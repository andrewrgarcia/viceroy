#!/usr/bin/env node
// Viceroy mini-agent -- the smallest honest version of the loop, with a baseline.
//
// It is the diagram in code:
//   read the file  ->  ask a model to edit it  ->  observe (does the edit apply?)
//                                                  -> apply it / report why not
//
// Two arms, same task, same file, same model -- only the system prompt differs:
//   viceroy   the Viceroy skill as the system prompt
//   baseline  no skill at all (a one-line generic instruction)
//
// Two tasks (--task <id>):
//   cache-fn   trivial: a 10-line synthetic file. Both arms tend to score the
//              same here -- a 10-line file has nowhere to get lost, so it does
//              not stress Viceroy's actual claim. Kept as a sanity-check task.
//   dna-guard  real-world: a genuine, unmodified 77-line slice of a published
//              C simulation (DNAfold, RNA-folding-lab/DNAfold on GitHub), full
//              of one-letter variable names and near-identical sibling
//              functions (PCP/CPC/PCN/NCP all share the same shape). The task:
//              PCN lacks the bounds guard that its sibling CPC already has
//              (`if(i1+2>N0) ...`); add the matching guard to PCN. This is the
//              regime "where do I edit" is genuinely hard in, and the regime
//              Viceroy is actually built for.
//
// Both are scored by the SAME deterministic checker (../applyability.js), so
// "did the skill help?" is a fact you can read off a table, not a guess.
//
// It runs against a FREE local model via Ollama (http://localhost:11434), so the
// whole loop costs nothing. With --demo it skips the model entirely and uses
// baked-in answers for both arms, so you can watch the apply+score path work
// before you even install Ollama.
//
//   node mini-agent.js --demo                                   # cache-fn task, both arms, no model
//   node mini-agent.js --model qwen2.5-coder                     # cache-fn, viceroy arm (default task+arm)
//   node mini-agent.js --model qwen2.5-coder --task dna-guard --arm baseline
//   node mini-agent.js --model qwen2.5-coder --task dna-guard --compare --runs 10
//   node mini-agent.js --model qwen2.5-coder --task all --compare --runs 10   # both tasks, both arms
//
// viceroy: Node stdlib only (http, fs, path), no dependencies. The agent is the small thing.

'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const { scoreAnswer } = require('../applyability.js');
const { analyze } = require('../blast-radius.js');
const { readerLoad } = require('../cognitive-load.js');

