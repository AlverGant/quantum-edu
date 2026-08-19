#!/usr/bin/env python3
"""Gera os circuitos de Shor que o Worker submete ao hardware da IBM.

Roda offline, uma vez, na máquina do desenvolvedor — o Worker não tem Qiskit
e não transpila nada: ele submete o OpenQASM 3 pronto que este script emite.
O preço dessa simplicidade é que cada circuito é transpilado para backends
específicos (qubits físicos fixos); se a IBM aposentar um backend, rode de
novo com o fake novo.

Três circuitos, três papéis pedagógicos:

  shor15_compilado  N=15, a=7.  Multiplicação modular por truque de bits:
                    x*8 mod 15 é rotação de bits (16≡1) e x*7 = -8x é
                    rotação seguida de NOT (15 é tudo-1s). ~dezenas de
                    portas de 2 qubits -> picos visíveis em hardware real.

  shor21_orbita     N=21, a=4 (ordem 3). Registrador de trabalho comprimido
                    na órbita {1,4,16} -> 2 qubits. r=3 não divide 2^m, então
                    os picos caem "entre" os inteiros — é o caso em que as
                    frações continuadas são necessárias. Rotulado no site
                    como circuito *compilado*: usa conhecimento prévio da
                    órbita, coisa que uma fatoração cega não teria.

  shor15_generico   O MESMO N=15, mas com a construção genérica de
                    Beauregard (arXiv:quant-ph/0205095): somadores de
                    constantes em base de Fourier, adição modular com
                    ancilla de comparação, multiplicador controlado +
                    des-cômputo. Nenhuma estrutura do problema é usada — o
                    circuito tem o mesmo tamanho para qualquer constante.
                    Milhares de portas de 2 qubits -> o ruído vence. O
                    contraste com o compilado é a aula inteira.

Cada circuito é validado por simulação (Statevector) antes de ser emitido:
se a distribuição ideal não bater com a teoria, o script aborta.

Saídas:
  worker/src/circuits.gen.ts   QASM3 por backend + metadados (o Worker importa)
  web/data/circuits.json       metadados + distribuição ideal (o site importa)

Uso:
  .venv/bin/python circuits/build_circuits.py
"""

from __future__ import annotations

import json
import math
import sys
from fractions import Fraction
from pathlib import Path

import numpy as np
from qiskit import QuantumCircuit, QuantumRegister, ClassicalRegister, transpile
from qiskit import qasm3
from qiskit.circuit.library import PhaseGate, UnitaryGate, QFTGate
from qiskit.synthesis import synth_qft_full
from qiskit.quantum_info import Statevector
from qiskit_ibm_runtime.fake_provider import FakeMarrakesh, FakeFez, FakeKingston

ROOT = Path(__file__).resolve().parent.parent

# Backends-alvo. O Worker tenta na ordem; o primeiro operacional leva o job.
BACKENDS = {
    "ibm_marrakesh": FakeMarrakesh,
    "ibm_fez": FakeFez,
    "ibm_kingston": FakeKingston,
}

SEED_TRANSPILE = 2026  # reprodutibilidade: mesmo layout a cada rodada


def _iqft_gate(m: int):
    """QFT inversa com reordenação de bits (equivale ao antigo do_swaps=True)."""
    g = QFTGate(m).inverse().to_mutable()
    g.label = "iqft"
    return g


# ---------------------------------------------------------------------------
# shor15_compilado — permutações de bits
# ---------------------------------------------------------------------------

