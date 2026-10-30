import { spawnSync } from 'node:child_process';
import { appendFileSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../..', import.meta.url).pathname;
const PAGES = join(ROOT, 'client/src/pages');
const TESTS = join(ROOT, 'test');
const LOG = join(ROOT, 'spikes/arena/results.jsonl');
const PER_PAGE = 10;

export const swaps = [
  ['above(', 'below('],
  ['below(', 'above('],
  ['all(', 'either('],
  ['either(', 'all('],
  ['atLeast(', 'above('],
  ['emitMinimum(', 'emitMaximum('],
  ['emitMaximum(', 'emitMinimum('],
];

export function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function splitArgs(text, open) {
  const args = [];
  let depth = 0;
  let start = open + 1;
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    if (ch === ')' || ch === ']' || ch === '}') {
      depth -= 1;
      if (depth === 0) {
        args.push([start, i]);
        return { args, close: i };
      }
    }
    if (ch === ',' && depth === 1) {
      args.push([start, i]);
      start = i + 1;
    }
  }
  return null;
}

export function sites(source) {
  const begin = source.indexOf('table.createCircuit()');
  const end = source.indexOf('table.finish()', begin);
  if (begin < 0 || end < 0) return [];
  const found = [];
  for (const [from, to] of swaps) {
    let at = source.indexOf(from, begin);
    while (at >= 0 && at < end) {
      const before = source[at - 1];
      if (!/[A-Za-z0-9_]/.test(before ?? '')) found.push({ kind: `${from}→${to}`, at, apply: (s) => s.slice(0, at) + to + s.slice(at + from.length) });
      at = source.indexOf(from, at + 1);
    }
  }
  let at = source.indexOf('emitSelect(', begin);
  while (at >= 0 && at < end) {
    const parsed = splitArgs(source, at + 'emitSelect'.length);
    if (parsed && parsed.args.length === 4) {
      const [, , b, c] = parsed.args;
      const position = at;
      found.push({
        kind: 'select swap',
        at: position,
        apply: (s) => s.slice(0, b[0]) + s.slice(c[0], c[1]) + ',' + s.slice(b[0], b[1]) + s.slice(c[1]),
      });
    }
    at = source.indexOf('emitSelect(', at + 1);
  }
  const number = /(?<![A-Za-z0-9_.#])(\d+\.?\d*)(?![A-Za-z0-9_])/g;
  for (const match of source.slice(begin, end).matchAll(number)) {
    const position = begin + match.index;
    const value = Number(match[1]);
    const next = Number.isInteger(value) ? String(value + 1) : String(Number((value * 1.25).toFixed(4)));
    found.push({
      kind: `number ${match[1]}→${next}`,
      at: position,
      apply: (s) => s.slice(0, position) + next + s.slice(position + match[1].length),
    });
  }
  return found;
}

