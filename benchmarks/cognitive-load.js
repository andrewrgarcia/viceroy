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

// Fraction of T's non-trivial content lines that appear verbatim (trimmed) in I.
function coverage(instruction, target) {
  const I = String(instruction);
  const lines = String(target)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length >= 4); // ignore lone braces, blank lines, etc.
  if (lines.length === 0) return 1;
  const present = lines.filter((l) => I.includes(l)).length;
  return present / lines.length;
}

// Reader-reconstruction load for instruction I aimed at producing edit T.
// Lower load = the instruction did more of the reader's work.
function readerLoad(instruction, target) {
  const d = ncd(instruction, target);
  const cov = coverage(instruction, target);
  return {
    ncd: +d.toFixed(3), // information distance instruction->edit (lower = less reader work)
    coverage: +cov.toFixed(3), // share of the edit handed over verbatim (higher = less reader work)
    reconstruct: +(1 - cov).toFixed(3), // share the reader must generate (lower = less work)
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

  console.log(`\nself-test: ${pass} passed, ${fail} failed${fail ? '  -- BROKEN' : '  -- all instruments valid'}`);
  process.exit(fail ? 1 : 0);
}
