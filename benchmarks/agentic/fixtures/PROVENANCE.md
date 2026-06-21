# Fixture provenance

Both `DNA_slice.c` and `DNA_slice2.c` are byte-exact, unmodified slices of real,
published scientific C code. Neither is synthetic and neither is hand-edited.

**Source:** [`RNA-folding-lab/DNAfold`](https://github.com/RNA-folding-lab/DNAfold), `program/DNA.c`.
A Monte Carlo / simulated-annealing model for predicting 3D DNA structure, by
Ya-Zhou Shi & Zi-Chun Mu.

`DNA.c.full` in this directory is the complete original file (fetched directly
from `raw.githubusercontent.com`) so both slices' authenticity can be checked
by anyone.

## DNA_slice.c (used by `--task dna-guard`)

**Extraction:** lines 480-556 of the original file, copied verbatim via `sed`.

```bash
sed -n '480,556p' DNA.c.full | cmp - DNA_slice.c && echo "byte-identical"
```

Contains `PC`, `CP`, `CN`, `PCP`, `CPC`, `PCN`, `NCP` — seven short functions
with near-identical shapes (same parameter list, same `sqrt(...)` distance-
formula pattern, different constants and offsets). `CPC` has a bounds guard
(`if(i1+2>N0) ue0=0.0; else { ... }`) that its sibling `PCN` is missing
entirely. The task: add the matching guard to `PCN`. This tests "find the
right one among several near-duplicates and copy a pattern correctly."

## DNA_slice2.c (used by `--task dna-bound`)

**Extraction:** lines 557-645 of the original file, copied verbatim via `sed`.

```bash
sed -n '557,645p' DNA.c.full | cmp - DNA_slice2.c && echo "byte-identical"
```

Contains `PCPC`, `CPCP`, `CPCN`, `NCPC` — four longer dihedral-angle functions.
Three guard with `if(i1+2>L0_chain[jc])`; one (`CPCN`) correctly guards the
*opposite* end (`if(i1-4<0)`) because it reads backward instead of forward.
The actual, **verified** bug: `CPCP`'s body reads as far as `x1[jc][i1+4]`
(confirmed via `grep -o 'i1+4'` against the live file), but its guard only
checks `i1+2>L0_chain[jc]` — two elements short of what it actually accesses.
The task: tighten *only* `CPCP`'s guard to match what it reads.

This is deliberately a **different bug shape** from `dna-guard`: copying any
sibling's guard verbatim (the "obvious" pattern-match three of the four
functions would suggest) produces the *wrong* fix here. It punishes confident
pattern-matching rather than carelessness, which is a meaningfully different
and harder failure mode for a benchmark to separate models on.

## Why two slices from the same file

Same real-world messiness (one-letter variables, near-duplicate functions,
almost no whitespace) but two distinct bug shapes means the benchmark isn't
just re-testing the same lucky pattern-match twice. `dna-guard` rewards
"copy a guard verbatim onto the one function missing it." `dna-bound` punishes
"copy a guard verbatim onto the wrong target" — you have to actually read what
the buggy function accesses, not just match the majority shape.

## License note

The DNAfold repository is academic research code. These fixtures reproduce
small slices for benchmarking purposes (testing whether an AI agent's *edit*
to them applies cleanly); they do not redistribute the program as a usable
tool. If you fork this benchmark for wider distribution, check the upstream
repository's license terms.
