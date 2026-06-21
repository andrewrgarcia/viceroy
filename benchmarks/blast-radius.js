#!/usr/bin/env node
// Viceroy blast-radius instrument.
//
// applyability.js answers "can this edit be dropped in?" -- a DELIVERY property.
// It is necessary but NOT sufficient, and the dna-guard episode showed why: a
// model can return a whole file that drops in cleanly (no elision, parses) while
// having SILENTLY DELETED the function it was asked to fix and CORRUPTED a
// neighbor. That answer is applyable and also worthless. Applyability cannot see
// it, because every flaw is inside code that "looks like a file".
//
// This module measures the two things applyability is blind to, both
// deterministically, both WITHOUT a correctness oracle for the target math:
//
//   1. BLAST RADIUS / COLLATERAL DAMAGE -- of the functions the task did NOT
//      ask to touch, how many did the answer change or delete? A surgical swap
//      is structurally ~0. A whole-file regeneration risks all of them, and on
//      dna-guard the baseline realized that risk (deleted PCN, mangled CPC).
//      This is the genuinely Viceroy-shaped metric: "leave what you didn't touch
//      alone" is the whole point of the exact-swap rule.
//
//   2. TASK PRESENCE -- did the requested change actually land in the target?
//      (Target function still present, changed, and now contains a required
//      token, e.g. the `i1+2>N0` guard.) This is a presence check, NOT a proof
//      of correctness -- it only guards against "did nothing / deleted it"
//      scoring well. It is deliberately shallow and labeled as such.
//
// It also reports ANSWER SHAPE (swap / whole / prose), because that is the
// mechanism Viceroy acts through: if the skill does not change a model from
// "dump the whole file" to "emit a swap", no downstream metric can split the
// arms, and the honest finding is "this model doesn't follow the skill."
//
//   node blast-radius.js --selftest    # verify the instrument (no API, no cost)
//
// viceroy: Node stdlib only, one local require. The instrument is the small thing.

'use strict';
const fs = require('fs');
const path = require('path');
const { extractSwaps } = require('./applyability.js');

const norm = (s) => String(s == null ? '' : s).replace(/\r\n/g, '\n');

// Format-insensitive canonical form of a chunk of C, for deciding whether two
// functions are "the same" regardless of how they're spaced or indented.
// Strips ALL whitespace, so `if(i1+2>N0)` and `if (i1 + 2 > N0)` and a
// reindented multi-line body all collapse to the same string. This is the fix
// for the false 0% task-done: a model that solves the bug but reformats the
// function (qwen does this constantly) was being scored as "changed the wrong
// way / deleted the target" purely because of spacing. Correctness is about
// whether the bug is fixed, not how the code is spaced.
const canon = (s) => norm(s).replace(/\s+/g, '');

// Same idea for the required-token check: the guard `i1+2>N0` must be found in
// the target even if the model wrote it as `i1 + 2 > N0`.
const canonHas = (haystack, needle) => canon(haystack).includes(canon(needle));

