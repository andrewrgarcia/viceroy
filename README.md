<p align="center">
    <img width="300" alt="sticker" src="https://github.com/user-attachments/assets/393108b7-bce7-4779-b4cb-c2e73cf90880" />
</p>

<h1 align="center">Viceroy</h1>

<p align="center">
  <em>He doesn't point at the code. He hands it to you, whole — and the room is tidier when he leaves.</em>
</p>

<p align="center">
  <strong>Applyable, not abstract · the full file or the exact verbatim swap · monoliths get cleaner where you touch them</strong>
</p>

---

You know the answer that helps nobody: *"Add a try/except around your database call, somewhere near the top of the function, and don't forget to import logging."* Where near the top? Which call? What exactly do I paste, and what do I delete to make room? You are now doing the work the assistant was supposed to do — locating the seam, reconstructing the edit, hoping you put it in the right place.

Viceroy is a mental model for an AI coding agent that refuses to do that. Two laws:

1. **Applyable, not abstract.** Every change arrives in a form you can drop in without thinking. If the change is substantial, you get the **whole file**. If it is a small change in a long file, you get an **exact, verbatim block-for-block swap**: *in this file, replace this (copied character-for-character from your current code) with this.* If the change creates files, you get the **directory tree first**, then each file headed by its path. Find it, select it, paste. Never `// ... rest unchanged`. Never "insert this somewhere around line 40." Never a file with no shown home.

2. **Tidier on the way out.** When Viceroy has to edit a monolith — a 300-line function, a file doing six jobs — it doesn't avert its eyes and it doesn't stop to rewrite from scratch. It improves *the seam it is already working at*: extracts the obvious unit, names the unnamed thing, leaves a `viceroy:` marker so the next reader sees the boundary. Moderate, behavior-preserving, scoped to the blast radius.

## Before / after

You ask an agent to add caching to a function buried in a 400-line `service.py`.

A typical answer:

> Wrap your `fetch_user` call in a cache. Add `from functools import lru_cache` to your imports, then put `@lru_cache` above the function. You may also want to handle the `maxsize` and add cache invalidation around your update calls.

*Which* imports block? *Which* update calls? You go hunting.

With Viceroy:

````
In `service.py`, replace this:

```python
def fetch_user(user_id):
    row = db.query("SELECT * FROM users WHERE id = ?", user_id)
    return User.from_row(row)
```

with this:

```python
@lru_cache(maxsize=1024)  # viceroy: see invalidation note below
def fetch_user(user_id):
    row = db.query("SELECT * FROM users WHERE id = ?", user_id)
    return User.from_row(row)
```

And add to the import block at the top of `service.py`, replace this:

```python
from .models import User
```

with this:

```python
from functools import lru_cache
from .models import User
```
````