def shor15_compilado() -> QuantumCircuit:
    """3 qubits de contagem + 4 de trabalho. a=7, r=4.

    Convenção (a mesma do QPE do livro-texto): qubit de contagem t controla
    U^(2^t); QFT inversa com do_swaps=True; contagem lida com o qubit 0 como
    bit menos significativo.
    """
    m, n = 3, 4
    c = QuantumRegister(m, "c")
    w = QuantumRegister(n, "w")
    meas = ClassicalRegister(m, "meas")
    qc = QuantumCircuit(c, w, meas)

    qc.x(w[0])          # registrador de trabalho começa em |1>
    qc.h(c)

    # c0 controla x*7 mod 15: rotação (x*8) + NOT (negação mod 15).
    # x*8: w0<-w1, w1<-w2, w2<-w3, w3<-w0  == swaps em cadeia.
    qc.cswap(c[0], w[0], w[1])
    qc.cswap(c[0], w[1], w[2])
    qc.cswap(c[0], w[2], w[3])
    for q in w:
        qc.cx(c[0], q)

    # c1 controla x*7^2 = x*4 mod 15: rotação de 2 bits.
    qc.cswap(c[1], w[0], w[2])
    qc.cswap(c[1], w[1], w[3])

    # c2 controla x*7^4 = x*1: identidade — nada a fazer, mas o qubit
    # participa da QFT inversa (o zero dele carrega informação de fase).

    qc.append(_iqft_gate(m), c)
    qc.measure(c, meas)
    return qc


# ---------------------------------------------------------------------------
# shor21_orbita — órbita {1,4,16} comprimida em 2 qubits
# ---------------------------------------------------------------------------

def shor21_orbita() -> QuantumCircuit:
    """3 qubits de contagem + 2 de trabalho. a=4, r=3.

    |00> = 1, |01> = 4, |10> = 16. U = x*4 cicla 00->01->10->00 (|11> fixo).
    U^2 é o ciclo inverso; U^4 = U (ordem 3).
    """
    m = 3
    c = QuantumRegister(m, "c")
    w = QuantumRegister(2, "w")
    meas = ClassicalRegister(m, "meas")
    qc = QuantumCircuit(c, w, meas)

    # Trabalho começa em |00> = valor 1: nenhum X necessário.
    qc.h(c)

    perm = np.zeros((4, 4))
    for src, dst in [(0, 1), (1, 2), (2, 0), (3, 3)]:
        perm[dst, src] = 1.0
    u = UnitaryGate(perm, label="x4")
    u2 = UnitaryGate(perm @ perm, label="x16")

    qc.append(u.control(1), [c[0], w[0], w[1]])
    qc.append(u2.control(1), [c[1], w[0], w[1]])
    qc.append(u.control(1), [c[2], w[0], w[1]])   # U^4 = U

    qc.append(_iqft_gate(m), c)
    qc.measure(c, meas)
    return qc


# ---------------------------------------------------------------------------
# shor35_orbita — órbita {1, 8, 29, 22} comprimida em 2 qubits
# ---------------------------------------------------------------------------

def shor35_orbita() -> QuantumCircuit:
    """3 qubits de contagem + 2 de trabalho. a=8, r=4.

    |00>=1, |01>=8, |10>=29, |11>=22. U = x*8 é o 4-ciclo (incremento mod 4);
    U^2 troca os pares; U^4 = identidade. r=4 divide 8: picos limpos em
    0, 2, 4, 6 — e r par dispensa truque: 8^2 = 29, mdc(29∓1, 35) = 7 e 5.
    """
    m = 3
    c = QuantumRegister(m, "c")
    w = QuantumRegister(2, "w")
    meas = ClassicalRegister(m, "meas")
    qc = QuantumCircuit(c, w, meas)

    qc.h(c)

    perm = np.zeros((4, 4))
    for src, dst in [(0, 1), (1, 2), (2, 3), (3, 0)]:
        perm[dst, src] = 1.0
    u = UnitaryGate(perm, label="x8")
    u2 = UnitaryGate(perm @ perm, label="x29")

    qc.append(u.control(1), [c[0], w[0], w[1]])
    qc.append(u2.control(1), [c[1], w[0], w[1]])
    # c2 controla U^4 = identidade — nada a fazer.

    qc.append(_iqft_gate(m), c)
    qc.measure(c, meas)
    return qc


