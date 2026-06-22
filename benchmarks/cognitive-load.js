#!/usr/bin/env node
// Viceroy cognitive-load instrument.
//
// applyability.js  -> "can the edit be dropped in?"          (delivery is sound)
// blast-radius.js  -> "did it do the job without breakage?"  (the edit is correct)
// BOTH are properties of the OUTPUT. Neither measures Viceroy's actual claim,
// which is about the READER: a Viceroy instruction costs the human less effort to
// act on than a vague one, because it hands over the exact change instead of
// describing it.
//
// That sounds subjective, but it has a mechanical core. The effort to turn an
// instruction I into the correct edit T is the information the reader must
// SUPPLY that I did not give them -- the conditional complexity K(T | I). That
// is uncomputable in the ideal, but it has a standard, deterministic, parameter-
// light estimator: Normalized Compression Distance (Cilibrasi & Vitanyi, 2005),
// computed with plain gzip. No humans, no model, no judge -- just: how
// information-distant is the instruction from the change it is asking for?
//
//   NCD(I, T) = (C(I+T) - min(C(I), C(T))) / max(C(I), C(T))
//
//   - A Viceroy exact-swap CONTAINS T verbatim -> gzip exploits the overlap
//     -> C(I+T) ~ C(I) -> NCD near 0  -> the reader reconstructs ~nothing.
//   - A vague instruction shares little with T -> C(I+T) ~ C(I)+C(T)
//     -> NCD near 1  -> the reader must reconstruct the edit themselves.
//
// We report a second, even more transparent axis alongside it:
//
//   coverage(I, T) = fraction of T's content lines present VERBATIM in I.
//
//   Viceroy ~ 1.0 (the new block is literally in the instruction); vague ~ low.
//   (1 - coverage) is the share of the edit the reader has to generate from
//   scratch -- a model-free "reconstruction load" in [0, 1].
//
// SCOPE / honesty: gzip-NCD captures LITERAL (lexical) redundancy. That is
// exactly Viceroy's mechanism -- verbatim delivery -- so it is well matched
// here. An instruction that conveys the answer purely SEMANTICALLY (right idea,
// none of the literal tokens) would look "vague" to this metric even if a human
// found it easy; that is a real limitation, noted, not hidden. The surprisal-
// under-a-fixed-language-model variant (see README) is the heavier instrument
// that captures semantic delivery; this one is the bias-free deterministic floor.
//
//   node cognitive-load.js --selftest    # verify the instrument (no API, no cost)
//
// viceroy: Node stdlib only (zlib). The instrument is the small thing.

'use strict';
const zlib = require('zlib');

// Deterministic compressed size in bytes. Fixed level so the number is
// reproducible for a given zlib build; only the COMPARISON matters, and its
// direction is robust across builds.
function C(s) {
  return zlib.gzipSync(Buffer.from(String(s), 'utf8'), { level: 9 }).length;
}

// Normalized Compression Distance in [0, ~1.1]. 0 = T fully redundant given I
// (instruction already contains the edit); ~1 = independent (reader supplies it).
function ncd(a, b) {
  const ca = C(a);
  const cb = C(b);
  const cab = C(a + '\n' + b);
  return (cab - Math.min(ca, cb)) / Math.max(ca, cb);
}

// Whitespace-insensitive canonical form, so a line that's present but re-spaced
// (`i1 - 1` vs `i1-1`, reindented) still counts as handed-over. This mirrors the
// same fix made in blast-radius.js: a correct edit delivered in a different
// format is still delivered -- the reader pastes it, they don't rebuild it.
// Without this, a model that hands over the whole corrected function as prose
// (qwen does this constantly) was scored as ~85% reader-reconstruction when the
// real cost is near zero. Format is a separate axis from how much work the
// instruction actually saves the reader.
const canonLine = (s) => String(s).replace(/\s+/g, '');

// Fraction of T's non-trivial content lines that appear in I, ignoring spacing.
function coverage(instruction, target) {
  const I = canonLine(instruction);
  const lines = String(target)
    .split('\n')
    .map((l) => canonLine(l))
    .filter((l) => l.length >= 4); // ignore lone braces, blank lines, etc.
  if (lines.length === 0) return 1;
  const present = lines.filter((l) => I.includes(l)).length;
  return present / lines.length;
}

// Reader-reconstruction load for instruction I aimed at producing edit T.
// Lower load = the instruction did more of the reader's work.
//
// The HEADLINE number is `reconstruct`, driven by coverage (how much of the edit
// is actually present in the answer, format-insensitively). `ncd` is reported as
// a secondary diagnostic only -- it is NOT reliable as the headline when answers
// differ a lot in length: a whole-file answer shares incidental byte-substrings
// with any one target function (shared boilerplate across sibling functions), so
// NCD-to-a-single-function can look small even for an answer that DELETED that
// function. Coverage doesn't have that failure mode -- it asks the direct
// question, "are the lines of the correct edit here or not."
function readerLoad(instruction, target) {
  const d = ncd(instruction, target);
  const cov = coverage(instruction, target);
  return {
    coverage: +cov.toFixed(3), // share of the edit handed over (higher = less reader work) -- headline
    reconstruct: +(1 - cov).toFixed(3), // share the reader must generate (lower = less work) -- headline
    ncd: +d.toFixed(3), // raw information distance; diagnostic only, see note above
  };
}

// Compare two instructions that aim at the SAME correct edit T.
function compare(target, instructions) {
  const out = {};
  for (const [arm, instr] of Object.entries(instructions)) out[arm] = readerLoad(instr, target);
  return out;
}

