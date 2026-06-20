# Viceroy benchmark

Viceroy claims its edits **apply cleanly** — you can drop them in without hunting for the spot or reconstructing elided code. That is a property you can measure deterministically, which is the whole point: the headline number is a fact, not a vibe.

## What is measured

Two deterministic axes, plus one judged axis.

**1. Apply-rate (deterministic).** For every exact swap an answer emits, the quoted "old block" must appear in the current file **exactly once**.

| occurrences of the old block | verdict |
|---|---|
| 1 | applies — unique, droppable |
| 0 | broken — paraphrased from memory, or a stale file |
| 2+ | ambiguous — the reader can't tell which one to replace |

**2. Elision-rate (deterministic).** Every whole-file answer must contain **no elision markers** — `// ... rest unchanged`, `# existing code here`, `(unchanged)`, `...methods unchanged...`. A file with a hole where code belongs is a failed deliverable.

**3. Seam quality (judged).** The "tidier on the way out" law resists a deterministic check, so — exactly like ponytail's over-engineering judge — it gets an auditable LLM judge: a fixed model at temperature 0, a published rubric, and every score must name the seam it considers improved (or "none"). It scores whether a monolith edit extracted the seam it touched, named things well, and **preserved behavior**, without rewriting untouched code.

## The instrument

`applyability.js` is axes 1 and 2, and it runs with **no API key**:

```bash
node applyability.js --selftest
```

The self-test ships reference good and bad edits and asserts the checker catches each failure mode — a verbatim swap applies, a paraphrased one is caught as count-0, a non-unique one as count-2, and elided whole-files are flagged — before any model is ever scored. This mirrors ponytail's discipline of proving the instruments before spending on the API.

It exposes three things you can build a full harness on:

- `checkSwapApplies(source, oldBlock)` → `{ applies, count, reason }`
- `findElision(fileText)` → `{ whole, hits }`
- `scoreAnswer(answer, sources)` → end-to-end applyability of a Viceroy-shaped answer against the files it edits

A note on the conservative bias: elision detection requires comment context, so a comment that happens to say "unchanged" in a sentence is flagged. That is intentional — false positives are cheap (reword the comment), false negatives ship a hole. The self-test documents and pins this behavior.

## The agentic design (next milestone)

The honest, defensible benchmark — the one that produces a quotable number — is a real agent on a real repo, the same structure ponytail moved to after its single-shot numbers were rightly criticized for an inflated baseline:

- **Unit:** a headless agent session editing a seeded real codebase, not a one-shot completion.
- **Baseline:** the same agent with no skill (the fair baseline), so any difference is the skill's effect.
- **Tasks:** small fixes seeded into **long files** — the regime where *where* the edit goes is as easy to get wrong as *what* it is, which is exactly where abstract/elided answers fail.
- **Scoring:** run the agent's emitted edits through `applyability.js`. Apply-rate and elision-rate are deterministic; seam quality goes to the judge.

The hypothesis this is built to be able to **disprove**: if a no-skill agent already emits edits that apply just as often, the benchmark will say so. The point is a checkable claim, not a flattering one.

## Status

| piece | state |
|---|---|
| deterministic applyability + elision checker | **built, self-tested, no API** |
| seam-quality LLM judge | designed (mirror ponytail's `judge.py`) |
| agentic harness on a real repo | designed, needs the agent CLI + API |
| published apply-rate numbers | not yet — do not quote a number until the agentic run exists |

The instrument is the hard part, and it exists. The numbers come when the agentic harness runs.
