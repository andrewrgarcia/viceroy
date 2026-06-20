# Agentic mini-agent

The smallest honest version of the agentic loop: read a file → ask a model to edit it → check whether the edit applies → apply it or report why not. It reuses the deterministic checker in `../applyability.js`, so "did it apply?" is a fact, not a guess.

## Run it

No model needed (uses a baked-in answer — proves the apply + score path):

```bash
node mini-agent.js --demo
```

Against a free local model via [Ollama](https://ollama.com):

```bash
node mini-agent.js --model llama3.2        # small, general
node mini-agent.js --model qwen2.5-coder   # a code model edits far better
```

It prints the model's answer, an applyability verdict per edit, and — if the edit applies — the resulting file. Exit code `0` = applyable, `1` = not (where a real agent would loop and re-prompt), `2` = couldn't reach the model.

## What it is and isn't

It is one pass of the loop, on one seeded file, to make the concept concrete and runnable for free. It is not yet the full benchmark: that runs many tasks across long files, many times, and aggregates an apply-rate vs a no-skill baseline. This is the seed it grows from.
