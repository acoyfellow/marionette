import { describe, expect, it } from 'vitest';
import { BUILDING, createElevator } from '../client/src/pages/elevator';
import { createQueue, QUEUE } from '../client/src/pages/queue';
import { createWaf, VERDICT } from '../client/src/pages/waf';
import { identical, replayTicker } from '../client/src/ticker';

const seconds = (s: number) => Math.round(s * 60);
const run = <T>(step: () => T, frames: number) => {
  let last = step();
  for (let i = 1; i < frames; i += 1) last = step();
  return last;
};

describe('queue backpressure circuit', () => {
  it('stays low when workers keep up', () => {
    const queue = createQueue();
    queue.set('rate', 8);
    expect(run(queue.step, seconds(10)).fill).toBeLessThan(0.1);
  });

  it('throttles above the high mark and only releases below the low mark', () => {
    const queue = createQueue();
    queue.set('rate', 30);
    queue.press('toggle1');
    queue.press('toggle2');
    let throttledAt = -1;
    for (let i = 0; i < seconds(20) && throttledAt < 0; i += 1) {
      const frame = queue.step();
      if (frame.throttled === 1) throttledAt = frame.fill;
    }
    expect(throttledAt).toBeGreaterThan(QUEUE.high);
    queue.set('rate', 0);
    let releasedAt = -1;
    for (let i = 0; i < seconds(20) && releasedAt < 0; i += 1) {
      const frame = queue.step();
      if (frame.throttled === 0) releasedAt = frame.fill;
      else expect(frame.fill).toBeGreaterThanOrEqual(QUEUE.low - 0.01);
    }
    expect(releasedAt).toBeLessThan(QUEUE.low);
  });

  it('never exceeds capacity', () => {
    const queue = createQueue();
    queue.set('rate', 30);
    for (let i = 0; i < 3; i += 1) queue.press(`toggle${i}`);
    for (let i = 0; i < seconds(20); i += 1) expect(queue.step().depth).toBeLessThanOrEqual(QUEUE.capacity);
  });

  it('replays bit for bit', () => {
    const queue = createQueue();
    queue.set('rate', 25);
    run(queue.step, 200);
    queue.press('toggle0');
    queue.set('rate', 3);
    run(queue.step, 300);
    expect(identical(replayTicker(createQueue, queue.journal()), queue.snapshot())).toBe(true);
  });
});

describe('WAF scoring circuit', () => {
  const send = (waf: ReturnType<typeof createWaf>, flags: number[]) => {
    flags.forEach((on, i) => waf.set(`flag${i}`, on));
    waf.set('challengeAt', 40);
    waf.set('blockAt', 70);
    waf.press('send');
    return waf.step();
  };

  it('allows a clean request', () => {
    expect(send(createWaf(), [0, 0, 0, 0]).lastVerdict).toBe(VERDICT.allow);
  });

  it('challenges a suspicious one and blocks an attack', () => {
    const waf = createWaf();
    expect(send(waf, [0, 1, 0, 0]).lastVerdict).toBe(VERDICT.challenge);
    expect(send(waf, [1, 1, 0, 0]).lastVerdict).toBe(VERDICT.block);
  });

  it('moving the line changes the verdict for the same request', () => {
    const waf = createWaf();
    [1, 0, 1, 0].forEach((on, i) => waf.set(`flag${i}`, on));
    waf.set('challengeAt', 60);
    waf.set('blockAt', 100);
    waf.press('send');
    expect(waf.step().lastVerdict).toBe(VERDICT.allow);
    waf.set('challengeAt', 40);
    waf.press('send');
    expect(waf.step().lastVerdict).toBe(VERDICT.challenge);
  });

  it('replays bit for bit', () => {
    const waf = createWaf();
    send(waf, [1, 0, 1, 0]);
    run(waf.step, 10);
    send(waf, [1, 1, 1, 1]);
    expect(identical(replayTicker(createWaf, waf.journal()), waf.snapshot())).toBe(true);
  });
});

describe('elevator dispatch circuit', () => {
  it('sends the closest car', () => {
    const lift = createElevator();
    lift.press(`call${BUILDING.floors - 2}`);
    const frame = lift.step();
    expect(frame.cars[1]?.target).toBe(BUILDING.floors - 2);
    expect(frame.cars[0]?.target).toBe(-1);
  });

  it('never sends two cars to one call', () => {
    const lift = createElevator();
    lift.press('call3');
    for (let i = 0; i < seconds(6); i += 1) {
      const frame = lift.step();
      expect(frame.cars.filter((car) => car.target === 3).length).toBeLessThanOrEqual(1);
    }
  });

  it('answers every call eventually', () => {
    const lift = createElevator();
    for (const f of [5, 0, 3, 1]) lift.press(`call${f}`);
    const frame = run(lift.step, seconds(30));
    expect(frame.waiting.every((w) => w === 0)).toBe(true);
  });

  it('replays bit for bit', () => {
    const lift = createElevator();
    lift.press('call4');
    run(lift.step, 60);
    lift.press('call1');
    lift.press('call5');
    run(lift.step, 400);
    expect(identical(replayTicker(createElevator, lift.journal()), lift.snapshot())).toBe(true);
  });
});
