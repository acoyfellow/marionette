import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { behaviour } from './behave';
import { divergence, pickedSites, restores } from './ground';

const ROOT = new URL('../..', import.meta.url).pathname;
const HERE = join(ROOT, 'spikes/arena');
const OUT = join(HERE, 'recall.jsonl');
const MODEL = process.env.HUNT_MODEL ?? 'claude-sonnet-5-5';
const PARALLEL = 6;

const page = (slug: string) => readFileSync(join(ROOT, 'client/src/pages', `${slug}.ts`), 'utf8');
const verify = readFileSync(join(HERE, 'verify.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const misses = verify.filter((r) => r.model === 'sonnet' && r.task && !r.task.includes('#clean') && !r.equivalentMutant && !(r.claimed && r.grounded && r.verdict === 'found'));
const done = new Set(existsSync(OUT) ? readFileSync(OUT, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).task) : []);

const prompt = (hint: string) => `You are reviewing one file from a small physics/logic toy. Each page is a hand-wired circuit: sums, ReLUs, compares and selects, no if statements.

This file DOES contain exactly one planted bug: a single small change inside the circuit (a flipped comparison, AND/OR swapped, min/max swapped, a select's branches swapped, or one number changed).

A reference run of the correct circuit and this file were driven with the same inputs. They first disagree here:
${hint}

Read page.ts, find the change that explains this divergence, and reply with exactly one line of JSON and nothing else:
{"bug": true, "line": <line number>, "why": "<one sentence>"}`;

function ask(dir: string, text: string): Promise<{ bug?: boolean; line?: number; why?: string; error?: string }> {
  return new Promise((resolve) => {
    const child = spawn('pi', ['-p', '--no-session', '--model', MODEL, '--tools', 'read', text], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (chunk) => {
      out += chunk;
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), 180000);
    child.on('close', () => {
      clearTimeout(timer);
      const match = out.match(/\{[^{}]*"bug"[^{}]*\}/g);
      try {
        resolve(match ? JSON.parse(match.at(-1)!) : { error: out.slice(-200) });
      } catch {
        resolve({ error: out.slice(-200) });
      }
    });
  });
}

const queue = misses.filter((r) => !done.has(r.task));
console.log(`misses ${misses.length} todo ${queue.length}`);
const specs = new Map<string, string[][] | null>();

async function worker(id: number) {
  while (queue.length > 0) {
    const row = queue.shift()!;
    const original = page(row.slug);
    if (!specs.has(row.slug)) specs.set(row.slug, behaviour(original, `r-${row.slug}-spec`));
    const spec = specs.get(row.slug)!;
    const index = Number(row.task.split('#')[1]);
    const site = pickedSites(original, row.slug)[index]!;
    const mutant = site.apply(original);
    const diff = divergence(spec, behaviour(mutant, `r-${row.slug}-${index}`));
    const hint = diff
      ? `journal ${diff.journal}, frame ${diff.frame} (1/60 s per frame):\n${diff.outputs.map((o) => `  output "${o.output}": expected ${JSON.stringify(o.expected)}, got ${JSON.stringify(o.actual)}`).join('\n')}`
      : 'no divergence found';
    const dir = join(HERE, 'box', `r${id}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'page.ts'), mutant);
    const answer = await ask(dir, prompt(hint));
    const plantedLine = original.slice(0, site.at).split('\n').length;
    const grounded = answer.bug === true && Number.isFinite(Number(answer.line)) && restores(mutant, Number(answer.line), spec, `r-${row.slug}-${index}-v`);
    appendFileSync(OUT, `${JSON.stringify({ task: row.task, slug: row.slug, kind: row.kind, plantedLine, hint, answer, nearLine: Math.abs(Number(answer.line) - plantedLine) <= 2, grounded, before: row.verdict })}\n`);
  }
}

await Promise.all(Array.from({ length: PARALLEL }, (_, i) => worker(i)));
appendFileSync(OUT, `${JSON.stringify({ task: 'DONE' })}\n`);
console.log('RECALL DONE');