// --- split top-level C functions: Map(name -> verbatim full text) ------------
// Heuristic, not a full C parser: a top-level definition starts at column 0
// with a return type and name, has a parenthesized arg list containing no `;`
// or `{`, and a brace-balanced body. Inner declarations and calls are indented,
// so the column-0 anchor excludes them. Good enough for these fixtures, and the
// self-test pins the behavior.
function splitCFunctions(src) {
  const text = norm(src);
  const sigRe = /^[A-Za-z_][\w \t*]*?\b([A-Za-z_]\w*)\s*\([^;{]*\)\s*\{/gm;
  // Pass 1: collect every top-level signature position FIRST. Doing this up
  // front (rather than advancing past each function body as we go) is what makes
  // the splitter robust to a corrupted function: a brace-unbalanced body must
  // not hide the functions that come after it. Body lines are indented, so the
  // column-0 `^` anchor never matches an inner statement.
  const sigs = [];
  let m;
  while ((m = sigRe.exec(text))) {
    sigs.push({ name: m[1], start: m.index, braceStart: text.indexOf('{', m.index) });
  }
  // Pass 2: bound each function. A well-formed body ends at its balanced close
  // brace. A MALFORMED body (braces don't balance -- e.g. a model dropped a
  // `}`) is bounded at the next top-level signature (or EOF) and recorded
  // anyway, so it counts as a change rather than vanishing, and scanning
  // continues past it.
  const fns = new Map();
  for (let k = 0; k < sigs.length; k += 1) {
    const { name, start, braceStart } = sigs[k];
    if (braceStart === -1) continue;
    let depth = 0;
    let end = -1;
    for (let i = braceStart; i < text.length; i += 1) {
      const ch = text[i];
      if (ch === '{') depth += 1;
      else if (ch === '}') { depth -= 1; if (depth === 0) { end = i; break; } }
    }
    if (end === -1) {
      const nextStart = k + 1 < sigs.length ? sigs[k + 1].start : text.length;
      fns.set(name, text.slice(start, nextStart).replace(/\s+$/, '')); // malformed, but present
    } else {
      fns.set(name, text.slice(start, end + 1));
    }
  }
  return fns;
}

// --- reconstruct the file the model's answer would produce -------------------
// Returns { shape, file }. shape is the mechanism Viceroy acts through.
function fencedBlocks(answer) {
  return [...norm(answer).matchAll(/```[^\n`]*\n([\s\S]*?)```/g)].map((mm) => mm[1]);
}

function reconstructResult(answer, original) {
  const swaps = extractSwaps(answer);
  const appliedSwaps = swaps.filter(
    (s) => s.oldBlock && norm(original).split(norm(s.oldBlock)).length === 2, // unique
  );
  if (appliedSwaps.length) {
    let out = norm(original);
    for (const s of appliedSwaps) out = out.replace(norm(s.oldBlock), norm(s.newBlock));
    return { shape: 'swap', file: out, swaps };
  }
  const blocks = fencedBlocks(answer);
  if (blocks.length) {
    const biggest = norm(blocks.slice().sort((a, b) => b.length - a.length)[0]);
    // A fenced block is only a WHOLE-FILE replacement if it actually looks like
    // the file -- i.e. it contains MOST of the original's top-level functions,
    // not just one. A single-function illustrative snippet ("here's what CPCP
    // looks like", a stray `if` block) is a description, not a delivery: prose.
    // Threshold: at least half the original's function count (floor 1, so a
    // single-function original still requires that one function to be present).
    // Without this, a 1-function snippet against a multi-function original was
    // being scored as "the whole file, and everything else got silently
    // deleted" -- a real misclassification this replaced.
    const originalFnCount = splitCFunctions(original).size;
    const threshold = Math.max(1, Math.ceil(originalFnCount / 2));
    if (splitCFunctions(biggest).size >= threshold) {
      return { shape: 'whole', file: biggest, swaps: [] };
    }
  }
  return { shape: 'prose', file: null, swaps: [], proseCode: blocks.join('\n') }; // described, not delivered in an applyable shape
}

// --- the structural diff at function granularity -----------------------------
// targetFn: the function the task is allowed to change.
// requiredToken: a string that must appear in the target after a correct edit.
function blastRadius(original, result, { targetFn, requiredToken }, proseCode) {
  const o = splitCFunctions(original);
  if (result == null) {
    // Nothing was delivered as a whole file or applied swap -- but the answer's
    // prose may still CONTAIN the corrected target function in a code block.
    // Per design: a correct fix counts as task-done even when delivered as prose
    // (delivery format is a separate axis from "did the bug get fixed"). So we
    // look for the target function inside whatever code the answer included, and
    // score correctness from it. We do NOT treat the absent siblings as deleted
    // -- a prose snippet isn't a destructive whole-file rewrite -- so collateral
    // stays empty (harmless), and `delivered:false` records that it wasn't
    // handed over in an applyable shape.
    const inProse = proseCode ? splitCFunctions(proseCode) : new Map();
    const targetPresent = inProse.has(targetFn);
    const targetChanged = targetPresent && o.has(targetFn)
      && canon(inProse.get(targetFn)) !== canon(o.get(targetFn));
    const targetHasToken = targetPresent && canonHas(inProse.get(targetFn), requiredToken);
    return {
      shape: 'prose',
      missing: [],
      changed: [],
      added: [],
      collateral: [],
      noCollateral: true,
      delivered: false,
      targetPresent,
      targetChanged,
      targetHasToken,
      taskDone: targetChanged && targetHasToken,
    };
  }
  const r = splitCFunctions(result);
  const missing = [...o.keys()].filter((n) => !r.has(n));
  // "changed" = not the same function after format-insensitive canonicalization.
  // Reindenting or respacing a function is NOT a change; altering what it does is.
  const changed = [...o.keys()].filter((n) => r.has(n) && canon(r.get(n)) !== canon(o.get(n)));
  const added = [...r.keys()].filter((n) => !o.has(n));
  const touched = new Set([...missing, ...changed]); // not equivalent to original
  const collateral = [...touched].filter((n) => n !== targetFn);
  const targetPresent = r.has(targetFn);
  const targetChanged = targetPresent && canon(r.get(targetFn)) !== canon(o.get(targetFn));
  const targetHasToken = targetPresent && canonHas(r.get(targetFn), requiredToken);
  return {
    missing,
    changed,
    added,
    collateral,
    noCollateral: collateral.length === 0,
    delivered: true,
    targetPresent,
    targetChanged,
    targetHasToken,
    taskDone: targetChanged && targetHasToken,
  };
}

// --- top-level: analyze a model answer against the original + task meta -------
function analyze(answer, original, taskMeta) {
  const { shape, file, proseCode } = reconstructResult(answer, original);
  const br = blastRadius(original, file, taskMeta, proseCode);
  return { shape, ...br };
}

module.exports = { splitCFunctions, reconstructResult, blastRadius, analyze };

// ============================ self-test (no API) =============================
if (require.main === module && process.argv.includes('--selftest')) {
  let pass = 0;
  let fail = 0;
  const ok = (cond, name) => { console.log(`${cond ? 'ok ' : 'XX '} ${name}`); cond ? (pass += 1) : (fail += 1); };

  // A tiny synthetic multi-function C file. foo is the target; it lacks a guard
  // that bar already has. bar and baz are innocent bystanders.
  const ORIGINAL = [
    'float bar(int i)',
    '{',
    ' float v;',
    ' if(i+2>N) v=0.0;',
    ' else { v=compute(i); }',
    ' return v;',
    '}',
    'float foo(int i)',
    '{',
    ' float v;',
    ' v=compute(i);',
    ' return v;',
    '}',
    'float baz(int i)',
    '{',
    ' return other(i);',
    '}',
  ].join('\n');

  const META = { targetFn: 'foo', requiredToken: 'i+2>N' };

  // 1. splitter finds all three functions
  const fns = splitCFunctions(ORIGINAL);
  ok(fns.size === 3 && fns.has('foo') && fns.has('bar') && fns.has('baz'),
    'splitter finds all three top-level functions');

  // 2. a clean Viceroy swap of foo: guard added, nothing else touched
  const goodSwap = [
    'In `x.c`, replace this:',
    '',
    '```c',
    'float foo(int i)\n{\n float v;\n v=compute(i);\n return v;\n}',
    '```',
    '',
    'with this:',
    '',
    '```c',
    'float foo(int i)\n{\n float v;\n if(i+2>N) v=0.0;\n else { v=compute(i); }\n return v;\n}',
    '```',
  ].join('\n');
  const a1 = analyze(goodSwap, ORIGINAL, META);
  ok(a1.shape === 'swap', 'clean swap is detected as shape=swap');
  ok(a1.noCollateral && a1.collateral.length === 0, 'clean swap has zero collateral damage');
  ok(a1.taskDone, 'clean swap completes the task (target changed + token present)');

  // 3. the dna-guard pathology, in miniature: a WHOLE-FILE answer that deletes
  //    the target (foo) and corrupts a bystander (baz), never adding the guard.
  const badWhole = [
    'Here is the updated file:',
    '',
    '```c',
    'float bar(int i)',
    '{',
    ' float v;',
    ' if(i+2>N) v=0.0;',
    ' else { v=compute(i); }',
    ' return v;',
    '}',
    'float baz(int i)',
    '{',
    ' return WRONG(i);', // baz corrupted
    '}',
    '```',
  ].join('\n'); // foo entirely absent
  const a2 = analyze(badWhole, ORIGINAL, META);
  ok(a2.shape === 'whole', 'whole-file dump is detected as shape=whole');
  ok(a2.missing.includes('foo'), 'deletion of the target function is caught (foo missing)');
  ok(a2.collateral.includes('baz'), 'corruption of an untouched bystander is caught as collateral (baz)');
  ok(!a2.taskDone, 'the lazy/broken whole-file answer is correctly NOT task-done');
  ok(!a2.noCollateral, '...and is correctly flagged as having collateral damage');

  // 4. a FAITHFUL whole-file answer: whole file, but only foo changed (guard
  //    added), everything else byte-identical. This must NOT be punished --
  //    whole-file is a legitimate Viceroy shape when it stays faithful.
  const goodWhole = [
    '```c',
    ORIGINAL.replace(
      'float foo(int i)\n{\n float v;\n v=compute(i);\n return v;\n}',
      'float foo(int i)\n{\n float v;\n if(i+2>N) v=0.0;\n else { v=compute(i); }\n return v;\n}',
    ),
    '```',
  ].join('\n');
  const a3 = analyze(goodWhole, ORIGINAL, META);
  ok(a3.shape === 'whole', 'faithful whole-file answer is shape=whole');
  ok(a3.noCollateral, 'faithful whole-file answer has zero collateral (only the target changed)');
  ok(a3.taskDone, 'faithful whole-file answer completes the task');

  // 5. a prose-only answer that describes but never delivers an edit. Crucially,
  //    even if it contains an illustrative fenced snippet (a stray `if` block
  //    with no function definition), it must be classified as prose, NOT as a
  //    whole-file rewrite that "deleted" every real function.
  const proseWithSnippet = [
    'You should add a bounds check to foo, similar to bar:',
    '',
    '```c',
    'if (i+2>N) { v = 0.0; } else { v = compute(i); }',
    '```',
    '',
    'Wrap the body of foo in that.',
  ].join('\n');
  const a4 = analyze(proseWithSnippet, ORIGINAL, META);
  ok(a4.shape === 'prose', 'a fenced snippet with no function def is prose, not a whole-file rewrite');
  ok(a4.missing.length === 0 && a4.collateral.length === 0, 'a non-delivery answer reports NO phantom deletions or collateral');
  ok(!a4.taskDone, 'a prose-only answer is not task-done (nothing was delivered)');
  ok(a4.noCollateral && !a4.delivered, 'prose answer: harmless (collateral-free) but undelivered -- the task-done column is what fails it');

  // 5b. THE other half of the same bug, sharper: a snippet containing exactly
  //     ONE complete, real function (not a bare fragment with zero functions,
  //     as in 5 above) shown as an illustration -- "here's what foo looks like,
  //     it already matches the pattern" -- against a 3-function original. This
  //     must ALSO be prose, not "whole file, bar and baz deleted". This is the
  //     exact shape that slipped through before the >=1 threshold was replaced
  //     with a majority-of-functions threshold (found via the dna-bound task,
  //     where a baseline answer illustrated one unchanged function in isolation
  //     and was wrongly scored as having deleted its three siblings).
  const oneFunctionIllustration = [
    'Looking at it, `foo` already matches the pattern used elsewhere:',
    '',
    '```c',
    'float foo(int i)\n{\n float v;\n v=compute(i);\n return v;\n}',
    '```',
    '',
    'So no change is needed.',
  ].join('\n');
  const a4b = analyze(oneFunctionIllustration, ORIGINAL, META);
  ok(a4b.shape === 'prose', 'a snippet with exactly ONE real function (vs a 3-function original) is prose, not whole-file');
  ok(a4b.missing.length === 0, 'bar and baz are NOT reported as deleted just because they are absent from a one-function illustration');
  ok(!a4b.taskDone, 'an illustration that changes nothing is correctly not task-done');

  // 6. robustness: a function whose braces DON'T balance (a model dropped a `}`)
  //    must NOT blind the splitter to the functions after it. Here bar is
  //    corrupted AND missing its closing brace; baz still follows. The splitter
  //    must still find foo and baz, and must record the corrupted bar as present
  //    (changed), not let it swallow the rest of the file.
  const malformed = [
    'float bar(int i)',
    '{',
    ' float v;',
    ' if(i+2>N) { v=0.0;',       // opened, never closed -> bar is brace-unbalanced
    ' return v;',
    'float foo(int i)',
    '{',
    ' float v;',
    ' v=compute(i);',
    ' return v;',
    '}',
    'float baz(int i)',
    '{',
    ' return other(i);',
    '}',
  ].join('\n');
  const fnsM = splitCFunctions(malformed);
  ok(fnsM.has('foo') && fnsM.has('baz'), 'a malformed function does not hide the functions after it (foo, baz still found)');
  ok(fnsM.has('bar'), 'the malformed function is still recorded as present (bounded at the next signature)');

  // 7. THE capstone: qwen2.5-coder's REAL captured baseline answer on dna-guard,
  //    scored against the REAL fixture. This is the exact output that scored
  //    APPLYABLE under delivery-only checking while being catastrophically wrong:
  //    PCN deleted, CPC corrupted (and left brace-unbalanced). If the fixtures
  //    are present, assert the oracle catches all of it.
  try {
    const real = fs.readFileSync(path.join(__dirname, 'agentic', 'fixtures', 'DNA_slice.c'), 'utf8');
    const qwen = fs.readFileSync(path.join(__dirname, 'agentic', 'fixtures', 'qwen_baseline_dnaguard.txt'), 'utf8');
    const aReal = analyze(qwen, real, { targetFn: 'PCN', requiredToken: 'i1+2>N0' });
    ok(aReal.shape === 'whole', 'real qwen baseline: detected as a whole-file answer');
    ok(!aReal.targetPresent && aReal.missing.includes('PCN'), 'real qwen baseline: the deletion of PCN is caught');
    ok(aReal.collateral.includes('CPC'), 'real qwen baseline: the corruption of CPC is caught as collateral');
    ok(!aReal.taskDone, 'real qwen baseline: correctly NOT task-done (the guard never landed in PCN)');
    ok(!aReal.noCollateral, 'real qwen baseline: correctly flagged as collateral damage -- applyable, yet broken');
  } catch (e) {
    console.log('-- (skipped real-capture regression: fixtures not found at expected path)');
  }

  // THE capstone for format-insensitive correctness: qwen2.5-coder's REAL
  // viceroy-arm answer on dna-guard. It SOLVED the bug -- added the i1+2>N0
  // guard to PCN, correct logic -- but delivered it as reformatted prose
  // (`i1 - 1` spacing, reindented, wrapped in explanation). Before the fix it
  // scored task-done=NO purely because it didn't match the original byte-for-
  // byte. Per the design call (a correct fix counts even as prose, and spacing
  // doesn't matter), it must now score task-done=YES.
  try {
    const real = fs.readFileSync(path.join(__dirname, 'agentic', 'fixtures', 'DNA_slice.c'), 'utf8');
    const correct = fs.readFileSync(path.join(__dirname, 'agentic', 'fixtures', 'qwen_viceroy_dnaguard_correct.txt'), 'utf8');
    const aGood = analyze(correct, real, { targetFn: 'PCN', requiredToken: 'i1+2>N0' });
    ok(aGood.taskDone, 'real qwen correct fix (reformatted prose) scores task-done=YES (format-insensitive)');
    ok(aGood.noCollateral, 'real qwen correct fix: no collateral (it only touched PCN, prose siblings not penalized)');
    ok(aGood.shape === 'prose', 'real qwen correct fix: shape is prose (delivery format is a SEPARATE axis from correctness)');
  } catch (e) {
    console.log('-- (skipped correct-prose regression: fixtures not found at expected path)');
  }

  console.log(`\nself-test: ${pass} passed, ${fail} failed${fail ? '  -- BROKEN' : '  -- all instruments valid'}`);
  process.exit(fail ? 1 : 0);
}