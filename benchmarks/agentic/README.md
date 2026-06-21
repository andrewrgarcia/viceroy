# Agentic mini-agent

The smallest honest version of the agentic loop: read a file → ask a model to edit it → check whether the edit applies → apply it or report why not. It reuses the deterministic checker in `../applyability.js`, so "did it apply?" is a fact, not a guess.

Two arms, same task, same file — only the system prompt differs:

- **viceroy** — the Viceroy skill loaded as the system prompt.
- **baseline** — a generic "you are a helpful coding assistant" prompt, no skill at all.

Both are scored by the same checker, so the comparison is apples to apples.

## Two tasks

| `--task` | file | what it tests |
|---|---|---|
| `cache-fn` (default) | 10-line synthetic `service.py` | sanity check only. The file is short enough that there's nowhere to get lost, so both arms tend to score the same here — see the n=10 real-model result below. Kept for fast wiring checks. |
| `dna-guard` | 77-line real, unmodified slice of [`RNA-folding-lab/DNAfold`](https://github.com/RNA-folding-lab/DNAfold)'s `DNA.c` | **the actual claim.** One-letter variable names, near-identical sibling functions (`PC`/`CP`/`CN` and `PCP`/`CPC`/`PCN`/`NCP` all share the same shape), almost no whitespace. The task: `PCN` is missing a bounds guard its sibling `CPC` already has; add the matching guard, touching nothing else. This is the regime where "find the right spot among several near-duplicates" is genuinely hard, and where Viceroy's verbatim-and-unique rule earns its keep. Provenance and license note: `fixtures/PROVENANCE.md`. |

`--task all` runs both.

## Run it

No model needed (uses baked-in answers for both arms and both tasks — proves the apply + score path, including that the two arms actually score differently):

```bash
node mini-agent.js --demo                              # cache-fn, viceroy arm
node mini-agent.js --demo --task dna-guard --arm baseline
node mini-agent.js --demo --task all --compare          # both tasks, both arms, side by side
```

Against a free local model via [Ollama](https://ollama.com):

```bash
node mini-agent.js --model qwen2.5-coder                                  # cache-fn, viceroy arm (defaults)
node mini-agent.js --model qwen2.5-coder --task dna-guard --arm baseline
node mini-agent.js --model qwen2.5-coder --task dna-guard --compare --runs 10
node mini-agent.js --model qwen2.5-coder --task all --compare --runs 10   # everything
```

Flags:

| flag | what it does |
|---|---|
| `--model <name>` | the Ollama model to use (default `llama3.2`; `qwen2.5-coder` edits noticeably better) |
| `--task cache-fn\|dna-guard\|all` | which fixture to run (default `cache-fn`) |
| `--arm viceroy\|baseline` | which system prompt for a single run (default `viceroy`) |
| `--compare` | run both arms `--runs` times each (per task) and print an apply-rate table |
| `--runs <n>` | how many times per arm under `--compare` (default 1 — see the caveat below) |
| `--demo` | skip the model entirely, use baked-in answers (works with all of the above) |

Single-run mode prints the model's answer, an applyability verdict per edit, and — if the edit applies — the resulting file. Exit code `0` = applyable, `1` = not (where a real agent would loop and re-prompt), `2` = couldn't reach the model.

`--compare` mode prints an apply-rate table per task instead. **`n=1` (the default) only proves the wiring** — a single run can't tell you a rate, the same way one coin flip can't tell you if a coin is fair. Use `--runs 10` or more before reading anything into the percentages.

## What was found so far (honest, small)

On `cache-fn` (the trivial task), a live `n=10` run with `qwen2.5-coder` scored **both arms at 100%** — the file is too short to discriminate. That's a real result about the task, not the skill: a 10-line file with one obvious edit site doesn't stress "can you find the right spot," which is Viceroy's actual claim. `dna-guard` exists because of that finding — it's the task built specifically to put real pressure on the part of the claim a trivial file can't test.

## What it is and isn't

It is one pass of the loop (or a handful, under `--compare`), on a couple of seeded files, to make the concept concrete, runnable for free, and now genuinely comparative. It is not yet the full benchmark: that runs many more tasks across many more long files, many runs each, and aggregates an apply-rate with real statistical weight. This is the seed it grows from.