#!/usr/bin/env node
// Viceroy mini-agent — the smallest honest version of the loop.
//
// It is the diagram in code:
//   read the file  ->  ask a model to edit it  ->  observe (does the edit apply?)
//                                                  -> apply it / report why not
//
// It runs against a FREE local model via Ollama (http://localhost:11434), so the
// whole loop costs nothing. With --demo it skips the model entirely and uses a
// baked-in answer, so you can watch the apply+score path work before you even
// install Ollama. Either way it reuses the same deterministic checker the rest
// of the benchmark uses (../applyability.js) -- one source of truth.
//
//   node mini-agent.js --demo                 # no Ollama, baked-in answer
//   node mini-agent.js --model llama3.2        # real local model (needs Ollama)
//   node mini-agent.js --model qwen2.5-coder   # a code model does this far better
//
// viceroy: Node stdlib only (http), no dependencies. The agent is the small thing.

'use strict';
const http = require('http');
const { scoreAnswer } = require('../applyability.js');

// --- the seeded "repo": one real file the agent must edit in place ----------
const FILE = 'service.py';
const SOURCE = [
  'import os',
  '',
  'def fetch_user(user_id):',
  '    row = db.query("SELECT * FROM users WHERE id = ?", user_id)',
  '    return User.from_row(row)',
  '',
  'def fetch_order(order_id):',
  '    row = db.query("SELECT * FROM orders WHERE id = ?", order_id)',
  '    return Order.from_row(row)',
  '',
].join('\n');

const TASK =
  'Add caching to fetch_user so repeated calls with the same user_id do not ' +
  're-query the database. Behavior must stay identical otherwise. Only touch ' +
  'what you need to.';

// The Viceroy ruleset is the system prompt. Load the real skill if it's there;
// fall back to a one-line summary so the demo runs from anywhere.
function loadSkill() {
  try {
    return require('fs').readFileSync(
      require('path').join(__dirname, '..', '..', 'skills', 'viceroy', 'SKILL.md'),
      'utf8',
    );
  } catch (e) {
    return 'Deliver the change as an exact verbatim block-for-block swap ' +
      '(in `file`, replace this: ```old``` with this: ```new```) where the old ' +
      'block is copied character-for-character from the current file, or as the ' +
      'whole file. Never elide code. Never describe the edit abstractly.';
  }
}

// A correct, Viceroy-shaped answer, used by --demo (no model needed).
const DEMO_ANSWER = [
  'In `service.py`, replace this:',
  '',
  '```python',
  'def fetch_user(user_id):',
  '    row = db.query("SELECT * FROM users WHERE id = ?", user_id)',
  '    return User.from_row(row)',
  '```',
  '',
  'with this:',
  '',
  '```python',
  '@lru_cache(maxsize=1024)',
  'def fetch_user(user_id):',
  '    row = db.query("SELECT * FROM users WHERE id = ?", user_id)',
  '    return User.from_row(row)',
  '```',
  '',
  'And in `service.py`, replace this:',
  '',
  '```python',
  'import os',
  '```',
  '',
  'with this:',
  '',
  '```python',
  'import os',
  'from functools import lru_cache',
  '```',
].join('\n');

// --- talk to a local model over Ollama's HTTP API (free, on your machine) ----
function ollamaChat(model, system, user) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model,
      stream: false,
      options: { temperature: 0.2 },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    });
    const req = http.request(
      { host: '127.0.0.1', port: 11434, path: '/api/chat', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try { resolve(JSON.parse(data).message.content); }
          catch (e) { reject(new Error('unexpected Ollama response: ' + data.slice(0, 200))); }
        });
      },
    );
    req.on('error', (e) =>
      reject(new Error(
        'cannot reach Ollama at 127.0.0.1:11434 — is it running? Start it with ' +
        '`ollama serve` (or it may already run as a service), and `ollama pull ' +
        model + '` first.\n  underlying error: ' + e.message)));
    req.write(body);
    req.end();
  });
}

// --- observe: score the answer, and APPLY any swap that lands ----------------
function applySwaps(source, swaps) {
  let out = source;
  for (const s of swaps) {
    if (s.applies) out = out.replace(s.oldBlock, s.newBlock); // unique by definition
  }
  return out;
}

(async () => {
  const args = process.argv.slice(2);
  const demo = args.includes('--demo');
  const model = (args[args.indexOf('--model') + 1] || 'llama3.2');

  console.log('Viceroy mini-agent — one pass of the loop\n');
  console.log(`task : ${TASK}\n`);
  console.log(`file : ${FILE}  (${SOURCE.split('\n').length} lines)\n`);

  // 1. READ + 2. ASK (the model, or the baked-in demo answer)
  let answer;
  if (demo) {
    console.log('mode : --demo (no model, baked-in answer)\n');
    answer = DEMO_ANSWER;
  } else {
    console.log(`mode : Ollama model "${model}"\n`);
    const userPrompt =
      `${TASK}\n\nHere is the current \`${FILE}\`:\n\n\`\`\`python\n${SOURCE}\`\`\`\n\n` +
      `Return the change as a Viceroy exact swap, or the whole file.`;
    answer = await ollamaChat(model, loadSkill(), userPrompt);
  }

  console.log('--- model answer ' + '-'.repeat(40));
  console.log(answer.trim());
  console.log('-'.repeat(57) + '\n');

  // 3. OBSERVE: does it apply? (the deterministic checker — the "score" box)
  const scored = scoreAnswer(answer, { [FILE]: SOURCE });
  console.log('--- applyability ' + '-'.repeat(40));
  if (scored.swaps.length === 0 && scored.wholeFiles.length === 0) {
    console.log('no edit found in the answer (the model described it instead of delivering it).');
  }
  scored.swaps.forEach((s, i) => {
    console.log(`swap ${i + 1} [${s.file || FILE}]: ${s.applies ? 'APPLIES' : 'DOES NOT APPLY'} — ${s.reason}`);
  });
  scored.wholeFiles.forEach((w, i) => {
    console.log(`whole-file ${i + 1}: ${w.whole ? 'no elision' : 'ELIDED at line ' + w.hits[0].line + ' (' + w.hits[0].text + ')'}`);
  });
  console.log(`\nverdict: ${scored.applyable ? 'APPLYABLE ✔  (the loop is done)' : 'NOT APPLYABLE ✘  (a real agent would re-prompt and loop again)'}`);
  console.log('-'.repeat(57) + '\n');

  // 4. If it applies, actually apply it and show the result.
  if (scored.applyable && scored.swaps.length) {
    const result = applySwaps(SOURCE, scored.swaps);
    console.log('--- service.py after applying ' + '-'.repeat(27));
    console.log(result.trim());
    console.log('-'.repeat(57));
  }

  process.exit(scored.applyable ? 0 : 1);
})().catch((e) => { console.error('\n' + e.message); process.exit(2); });
