# Quantum Factoring (quantum-edu)

Educational site about quantum computing, built on top of the
[sorteio-quantico](https://sorteio.vynstream.com) infrastructure: Shor's
algorithm end to end — superposition, Hilbert space, interference,
measurement — with an **exact** in-browser simulation, and the same circuits
executed on real IBM Quantum hardware (Heron, 156 qubits).

**Live at:** https://quantum.vynstream.com (site content in Portuguese)

```
circuits/  offline circuit generator (Qiskit): validates against theory and
           emits pre-transpiled QASM3 per backend
worker/    Cloudflare Worker: assets + API + cron that runs the IBM jobs
web/       front-end: framework-free SPA, exact simulation in plain JS
```

## The two halves (and why there are two)

**In the browser.** Constructive/destructive interference, phases and
amplitudes are invisible on real hardware — a QPU only returns measurement
counts. So the interactive part is an exact simulation: the state after the
oracle is (1/√M)·Σ|x⟩|aˣ mod N⟩, the work-register values split it into r
arithmetic combs, and the inverse QFT of each comb is a size-M FFT.
`web/sim.js` computes the exact amplitudes in O(r·M·log M) — any valid N up
to 99 runs instantly.

**On hardware.** Three circuits with distinct pedagogical roles, submitted
together in one weekly job:

| circuit | qubits | 2q gates | role |
|---|---|---|---|
| `shor15_compilado` | 7 | 83 | N=15, a=7 via bit tricks (×8 = rotation, ×7 = rotation+NOT) → visible peaks |
| `shor21_orbita` | 5 | 39 | N=21, a=4, orbit {1,4,16} compressed into 2 qubits → r=3 ∤ 8, continued fractions required |
| `shor15_generico` | 14 | 12,428 | the SAME N=15 via Beauregard's generic construction (quant-ph/0205095) → drowns in noise |

The compiled × generic contrast (83 vs 12,428 gates for the same
factorization) is the site's central lesson: nearly every "quantum
factorization" ever demonstrated used shortcuts built from prior knowledge of
the answer (the classic critique: Smolin et al., arXiv:1301.7007), and the
real frontier is error correction, not qubit count.

## Circuits: regenerating

The QASM3 files are pre-transpiled for specific backends (fixed physical
qubits). If IBM retires `ibm_marrakesh`/`ibm_fez`, update `BACKENDS` in the
script and rerun:

```bash
python3 -m venv .venv
.venv/bin/pip install -r circuits/requirements.txt
.venv/bin/python circuits/build_circuits.py
```

The script **validates every circuit by simulation against the theoretical
distribution** and aborts on mismatch. Outputs: `worker/src/circuits.gen.ts`
(with QASM, imported by the Worker) and `web/data/circuits.json` (without
QASM, consumed by the site).

## Operation

Same design as the sorteio's harvest: a 5-minute cron ticks a one-row state
machine (`shor_state`), only one job is ever in flight, and the actual run
cadence comes from `RUN_PERIOD_DAYS` (default 7).

```
idle       ──▶ last good run older than 7 days?  submit all 3 PUBs in one job ──▶ submitted
submitted  ──▶ polling; on completion: aggregate counts into shor_runs ────────▶ idle
```

### QPU budget — careful

The IBM instance is the SAME one used by sorteio-quantico: **10 min/month
shared** (Open plan). The sorteio harvest uses ~300 s/month. One run here
costs ~10–15 charged seconds (the generic circuit dominates: depth ~26,600);
weekly ≈ 60 s/month. If it gets tight, raise `RUN_PERIOD_DAYS` or drop the
generic circuit from the PUBs.

### API

```
GET  /api/runs        latest good run (cached 1h)
GET  /api/state       state machine (debug)
POST /api/admin/run   Bearer ADMIN_TOKEN; ?force=1 ignores the calendar
```

## Deploy (first time)

Credentials are Wrangler secrets only — nothing sensitive lives in the repo.

```bash
cd worker
npm install
npx wrangler d1 create quantum_edu     # paste the id into wrangler.toml
npm run db:remote
npx wrangler secret put IBM_API_KEY    # IBM Cloud API key
npx wrangler secret put IBM_CRN        # IBM Quantum instance CRN
npx wrangler secret put ADMIN_TOKEN
npm run deploy                         # runs tests + typecheck first
# first run without waiting for the cron:
curl -X POST -H "authorization: Bearer $ADMIN_TOKEN" \
     "https://quantum.vynstream.com/api/admin/run?force=1"
```

The site works before the first run (it shows the ideal distributions and
says so), so the deploy can go ahead of the first job.

## Tests

```bash
cd worker && npm test        # sample aggregation + generated-circuit sanity
npm run typecheck
```

The front-end was tested with Playwright (full flow: prepare, 4 stages,
measure until factoring, custom N, input validation, mobile). The engine
`web/sim.js` is a pure module, testable in Node:

```bash
cd web && node --input-type=module -e "
import { prepare, finalState } from './sim.js';
console.log(finalState(prepare(15, 7)).probs.filter(p => p > 1e-9))"
```

## Decisions worth a line

- **The Worker does not transpile.** Shor circuits entangle and need routing;
  that's a transpiler's job, not a Worker's. Transpilation happens offline
  with a fixed seed and the Worker delivers ready-made QASM3 — the price is
  regenerating when a backend dies.
- **Three PUBs, one job.** The fixed cost is ~3 s of charged QPU per job;
  three separate jobs would pay that toll three times.
- **The site's simulation doesn't pretend to be gate-by-gate.** It is the
  same algebra through the shortcut the circuit's structure allows, and the
  site's text says so.
- **Phase 0 maps to the house cyan, not red.** A red bar reads as an error;
  the phase wheel is rotated (+175°) so zero lands on the brand color. The
  angle is always redundant to the hue (phasor + tooltip) — color is never
  the only channel.
- **Data-series colors validated** (`#14a898` measured, `#8b6cf6` ideal) for
  color-vision deficiency and contrast over `#0d0f1a`; every chart has a
  legend, tooltips and a table view.

## License

MIT.