# ---------------------------------------------------------------------------
# shor15_generico — Beauregard (quant-ph/0205095)
#
# Mantido como EXPERIMENTO DE CONTROLE, fora da rotação semanal desde a
# rodada 1 (job da2jovuaa69c739hjfeg, ibm_fez, 2026-08-19): 12.428 portas de
# 2 qubits devolveram 14% de shots "bons" contra 13% do acaso — afogou no
# ruído exatamente como previsto. O site conta essa história em texto.
# ---------------------------------------------------------------------------
#
# Registradores:
#   c    m qubits de contagem
#   x    n qubits de trabalho (multiplicando)
#   b    n+1 qubits acumulador (as somas modulares acontecem aqui, em base
#        de Fourier; o qubit extra evita overflow)
#   anc  1 qubit de comparação da adição modular
#
# Tudo abaixo segue o paper; a única liberdade é usar PhaseGate.control(k)
# e deixar o transpilador decompor.

def _qft_raw(qc: QuantumCircuit, qubits, inverse: bool = False) -> None:
    """QFT sem swaps sobre `qubits` (qubit de índice alto = mais significativo)."""
    gate = synth_qft_full(len(qubits), do_swaps=False, inverse=inverse).to_gate(
        label="iqft~" if inverse else "qft~")
    qc.append(gate, qubits)


def _phase_add_const(qc: QuantumCircuit, reg, value: int, controls=(), sign: int = 1) -> None:
    """Soma (sign=+1) ou subtrai a constante `value` no registrador `reg`,
    que precisa estar em base de Fourier. Zero portas de 2 qubits quando não
    há controle: constantes viram só rotações."""
    nbits = len(reg)
    for j, q in enumerate(reg):
        # Contribuição da constante ao qubit j (j = menos significativo).
        angle = 0.0
        for k in range(nbits):
            if (value >> k) & 1 and k <= j:
                angle += math.pi / (2 ** (j - k))
        angle *= sign
        if angle == 0.0:
            continue
        if controls:
            qc.append(PhaseGate(angle).control(len(controls)), [*controls, q])
        else:
            qc.p(angle, q)


def _cc_add_mod(qc: QuantumCircuit, ctrls, breg, anc, a: int, N: int) -> None:
    """(controlado-controlado) b <- b + a mod N, com b em base de Fourier.

    Beauregard fig. 5: soma a, subtrai N, o sinal (qubit alto de b) diz se
    passou de N; a ancilla recondiciona; des-computa a comparação no final.
    """
    top = breg[-1]
    _phase_add_const(qc, breg, a, controls=ctrls, sign=+1)
    _phase_add_const(qc, breg, N, sign=-1)
    _qft_raw(qc, breg, inverse=True)
    qc.cx(top, anc)
    _qft_raw(qc, breg)
    _phase_add_const(qc, breg, N, controls=(anc,), sign=+1)
    _phase_add_const(qc, breg, a, controls=ctrls, sign=-1)
    _qft_raw(qc, breg, inverse=True)
    qc.x(top)
    qc.cx(top, anc)
    qc.x(top)
    _qft_raw(qc, breg)
    _phase_add_const(qc, breg, a, controls=ctrls, sign=+1)


def _cmult_mod(qc: QuantumCircuit, ctrl, xreg, breg, anc, a: int, N: int,
               inverse: bool = False) -> None:
    """Controlado: b <- b + a*x mod N (ou o inverso). b sai/entra em base
    computacional; a base de Fourier é interna."""
    _qft_raw(qc, breg)
    pairs = [(i, (a * (1 << i)) % N) for i in range(len(xreg))]
    if inverse:
        for i, const in reversed(pairs):
            _cc_add_mod_inverse(qc, (ctrl, xreg[i]), breg, anc, const, N)
    else:
        for i, const in pairs:
            _cc_add_mod(qc, (ctrl, xreg[i]), breg, anc, const, N)
    _qft_raw(qc, breg, inverse=True)


