import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createJiti } from 'jiti';

const ROOT = new URL('../..', import.meta.url).pathname;
const SCRATCH = join(ROOT, 'spikes/arena/box/mods');
const SRC = join(ROOT, 'client/src');
const jiti = createJiti(import.meta.url, { moduleCache: false, fsCache: false });

type Control =
  | { kind: 'button'; event: string }
  | { kind: 'slider'; input: string; min: number; max: number; initial: number };
type Ticker = {
  press: (name: string) => void;
  set: (name: string, value: number) => void;
  step: () => unknown;
};
type Page = { slug: string; make: () => Ticker; controls: Control[] };

function seeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function eventNames(make: () => Ticker): string[] {
  const probe = make() as unknown as { journal: () => unknown };
  void probe;
  return [];
}

function load(source: string, tag: string): Page | null {
  mkdirSync(SCRATCH, { recursive: true });
  const file = join(SCRATCH, `${tag}.ts`);
  const patched = source
    .replaceAll("from '../kit'", `from '${SRC}/kit'`)
    .replaceAll("from '../scene'", `from '${SRC}/scene'`)
    .replaceAll("from '../ticker'", `from '${SRC}/ticker'`);
  writeFileSync(file, patched);
  try {
    const mod = jiti(file) as Record<string, unknown>;
    const page = Object.values(mod).find((v) => v && typeof v === 'object' && 'make' in (v as object)) as Page | undefined;
    return page ?? null;
  } catch {
    return null;
  }
}

function trace(page: Page, seed: number, frames: number, extraEvents: string[]): string[] {
  const random = seeded(seed);
  const buttons = [...page.controls.filter((c) => c.kind === 'button').map((c) => (c as { event: string }).event), ...extraEvents];
  const sliders = page.controls.filter((c) => c.kind === 'slider') as Extract<Control, { kind: 'slider' }>[];
  let ticker: Ticker;
  try {
    ticker = page.make();
  } catch (error) {
    return [`make-throws:${String(error).slice(0, 60)}`];
  }
  for (const slider of sliders) ticker.set(slider.input, slider.initial);
  const out: string[] = [];
  for (let frame = 0; frame < frames; frame += 1) {
    if (buttons.length > 0 && random() < 0.04) ticker.press(buttons[Math.floor(random() * buttons.length)] as string);
    if (sliders.length > 0 && random() < 0.01) {
      const slider = sliders[Math.floor(random() * sliders.length)] as (typeof sliders)[number];
      ticker.set(slider.input, slider.min + random() * (slider.max - slider.min));
    }
    try {
      out.push(JSON.stringify(ticker.step()));
    } catch (error) {
      out.push(`throws:${String(error).slice(0, 80)}`);
      break;
    }
  }
  return out;
}

export function behaviour(source: string, tag: string, journals = 4, frames = 900): string[][] | null {
  const page = load(source, tag);
  if (!page) return null;
  const extra = page.slug === 'life' ? ['glider', 'clear', 'pause', 'toggle40', 'toggle41', 'toggle42'] : page.slug === 'drums' ? ['toggle1', 'toggle10'] : [];
  return Array.from({ length: journals }, (_, j) => trace(page, 1000 + j, frames, extra));
}

export function same(a: string[][] | null, b: string[][] | null): boolean {
  if (!a || !b) return false;
  return a.every((journal, j) => journal.length === b[j]?.length && journal.every((frame, f) => frame === b[j]?.[f]));
}

export function firstDifference(a: string[][] | null, b: string[][] | null): number {
  if (!a || !b) return 0;
  for (let j = 0; j < a.length; j += 1) {
    const x = a[j] ?? [];
    const y = b[j] ?? [];
    for (let f = 0; f < Math.max(x.length, y.length); f += 1) if (x[f] !== y[f]) return j * 1e6 + f;
  }
  return -1;
}

export const read = (path: string) => readFileSync(path, 'utf8');
void eventNames;