module.exports = { C, ncd, coverage, readerLoad, compare };

// ============================ self-test (no API) =============================
if (require.main === module && process.argv.includes('--selftest')) {
  let pass = 0;
  let fail = 0;
  const ok = (cond, name) => { console.log(`${cond ? 'ok ' : 'XX '} ${name}`); cond ? (pass += 1) : (fail += 1); };

  // The correct edit the reader must end up producing.
  const TARGET = [
    'float guard(int i)',
    '{',
    ' float v;',
    ' if(i+2>N) v=0.0;',
    ' else { v=compute(i); }',
    ' return v;',
    '}',
  ].join('\n');

  // Instruction A (Viceroy-shaped): hands over the exact new block verbatim.
  const EXACT = [
    'In `x.c`, replace the body of guard with this:',
    '',
    '```c',
    TARGET,
    '```',
  ].join('\n');

  // Instruction B (vague-shaped): describes the same change, none of the literal
  // edit tokens. Same correct outcome, but the reader must reconstruct it.
  const VAGUE = [
    'Add a bounds check to the guard function, similar to what the neighboring',
    'function does -- if the index is near the end, zero it out, otherwise run',
    'the usual computation. Put it at the top of the body before anything else.',
  ].join('\n');

  const exact = readerLoad(EXACT, TARGET);
  const vague = readerLoad(VAGUE, TARGET);

  ok(exact.ncd < vague.ncd,
    `exact instruction is information-CLOSER to the edit than vague (ncd ${exact.ncd} < ${vague.ncd})`);
  ok(exact.coverage > vague.coverage,
    `exact instruction hands over more of the edit verbatim (coverage ${exact.coverage} > ${vague.coverage})`);
  ok(exact.coverage >= 0.95,
    `exact instruction hands over essentially the whole edit (coverage ${exact.coverage} >= 0.95)`);
  ok(vague.reconstruct > 0.5,
    `vague instruction forces the reader to reconstruct most of the edit (reconstruct ${vague.reconstruct} > 0.5)`);

  // NCD sanity: identical strings collapse to ~0; unrelated strings approach ~1.
  ok(ncd(TARGET, TARGET) < 0.15, `NCD of a string with itself is ~0 (got ${ncd(TARGET, TARGET).toFixed(3)})`);
  const unrelated = ncd(TARGET, 'the quick brown fox jumps over the lazy dog repeatedly in a field');
  ok(unrelated > 0.6, `NCD of unrelated strings is high (got ${unrelated.toFixed(3)})`);

  // Monotonicity: an instruction that contains HALF the edit lands between the
  // fully-verbatim and the fully-vague instruction on both axes.
  const HALF = ['Add a bounds check to guard:', '', '```c', ' if(i+2>N) v=0.0;', '```',
    'then keep the existing computation in the else branch.'].join('\n');
  const half = readerLoad(HALF, TARGET);
  ok(half.coverage > vague.coverage && half.coverage < exact.coverage,
    `partial instruction sits between vague and exact on coverage (${vague.coverage} < ${half.coverage} < ${exact.coverage})`);

  // THE fix: an instruction that hands over the whole correct edit but REFORMATTED
  // (re-spaced, reindented) must still score as low reader-reconstruction. Before
  // the whitespace-insensitive coverage fix, this scored as if the reader had to
  // rebuild everything, purely because of spacing -- the same class of bug found
  // in blast-radius. The reader pastes a complete function; cost is near zero.
  const REFORMATTED = [
    'Here is the corrected guard function:',
    '',
    '```c',
    'float guard( int i ) {',
    '    float v;',
    '    if ( i + 2 > N ) v = 0.0;',
    '    else { v = compute( i ); }',
    '    return v;',
    '}',
    '```',
  ].join('\n');
  const ref = readerLoad(REFORMATTED, TARGET);
  ok(ref.reconstruct < 0.25,
    `a complete but REFORMATTED edit scores LOW reconstruction (${ref.reconstruct} < 0.25), not punished for whitespace`);

  // Real captured answer: qwen's correct dna-guard fix, delivered as reformatted
  // prose. Pinned so the fix can't regress. (Skipped if fixtures absent.)
  try {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, 'agentic', 'fixtures', 'DNA_slice.c'), 'utf8');
    const s = src.indexOf('float PCN(');
    const e = src.indexOf('\nfloat NCP(', s);
    const pcn = src.slice(s, e);
    const realTarget = pcn
      .replace(' float d1,d2,d3,w,a1,ue0;', ' float d1,d2,d3,w,a1,ue0;\n if(i1+2>N0)  ue0=0.0;\n else {')
      .replace(' ue0=kpcN*(a1-ApcN)*(a1-ApcN);', ' ue0=kpcN*(a1-ApcN)*(a1-ApcN);\n }');
    const realAns = fs.readFileSync(path.join(__dirname, 'agentic', 'fixtures', 'qwen_viceroy_dnaguard_correct.txt'), 'utf8');
    const real = readerLoad(realAns, realTarget);
    ok(real.reconstruct < 0.2,
      `real qwen correct prose fix scores LOW reconstruction (${real.reconstruct} < 0.2) -- it contains the whole function`);
  } catch (err) {
    console.log('-- (skipped real-capture regression: fixtures not found)');
  }

  console.log(`\nself-test: ${pass} passed, ${fail} failed${fail ? '  -- BROKEN' : '  -- all instruments valid'}`);
  process.exit(fail ? 1 : 0);
}