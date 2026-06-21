# Agentic mini-agent

The smallest honest version of the agentic loop: read a file → ask a model to edit it → check whether the edit applies → apply it or report why not. It reuses the deterministic checkers in `../applyability.js`, `../blast-radius.js`, and `../cognitive-load.js`, so every axis is a fact, not a guess.

Two arms, same task, same file — only the system prompt differs:

- **viceroy** — the Viceroy skill loaded as the system prompt.
- **baseline** — a generic "you are a helpful coding assistant" prompt, no skill at all.

## Three gates, not one

Applyability ("does it drop in clean?") is necessary but **not sufficient** — a model can return a whole file that applies perfectly while having deleted the function it was asked to fix and corrupted a neighbor (this actually happened: see the dna-guard episode in the top-level README). And applyability + correctness together still don't measure *why* Viceroy matters to a human reader. So real tasks are scored on three instruments:

- `../applyability.js` — **does the edit apply?** (verbatim, unique, no elision)
- `../blast-radius.js` — **is it correct and surgical?** Two axes: *task-done* (did the change land in the target function?) and *collateral-free* (were the functions the task said not to touch left byte-identical?).
- `../cognitive-load.js` — **what does the instruction cost the human?** Deterministic gzip-NCD + verbatim coverage against the known-correct edit — no test subjects, no LLM judge. This is Viceroy's actual claim (specificity lowers reader effort), not just whether the output was sound.

A run only fully passes if it's applyable **and** task-done **and** collateral-free. The compare table shows applyable / task-done / collateral-free / reader-reconstruct together; a single run prints a "correctness" section and a "reader load" section. (`cache-fn` is Python and carries neither blast nor reader-load config, so it reports applyability only — it's the throwaway sanity task.)

## Three tasks

| `--task` | file | what it tests |
|---|---|---|
| `cache-fn` (default) | 10-line synthetic `service.py` | sanity check only. The file is short enough that there's nowhere to get lost, so both arms tend to score the same here — see the n=10 finding below. Kept for fast wiring checks. |
| `dna-guard` | 77-line real, unmodified slice of [`RNA-folding-lab/DNAfold`](https://github.com/RNA-folding-lab/DNAfold)'s `DNA.c` (lines 480-556) | **bug shape 1: missing guard.** Near-identical sibling functions (`PC`/`CP`/`CN` and `PCP`/`CPC`/`PCN`/`NCP`). `PCN` is missing a bounds guard its sibling `CPC` already has; add the matching guard, touching nothing else. Tests "find the right spot among several near-duplicates." |
| `dna-bound` | 89-line real, unmodified slice of the same file (lines 557-645) | **bug shape 2: wrong-target pattern-matching.** Four near-identical dihedral functions (`PCPC`/`CPCP`/`CPCN`/`NCPC`). Three share one guard pattern; `CPCP` has that same guard but it's *insufficient* for what `CPCP` itself reads (verified: it accesses `i1+4` but only guards `i1+2`). Copying any sibling's guard verbatim — the obvious move — produces the wrong fix here. Tests whether the model reads what the buggy function actually does instead of pattern-matching the majority shape. |

Both real tasks come from the same messy real file but exercise genuinely different failure modes — see `fixtures/PROVENANCE.md` for exactly how each was extracted and verified byte-identical to the original. `--task all` runs all three.

## Run it

No model needed (uses baked-in answers for every arm and every task — proves the apply + score path, including that the two arms actually score differently on every axis):

```bash
node mini-agent.js --demo                              # cache-fn, viceroy arm
node mini-agent.js --demo --task dna-bound --arm baseline
node mini-agent.js --demo --task all --compare          # all three tasks, both arms, plus the cross-task aggregate
```

Against a free local model via [Ollama](https://ollama.com):

```bash
node mini-agent.js --model qwen2.5-coder                                   # cache-fn, viceroy arm (defaults)
node mini-agent.js --model qwen2.5-coder --task dna-bound --arm baseline
node mini-agent.js --model qwen2.5-coder --task dna-guard --compare --runs 10
node mini-agent.js --model qwen2.5-coder --task all --compare --runs 10    # everything, plus the aggregate
```

Flags:

| flag | what it does |
|---|---|
| `--model <name>` | the Ollama model to use (default `llama3.2`; `qwen2.5-coder` edits noticeably better) |
| `--task cache-fn\|dna-guard\|dna-bound\|all` | which fixture to run (default `cache-fn`) |
| `--arm viceroy\|baseline` | which system prompt for a single run (default `viceroy`) |
| `--compare` | run all arms `--runs` times each (per task) and print the result table; with `--task all` (2+ real tasks) also prints a pooled cross-task aggregate |
| `--runs <n>` | how many times per arm under `--compare` (default 1 — see the caveat below) |
| `--demo` | skip the model entirely, use baked-in answers (works with all of the above) |

Single-run mode prints the model's answer, an applyability verdict, a correctness section (task-done / collateral-free, if the task has blast config), and a reader-load section (if the task has a known-correct target edit). Exit code `0` = applyable, `1` = not, `2` = couldn't reach the model.

`--compare` mode prints a result table per task, plus a cross-task aggregate when more than one real task ran together. **`n=1` (the default) only proves the wiring** — a single run can't tell you a rate, the same way one coin flip can't tell you if a coin is fair. Use `--runs 10` or more before reading anything into the percentages.

## What was found (real, live, n=10, $0)

The path here mattered as much as the destination — three real findings, in order:

1. **`cache-fn` (trivial task), n=10:** both arms 100%. The file is too short to discriminate. `dna-guard` exists because of this finding.
2. **`dna-guard`, first live run:** looked like another null (~0% task-done, both arms) — until inspecting raw output showed the *scorer*, not the model, was at fault. The viceroy-arm model was correctly fixing the bug but reformatting it (`i1-1` vs `i1 - 1`, reindented), and the scorer was comparing bytes, not semantics. Fixed `blast-radius.js` to compare function bodies and the required token after stripping whitespace, and to credit a correct fix delivered as prose. Full story, including both real captured answers (the broken baseline and the correct-but-reformatted viceroy fix), is in the top-level README and pinned in `fixtures/`.
3. **`dna-guard`, after the fix — the real result:** viceroy **90% task-done / 100% collateral-free**; baseline **0% / 0%**, every single run. Same model, only the prompt differs. **`dna-bound`, the real result:** both arms near 0% task-done. Inspecting raw output: the model doesn't fail to format the fix, it fails to *find* it — confusing `CPCP` with `CPC` and hallucinating which function it's even editing. Confirmed at a second, larger model (`qwen2.5-coder:14b` — see `fixtures/qwen14b_dnabound_viceroy.txt`) before stopping: same failure shape, not a fluke. This is a real, reproducible ceiling, not a broken task — no prompt fixes a bug the model can't locate.

The honest takeaway: Viceroy is a delivery-and-precision discipline, and `dna-guard` shows it working cleanly inside a model's actual capability. `dna-bound` shows the boundary of that capability, which Viceroy correctly does not paper over.

## What it is and isn't

This is a small, real, two-task benchmark with one clear, live, reproducible win (`dna-guard`) and one honestly documented capability ceiling (`dna-bound`), on a free local model. It is not the statistical weight ponytail's 12-task agentic run has: more tasks at `dna-guard`'s difficulty, more runs, more files would strengthen it further. The reader-cost axis (`cognitive-load.js`) still needs a format-aware pass — it currently scores qwen's correct-but-reformatted prose answers as high reader-cost, which understates the win `task-done` already shows cleanly. That's the next fix, not a reason to distrust the result above.