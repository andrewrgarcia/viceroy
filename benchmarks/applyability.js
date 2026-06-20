#!/usr/bin/env node
// Viceroy applyability instrument.
//
// Viceroy's headline property is APPLYABILITY: a code edit is good when the
// reader can drop it in without reconstruction. Unlike "is it good code?", that
// is deterministically checkable, the same way ponytail's LOC is:
//
//   1. An exact swap applies iff its quoted "old block" appears in the current
//      file EXACTLY ONCE. Zero = broken (nothing to replace); many = ambiguous
//      (which one?). Both are detectable by searching the file.
//   2. A whole-file answer is whole iff it contains NO elision markers
//      (`// ... rest unchanged`, `# existing code here`, `(unchanged)`, ...).
//      A file with a hole where code should be is a failed deliverable.
//
// This module is the checker. It ships reference good/bad edits and a
// --selftest that runs with NO API KEY -- proving the instrument can tell an
// applyable edit from a broken one before any model is scored. That mirrors
// ponytail's "prove the instruments, no spend" discipline.
//
//   node applyability.js --selftest    # verify the checker (no API)
//
// viceroy: pure stdlib, no dependencies -- the instrument is the small thing.

'use strict';

const norm = (s) => String(s == null ? '' : s).replace(/\r\n/g, '\n');

// --- Primitive 1: does an exact swap apply? ----------------------------------
// Count verbatim occurrences of `oldBlock` in `source`. applies === (count 1).
function checkSwapApplies(source, oldBlock) {
  const src = norm(source);
  const needle = norm(oldBlock);
  if (needle.trim() === '') return { applies: false, count: 0, reason: 'empty old block' };

  let count = 0;
  let from = 0;
  for (;;) {
    const i = src.indexOf(needle, from);
    if (i === -1) break;
    count += 1;
    from = i + 1; // overlapping-safe; we only care about 0 / 1 / many
  }

  const reason =
    count === 1 ? 'applies (unique match)'
      : count === 0 ? 'broken: old block not found in source (paraphrased? stale file?)'
        : `ambiguous: old block matches ${count} places (widen it until unique)`;
  return { applies: count === 1, count, reason };
}

// --- Primitive 2: is a whole-file answer free of elision? --------------------
// Elision in code answers is almost always comment-shaped. We flag a comment
// line that is essentially just an ellipsis, or a comment carrying an elision
// keyword. Requiring comment context keeps legitimate prose/strings from
// tripping it (e.g. a docstring that says "unchanged" in a sentence).
const COMMENT = String.raw`(?://|#|--|;|\*|<!--)`;
const ELISION_KEYWORDS = String.raw`rest of|existing code|unchanged|remains the same|stays the same|same as (?:before|above)|omitted|snip|keep (?:the )?(?:existing|rest)|other (?:code|methods|functions)|continues|as before|previous|… ?rest`;

const ELISION_PATTERNS = [
  // comment that is just an ellipsis: `// ...`, `# ...`, `/* ... */`, `<!-- ... -->`
  new RegExp(String.raw`^\s*${COMMENT}\s*\.{2,}\s*(?:\*/|-->)?\s*$`, 'i'),
  // comment containing an ellipsis + anything: `// ... rest of handler`
  new RegExp(String.raw`^\s*${COMMENT}.*\.{3}.*$`),
  // comment carrying an elision keyword: `# existing imports here`
  new RegExp(String.raw`^\s*${COMMENT}.*(?:${ELISION_KEYWORDS}).*$`, 'i'),
  // ellipsis + keyword on one line even without a comment marker: `... rest unchanged ...`
  new RegExp(String.raw`\.{3}\s*(?:${ELISION_KEYWORDS})`, 'i'),
];

function findElision(fileText) {
  const lines = norm(fileText).split('\n');
  const hits = [];
  lines.forEach((line, idx) => {
    if (ELISION_PATTERNS.some((re) => re.test(line))) {
      hits.push({ line: idx + 1, text: line.trim() });
    }
  });
  return { whole: hits.length === 0, hits };
}

// --- Template parser: pull edits out of a Viceroy-shaped answer --------------
// Shape A (whole file):  ```lang title=path ...```  OR a "the full `path`:" lead-in
// Shape B (exact swap):  In `path`, replace this: ```old``` with this: ```new```
// The parser is best-effort; the primitives above are the load-bearing checks.
function fences(text) {
  const out = [];
  const re = /```[^\n`]*\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(norm(text)))) out.push({ code: m[1], end: re.lastIndex, start: m.index });
  return out;
}

