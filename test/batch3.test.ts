import { describe, expect, it } from 'vitest';
import { createBalancer } from '../client/src/pages/balancer';
import { createCache } from '../client/src/pages/cache';
import { BELT, createSorter } from '../client/src/pages/sorter';
import { identical, replayTicker } from '../client/src/ticker';

const seconds = (s: number) => Math.round(s * 60);
const run = <T>(step: () => T, frames: number) => {
  let last = step();
  for (let i = 1; i < frames; i += 1) last = step();
  return last;
};

describe('LRU cache circuit', () => {
  const get = (cache: ReturnType<typeof createCache>, key: number) => {
    cache.press(`get${key}`);
    return cache.step();
  };

  it('misses first, hits after', () => {
    const cache = createCache();
    expect(get(cache, 2).miss).toBe(1);
    expect(get(cache, 2).hit).toBe(1);
  });

  it('evicts the least recently used item', () => {
    const cache = createCache();
    for (const key of [0, 1, 2, 3]) get(cache, key);
    get(cache, 0);
    const frame = get(cache, 4);
    const keys = frame.slots.map((slot) => slot.key).sort();
    expect(keys).toEqual([0, 2, 3, 4]);
  });

  it('fills empty slots before evicting', () => {
    const cache = createCache();
    const frame = [5, 6, 7].map((key) => get(cache, key)).at(-1);
    expect(frame?.slots.map((slot) => slot.key).filter((k) => k >= 0).sort()).toEqual([5, 6, 7]);
  });

  it('counts hits and misses', () => {
    const cache = createCache();
    for (const key of [0, 1, 0, 1, 0, 2]) get(cache, key);
    const frame = cache.step();
    expect(frame.hits).toBe(3);
    expect(frame.misses).toBe(3);
  });

  it('replays bit for bit', () => {
    const cache = createCache();
    for (const key of [0, 3, 5, 0, 7, 1, 2, 0, 6, 6, 4]) {
      get(cache, key);
      run(cache.step, 3);
    }
    expect(identical(replayTicker(createCache, cache.journal()), cache.snapshot())).toBe(true);
  });
});

describe('PLC sorter circuit', () => {
  it('sorts small boxes to bin 1 and big boxes to bin 2', () => {
    const sorter = createSorter();
    sorter.press('dropSmall');
    run(sorter.step, seconds(1.2));
    sorter.press('dropBig');
    run(sorter.step, seconds(1.2));
    sorter.press('dropSmall');
    const done = run(sorter.step, seconds(BELT.length / BELT.speed + 1));
    expect(done.sorted).toEqual([0, 2, 1]);
  });

  it('stops moving boxes when the belt stops', () => {
    const sorter = createSorter();
    sorter.press('dropBig');
    run(sorter.step, seconds(1));
    sorter.press('stop');
    const at = sorter.step().boxes[0]?.position ?? 0;
    expect(run(sorter.step, seconds(2)).boxes[0]?.position).toBe(at);
  });

  it('replays bit for bit', () => {
    const sorter = createSorter();
    for (const name of ['dropSmall', 'dropBig', 'dropBig', 'stop', 'stop', 'dropSmall'] as const) {
      sorter.press(name);
      run(sorter.step, 50);
    }
    expect(identical(replayTicker(createSorter, sorter.journal()), sorter.snapshot())).toBe(true);
  });
});

describe('load balancer circuit', () => {
  it('spreads load evenly across healthy servers', () => {
    const lb = createBalancer();
    lb.set('rate', 20);
    const queues = run(lb.step, seconds(5)).servers.map((server) => server.queue);
    expect(Math.max(...queues) - Math.min(...queues)).toBeLessThanOrEqual(1.2);
  });

  it('routes around an unplugged server', () => {
    const lb = createBalancer();
    lb.set('rate', 20);
    run(lb.step, seconds(2));
    lb.press('kill1');
    for (let i = 0; i < seconds(3); i += 1) expect(lb.step().servers[1]?.assigned).toBe(0);
  });

  it('drops requests only when every server is down', () => {
    const lb = createBalancer();
    lb.set('rate', 10);
    expect(run(lb.step, seconds(3)).dropped).toBe(0);
    for (let i = 0; i < 4; i += 1) lb.press(`kill${i}`);
    expect(run(lb.step, seconds(2)).dropped).toBeGreaterThan(10);
  });

  it('replays bit for bit', () => {
    const lb = createBalancer();
    lb.set('rate', 25);
    run(lb.step, 120);
    lb.press('kill2');
    lb.set('rate', 7);
    run(lb.step, 200);
    lb.press('kill2');
    run(lb.step, 100);
    expect(identical(replayTicker(createBalancer, lb.journal()), lb.snapshot())).toBe(true);
  });
});
