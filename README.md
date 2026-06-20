<p align="center">
    <img width="200" alt="viceroy" src="https://github.com/user-attachments/assets/f16454f1-93ec-4077-95b6-2bbdb3553ee4" />
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
ok  comment ellipsis "// ... rest" is caught
ok  keyword elision "# existing code here" is caught
ok  an answer whose old block does not match the file scores NOT applyable
...
self-test: 14 passed, 0 failed -- all instruments valid
```

## What's measured so far

Honest and small, on purpose — this is one live result, not a benchmark yet, and it's labeled that way until there's an `n` worth quoting.

**Setup.** `benchmarks/agentic/mini-agent.js` runs one real pass of the loop: a 10-line seeded `service.py`, a real task ("add caching to `fetch_user`, behavior identical otherwise"), a free local model via [Ollama](https://ollama.com), the Viceroy skill as the system prompt. The model's answer is scored by the same deterministic checker above — not eyeballed.

**Result, 2026-06-20, `qwen2.5-coder` (7.6B, Q4_K_M), n=1:**

| | |
|---|---|
| model | qwen2.5-coder:latest, local via Ollama |
| task | add caching to `fetch_user`, behavior unchanged |
| swaps emitted | 1 |
| applies? | **yes** — verbatim, unique match |
| cost | $0 (local model) |

The model returned one exact swap. Its "old block" matched the seeded file character-for-character, so it applied cleanly and the patched file was produced automatically. Reproduce it yourself:

```bash
ollama pull qwen2.5-coder
cd benchmarks/agentic && node mini-agent.js --model qwen2.5-coder
```

**What this is not, yet:** a comparison. There's no baseline arm (the same task with no Viceroy skill in the prompt) and no `n` large enough to call a rate. Both are next — see [Roadmap](#roadmap). A real headline number needs: multiple seeded tasks, many runs each, a no-skill baseline, and ideally a bigger/more capable model alongside the free local one. Until that exists, this README will keep showing the real, current, small result instead of a placeholder table.

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

- [x] Core skill (the philosophy: applyable delivery + tidier seams + lead with the tree)
- [x] Always-on adapters for instruction-only hosts (`AGENTS.md` + four editors)
- [x] Deterministic applyability instrument + self-test (no API, no cost)
- [x] One real agentic pass, free local model, scored end to end (n=1, above)
- [ ] No-skill baseline arm — the comparison number that makes the metric mean something
- [ ] Multi-task benchmark: several seeded files/tasks, many runs each, aggregated apply-rate
- [ ] Seam-quality judge for the "tidier on the way out" law (extraction quality, behavior preserved)
- [ ] Full plugin adapters with mode switching (Claude Code / Codex / OpenCode) and a `check-rule-copies` alignment script
- [ ] `/viceroy-review` companion: scan a diff for un-applyable or elided edits

## License

[MIT](LICENSE).
