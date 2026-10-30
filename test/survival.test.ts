import { describe, expect, it } from 'vitest';
import { createSurvival } from '../client/src/pages/survival';
import { identical, replayTicker } from '../client/src/ticker';

const seconds = (s: number) => Math.round(s * 60);
const run = <T>(step: () => T, frames: number) => {
  let last = step();
  for (let i = 1; i < frames; i += 1) last = step();
  return last;
};

describe('workers survival circuit', () => {
  it('stays at one server under light load', () => {
    const fleet = createSurvival();
    fleet.set('load', 5);
    expect(run(fleet.step, seconds(10)).instances).toBe(1);
  });

  it('scales out under heavy load, one cold start at a time', () => {
    const fleet = createSurvival();
    fleet.set('load', 60);
    expect(run(fleet.step, seconds(1)).instances).toBe(1);
    expect(run(fleet.step, seconds(1.5)).instances).toBe(2);
    expect(run(fleet.step, seconds(30)).instances).toBeGreaterThanOrEqual(6);
  });

  it('scales back in when traffic drops', () => {
    const fleet = createSurvival();
    fleet.set('load', 60);
    const big = run(fleet.step, seconds(30)).instances;
    fleet.set('load', 2);
    expect(run(fleet.step, seconds(30)).instances).toBeLessThan(big);
  });

  it('trips the breaker on a spike, then closes it again', () => {
    const fleet = createSurvival();
    fleet.set('load', 10);
    fleet.press('spike');
    let opened = false;
    for (let i = 0; i < seconds(2.5); i += 1) opened = opened || fleet.step().open === 1;
    expect(opened).toBe(true);
    fleet.set('load', 0);
    expect(run(fleet.step, seconds(6)).open).toBe(0);
  });

  it('serves nothing while the breaker is open', () => {
    const fleet = createSurvival();
    fleet.set('load', 10);
    fleet.press('spike');
    for (let i = 0; i < seconds(3); i += 1) {
      const frame = fleet.step();
      if (frame.open === 1) expect(frame.served).toBe(0);
    }
  });

  it('replays bit for bit, slider moves included', () => {
    const fleet = createSurvival();
    fleet.set('load', 40);
    run(fleet.step, 200);
    fleet.press('spike');
    fleet.set('load', 12.5);
    run(fleet.step, 300);
    expect(identical(replayTicker(createSurvival, fleet.journal()), fleet.snapshot())).toBe(true);
  });
});