// --- task 1: cache-fn -- trivial synthetic file (sanity-check task) ----------
const CACHE_FN_FILE = 'service.py';
const CACHE_FN_SOURCE = [
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

const CACHE_FN_TASK =
  'Add caching to fetch_user so repeated calls with the same user_id do not ' +
  're-query the database. Behavior must stay identical otherwise. Only touch ' +
  'what you need to.';

const CACHE_FN_DEMO = {
  viceroy: [
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
  ].join('\n'),
  baseline: [
    'You can add caching to `fetch_user` by importing `lru_cache` from the',
    '`functools` module near the top of your file, then adding the',
    '`@lru_cache` decorator above the `fetch_user` function definition.',
    'Something like:',
    '',
    '```python',
    '@lru_cache(maxsize=128)',
    'def fetch_user(user_id):',
    '    ...',
    '```',
    '',
    'Just drop that in above your existing function and you should be set!',
  ].join('\n'),
};

// --- task 2: dna-guard -- real, unmodified slice of published C simulation ---
// Source: github.com/RNA-folding-lab/DNAfold, program/DNA.c, lines 480-556.
// Fetched verbatim, byte-identical to the original (see fixtures/DNA_slice.c).
// Real messy scientific C: one-letter vars, near-duplicate sibling functions
// (PC/CP/CN and PCP/CPC/PCN/NCP), almost no whitespace. The kind of file where
// "where does this go" is genuinely the hard part.
const DNA_GUARD_FILE = 'DNA.c';
const DNA_GUARD_SOURCE = "/* ~~~~~~~~~~ Details of bonded potential calculation ~~~~~~~~~~~~~~ */\nfloat PC(int i1,int jc,float x1[chain_maxsize][max_size],float y1[chain_maxsize][max_size],float z1[chain_maxsize][max_size])\n{\n float d,ul;\n d=sqrt((x1[jc][i1-2]-x1[jc][i1-1])*(x1[jc][i1-2]-x1[jc][i1-1])+(y1[jc][i1-2]-y1[jc][i1-1])*(y1[jc][i1-2]-y1[jc][i1-1])+(z1[jc][i1-2]-z1[jc][i1-1])*(z1[jc][i1-2]-z1[jc][i1-1]));\n ul=kpc*(d-lpc)*(d-lpc);\n return ul;\n}\nfloat CP(int i1,int jc,float x1[chain_maxsize][max_size],float y1[chain_maxsize][max_size],float z1[chain_maxsize][max_size])\n{\n float d,ul;\n d=sqrt((x1[jc][i1+1]-x1[jc][i1-1])*(x1[jc][i1+1]-x1[jc][i1-1])+(y1[jc][i1+1]-y1[jc][i1-1])*(y1[jc][i1+1]-y1[jc][i1-1])+(z1[jc][i1+1]-z1[jc][i1-1])*(z1[jc][i1+1]-z1[jc][i1-1]));\n ul=kcp*(d-lcp)*(d-lcp);\n return ul;\n}\nfloat CN(int i1,int jc,float x1[chain_maxsize][max_size],float y1[chain_maxsize][max_size],float z1[chain_maxsize][max_size])\n{\n float d,ul;\n d=sqrt((x1[jc][i1]-x1[jc][i1-1])*(x1[jc][i1]-x1[jc][i1-1])+(y1[jc][i1]-y1[jc][i1-1])*(y1[jc][i1]-y1[jc][i1-1])+(z1[jc][i1]-z1[jc][i1-1])*(z1[jc][i1]-z1[jc][i1-1]));\n ul=kcN*(d-lcN)*(d-lcN);\n return ul;\n}\nfloat PCP(int i1,int jc,float x1[chain_maxsize][max_size],float y1[chain_maxsize][max_size],float z1[chain_maxsize][max_size])\n{\n float d1,d2,d3,w,a1,ue0;\n d1=sqrt((x1[jc][i1-2]-x1[jc][i1-1])*(x1[jc][i1-2]-x1[jc][i1-1])+(y1[jc][i1-2]-y1[jc][i1-1])*(y1[jc][i1-2]-y1[jc][i1-1])+(z1[jc][i1-2]-z1[jc][i1-1])*(z1[jc][i1-2]-z1[jc][i1-1]));\n d2=sqrt((x1[jc][i1-1]-x1[jc][i1+1])*(x1[jc][i1-1]-x1[jc][i1+1])+(y1[jc][i1-1]-y1[jc][i1+1])*(y1[jc][i1-1]-y1[jc][i1+1])+(z1[jc][i1-1]-z1[jc][i1+1])*(z1[jc][i1-1]-z1[jc][i1+1]));\n d3=sqrt((x1[jc][i1+1]-x1[jc][i1-2])*(x1[jc][i1+1]-x1[jc][i1-2])+(y1[jc][i1+1]-y1[jc][i1-2])*(y1[jc][i1+1]-y1[jc][i1-2])+(z1[jc][i1+1]-z1[jc][i1-2])*(z1[jc][i1+1]-z1[jc][i1-2]));\n w=(d1*d1+d2*d2-d3*d3)/(2.0*d1*d2);\n if (w<=-1.0) {a1=3.14;}\n else if (w>=1.0) {a1=0.;}\n else  {a1=acos(w);}\n ue0=kpcp*(a1-Apcp)*(a1-Apcp);  \n return ue0;\n}\nfloat CPC(int i1,int jc,float x1[chain_maxsize][max_size],float y1[chain_maxsize][max_size],float z1[chain_maxsize][max_size])\n{\n float d1,d2,d3,w,a1,ue0;\n if(i1+2>N0)  ue0=0.0;\n else {\n d1=sqrt((x1[jc][i1-1]-x1[jc][i1+1])*(x1[jc][i1-1]-x1[jc][i1+1])+(y1[jc][i1-1]-y1[jc][i1+1])*(y1[jc][i1-1]-y1[jc][i1+1])+(z1[jc][i1-1]-z1[jc][i1+1])*(z1[jc][i1-1]-z1[jc][i1+1]));\n d2=sqrt((x1[jc][i1+1]-x1[jc][i1+2])*(x1[jc][i1+1]-x1[jc][i1+2])+(y1[jc][i1+1]-y1[jc][i1+2])*(y1[jc][i1+1]-y1[jc][i1+2])+(z1[jc][i1+1]-z1[jc][i1+2])*(z1[jc][i1+1]-z1[jc][i1+2]));\n d3=sqrt((x1[jc][i1+2]-x1[jc][i1-1])*(x1[jc][i1+2]-x1[jc][i1-1])+(y1[jc][i1+2]-y1[jc][i1-1])*(y1[jc][i1+2]-y1[jc][i1-1])+(z1[jc][i1+2]-z1[jc][i1-1])*(z1[jc][i1+2]-z1[jc][i1-1]));\n w=(d1*d1+d2*d2-d3*d3)/(2.0*d1*d2);\n if (w<=-1.0) {a1=3.14;}\n else if (w>=1.0) {a1=0.;}\n else  {a1=acos(w);}\n ue0=kcpc*(a1-Acpc)*(a1-Acpc);  \n } \n return ue0;\n}\nfloat PCN(int i1,int jc,float x1[chain_maxsize][max_size],float y1[chain_maxsize][max_size],float z1[chain_maxsize][max_size])\n{\n float d1,d2,d3,w,a1,ue0;\n d1=sqrt((x1[jc][i1-1]-x1[jc][i1-2])*(x1[jc][i1-1]-x1[jc][i1-2])+(y1[jc][i1-1]-y1[jc][i1-2])*(y1[jc][i1-1]-y1[jc][i1-2])+(z1[jc][i1-1]-z1[jc][i1-2])*(z1[jc][i1-1]-z1[jc][i1-2]));\n d2=sqrt((x1[jc][i1-1]-x1[jc][i1])*(x1[jc][i1-1]-x1[jc][i1])+(y1[jc][i1-1]-y1[jc][i1])*(y1[jc][i1-1]-y1[jc][i1])+(z1[jc][i1-1]-z1[jc][i1])*(z1[jc][i1-1]-z1[jc][i1]));\n d3=sqrt((x1[jc][i1-2]-x1[jc][i1])*(x1[jc][i1-2]-x1[jc][i1])+(y1[jc][i1-2]-y1[jc][i1])*(y1[jc][i1-2]-y1[jc][i1])+(z1[jc][i1-2]-z1[jc][i1])*(z1[jc][i1-2]-z1[jc][i1]));\n w=(d1*d1+d2*d2-d3*d3)/(2.0*d1*d2);\n if (w<=-1.0) {a1=3.14;}\n else if (w>=1.0) {a1=0.;}\n else  {a1=acos(w);}\n ue0=kpcN*(a1-ApcN)*(a1-ApcN);\n return ue0;\n}\nfloat NCP(int i1,int jc,float x1[chain_maxsize][max_size],float y1[chain_maxsize][max_size],float z1[chain_maxsize][max_size])\n{\n float d1,d2,d3,w,a1,ue0;\n d1=sqrt((x1[jc][i1-1]-x1[jc][i1])*(x1[jc][i1-1]-x1[jc][i1])+(y1[jc][i1-1]-y1[jc][i1])*(y1[jc][i1-1]-y1[jc][i1])+(z1[jc][i1-1]-z1[jc][i1])*(z1[jc][i1-1]-z1[jc][i1]));\n d2=sqrt((x1[jc][i1-1]-x1[jc][i1+1])*(x1[jc][i1-1]-x1[jc][i1+1])+(y1[jc][i1-1]-y1[jc][i1+1])*(y1[jc][i1-1]-y1[jc][i1+1])+(z1[jc][i1-1]-z1[jc][i1+1])*(z1[jc][i1-1]-z1[jc][i1+1]));\n d3=sqrt((x1[jc][i1+1]-x1[jc][i1])*(x1[jc][i1+1]-x1[jc][i1])+(y1[jc][i1+1]-y1[jc][i1])*(y1[jc][i1+1]-y1[jc][i1])+(z1[jc][i1+1]-z1[jc][i1])*(z1[jc][i1+1]-z1[jc][i1]));\n w=(d1*d1+d2*d2-d3*d3)/(2.0*d1*d2);\n if (w<=-1.0) {a1=3.14;}\n else if (w>=1.0) {a1=0.;}\n else  {a1=acos(w);}\n ue0=kNcp*(a1-ANcp)*(a1-ANcp);\n return ue0;\n}\n";

const DNA_GUARD_TASK =
  'In this file, `CPC` guards against reading past the end of the chain with ' +
  '`if(i1+2>N0) ue0=0.0; else { ... }`. The sibling function `PCN` does the ' +
  'same kind of neighbor-offset distance calculation but has NO such guard, ' +
  'so it can read out of bounds near a chain boundary. Add the matching ' +
  '`i1+2>N0` guard to `PCN`, following the exact pattern `CPC` already uses. ' +
  'Only touch PCN -- do not modify PC, CP, CN, PCP, CPC, or NCP.';

// The real, current PCN function pulled out of the actual fixture text, so the
// demo's "old block" is never hand-typed and can never silently drift from it.
function pcnOldBlock(source) {
  const start = source.indexOf('float PCN(');
  const end = source.indexOf('\nfloat NCP(', start);
  return source.slice(start, end);
}

// A representative viceroy-shaped fix: PCN's body wrapped in the same guard
// CPC already uses, same style (brace placement, variable names) as the file.
const DNA_GUARD_DEMO_VICEROY_NEW = [
  'float PCN(int i1,int jc,float x1[chain_maxsize][max_size],float y1[chain_maxsize][max_size],float z1[chain_maxsize][max_size])',
  '{',
  ' float d1,d2,d3,w,a1,ue0;',
  ' if(i1+2>N0)  ue0=0.0;',
  ' else {',
  ' d1=sqrt((x1[jc][i1-1]-x1[jc][i1-2])*(x1[jc][i1-1]-x1[jc][i1-2])+(y1[jc][i1-1]-y1[jc][i1-2])*(y1[jc][i1-1]-y1[jc][i1-2])+(z1[jc][i1-1]-z1[jc][i1-2])*(z1[jc][i1-1]-z1[jc][i1-2]));',
  ' d2=sqrt((x1[jc][i1-1]-x1[jc][i1])*(x1[jc][i1-1]-x1[jc][i1])+(y1[jc][i1-1]-y1[jc][i1])*(y1[jc][i1-1]-y1[jc][i1])+(z1[jc][i1-1]-z1[jc][i1])*(z1[jc][i1-1]-z1[jc][i1]));',
  ' d3=sqrt((x1[jc][i1-2]-x1[jc][i1])*(x1[jc][i1-2]-x1[jc][i1])+(y1[jc][i1-2]-y1[jc][i1])*(y1[jc][i1-2]-y1[jc][i1])+(z1[jc][i1-2]-z1[jc][i1])*(z1[jc][i1-2]-z1[jc][i1]));',
  ' w=(d1*d1+d2*d2-d3*d3)/(2.0*d1*d2);',
  ' if (w<=-1.0) {a1=3.14;}',
  ' else if (w>=1.0) {a1=0.;}',
  ' else  {a1=acos(w);}',
  ' ue0=kpcN*(a1-ApcN)*(a1-ApcN);',
  ' }',
  ' return ue0;',
  '}',
].join('\n');

// The observed "no skill" failure on this task (qwen2.5-coder, baseline arm):
// a whole-file dump that silently DELETED the target function PCN and CORRUPTED
// a neighbor (CPC ended up carrying PCN's energy constant), without ever adding
// the guard. Reproduced here by deriving the damage from the real source rather
// than hand-typing it -- so the demo exercises the blast-radius collateral path,
// and matches what the live model actually did. This dump has no elision markers,
// so it (wrongly) passes applyability -- which is the whole point of the episode.
function buildDnaGuardBaselineDump(source) {
  const start = source.indexOf('float PCN(');
  const end = source.indexOf('\nfloat NCP(', start);
  const pcn = source.slice(start, end);
  const damaged = source
    .replace('\n' + pcn, '')                                   // delete PCN entirely
    .replace('ue0=kcpc*(a1-Acpc)*(a1-Acpc);',                  // corrupt CPC's constant
      'ue0=kpcN*(a1-ApcN)*(a1-ApcN);');
  return 'Here is the modified `DNA.c` with the guard added to the `PCN` function:\n\n```c\n'
    + damaged + '\n```';
}

function buildDnaGuardDemo(source) {
  return {
    viceroy: [
      'In `DNA.c`, replace this:',
      '',
      '```c',
      pcnOldBlock(source),
      '```',
      '',
      'with this:',
      '',
      '```c',
      DNA_GUARD_DEMO_VICEROY_NEW,
      '```',
    ].join('\n'),
    baseline: buildDnaGuardBaselineDump(source),
  };
}


// --- task 3: dna-bound -- a DIFFERENT real bug, harder: don't pattern-match -----
// Source: same file, lines 557-645 (program/DNA.c, RNA-folding-lab/DNAfold).
// Fetched verbatim, byte-identical to the original (see fixtures/DNA_slice2.c).
// Four near-identical dihedral-angle functions (PCPC/CPCP/CPCN/NCPC). Naively,
// you'd expect them all to share one guard pattern -- and three of them do
// (`if(i1+2>L0_chain[jc])`), with CPCN guarding the opposite end (`if(i1-4<0)`)
// because it reaches backward instead of forward.
//
// The actual, VERIFIED bug: CPCP's body reads as far as `x1[jc][i1+4]` (see the
// p1/p2/p3/g1/g2/g3 lines), but its guard only checks `i1+2>L0_chain[jc]` -- two
// elements short of what it actually accesses. The other three functions guard
// correctly for what THEY access. Copying any sibling's guard verbatim (the
// "obvious" pattern-match) produces the WRONG fix here -- you have to read which
// index CPCP actually reaches and guard THAT. This is a harder, more honest test
// than dna-guard: it punishes confident pattern-matching, not just carelessness.
const DNA_BOUND_FILE = 'DNA.c';
const DNA_BOUND_SOURCE = "float PCPC(int i1,int jc,float x1[chain_maxsize][max_size],float y1[chain_maxsize][max_size],float z1[chain_maxsize][max_size])\n{\n float c1,c2,c3,p1,p2,p3,e1,f1,pp1,g1,g2,g3,gg1,hh1,di,ud0=0.0;\n if(i1+2>L0_chain[jc]) ud0=0.0;\n else  {\n c1=((y1[jc][i1-2]-y1[jc][i1-1])*(z1[jc][i1-1]-z1[jc][i1+1])-(z1[jc][i1-2]-z1[jc][i1-1])*(y1[jc][i1-1]-y1[jc][i1+1]));\n c2=((z1[jc][i1-2]-z1[jc][i1-1])*(x1[jc][i1-1]-x1[jc][i1+1])-(x1[jc][i1-2]-x1[jc][i1-1])*(z1[jc][i1-1]-z1[jc][i1+1]));\n c3=((x1[jc][i1-2]-x1[jc][i1-1])*(y1[jc][i1-1]-y1[jc][i1+1])-(y1[jc][i1-2]-y1[jc][i1-1])*(x1[jc][i1-1]-x1[jc][i1+1]));\n p1=((y1[jc][i1-1]-y1[jc][i1+1])*(z1[jc][i1+1]-z1[jc][i1+2])-(z1[jc][i1-1]-z1[jc][i1+1])*(y1[jc][i1+1]-y1[jc][i1+2]));\n p2=((z1[jc][i1-1]-z1[jc][i1+1])*(x1[jc][i1+1]-x1[jc][i1+2])-(x1[jc][i1-1]-x1[jc][i1+1])*(z1[jc][i1+1]-z1[jc][i1+2]));\n p3=((x1[jc][i1-1]-x1[jc][i1+1])*(y1[jc][i1+1]-y1[jc][i1+2])-(y1[jc][i1-1]-y1[jc][i1+1])*(x1[jc][i1+1]-x1[jc][i1+2]));\n e1=sqrt(c1*c1+c2*c2+c3*c3); f1=sqrt(p1*p1+p2*p2+p3*p3);\n pp1=(c1*p1+c2*p2+c3*p3)/(e1*f1);\n g1=(x1[jc][i1-2]-x1[jc][i1+2]); g2=(y1[jc][i1-2]-y1[jc][i1+2]); g3=(z1[jc][i1-2]-z1[jc][i1+2]);\n gg1=sqrt(g1*g1+g2*g2+g3*g3); hh1=(p1*g1+p2*g2+p3*g3)/(f1*gg1);\n if (pp1<=-1.0) {di=-3.14;}\n else if (pp1>=1.0) {di=0.;}\n else if (hh1>=0.) {di=acos(pp1);}\n else {di=-acos(pp1);}\n ud0=kpcpc*((1-cos(di-dpcpc))+0.5*(1-cos(3.*(di-dpcpc)))); }\n return ud0;\n}\nfloat CPCP(int i1,int jc,float x1[chain_maxsize][max_size],float y1[chain_maxsize][max_size],float z1[chain_maxsize][max_size])\n{\n float c1,c2,c3,p1,p2,p3,e1,f1,pp1,g1,g2,g3,gg1,hh1,di,ud0=0.0;\n if(i1+2>L0_chain[jc]) ud0=0.0;\n else  {\n c1=((y1[jc][i1-1]-y1[jc][i1+1])*(z1[jc][i1+1]-z1[jc][i1+2])-(z1[jc][i1-1]-z1[jc][i1+1])*(y1[jc][i1+1]-y1[jc][i1+2]));\n c2=((z1[jc][i1-1]-z1[jc][i1+1])*(x1[jc][i1+1]-x1[jc][i1+2])-(x1[jc][i1-1]-x1[jc][i1+1])*(z1[jc][i1+1]-z1[jc][i1+2]));\n c3=((x1[jc][i1-1]-x1[jc][i1+1])*(y1[jc][i1+1]-y1[jc][i1+2])-(y1[jc][i1-1]-y1[jc][i1+1])*(x1[jc][i1+1]-x1[jc][i1+2]));\n p1=((y1[jc][i1+1]-y1[jc][i1+2])*(z1[jc][i1+2]-z1[jc][i1+4])-(z1[jc][i1+1]-z1[jc][i1+2])*(y1[jc][i1+2]-y1[jc][i1+4]));\n p2=((z1[jc][i1+1]-z1[jc][i1+2])*(x1[jc][i1+2]-x1[jc][i1+4])-(x1[jc][i1+1]-x1[jc][i1+2])*(z1[jc][i1+2]-z1[jc][i1+4]));\n p3=((x1[jc][i1+1]-x1[jc][i1+2])*(y1[jc][i1+2]-y1[jc][i1+4])-(y1[jc][i1+1]-y1[jc][i1+2])*(x1[jc][i1+2]-x1[jc][i1+4]));\n e1=sqrt(c1*c1+c2*c2+c3*c3); f1=sqrt(p1*p1+p2*p2+p3*p3);\n pp1=(c1*p1+c2*p2+c3*p3)/(e1*f1);\n g1=(x1[jc][i1-1]-x1[jc][i1+4]); g2=(y1[jc][i1-1]-y1[jc][i1+4]); g3=(z1[jc][i1-1]-z1[jc][i1+4]);\n gg1=sqrt(g1*g1+g2*g2+g3*g3); hh1=(p1*g1+p2*g2+p3*g3)/(f1*gg1);\n if (pp1<=-1.0) {di=-3.14;}\n else if (pp1>=1.0) {di=0.;}\n else if (hh1>=0.) {di=acos(pp1);}\n else {di=-acos(pp1);}\n ud0=kcpcp*((1-cos(di-dcpcp))+0.5*(1-cos(3.*(di-dcpcp))));  }\n return ud0;\n}\nfloat CPCN(int i1,int jc,float x1[chain_maxsize][max_size],float y1[chain_maxsize][max_size],float z1[chain_maxsize][max_size])\n{\n float c1,c2,c3,p1,p2,p3,e1,f1,pp1,g1,g2,g3,gg1,hh1,di,ud0=0.0;\n if(i1-4<0) ud0=0.0;\n else  {\n c1=((y1[jc][i1-4]-y1[jc][i1-2])*(z1[jc][i1-2]-z1[jc][i1-1])-(z1[jc][i1-4]-z1[jc][i1-2])*(y1[jc][i1-2]-y1[jc][i1-1]));\n c2=((z1[jc][i1-4]-z1[jc][i1-2])*(x1[jc][i1-2]-x1[jc][i1-1])-(x1[jc][i1-4]-x1[jc][i1-2])*(z1[jc][i1-2]-z1[jc][i1-1]));\n c3=((x1[jc][i1-4]-x1[jc][i1-2])*(y1[jc][i1-2]-y1[jc][i1-1])-(y1[jc][i1-4]-y1[jc][i1-2])*(x1[jc][i1-2]-x1[jc][i1-1]));\n p1=((y1[jc][i1-2]-y1[jc][i1-1])*(z1[jc][i1-1]-z1[jc][i1])-(z1[jc][i1-2]-z1[jc][i1-1])*(y1[jc][i1-1]-y1[jc][i1]));\n p2=((z1[jc][i1-2]-z1[jc][i1-1])*(x1[jc][i1-1]-x1[jc][i1])-(x1[jc][i1-2]-x1[jc][i1-1])*(z1[jc][i1-1]-z1[jc][i1]));\n p3=((x1[jc][i1-2]-x1[jc][i1-1])*(y1[jc][i1-1]-y1[jc][i1])-(y1[jc][i1-2]-y1[jc][i1-1])*(x1[jc][i1-1]-x1[jc][i1]));\n e1=sqrt(c1*c1+c2*c2+c3*c3); f1=sqrt(p1*p1+p2*p2+p3*p3);\n pp1=(c1*p1+c2*p2+c3*p3)/(e1*f1);\n g1=(x1[jc][i1-4]-x1[jc][i1]); g2=(y1[jc][i1-4]-y1[jc][i1]); g3=(z1[jc][i1-4]-z1[jc][i1]);\n gg1=sqrt(g1*g1+g2*g2+g3*g3); hh1=(p1*g1+p2*g2+p3*g3)/(f1*gg1);\n if (pp1<=-1.0) {di=-3.14;}\n else if (pp1>=1.0) {di=0.;}\n else if (hh1>=0.) {di=acos(pp1);}\n else {di=-acos(pp1);}\n ud0=kcpcN*((1-cos(di-dcpcN))+0.5*(1-cos(3.*(di-dcpcN)))); }\n return ud0;\n}\nfloat NCPC(int i1,int jc,float x1[chain_maxsize][max_size],float y1[chain_maxsize][max_size],float z1[chain_maxsize][max_size])\n{\n float c1,c2,c3,p1,p2,p3,e1,f1,pp1,g1,g2,g3,gg1,hh1,di,ud0=0.0;\n if(i1+2>L0_chain[jc]) ud0=0.0;\n else  {\n c1=((y1[jc][i1]-y1[jc][i1-1])*(z1[jc][i1-1]-z1[jc][i1+1])-(z1[jc][i1]-z1[jc][i1-1])*(y1[jc][i1-1]-y1[jc][i1+1]));\n c2=((z1[jc][i1]-z1[jc][i1-1])*(x1[jc][i1-1]-x1[jc][i1+1])-(x1[jc][i1]-x1[jc][i1-1])*(z1[jc][i1-1]-z1[jc][i1+1]));\n c3=((x1[jc][i1]-x1[jc][i1-1])*(y1[jc][i1-1]-y1[jc][i1+1])-(y1[jc][i1]-y1[jc][i1-1])*(x1[jc][i1-1]-x1[jc][i1+1]));\n p1=((y1[jc][i1-1]-y1[jc][i1+1])*(z1[jc][i1+1]-z1[jc][i1+2])-(z1[jc][i1-1]-z1[jc][i1+1])*(y1[jc][i1+1]-y1[jc][i1+2]));\n p2=((z1[jc][i1-1]-z1[jc][i1+1])*(x1[jc][i1+1]-x1[jc][i1+2])-(x1[jc][i1-1]-x1[jc][i1+1])*(z1[jc][i1+1]-z1[jc][i1+2]));\n p3=((x1[jc][i1-1]-x1[jc][i1+1])*(y1[jc][i1+1]-y1[jc][i1+2])-(y1[jc][i1-1]-y1[jc][i1+1])*(x1[jc][i1+1]-x1[jc][i1+2]));\n e1=sqrt(c1*c1+c2*c2+c3*c3);\n f1=sqrt(p1*p1+p2*p2+p3*p3);\n pp1=(c1*p1+c2*p2+c3*p3)/(e1*f1);\n g1=(x1[jc][i1]-x1[jc][i1+2]); g2=(y1[jc][i1]-y1[jc][i1+2]); g3=(z1[jc][i1]-z1[jc][i1+2]);\n gg1=sqrt(g1*g1+g2*g2+g3*g3); hh1=(p1*g1+p2*g2+p3*g3)/(f1*gg1);\n if (pp1<=-1.0) {di=-3.14;}\n else if (pp1>=1.0) {di=0.;}\n else if (hh1>=0.) {di=acos(pp1);}\n else {di=-acos(pp1);}\n ud0=kNcpc*((1-cos(di-dNcpc))+0.5*(1-cos(3.*(di-dNcpc)))); }\n return ud0;\n}\n";

const DNA_BOUND_TASK =
  'In this file, four functions (PCPC, CPCP, CPCN, NCPC) guard against reading ' +
  'past the end of the chain before doing their distance calculations. Three of ' +
  'them check `i1+2>L0_chain[jc]` and one (CPCN) checks `i1-4<0` because it reads ' +
  'backward instead of forward -- both are correct for what each function reads. ' +
  'BUT: `CPCP`\'s guard checks `i1+2>L0_chain[jc]`, while its body actually reads ' +
  'as far as `x1[jc][i1+4]` (see the p1/p2/p3/g1/g2/g3 lines) -- the guard is two ' +
  'elements short of what the function actually accesses, so it can still read ' +
  'out of bounds near a chain boundary even when the guard passes. Fix ONLY the ' +
  'guard condition in `CPCP` so it correctly covers the farthest index it reads ' +
  '(`i1+4`), Do not copy another function\'s guard verbatim -- the other three ' +
  'guard a different reach than CPCP does. Only touch CPCP -- do not modify ' +
  'PCPC, CPCN, or NCPC.';

// The real, current CPCP function pulled out of the actual fixture text.
function cpcpOldBlock(source) {
  const start = source.indexOf('float CPCP(');
  const end = source.indexOf('\nfloat CPCN(', start);
  return source.slice(start, end);
}

// The correct fix: tighten the guard from i1+2 to i1+4 -- nothing else changes.
function buildDnaBoundCorrectCpcp(source) {
  return cpcpOldBlock(source).replace('if(i1+2>L0_chain[jc])', 'if(i1+4>L0_chain[jc])');
}

// A representative "no skill" failure: pattern-matches the MAJORITY guard
// (i1+2, seen on PCPC/NCPC) instead of reading what CPCP itself accesses. This
// is a realistic, plausible mistake -- not a strawman -- because three of the
// four sibling functions really do share that exact guard. It also shows the
// failure mode dna-guard couldn't: this answer IS applyable, correctness-wise
// it changes the RIGHT function, but the value it lands is WRONG (a no-op,
// since CPCP already had i1+2 -- the bug survives untouched).
function buildDnaBoundBaselineWrongFix(source) {
  const old = cpcpOldBlock(source);
  // re-asserts the SAME (buggy) guard the model "fixed" nothing about --
  // a model that pattern-matches the majority sees i1+2 already there and,
  // misreading the task, leaves it untouched or re-states it unchanged.
  const unchanged = old; // identical block: the "fix" is a no-op
  return [
    'Looking at the four functions, they should all use the same chain-boundary',
    'guard. `CPCP` already has `if(i1+2>L0_chain[jc])`, matching `PCPC` and',
    '`NCPC`, so it looks consistent with its siblings:',
    '',
    '```c',
    unchanged,
    '```',
    '',
    'This matches the pattern used elsewhere in the file, so no change is needed.',
  ].join('\n');
}

function buildDnaBoundDemo(source) {
  const correct = buildDnaBoundCorrectCpcp(source);
  return {
    viceroy: [
      'In `DNA.c`, replace this:',
      '',
      '```c',
      cpcpOldBlock(source),
      '```',
      '',
      'with this:',
      '',
      '```c',
      correct,
      '```',
    ].join('\n'),
    baseline: buildDnaBoundBaselineWrongFix(source),
  };
}

// --- task registry ------------------------------------------------------------
const TASKS = {
  'cache-fn': {
    file: CACHE_FN_FILE,
    source: CACHE_FN_SOURCE,
    task: CACHE_FN_TASK,
    demo: CACHE_FN_DEMO,
    note: 'trivial synthetic file -- sanity check, not the real claim',
  },
  'dna-guard': {
    file: DNA_GUARD_FILE,
    source: DNA_GUARD_SOURCE,
    task: DNA_GUARD_TASK,
    demo: buildDnaGuardDemo(DNA_GUARD_SOURCE),
    note: 'real, unmodified 77-line C slice (DNAfold, github.com/RNA-folding-lab/DNAfold) -- the actual claim',
    // blast-radius config: the function the task is allowed to change, and a
    // token that must appear in it after a correct edit. Present only on C
    // tasks; cache-fn (Python) reports applyability only -- the function
    // splitter is C-specific and cache-fn is the throwaway sanity task anyway.
    blast: { targetFn: 'PCN', requiredToken: 'i1+2>N0' },
    // reader-load config: the correct edit content the reader must end up with.
    // cognitive-load measures how much of THIS the instruction hands over vs
    // leaves the reader to reconstruct. Reusing the known-correct guarded PCN.
    targetEdit: DNA_GUARD_DEMO_VICEROY_NEW,
  },
  'dna-bound': {
    file: DNA_BOUND_FILE,
    source: DNA_BOUND_SOURCE,
    task: DNA_BOUND_TASK,
    demo: buildDnaBoundDemo(DNA_BOUND_SOURCE),
    note: 'real, unmodified 89-line C slice, SAME file as dna-guard but a different bug shape -- punishes pattern-matching the majority guard instead of reading what the buggy function actually accesses',
    blast: { targetFn: 'CPCP', requiredToken: 'i1+4>L0_chain' },
    targetEdit: buildDnaBoundCorrectCpcp(DNA_BOUND_SOURCE),
  },
};

// --- the two system prompts (the only thing that differs between arms) ------
function loadViceroySkill() {
  try {
    return fs.readFileSync(path.join(__dirname, '..', '..', 'skills', 'viceroy', 'SKILL.md'), 'utf8');
  } catch (e) {
    return 'Deliver the change as an exact verbatim block-for-block swap ' +
      '(in `file`, replace this: ```old``` with this: ```new```) where the old ' +
      'block is copied character-for-character from the current file, or as the ' +
      'whole file. Never elide code. Never describe the edit abstractly.';
  }
}

// The baseline is deliberately generic -- a plain coding-assistant instruction,
// the way a model behaves with no skill loaded at all. It does NOT mention
// "verbatim", "swap", or "applyable" -- mentioning those would smuggle Viceroy's
// rule into the "no skill" arm and invalidate the comparison.
const BASELINE_PROMPT = 'You are a helpful coding assistant. Make the change the user asks for.';

const SYSTEM_PROMPTS = { viceroy: loadViceroySkill, baseline: () => BASELINE_PROMPT };

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
        'cannot reach Ollama at 127.0.0.1:11434 \u2014 is it running? Start it with ' +
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

// --- one full pass of the loop for one (task, arm) ---------------------------
async function runOnce(taskId, arm, model, demo) {
  const t = TASKS[taskId];
  const userPrompt = t.task + '\n\nHere is the current `' + t.file + '`:\n\n```\n' + t.source + '```';
  const answer = demo ? t.demo[arm] : await ollamaChat(model, SYSTEM_PROMPTS[arm](), userPrompt);
  const scored = scoreAnswer(answer, { [t.file]: t.source });
  return { taskId, arm, answer, scored };
}

// --- pretty-print one run in full (used outside --compare) ------------------
function printRun({ taskId, arm, answer, scored }, model, demo) {
  const t = TASKS[taskId];
  console.log('Viceroy mini-agent \u2014 one pass of the loop (task: ' + taskId + ', arm: ' + arm + ')\n');
  console.log('note : ' + t.note + '\n');
  console.log('task : ' + t.task + '\n');
  console.log('file : ' + t.file + '  (' + t.source.split('\n').length + ' lines)\n');
  console.log('mode : ' + (demo ? '--demo (no model, baked-in answer)' : 'Ollama model "' + model + '"') + '\n');

  console.log('--- model answer ' + '-'.repeat(40));
  console.log(answer.trim());
  console.log('-'.repeat(57) + '\n');

  console.log('--- applyability ' + '-'.repeat(40));
  if (scored.swaps.length === 0 && scored.wholeFiles.length === 0) {
    console.log('no edit found in the answer (the model described it instead of delivering it).');
  }
  scored.swaps.forEach((s, i) => {
    console.log('swap ' + (i + 1) + ' [' + (s.file || t.file) + ']: ' + (s.applies ? 'APPLIES' : 'DOES NOT APPLY') + ' \u2014 ' + s.reason);
  });
  scored.wholeFiles.forEach((w, i) => {
    console.log('whole-file ' + (i + 1) + ': ' + (w.whole ? 'no elision' : 'ELIDED at line ' + w.hits[0].line + ' (' + w.hits[0].text + ')'));
  });
  console.log('\nverdict: ' + (scored.applyable ? 'APPLYABLE \u2714  (the loop is done)' : 'NOT APPLYABLE \u2718  (a real agent would re-prompt and loop again)'));
  console.log('-'.repeat(57) + '\n');

  // Applyability is necessary, not sufficient. For tasks with a blast-radius
  // config, also show task-completion and collateral damage -- the axes that
  // catch an answer which drops in clean but didn't do the job (or broke a
  // neighbor). This is the dna-guard lesson, surfaced on every single run.
  if (t.blast) {
    const br = analyze(answer, t.source, t.blast);
    console.log('--- correctness (beyond applyability) ' + '-'.repeat(19));
    console.log('answer shape       : ' + br.shape + (br.shape === 'prose' ? '  (described, never delivered)' : ''));
    console.log('task done          : ' + (br.taskDone ? 'YES \u2714  (guard landed in ' + t.blast.targetFn + ')' : 'NO \u2718  (' + t.blast.targetFn + (br.shape === 'prose' ? ' was described but never delivered' : br.targetPresent ? ' present but guard absent' : ' missing entirely') + ')'));
    console.log('collateral damage  : ' + (br.noCollateral ? 'none \u2714  (untouched functions left alone)' : 'YES \u2718  changed=' + (br.changed.join('/') || 'none') + ' deleted=' + (br.missing.join('/') || 'none')));
    console.log('overall            : ' + (scored.applyable && br.taskDone && br.noCollateral ? 'PASS \u2714  (applyable AND correct AND surgical)' : 'FAIL \u2718  (an applyable edit is not automatically a good one)'));
    console.log('-'.repeat(57) + '\n');
  }

  // The third axis: what the instruction costs the READER. Measures how much of
  // the correct edit this answer hands over vs leaves the reader to reconstruct
  // -- deterministic (gzip-NCD + verbatim coverage), the metric for Viceroy's
  // actual claim (specificity), not just whether the output was sound.
  if (t.targetEdit) {
    const rl = readerLoad(answer, t.targetEdit);
    console.log('--- reader load (the cost to the human) ' + '-'.repeat(17));
    console.log('handed over to reader : ' + (rl.coverage * 100).toFixed(0) + '%  (of the correct edit, format-insensitive)');
    console.log('reader reconstructs   : ' + (rl.reconstruct * 100).toFixed(0) + '%  (HEADLINE -- lower = less cognitive work)');
    console.log('  (ncd diagnostic     : ' + rl.ncd.toFixed(3) + '  -- raw gzip distance, unreliable across answer lengths)');
    console.log('-'.repeat(57) + '\n');
  }

  if (scored.applyable && scored.swaps.length) {
    const result = applySwaps(t.source, scored.swaps);
    console.log('--- ' + t.file + ' after applying ' + '-'.repeat(Math.max(0, 30 - t.file.length)));
    console.log(result.trim());
    console.log('-'.repeat(57));
  }
}

// --- --compare: run both arms N times each (per task), tally apply-rate -----
async function runCompare(taskIds, model, demo, runs) {
  console.log('Viceroy mini-agent \u2014 comparison (n=' + runs + ' per arm per task)\n');

  const allTallies = {};
  for (const taskId of taskIds) {
    const t = TASKS[taskId];
    console.log('=== task: ' + taskId + ' ' + '-'.repeat(Math.max(0, 50 - taskId.length)));
    console.log('note  : ' + t.note);
    console.log('task  : ' + t.task);
    console.log('mode  : ' + (demo ? '--demo (no model, baked-in answers \u2014 same answer every run)' : 'Ollama model "' + model + '"') + '\n');

    const tally = {
      viceroy: { apply: 0, done: 0, clean: 0, total: 0, reconSum: 0, ncdSum: 0 },
      baseline: { apply: 0, done: 0, clean: 0, total: 0, reconSum: 0, ncdSum: 0 },
    };
    for (const arm of ['viceroy', 'baseline']) {
      for (let i = 0; i < runs; i += 1) {
        const { answer, scored } = await runOnce(taskId, arm, model, demo);
        tally[arm].total += 1;
        if (scored.applyable) tally[arm].apply += 1;
        let extra = '';
        if (t.blast) {
          const br = analyze(answer, t.source, t.blast);
          if (br.taskDone) tally[arm].done += 1;
          if (br.noCollateral) tally[arm].clean += 1;
          extra = '  [shape=' + br.shape
            + ', done=' + (br.taskDone ? 'Y' : 'N')
            + ', collateral=' + (br.collateral.length ? br.collateral.join('/') : 'none')
            + (br.missing.length ? ', deleted=' + br.missing.join('/') : '')
            + ']';
        }
        if (t.targetEdit) {
          const rl = readerLoad(answer, t.targetEdit);
          tally[arm].reconSum += rl.reconstruct;
          tally[arm].ncdSum += rl.ncd;
          extra += '  reader-reconstructs=' + (rl.reconstruct * 100).toFixed(0) + '%';
        }
        const tag = scored.applyable ? 'APPLIES' : 'NOT APPLYABLE';
        console.log('  [' + arm.padEnd(8) + '] run ' + (i + 1) + '/' + runs + ': ' + tag + extra);
        if (demo) break; // demo answers never change; one pass settles it
      }
    }
    allTallies[taskId] = tally;

    console.log('\n  --- result ---');
    if (t.blast) {
      console.log('  arm        applyable   task-done   collateral-free');
      for (const arm of ['viceroy', 'baseline']) {
        const { apply, done, clean, total } = tally[arm];
        const pc = (n) => (total ? Math.round((100 * n) / total) : 0) + '%';
        console.log('  ' + arm.padEnd(10)
          + ' ' + (apply + '/' + total + ' (' + pc(apply) + ')').padEnd(11)
          + ' ' + (done + '/' + total + ' (' + pc(done) + ')').padEnd(11)
          + ' ' + (clean + '/' + total + ' (' + pc(clean) + ')'));
      }
      console.log('\n  applyable   = drops in clean (no elision / swap is unique). Necessary, not sufficient.');
      console.log('  task-done   = the requested change actually landed in the target function.');
      console.log('  collateral-free = no OTHER function was changed or deleted (the Viceroy-shaped metric).');
      if (t.targetEdit) {
        const avg = (arm) => tally[arm].total ? Math.round((100 * tally[arm].reconSum) / tally[arm].total) : 0;
        console.log('\n  reader-reconstructs (avg): viceroy ' + avg('viceroy') + '%   baseline ' + avg('baseline') + '%');
        console.log('  = how much of the correct edit the instruction left the HUMAN to rebuild');
        console.log('    (deterministic gzip-NCD + verbatim coverage; lower = less cognitive load). Viceroy\u2019s actual claim.');
      }
    } else {
      console.log('  arm        apply-rate');
      for (const arm of ['viceroy', 'baseline']) {
        const { apply, total } = tally[arm];
        const pct = total ? Math.round((100 * apply) / total) : 0;
        console.log('  ' + arm.padEnd(10) + ' ' + apply + '/' + total + '  (' + pct + '%)');
      }
      console.log('  (applyability only -- this task carries no blast-radius config)');
    }
    console.log('');
  }

  // Cross-task aggregate: the actual "multi-task benchmark" headline. Only
  // rolls up tasks that carry real scoring config (blast-radius + targetEdit) --
  // cache-fn is the throwaway sanity task and is excluded so it can't dilute
  // the real signal with its by-design null result.
  const realTaskIds = taskIds.filter((id) => TASKS[id].blast && TASKS[id].targetEdit);
  if (realTaskIds.length > 1) {
    console.log('='.repeat(57));
    console.log('AGGREGATE across ' + realTaskIds.length + ' real tasks (' + realTaskIds.join(', ') + '), n=' + runs + ' each\n');
    const agg = {
      viceroy: { apply: 0, done: 0, clean: 0, total: 0, reconSum: 0 },
      baseline: { apply: 0, done: 0, clean: 0, total: 0, reconSum: 0 },
    };
    for (const id of realTaskIds) {
      for (const arm of ['viceroy', 'baseline']) {
        const t = allTallies[id][arm];
        agg[arm].apply += t.apply;
        agg[arm].done += t.done;
        agg[arm].clean += t.clean;
        agg[arm].total += t.total;
        agg[arm].reconSum += t.reconSum;
      }
    }
    console.log('  arm        applyable   task-done   collateral-free   reader-reconstructs');
    for (const arm of ['viceroy', 'baseline']) {
      const { apply, done, clean, total, reconSum } = agg[arm];
      const pc = (n) => (total ? Math.round((100 * n) / total) : 0) + '%';
      console.log('  ' + arm.padEnd(10)
        + ' ' + (apply + '/' + total + ' (' + pc(apply) + ')').padEnd(11)
        + ' ' + (done + '/' + total + ' (' + pc(done) + ')').padEnd(11)
        + ' ' + (clean + '/' + total + ' (' + pc(clean) + ')').padEnd(17)
        + ' ' + (total ? Math.round((100 * reconSum) / total) : 0) + '%');
    }
    console.log('\n  This is pooled across DIFFERENT bug shapes (deletion+corruption risk in dna-guard,');
    console.log('  wrong-target pattern-matching risk in dna-bound) -- a result that holds across both');
    console.log("  is a real signal, not one task's lucky framing.");
    console.log('='.repeat(57));
  }

  console.log('-'.repeat(57));
  console.log(
    '\nThis is the comparison the README is missing. Run it with --runs 10+ on a\n' +
    'real model for a number worth quoting; n=1 (the default) only proves the\n' +
    'wiring, the same way a single coin flip proves nothing about the coin.',
  );
  return allTallies;
}

(async () => {
  const args = process.argv.slice(2);
  const demo = args.includes('--demo');
  const model = args[args.indexOf('--model') + 1] || 'llama3.2';
  const compare = args.includes('--compare');
  const armArg = args[args.indexOf('--arm') + 1];
  const arm = armArg && SYSTEM_PROMPTS[armArg] ? armArg : 'viceroy';
  const runsArg = parseInt(args[args.indexOf('--runs') + 1], 10);
  const runs = Number.isInteger(runsArg) && runsArg > 0 ? runsArg : 1;
  const taskArg = args[args.indexOf('--task') + 1];
  const taskIds = taskArg === 'all' ? Object.keys(TASKS)
    : (taskArg && TASKS[taskArg] ? [taskArg] : ['cache-fn']);

  if (compare) {
    await runCompare(taskIds, model, demo, runs);
    return;
  }

  const result = await runOnce(taskIds[0], arm, model, demo);
  printRun(result, model, demo);
  process.exit(result.scored.applyable ? 0 : 1);
})().catch((e) => { console.error('\n' + e.message); process.exit(2); });