def _cc_add_mod_inverse(qc, ctrls, breg, anc, a: int, N: int) -> None:
    """Inverso exato de _cc_add_mod (portas na ordem oposta, ângulos opostos)."""
    top = breg[-1]
    _phase_add_const(qc, breg, a, controls=ctrls, sign=-1)
    _qft_raw(qc, breg, inverse=True)
    qc.x(top)
    qc.cx(top, anc)
    qc.x(top)
    _qft_raw(qc, breg)
    _phase_add_const(qc, breg, a, controls=ctrls, sign=+1)
    _phase_add_const(qc, breg, N, controls=(anc,), sign=-1)
    _qft_raw(qc, breg, inverse=True)
    qc.cx(top, anc)
    _qft_raw(qc, breg)
    _phase_add_const(qc, breg, N, sign=+1)
    _phase_add_const(qc, breg, a, controls=ctrls, sign=-1)


def _c_ua(qc: QuantumCircuit, ctrl, xreg, breg, anc, a: int, N: int) -> None:
    """Controlado-U_a: |x> -> |a*x mod N>, via multiplica/troca/des-multiplica."""
    n = len(xreg)
    _cmult_mod(qc, ctrl, xreg, breg, anc, a, N)
    for i in range(n):
        qc.cswap(ctrl, xreg[i], breg[i])
    a_inv = pow(a, -1, N)
    _cmult_mod(qc, ctrl, xreg, breg, anc, a_inv, N, inverse=True)


def shor15_generico(m: int = 4, a: int = 7, N: int = 15) -> QuantumCircuit:
    """m qubits de contagem, construção genérica completa.

    Com m=4 os picos ideais caem em 0, 4, 8, 12 (r=4 divide 16). Nada aqui
    sabe que N=15 tem estrutura: trocar N e a produz um circuito do mesmo
    tamanho.
    """
    n = N.bit_length()
    c = QuantumRegister(m, "c")
    x = QuantumRegister(n, "x")
    b = QuantumRegister(n + 1, "b")
    anc = QuantumRegister(1, "anc")
    meas = ClassicalRegister(m, "meas")
    qc = QuantumCircuit(c, x, b, anc, meas)

    qc.x(x[0])
    qc.h(c)
    for t in range(m):
        _c_ua(qc, c[t], x, b, anc[0], pow(a, 1 << t, N), N)
    qc.append(_iqft_gate(m), c)
    qc.measure(c, meas)
    return qc


# ---------------------------------------------------------------------------
# Validação: a distribuição ideal tem que bater com a teoria
# ---------------------------------------------------------------------------

def ideal_distribution(qc: QuantumCircuit) -> dict[int, float]:
    """Distribuição da contagem por simulação exata do circuito lógico."""
    bare = qc.remove_final_measurements(inplace=False)
    sv = Statevector.from_instruction(bare)
    m = qc.cregs[0].size
    probs = sv.probabilities(qargs=list(range(m)))  # contagem = primeiros m qubits
    return {k: float(p) for k, p in enumerate(probs) if p > 1e-9}

def expected_peaks(m: int, r: int) -> dict[int, float]:
    """P(k) teórica da estimativa de fase de U com autofases s/r, s=0..r-1."""
    M = 1 << m
    probs = {}
    for k in range(M):
        total = 0.0
        for s in range(r):
            amp = sum(np.exp(2j * np.pi * x * (s / r - k / M)) for x in range(M)) / M
            total += abs(amp) ** 2 / r
        if total > 1e-9:
            probs[k] = total
    return probs

def check(name: str, got: dict[int, float], want: dict[int, float]) -> None:
    keys = set(got) | set(want)
    worst = max(abs(got.get(k, 0.0) - want.get(k, 0.0)) for k in keys)
    if worst > 1e-6:
        print(f"ERRO {name}: distribuição não bate (desvio máximo {worst:.2e})")
        for k in sorted(keys):
            print(f"  k={k:3d}  simulado={got.get(k, 0.0):.6f}  teoria={want.get(k, 0.0):.6f}")
        sys.exit(1)
    print(f"  ok  {name}: distribuição confere (desvio máx {worst:.1e})")


# ---------------------------------------------------------------------------
# Emissão
# ---------------------------------------------------------------------------

