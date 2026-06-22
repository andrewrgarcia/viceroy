# Viceroy benchmark

Viceroy claims its edits **apply cleanly**, **actually fix the bug**, and **cost the reader little to act on**. All three are checkable, not a vibe — the headline numbers are facts.

Three deterministic instruments, each runnable with `--selftest` (no API, no cost):

| instrument | question | self-tests |
|---|---|---|
| [`applyability.js`](applyability.js) | can the edit be dropped in? (verbatim, unique, no elision) | 20 |
| [`blast-radius.js`](blast-radius.js) | did it do the job without breaking a neighbor? | 29 |
| [`cognitive-load.js`](cognitive-load.js) | what does the instruction cost the reader to act on? | 9 |

The first measures delivery, the second correctness, the third reader effort — Viceroy's actual claim, not just whether the output was sound. They're orthogonal on purpose: an edit can apply cleanly while having done nothing (a whole-file dump that silently deletes the target — this really happened, see below), or fix the bug while making the human hunt for what changed.

On the real `dna-guard` task, `n=10`, live `qwen2.5-coder` (7.6B, free, local): Viceroy hits **90% task-done, 100% collateral-free**; the bare baseline hits **0%/0%**, every run, while still passing the applyability check — same model, only the prompt differs. Full story, all the rounds, all the scorer bugs found and fixed in the open, including a confirmed capability ceiling on a harder task: see the [top-level README](../README.md#whats-measured-so-far).

## What is measured

Three axes, all deterministic, no LLM judge anywhere in the loop.

**1. Applyability — `applyability.js`.** For every exact swap an answer emits, the quoted "old block" must appear in the current file **exactly once**.

| occurrences of the old block | verdict |
|---|---|
| 1 | applies — unique, droppable |
| 0 | broken — paraphrased from memory, or a stale file |
| 2+ | ambiguous — the reader can't tell which one to replace |

Every whole-file answer must also contain **no elision markers** — `// ... rest unchanged`, `# existing code here`, `(unchanged)`, `existing <words> goes here`. A file with a hole where code belongs is a failed deliverable.

**2. Correctness and blast radius — `blast-radius.js`.** Applyability alone can be gamed: a whole-file answer can drop in clean while having deleted the target function entirely. So this instrument splits correctness into two:

- **task-done** — did the change actually land in the target function, with the required fix present? Compared after stripping all whitespace, so a correct fix that's been reformatted or reindented isn't punished for spacing (a real bug, found and fixed — see Round 7 in the top-level README).
- **collateral-free** — were the functions the task said *not* to touch left equivalent to the original? This is the most Viceroy-attributable axis: a surgical swap of one function structurally cannot corrupt another, because it never reproduces it.

**3. Reader cost — `cognitive-load.js`.** The axis that measures what Viceroy is actually *for*. The effort to turn an instruction into the correct edit is the information the reader must *supply that the instruction didn't* — estimated deterministically via Normalized Compression Distance (`gzip`) and whitespace-insensitive verbatim coverage against the known-correct edit. No test subjects, no self-report, no LLM judge. On real captured model answers: a correct fix delivered as a complete (if reformatted) function scores ~8% reader-reconstruction; a broken whole-file answer that deleted the target scores ~31%.

## The instruments

Each ships with reference good/bad answers and a `--selftest` that proves the checker works *before* any model is ever scored:

```bash
node applyability.js --selftest      # 20 cases
node blast-radius.js --selftest      # 29 cases, incl. 3 real captured model answers pinned as regressions
node cognitive-load.js --selftest    # 9 cases, incl. a real captured model answer pinned as a regression
```

`applyability.js` exposes the building blocks directly:

- `checkSwapApplies(source, oldBlock)` → `{ applies, count, reason }`
- `findElision(fileText)` → `{ whole, hits }`
- `scoreAnswer(answer, sources)` → end-to-end applyability of a Viceroy-shaped answer against the files it edits

`blast-radius.js` exposes `analyze(answer, original, { targetFn, requiredToken })`, and `cognitive-load.js` exposes `readerLoad(instruction, target)`.

A note on conservative bias, inherited from `applyability.js`'s elision check: it requires comment context, so a comment that happens to contain a tracked phrase is flagged even with benign intent. That's intentional — false positives are cheap (reword the comment), false negatives ship a hole. The self-test documents and pins this on both sides (catches real elision; doesn't flag ordinary comments that just happen to end in a similar word).

## The agentic harness

The honest, defensible benchmark is a real model doing real work, not a one-shot completion graded by eye — the same shift ponytail made after its single-shot numbers were criticized for an inflated baseline. `agentic/mini-agent.js` is that harness:

- **Unit:** a real local model (via [Ollama](https://ollama.com)), free, given a real file and a real task, looped through read → answer → score → apply.
- **Baseline:** the same model, same task, with only the system prompt swapped to a generic "you are a helpful coding assistant" — so any difference is attributable to the skill, not the model.
- **Tasks:** two real, byte-exact, unmodified slices of published scientific C ([`RNA-folding-lab/DNAfold`](https://github.com/RNA-folding-lab/DNAfold)), chosen because they have several near-identical sibling functions — the regime where *where* the edit goes is as easy to get wrong as *what* it is. `dna-guard` (a missing guard to copy) and `dna-bound` (a present-but-insufficient guard — a harder failure mode that punishes pattern-matching). Details: [`agentic/README.md`](agentic/README.md), provenance: [`agentic/fixtures/PROVENANCE.md`](agentic/fixtures/PROVENANCE.md).
- **Scoring:** every run goes through all three instruments above; `--compare --runs N` reports an apply-rate, task-done-rate, collateral-free-rate, and average reader-reconstruction per arm, plus a cross-task aggregate when more than one real task runs together.

This harness already disproved its own first hypothesis once: the original trivial task scored both arms at 100%, a real null that revealed the task — not the skill — was too easy to discriminate, which is exactly why `dna-guard` and `dna-bound` exist. The design is built to say so when the skill doesn't help, not to find a way to make it look like it does.

```bash
ollama pull qwen2.5-coder
cd agentic
node mini-agent.js --demo --task all --compare                     # no model, proves the wiring
node mini-agent.js --model qwen2.5-coder --task dna-guard --compare --runs 10   # the real thing
```

## Status

| piece | state |
|---|---|
| applyability instrument | **built, self-tested (20), no API** |
| correctness / blast-radius instrument | **built, self-tested (29, incl. 3 real regressions), no API** |
| reader-cost instrument | **built, self-tested (9, incl. 1 real regression), no API** |
| agentic harness, free local model | **built and run live** — `n=10`, real numbers in the top-level README |
| `dna-guard` result | **90% task-done / 100% collateral-free (viceroy) vs 0% / 0% (baseline)** |
| `dna-bound` result | **confirmed capability ceiling**, both arms near 0%, two model sizes (7.6B, 14B) |
| seam-quality judge for the "tidier" law | not yet built — see [roadmap](../README.md#roadmap) |
| more tasks for statistical weight | not yet — see [roadmap](../README.md#roadmap) |

The instruments are done and have already caught three real scorer bugs by being run against live model output instead of trusted on synthetic cases alone. The numbers above are real, reproducible, and $0.