Two swaps, both verbatim-old → new, both findable in one search. To apply: paste two blocks. Nothing to hunt for. (And if the change had been large, you'd get the whole file instead — Viceroy judges which.)

## The headline metric: applyability

A change is good when it drops in clean, and that turns out to be checkable, not a vibe:

- **Does the edit apply?** For every exact swap, the quoted "old block" must appear in the current file *exactly once*. Zero matches = broken (paraphrased, or a stale file). Two or more = ambiguous (which one?). Both are detectable by searching the file.
- **Is the file whole?** Every full-file answer must contain no elision markers (`// ... rest`, `# existing code here`, `(unchanged)`, `... keep the rest ...`). A file with a hole where code should be is a failed deliverable, detectably.

`benchmarks/applyability.js` is the instrument. It ships reference good/bad edits and a `--selftest` that runs with **no API key and no cost**, proving the checker can tell an applyable edit from a broken one before any model is ever scored:

```
$ node benchmarks/applyability.js --selftest
ok  verbatim unique old block APPLIES
ok  paraphrased old block is caught (count 0)
ok  non-unique old block is caught as ambiguous (count 2)
ok  bare "..." as a Python stub body is caught with no comment marker
ok  generalized "existing <words> goes here" placeholder is caught
ok  an ordinary comment ending in "here" with no elision intent passes
ok  an answer whose old block does not match the file scores NOT applyable
...
self-test: 20 passed, 0 failed -- all instruments valid
```

## What's measured so far

Honest and small, on purpose. This has gone through two rounds already, and both are kept visible rather than smoothed over.

**Round 1 — proving the wiring (n=1).** `benchmarks/agentic/mini-agent.js` runs one real pass of the loop: a seeded file, a real task, a free local model via [Ollama](https://ollama.com), the Viceroy skill as the system prompt, scored by the deterministic checker above — not eyeballed. First result, `qwen2.5-coder` (7.6B, Q4_K_M), n=1: one exact swap, verbatim and unique, applied cleanly. That proved the loop works end to end, on real hardware, for $0. It did not prove anything about Viceroy's *effect*, because there was no baseline to compare against yet.

**Round 2 — the comparison, and a null result (n=10).** A `baseline` arm was added (same task, same model, no Viceroy skill — just "you are a helpful coding assistant"). Running both arms 10 times each on the original trivial task:

```
arm        apply-rate
viceroy    10/10  (100%)
baseline   10/10  (100%)
```

Both arms hit 100%. That is a real finding about the *task*, not a disappointing result to bury: a 10-line file with one obvious edit site has nowhere to get lost, so even a generic prompt finds it without help. The task wasn't stressing the actual claim — Viceroy's value is in long, messy files where "where does this go" is genuinely hard, and a 10-line file can't test that.

**Round 3 — a real-world fixture (`dna-guard`).** In response, a second task was added using a byte-exact, unmodified 77-line slice of real published code: [`RNA-folding-lab/DNAfold`](https://github.com/RNA-folding-lab/DNAfold)'s `DNA.c`, a scientific C simulation with one-letter variable names and several near-identical sibling functions (`PC`/`CP`/`CN`, `PCP`/`CPC`/`PCN`/`NCP` — same shape, different constants). The task: one sibling (`PCN`) is missing a bounds guard another sibling (`CPC`) already has; add the matching guard, touch nothing else. That is the regime "verbatim and unique" actually has to work in. Provenance and the exact extraction command: `benchmarks/agentic/fixtures/PROVENANCE.md`.

**Round 4 — applyability is necessary, not sufficient.** Running `dna-guard` with `qwen2.5-coder` produced *another* 100%/100% null on apply-rate — but inspecting the raw baseline output showed why, and it was not "the skill doesn't matter." The baseline returned the whole file, which dropped in cleanly (no elision) and so scored applyable — while having **silently deleted the target function `PCN` entirely and corrupted a neighbor (`CPC`)**, never adding the guard. It passed the delivery check for the wrong reason. That is exactly ponytail's issue #126 in mirror image: a single metric can be gamed by an answer that doesn't do the work. The fix is a second deterministic instrument, `benchmarks/blast-radius.js`, that measures the two things applyability is blind to — **task completion** (did the change actually land in the target?) and **collateral damage** (were functions the task said not to touch left byte-identical?) — and reports them as separate axes. Win condition is all three. On the demo data the split is immediate:

```
arm        applyable   task-done   collateral-free
viceroy    100%        100%        100%
baseline   100%          0%          0%
```

The honest division of labor: *task-done* mostly reflects the model's coding ability, while *collateral-free* is the genuinely Viceroy-attributable axis — a surgical swap of `PCN` **cannot** corrupt `CPC`, because it never reproduces `CPC`; the baseline's whole-file rewrite had 77 lines of opportunity to break things and took it. Both `blast-radius.js` and the original checker run with `--selftest`, no API, no cost; `blast-radius`'s self-test includes qwen's *actual* captured failure as a pinned regression so this exact gaming case can never silently pass again.

**Round 5 — measuring the actual claim: reader cost.** Applyability and blast-radius both measure the *output*: is it droppable, is it correct. Neither measures what Viceroy is really *for* — that a precise instruction costs the human less effort to act on than a vague one. That sounds subjective, but it has a mechanical core: the effort to turn an instruction into the correct edit is the information the reader must *supply that the instruction didn't* — the conditional complexity `K(edit | instruction)`. That has a standard, deterministic, human-free estimator: Normalized Compression Distance (`gzip`-based). `benchmarks/cognitive-load.js` computes it — no test subjects, no self-report, no LLM judge, just: how information-distant is the instruction from the change it asks for? On the real `dna-guard` instructions, both aimed at the identical correct edit:

```
arm        info-distance to edit   handed over verbatim   reader reconstructs
viceroy    0.16                    100%                     0%
baseline   0.87                      8%                    92%
```

The vague instruction sits ~5× further (in information distance) from the actual change and leaves the human to rebuild 92% of it. That is the claim — specificity lowers reader cost — finally measured mechanically rather than asserted. The metric is honest about its scope: `gzip` sees *literal* overlap, which is exactly Viceroy's verbatim-delivery mechanism, so it's well matched here; an instruction that conveys the fix purely *semantically* would look vague to it even if a human found it easy (the language-model-surprisal variant, grounded in psycholinguistic surprisal theory, is the heavier instrument for that case — noted in the file, not yet built). Self-test: 7 cases, no API.

Reproduce any of this yourself, for $0:

```bash
ollama pull qwen2.5-coder
cd benchmarks/agentic
node mini-agent.js --model qwen2.5-coder --task dna-guard --compare --runs 10
node mini-agent.js --model qwen2.5-coder --task all --compare --runs 10   # both tasks
```

**Round 6 — a second bug shape, harder than the first.** `dna-bound` adds a second task from the *same* messy file but a deliberately different failure mode: instead of a missing guard to copy, it's a guard that's *present but insufficient* — three of four sibling functions share one bounds-check pattern, but the buggy one (`CPCP`) needs a different bound than its siblings because it reads further (`i1+4`, not `i1+2`). Copying the majority pattern verbatim — the obvious, plausible move — produces a no-op that leaves the bug in place. Building it also caught a real classifier bug (a one-function illustrative snippet was being misread as "a whole-file rewrite that deleted everything else"), fixed and pinned as a regression test.

**Round 7 — a scorer bug hid the real result.** The first live `n=10` run on `dna-guard` looked like another null: both arms ~100% applyable, task-done near 0% for both. Inspecting the raw model output showed why — the viceroy-arm model (`qwen2.5-coder`, 7.6B, local, free) was **correctly fixing the bug**, but delivering it as a reformatted, re-spaced explanation rather than a byte-perfect swap (`i1-1` vs `i1 - 1`, reindented). The scorer was comparing function bodies byte-for-byte, so a *correct* fix with different whitespace was being counted as "the target is missing." That conflated two unrelated things: *did the bug get fixed* (correctness) and *was it delivered in Viceroy's exact format* (delivery shape). Fixed: `blast-radius.js` now compares function bodies and the required guard token after stripping all whitespace, and a correct fix delivered as prose now counts as task-done — delivery format and correctness are reported as separate axes, the way they should have been from the start. qwen's real captured answer (correct fix, reformatted prose) is pinned as a permanent regression so this can't quietly regress. Self-test: 29 cases.

**The real result, live model, `n=10` per arm, `qwen2.5-coder` (7.6B, local, $0):**

```
                  task-done        collateral-free
dna-guard:
  viceroy         9/10  (90%)       10/10 (100%)
  baseline        0/10   (0%)        0/10   (0%)

dna-bound:
  viceroy         0/10   (0%)       10/10 (100%)
  baseline        1/10  (10%)       10/10 (100%)
```

Read these as two different findings, not one average:

- **`dna-guard` is the headline.** When the fix is within the model's reach, Viceroy's discipline is the difference between a correct, surgical edit (90% task-done, zero collateral damage) and a baseline that reliably deletes the target function and corrupts a neighbor while still looking "applyable" (0% task-done, 0% collateral-free, every single run). Same model, same task, only the prompt differs.
- **`dna-bound` is an honest ceiling, not a failure of the metric.** Both arms score near zero. Inspecting the raw output: the model doesn't fail to *format* the fix — it fails to *locate* it, hallucinating a function named `CPC` that's actually `CPCP`'s body, then waving at unrelated functions from the other fixture. Confirmed at a second, larger model size (`qwen2.5-coder:14b`) before stopping — same failure pattern, not a fluke of one model. No prompt rescues a model from a bug it cannot reason about; Viceroy is a delivery-and-precision discipline, not an intelligence amplifier, and this task is the proof of that boundary rather than a counterexample to the thesis.

That two-sided shape — a real win where the model is capable, a real, reproducible ceiling where it isn't — is more credible than a clean sweep would have been. Reproduce either result yourself, for $0:

```bash
ollama pull qwen2.5-coder
cd benchmarks/agentic
node mini-agent.js --model qwen2.5-coder --task dna-guard --compare --runs 10   # the win
node mini-agent.js --model qwen2.5-coder --task dna-bound --compare --runs 10   # the ceiling
```

**What this is not, yet:** a benchmark with the statistical weight of, say, ponytail's 12-task agentic run. One real task with a clean live result, one documented ceiling case, `n=10` on one model family — a start, not exhaustive evidence. See [Roadmap](#roadmap) for what's next: more tasks at `dna-guard`'s difficulty (findable-but-easy-to-miss bugs) across more files, more runs, and a fix to the reader-cost metric below (it still scores qwen's correct-prose answers as high-cost, which contradicts the win above and needs its own format-aware pass before it's trustworthy).

## How it works

When you ask for a code change, Viceroy stops at one question before answering:

```
Can the reader apply this with the least chance of putting it in the wrong place?

  creates one or more files             → lead with the directory TREE, then each file by path
  substantial change, or short file     → the WHOLE file
  local change in a long file           → exact VERBATIM swap of that region

Then, if you touched a monolith:
  improve the one seam you edited (extract, rename) — behavior-preserving
  mark it with `viceroy:` — never rewrite what the task didn't send you into
```

Never abstract. Never elided. Never a riddle.

## Install

Viceroy is an agent-portable skill: a core skill plus thin per-agent adapters, so the same ruleset works whether your tool reads `SKILL.md` files or a plain instructions file.

**Skill-capable hosts** (Claude Code, Codex, OpenCode, etc.) — point the host at `skills/viceroy/SKILL.md`.

**Instruction-only hosts** — copy the matching always-on rule file:

| Host | File |
|------|------|
| Any agent reading `AGENTS.md` | [`AGENTS.md`](AGENTS.md) |
| Cursor | [`.cursor/rules/viceroy.mdc`](.cursor/rules/viceroy.mdc) |
| Windsurf | [`.windsurf/rules/viceroy.md`](.windsurf/rules/viceroy.md) |
| Cline | [`.clinerules/viceroy.md`](.clinerules/viceroy.md) |
| GitHub Copilot | [`.github/copilot-instructions.md`](.github/copilot-instructions.md) |

The compact rule body is byte-identical across all of them today; `AGENTS.md` is the source of truth they're generated from.

Modes: `/viceroy auto` (default, judges whole-vs-swap per change), `/viceroy whole` (always full files), `/viceroy patch` (always minimal exact swaps). Deactivate with "stop viceroy" or "normal mode".

## Roadmap

- [x] Core skill (the philosophy: applyable delivery + tidier seams + lead with the tree) — now three laws: anchor before you answer, deliver applyably, leave structure tidier
- [x] Always-on adapters for instruction-only hosts (`AGENTS.md` + four editors), kept byte-aligned
- [x] Deterministic applyability instrument + self-test (no API, no cost) — 20 cases
- [x] No-skill baseline arm, wired and proven on real model output
- [x] Two real-world fixture tasks from a byte-exact, unmodified scientific C file — `dna-guard` (missing guard) and `dna-bound` (present-but-insufficient guard, punishes pattern-matching)
- [x] Second deterministic gate (`blast-radius.js`): task-completion + collateral-damage, fixed to be format-insensitive (a correct, reformatted fix now scores correctly instead of being punished for whitespace) — 29 self-tests, three real model answers pinned as permanent regressions
- [x] **A real, live result on real model output, n=10, $0:** `dna-guard` shows Viceroy at 90% task-done / 100% collateral-free vs. baseline's 0% / 0% — same model, only the prompt differs. `dna-bound` is an honest, confirmed ceiling (0% both arms at two model sizes, 7.6B and 14B) — the model fails to *locate* the bug, which no prompt fixes. See "What's measured so far" above.
- [ ] **Next:** fix `cognitive-load.js` to be format-aware (a correct fix delivered as a complete, pasteable function should not score as high reader-cost just because it isn't a byte-perfect swap) — it currently contradicts the win it should be confirming
- [ ] More tasks at `dna-guard`'s difficulty (findable-but-easy-to-miss, not `dna-bound`'s reasoning-ceiling difficulty) across more files, more runs, for real statistical weight
- [ ] Try `dna-bound` against a frontier model, to learn whether it's "real but needs strong reasoning" (keep it, valuable) or "too hard to ever discriminate" (cut it) — not urgent; `dna-guard` alone is the defensible headline
- [ ] Seam-quality judge for the "tidier on the way out" law (extraction quality, behavior preserved)
- [ ] Full plugin adapters with mode switching (Claude Code / Codex / OpenCode) and a `check-rule-copies` alignment script
- [ ] `/viceroy-review` companion: scan a diff for un-applyable or elided edits

## License

[MIT](LICENSE).