def main() -> None:
    specs = [
        {
            "id": "shor15_compilado",
            "title": "N=15, circuito compacto",
            "N": 15, "a": 7, "r": 4, "shots": 4096,
            "kind": "compilado",
            "build": shor15_compilado,
            "note": "Multiplicação modular por rotação de bits — usa o fato de 15 ser 2^4−1.",
        },
        {
            "id": "shor21_orbita",
            "title": "N=21, órbita comprimida",
            "N": 21, "a": 4, "r": 3, "shots": 4096,
            "kind": "compilado",
            "build": shor21_orbita,
            "note": "Registrador de trabalho reduzido à órbita {1,4,16} — 2 qubits. r=3 não divide 8: frações continuadas obrigatórias.",
        },
        {
            "id": "shor35_orbita",
            "title": "N=35, órbita comprimida",
            "N": 35, "a": 8, "r": 4, "shots": 4096,
            "kind": "compilado",
            "build": shor35_orbita,
            "note": "A órbita {1, 8, 29, 22} cabe em 2 qubits. r=4 divide 8: picos limpos — e 35 = 5 × 7 sai do hardware.",
        },
    ]

    out = []
    for spec in specs:
        print(f"{spec['id']}:")
        qc = spec["build"]()
        m = qc.cregs[0].size
        ideal = ideal_distribution(qc)
        check(spec["id"], ideal, expected_peaks(m, spec["r"]))

        entry = {
            "id": spec["id"],
            "title": spec["title"],
            "N": spec["N"], "a": spec["a"], "r": spec["r"],
            "kind": spec["kind"],
            "note": spec["note"],
            "counting_qubits": m,
            "logical_qubits": qc.num_qubits,
            "shots": spec["shots"],
            "ideal": {str(k): round(v, 6) for k, v in sorted(ideal.items())},
            "backends": {},
        }

        for bname, factory in BACKENDS.items():
            backend = factory()
            isa = transpile(qc, backend=backend, optimization_level=3,
                            seed_transpiler=SEED_TRANSPILE)
            ops = isa.count_ops()
            twoq = sum(v for g, v in ops.items() if g in ("cz", "ecr", "cx"))
            entry["backends"][bname] = {
                "qasm": qasm3.dumps(isa),
                "depth": isa.depth(),
                "twoq_gates": twoq,
                "total_gates": sum(v for g, v in ops.items() if g != "measure"),
            }
            print(f"  {bname}: depth={isa.depth()} 2q={twoq}")

        out.append(entry)

    # --- worker/src/circuits.gen.ts -------------------------------------
    ts_path = ROOT / "worker" / "src" / "circuits.gen.ts"
    header = (
        "// GERADO por circuits/build_circuits.py — não edite à mão.\n"
        "// Rode o script de novo para regenerar (precisa de Qiskit).\n\n"
        "export interface ShorCircuit {\n"
        "  id: string;\n  title: string;\n  N: number;\n  a: number;\n  r: number;\n"
        "  kind: 'compilado' | 'generico';\n  note: string;\n"
        "  counting_qubits: number;\n  logical_qubits: number;\n  shots: number;\n"
        "  ideal: Record<string, number>;\n"
        "  backends: Record<string, { qasm: string; depth: number; twoq_gates: number; total_gates: number }>;\n"
        "}\n\n"
    )
    ts_path.write_text(
        header + "export const CIRCUITS: ShorCircuit[] = "
        + json.dumps(out, ensure_ascii=False, indent=2)
        + ";\n",
        encoding="utf-8",
    )
    print(f"escrito {ts_path}")

    # --- web/data/circuits.json (sem QASM, com stats por backend) --------
    web = []
    for entry in out:
        e = {k: v for k, v in entry.items() if k != "backends"}
        e["backends"] = {
            b: {k: v for k, v in info.items() if k != "qasm"}
            for b, info in entry["backends"].items()
        }
        web.append(e)
    web_path = ROOT / "web" / "data" / "circuits.json"
    web_path.write_text(json.dumps(web, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"escrito {web_path}")


if __name__ == "__main__":
    main()
