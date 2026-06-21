# Fixture provenance: DNA_slice.c

`DNA_slice.c` is a byte-exact, unmodified slice of real, published scientific C
code. It is not synthetic and not hand-edited.

**Source:** [`RNA-folding-lab/DNAfold`](https://github.com/RNA-folding-lab/DNAfold), `program/DNA.c`.
A Monte Carlo / simulated-annealing model for predicting 3D DNA structure, by
Ya-Zhou Shi & Zi-Chun Mu.

**Extraction:** lines 480-556 of the original file, copied verbatim via `sed`.
`DNA.c.full` in this directory is the complete original file (fetched directly
from `raw.githubusercontent.com`) so the slice's authenticity can be checked
by anyone:

```bash
sed -n '480,556p' DNA.c.full | cmp - DNA_slice.c && echo "byte-identical"
```

**Why this slice.** It contains `PC`, `CP`, `CN`, `PCP`, `CPC`, `PCN`, `NCP` —
seven short functions with near-identical shapes (same parameter list, same
`sqrt(...)` distance-formula pattern, different constants and offsets). `CPC`
has a bounds guard (`if(i1+2>N0) ue0=0.0; else { ... }`) that its sibling `PCN`
is missing. That gives `benchmarks/agentic/mini-agent.js`'s `dna-guard` task a
genuine, real-world "find the right one among several near-duplicates and copy
a pattern correctly" problem — exactly the regime a 10-line synthetic file
cannot test, and exactly the regime Viceroy's "verbatim and unique" rule exists
for.

**License note.** The DNAfold repository is academic research code. This
fixture reproduces a small slice for benchmarking purposes (testing whether an
AI agent's *edit* to it applies cleanly); it does not redistribute the program
as a usable tool. If you fork this benchmark for wider distribution, check the
upstream repository's license terms.