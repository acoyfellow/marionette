import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { seeded, sites } from './lib.mjs';

const ROOT = new URL('../..', import.meta.url).pathname;
const HERE = join(ROOT, 'spikes/arena');
const BOX = join(HERE, 'box');
const LOG = join(HERE, 'hunt.jsonl');
const MODEL = process.env.HUNT_MODEL ?? 'claude-haiku-4-5';
const LIMIT = Number(process.env.HUNT_LIMIT ?? 999);
const PARALLEL = Number(process.env.HUNT_PARALLEL ?? 6);

function survivors() {
  const seen = new Set();
  const rows = [];
  for (const line of readFileSync(join(HERE, 'results.jsonl'), 'utf8').split('\n')) {
    if (!line.includes('"outcome":"pass"')) continue;
    const row = JSON.parse(line);
    const key = `${row.slug}#${row.index}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(row);
  }
  return rows;
}

function rebuild(row) {
  const original = readFileSync(join(ROOT, 'client/src/pages', `${row.slug}.ts`), 'utf8');
  const all = sites(original);
  const random = seeded([...row.slug].reduce((h, c) => h * 31 + c.charCodeAt(0), 7));
  const picked = all
    .map((site) => ({ site, key: random() }))
    .sort((a, b) => a.key - b.key)
    .slice(0, 10)
    .map((entry) => entry.site);
  const site = picked[row.index];
  if (!site || site.kind !== row.kind) return null;
  return { original, mutant: site.apply(original), line: original.slice(0, site.at).split('\n').length };
}

const PROMPT = (file) => `You are reviewing one file from a small physics/logic toy. Each page is a hand-wired circuit: sums, ReLUs, compares and selects, no if statements. The page's "lesson" string says what it is supposed to do.

The file may contain one planted bug, or it may be correct. Bugs, if present, are a single small change inside the circuit: a flipped comparison, AND/OR swapped, min/max swapped, the two branches of a select swapped, or one number changed so behaviour no longer matches the lesson, the names, or the rest of the file.

Read ${file} and decide. Reply with exactly one line of JSON and nothing else:
{"bug": true, "line": <line number>, "why": "<one sentence>"}
or
{"bug": false}`;

function ask(dir) {
  return new Promise((resolve) => {
    const child = spawn(
      'pi',
      ['-p', '--no-session', '--model', MODEL, '--tools', 'read', PROMPT('page.ts')],
      { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let out = '';
    child.stdout.on('data', (chunk) => {
      out += chunk;
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), 180000);
    child.on('close', () => {
      clearTimeout(timer);
      const match = out.match(/\{[^{}]*"bug"[^{}]*\}/g);
      try {
        resolve(match ? JSON.parse(match.at(-1)) : { error: out.slice(-200) });
      } catch {
        resolve({ error: out.slice(-200) });
      }
    });
  });
}

function done() {
  if (!existsSync(LOG)) return new Set();
  return new Set(readFileSync(LOG, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).task));
}

const tasks = [];
const random = seeded(42);
for (const row of survivors().slice(0, LIMIT)) {
  const built = rebuild(row);
  if (!built) continue;
  tasks.push({ task: `${row.slug}#${row.index}`, slug: row.slug, kind: row.kind, line: built.line, source: built.mutant, planted: true });
}
const slugs = [...new Set(tasks.map((t) => t.slug))];
for (const slug of slugs) {
  const count = tasks.filter((t) => t.slug === slug && t.planted).length;
  const original = readFileSync(join(ROOT, 'client/src/pages', `${slug}.ts`), 'utf8');
  for (let i = 0; i < count; i += 1) tasks.push({ task: `${slug}#clean${i}`, slug, kind: 'clean', line: null, source: original, planted: false });
}
tasks.sort(() => random() - 0.5);

const skip = done();
const queue = tasks.filter((t) => !skip.has(t.task));
console.log(`tasks ${tasks.length} todo ${queue.length} model ${MODEL}`);

async function worker(id) {
  while (queue.length > 0) {
    const task = queue.shift();
    const dir = join(BOX, `w${id}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'page.ts'), task.source);
    const started = Date.now();
    const answer = await ask(dir);
    const near = answer.bug === true && task.planted && Math.abs(Number(answer.line) - task.line) <= 2;
    const verdict = task.planted ? (near ? 'found' : answer.bug ? 'wrong-line' : 'missed') : answer.bug ? 'false-alarm' : 'clean-ok';
    appendFileSync(LOG, `${JSON.stringify({ task: task.task, slug: task.slug, kind: task.kind, line: task.line, answer, verdict, ms: Date.now() - started })}\n`);
  }
}

await Promise.all(Array.from({ length: PARALLEL }, (_, i) => worker(i)));
console.log('HUNT DONE');
