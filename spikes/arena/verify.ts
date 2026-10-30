import { appendFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { behaviour, same } from './behave';
import { seeded, sites } from './lib.mjs';

const ROOT = new URL('../..', import.meta.url).pathname;
const HERE = join(ROOT, 'spikes/arena');
const OUT = join(HERE, 'verify.jsonl');
const pages = (slug: string) => readFileSync(join(ROOT, 'client/src/pages', `${slug}.ts`), 'utf8');

type Site = { kind: string; at: number; apply: (s: string) => string };

function pickedSites(source: string, slug: string): Site[] {
  const all = sites(source) as Site[];
  const random = seeded([...slug].reduce((h, c) => h * 31 + c.charCodeAt(0), 7));
  return all
    .map((site) => ({ site, key: random() }))
    .sort((a, b) => a.key - b.key)
    .slice(0, 10)
    .map((entry) => entry.site);
}

function lineOf(source: string, at: number) {
  return source.slice(0, at).split('\n').length;
}

function undoAtLine(mutant: string, line: number, spec: string[][] | null, tag: string): { grounded: boolean; tried: number } {
  const candidates = (sites(mutant) as Site[]).filter((site) => Math.abs(lineOf(mutant, site.at) - line) <= 2);
  const inverse = (sites(mutant) as Site[])
    .filter((site) => site.kind.startsWith('number'))
    .filter((site) => Math.abs(lineOf(mutant, site.at) - line) <= 2);
  let tried = 0;
  for (const site of candidates) {
    tried += 1;
    if (same(behaviour(site.apply(mutant), `${tag}-c${tried}`), spec)) return { grounded: true, tried };
  }
  const lines = mutant.split('\n');
  const target = lines.slice(Math.max(0, line - 3), line + 2).join('\n');
  for (const match of target.matchAll(/(?<![A-Za-z0-9_.#])(\d+\.?\d*)(?![A-Za-z0-9_])/g)) {
    for (const factor of [0.8, 0.5, 2, 1.25]) {
      const value = Number(match[1]);
      for (const next of [String(Number((value * factor).toFixed(4))), String(value - 1)]) {
        tried += 1;
        const start = lines.slice(0, Math.max(0, line - 3)).join('\n').length + (line > 3 ? 1 : 0) + (match.index ?? 0);
        const candidate = mutant.slice(0, start) + next + mutant.slice(start + (match[1] as string).length);
        if (same(behaviour(candidate, `${tag}-n${tried}`), spec)) return { grounded: true, tried };
      }
    }
  }
  void inverse;
  return { grounded: false, tried };
}

const files = [
  ['sonnet', join(HERE, 'hunt.jsonl')],
  ['haiku', join(HERE, 'hunt-haiku.jsonl')],
] as const;
const done = new Set(existsSync(OUT) ? readFileSync(OUT, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).id) : []);
const specCache = new Map<string, string[][] | null>();
const only = process.argv[2];

for (const [model, file] of files) {
  if (only && only !== model) continue;
  for (const raw of readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
    const row = JSON.parse(raw);
    const id = `${model}:${row.task}`;
    if (done.has(id)) continue;
    const original = pages(row.slug);
    if (!specCache.has(row.slug)) specCache.set(row.slug, behaviour(original, `${row.slug}-spec`));
    const spec = specCache.get(row.slug) ?? null;
    const index = row.task.includes('#clean') ? null : Number(row.task.split('#')[1]);
    const mutant = index === null ? original : pickedSites(original, row.slug)[index]?.apply(original) ?? original;
    const mutantBehaves = index === null ? true : same(behaviour(mutant, `${row.slug}-m${index}`), spec);
    let grounded = false;
    let tried = 0;
    if (row.answer?.bug === true && Number.isFinite(Number(row.answer.line))) {
      const result = undoAtLine(mutant, Number(row.answer.line), spec, `${model}-${row.slug}-${index ?? 'c'}`);
      grounded = result.grounded;
      tried = result.tried;
    }
    appendFileSync(OUT, `${JSON.stringify({ id, model, task: row.task, slug: row.slug, kind: row.kind, verdict: row.verdict, claimed: row.answer?.bug === true, grounded, tried, equivalentMutant: index !== null && mutantBehaves })}\n`);
  }
}
rmSync(join(HERE, 'box/mods'), { recursive: true, force: true });
appendFileSync(OUT, `${JSON.stringify({ id: 'DONE' })}\n`);
