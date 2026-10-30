import { behaviour, same } from './behave';
import { seeded, sites } from './lib.mjs';

export type Site = { kind: string; at: number; apply: (s: string) => string };

export function pickedSites(source: string, slug: string): Site[] {
  const all = sites(source) as Site[];
  const random = seeded([...slug].reduce((h, c) => h * 31 + c.charCodeAt(0), 7));
  return all
    .map((site) => ({ site, key: random() }))
    .sort((a, b) => a.key - b.key)
    .slice(0, 10)
    .map((entry) => entry.site);
}

export const lineOf = (source: string, at: number) => source.slice(0, at).split('\n').length;

export function restores(mutant: string, line: number, spec: string[][] | null, tag: string): boolean {
  if (same(behaviour(mutant, `${tag}-m`), spec)) return false;
  let tried = 0;
  for (const site of (sites(mutant) as Site[]).filter((s) => Math.abs(lineOf(mutant, s.at) - line) <= 2)) {
    tried += 1;
    if (same(behaviour(site.apply(mutant), `${tag}-c${tried}`), spec)) return true;
  }
  const lines = mutant.split('\n');
  const from = Math.max(0, line - 3);
  const offset = lines.slice(0, from).join('\n').length + (from > 0 ? 1 : 0);
  const window = lines.slice(from, line + 2).join('\n');
  for (const match of window.matchAll(/(?<![A-Za-z0-9_.#])(\d+\.?\d*)(?![A-Za-z0-9_])/g)) {
    const value = Number(match[1]);
    const nexts = [0.8, 0.5, 2, 1.25].map((f) => String(Number((value * f).toFixed(4)))).concat(String(value - 1));
    for (const next of nexts) {
      tried += 1;
      const start = offset + (match.index ?? 0);
      const candidate = mutant.slice(0, start) + next + mutant.slice(start + (match[1] as string).length);
      if (same(behaviour(candidate, `${tag}-n${tried}`), spec)) return true;
    }
  }
  return false;
}

export function divergence(spec: string[][] | null, mutant: string[][] | null) {
  if (!spec || !mutant) return null;
  for (let j = 0; j < spec.length; j += 1) {
    for (let f = 0; f < Math.max(spec[j]!.length, mutant[j]!.length); f += 1) {
      const a = spec[j]![f];
      const b = mutant[j]![f];
      if (a === b) continue;
      const pa = a?.startsWith('{') ? JSON.parse(a) : { error: a };
      const pb = b?.startsWith('{') ? JSON.parse(b) : { error: b };
      const keys = [...new Set([...Object.keys(pa), ...Object.keys(pb)])].filter((k) => JSON.stringify(pa[k]) !== JSON.stringify(pb[k]));
      return { journal: j, frame: f, outputs: keys.map((k) => ({ output: k, expected: pa[k], actual: pb[k] })) };
    }
  }
  return null;
}
