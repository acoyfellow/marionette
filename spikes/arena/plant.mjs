import { seeded, sites } from './lib.mjs';
import { spawnSync } from 'node:child_process';
import { appendFileSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../..', import.meta.url).pathname;
const PAGES = join(ROOT, 'client/src/pages');
const TESTS = join(ROOT, 'test');
const LOG = join(ROOT, 'spikes/arena/results.jsonl');
const PER_PAGE = 10;

function testFor(slug) {
  for (const file of readdirSync(TESTS)) {
    if (readFileSync(join(TESTS, file), 'utf8').includes(`pages/${slug}'`)) return join('test', file);
  }
  return null;
}

function runSuite(file) {
  const result = spawnSync('npx', ['vitest', 'run', file], { cwd: ROOT, encoding: 'utf8', timeout: 60000 });
  if (result.error?.code === 'ETIMEDOUT') return 'timeout';
  return result.status === 0 ? 'pass' : 'fail';
}

const only = process.argv[2]?.split(',');
const slugs = readdirSync(PAGES)
  .filter((f) => f.endsWith('.ts') && f !== 'index.ts')
  .map((f) => f.replace(/\.ts$/, ''))
  .filter((slug) => !only || only.includes(slug));

for (const slug of slugs) {
  const path = join(PAGES, `${slug}.ts`);
  const original = readFileSync(path, 'utf8');
  const suite = testFor(slug);
  if (!suite) {
    appendFileSync(LOG, `${JSON.stringify({ slug, skipped: 'no suite' })}\n`);
    continue;
  }
  const all = sites(original);
  const random = seeded([...slug].reduce((h, c) => h * 31 + c.charCodeAt(0), 7));
  const picked = all
    .map((site) => ({ site, key: random() }))
    .sort((a, b) => a.key - b.key)
    .slice(0, PER_PAGE)
    .map((entry) => entry.site);
  try {
    for (const [index, site] of picked.entries()) {
      const mutant = site.apply(original);
      writeFileSync(path, mutant);
      const line = original.slice(0, site.at).split('\n').length;
      const outcome = runSuite(suite);
      appendFileSync(LOG, `${JSON.stringify({ slug, index, kind: site.kind, line, outcome, sites: all.length })}\n`);
    }
  } finally {
    writeFileSync(path, original);
  }
}
appendFileSync(LOG, `${JSON.stringify({ done: true })}\n`);
