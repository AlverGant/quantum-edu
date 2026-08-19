// Testes do que o Worker faz de puro: agregação de amostras e sanidade dos
// circuitos gerados. Rodam com type-stripping do Node, sem toolchain.
import test from 'node:test';
import assert from 'node:assert/strict';

import { aggregate } from '../src/shor.ts';
import { CIRCUITS } from '../src/circuits.gen.ts';

test('aggregate conta amostras hex com e sem prefixo', () => {
  const counts = aggregate(['0x0', '0x4', '0x4', '4', '0xc', '0']);
  assert.deepEqual(counts, { 0: 2, 4: 3, 12: 1 });
});

test('aggregate rejeita amostra inválida', () => {
  assert.throws(() => aggregate(['0xzz']), /inválida/);
});

test('circuitos gerados: ideal soma 1 e QASM presente por backend', () => {
  assert.equal(CIRCUITS.length, 3);
  for (const c of CIRCUITS) {
    const total = Object.values(c.ideal).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(total - 1) < 1e-3, `${c.id}: ideal soma ${total}`);
    const backends = Object.keys(c.backends);
    assert.ok(backends.length >= 1, `${c.id}: sem backend`);
    for (const b of backends) {
      const info = c.backends[b];
      assert.match(info.qasm, /^OPENQASM 3/, `${c.id}/${b}: QASM3 ausente`);
      assert.match(info.qasm, /meas\[0\] = measure/, `${c.id}/${b}: sem medição`);
      assert.ok(info.twoq_gates > 0, `${c.id}/${b}: sem portas de 2 qubits`);
    }
    // Todo k do ideal precisa caber no registrador de contagem.
    const M = 2 ** c.counting_qubits;
    for (const k of Object.keys(c.ideal)) {
      assert.ok(Number(k) >= 0 && Number(k) < M, `${c.id}: k=${k} fora de [0,${M})`);
    }
  }
});

test('os três circuitos da rotação são rasos o bastante para ter picos', () => {
  const byId = Object.fromEntries(CIRCUITS.map((c) => [c.id, c]));
  const twoq = (id) => Object.values(byId[id].backends)[0].twoq_gates;
  assert.ok(twoq('shor15_compilado') < 200, 'compilado deveria ser raso');
  assert.ok(twoq('shor21_orbita') < 200, 'órbita 21 deveria ser rasa');
  assert.ok(twoq('shor35_orbita') < 200, 'órbita 35 deveria ser rasa');
});