function extractSwaps(answer) {
  const a = norm(answer);
  const blocks = fences(a);
  const swaps = [];
  // Find "replace this:" / "with this:" adjacency around fenced blocks.
  for (let i = 0; i + 1 < blocks.length; i += 1) {
    const between = a.slice(blocks[i].end, blocks[i + 1].start);
    const before = a.slice(Math.max(0, blocks[i].start - 200), blocks[i].start);
    if (/with this\s*:?\s*$/i.test(between.replace(/\s+$/, ' ').trimEnd()) ||
        /\bwith this\b/i.test(between)) {
      const fileMatch = before.match(/(?:in|file)\s+[`"']([^`"']+)[`"']/i);
      swaps.push({
        file: fileMatch ? fileMatch[1] : null,
        oldBlock: blocks[i].code,
        newBlock: blocks[i + 1].code,
      });
    }
  }
  return swaps;
}

// --- Scoring an answer against the source files it edits ----------------------
// sources: { 'path/file.ext': '<current file text>', ... }
// Returns per-swap applyability + whole-file elision scan of any non-swap fence.
function scoreAnswer(answer, sources = {}) {
  const swaps = extractSwaps(answer);
  const swapResults = swaps.map((s) => {
    const src = s.file != null ? sources[s.file] : undefined;
    if (src === undefined) {
      return { ...s, applies: false, count: null, reason: 'no source provided for file (cannot verify)' };
    }
    return { ...s, ...checkSwapApplies(src, s.oldBlock) };
  });

  // Any fenced block NOT consumed by a swap is treated as a whole-file payload
  // and scanned for elision.
  const swapCode = new Set(swaps.flatMap((s) => [s.oldBlock, s.newBlock]));
  const wholeFiles = fences(answer)
    .map((b) => b.code)
    .filter((c) => !swapCode.has(c))
    .map((c) => ({ ...findElision(c), preview: c.split('\n').slice(0, 1)[0] }));

  const swapsApply = swapResults.length > 0 && swapResults.every((r) => r.applies);
  const noElision = wholeFiles.every((w) => w.whole);
  return {
    applyable: (swapResults.length === 0 || swapsApply) && noElision,
    swaps: swapResults,
    wholeFiles,
  };
}

module.exports = { checkSwapApplies, findElision, extractSwaps, scoreAnswer };

// ============================ self-test (no API) =============================
if (require.main === module && process.argv.includes('--selftest')) {
  let pass = 0;
  let fail = 0;
  const ok = (cond, name) => {
    console.log(`${cond ? 'ok ' : 'XX '} ${name}`);
    cond ? (pass += 1) : (fail += 1);
  };

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
  ].join('\n');

  // --- swap applyability ---
  const goodOld = 'def fetch_user(user_id):\n    row = db.query("SELECT * FROM users WHERE id = ?", user_id)\n    return User.from_row(row)';
  ok(checkSwapApplies(SOURCE, goodOld).applies, 'verbatim unique old block APPLIES');

  const missingOld = 'def fetch_user(user_id):\n    return get_user(user_id)  # paraphrased, not in file';
  ok(!checkSwapApplies(SOURCE, missingOld).applies, 'paraphrased old block is caught (count 0)');
  ok(checkSwapApplies(SOURCE, missingOld).count === 0, '  ...reports zero matches');

  const ambiguousOld = '    row = db.query';
  const amb = checkSwapApplies(SOURCE, ambiguousOld);
  ok(!amb.applies && amb.count === 2, 'non-unique old block is caught as ambiguous (count 2)');

  const crlfSource = SOURCE.replace(/\n/g, '\r\n');
  ok(checkSwapApplies(crlfSource, goodOld).applies, 'CRLF source still matches an LF block (newlines normalized)');

  // --- elision detection ---
  const wholeClean = [
    'import os',
    'from functools import lru_cache',
    '',
    'def f(x):',
    '    return x + 1  # add one to x',
  ].join('\n');
  ok(findElision(wholeClean).whole, 'a genuinely whole file passes (real comment, no elision)');

  const elidedDots = 'def f(x):\n    // ... rest of the function\n    return x';
  ok(!findElision(elidedDots).whole, 'comment ellipsis "// ... rest" is caught');

  const elidedKeyword = 'def f(x):\n    # existing code here\n    return x';
  ok(!findElision(elidedKeyword).whole, 'keyword elision "# existing code here" is caught');

  const elidedUnchanged = 'class A:\n    # ...methods unchanged...\n    pass';
  ok(!findElision(elidedUnchanged).whole, 'comment "...methods unchanged..." is caught');

  const falsePositive = 'def parse(s):\n    # this leaves the input string unchanged when empty\n    return s';
  // This SHOULD be flagged conservatively (comment + "unchanged"); we accept that
  // tradeoff and assert the behavior is intentional, documented, and stable.
  ok(!findElision(falsePositive).whole, 'comment containing "unchanged" is flagged (documented conservative bias)');
  const reworded = 'def parse(s):\n    # empty input is returned as-is\n    return s';
  ok(findElision(reworded).whole, '  ...rewording without the keyword passes (the escape hatch exists)');

  // --- end-to-end answer scoring ---
  const ANSWER = [
    'In `service.py`, replace this:',
    '',
    '```python',
    goodOld,
    '```',
    '',
    'with this:',
    '',
    '```python',
    '@lru_cache(maxsize=1024)  # viceroy: caching added',
    'def fetch_user(user_id):',
    '    row = db.query("SELECT * FROM users WHERE id = ?", user_id)',
    '    return User.from_row(row)',
    '```',
  ].join('\n');
  const scored = scoreAnswer(ANSWER, { 'service.py': SOURCE });
  ok(scored.swaps.length === 1, 'parser extracts one swap from a Viceroy-shaped answer');
  ok(scored.applyable, 'a well-formed Viceroy answer scores APPLYABLE end-to-end');

  const BAD_ANSWER = ANSWER.replace(goodOld, missingOld);
  ok(!scoreAnswer(BAD_ANSWER, { 'service.py': SOURCE }).applyable,
    'an answer whose old block does not match the file scores NOT applyable');

  console.log(`\nself-test: ${pass} passed, ${fail} failed${fail ? '  -- BROKEN' : '  -- all instruments valid'}`);
  process.exit(fail ? 1 : 0);
}
