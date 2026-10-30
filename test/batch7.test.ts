import { describe, expect, it } from 'vitest';
import { BRIDGE_STAGES, createDrawbridge } from '../client/src/pages/drawbridge';
import { createDrums, DRUMS } from '../client/src/pages/drums';
import { createOven, OVEN } from '../client/src/pages/oven';
import { createParking, LOT } from '../client/src/pages/parking';
import { createPinball } from '../client/src/pages/pinball';
import { createPlant } from '../client/src/pages/plant';
import { createSafe, DIAL } from '../client/src/pages/safe';
import { identical, replayTicker } from '../client/src/ticker';

const seconds = (s: number) => Math.round(s * 60);
const run = <T>(step: () => T, frames: number) => {
  let last = step();
  for (let i = 1; i < frames; i += 1) last = step();
  return last;
};
const tap = <T>(t: { press: (n: never) => void; step: () => T }, ...names: string[]) => {
  let last = t.step();
  for (const name of names) {
    t.press(name as never);
    last = t.step();
  }
  return last;
};

describe('parking counter circuit', () => {
  it('counts in and out', () => {
    const lot = createParking();
    expect(tap(lot, 'arrive', 'arrive', 'arrive', 'leave').parked).toBe(2);
  });

  it('turns cars away when full and never goes over', () => {
    const lot = createParking();
    const f = tap(lot, ...Array.from({ length: LOT.spaces + 3 }, () => 'arrive'));
    expect(f.parked).toBe(LOT.spaces);
    expect(f.full).toBe(1);
    expect(lot.step().turnedAway).toBe(3);
  });

  it('never goes below zero', () => {
    expect(tap(createParking(), 'leave', 'leave').parked).toBe(0);
  });

  it('replays bit for bit', () => {
    const lot = createParking();
    tap(lot, 'arrive', 'arrive', 'leave', 'arrive');
    run(lot.step, 50);
    expect(identical(replayTicker(createParking, lot.journal()), lot.snapshot())).toBe(true);
  });
});

describe('drawbridge sequence circuit', () => {
  it('runs every stage in order and returns to open', () => {
    const bridge = createDrawbridge();
    bridge.press('boat');
    const seen: string[] = [];
    for (let i = 0; i < seconds(20); i += 1) {
      const name = BRIDGE_STAGES[bridge.step().stage] ?? '';
      if (seen.at(-1) !== name) seen.push(name);
    }
    expect(seen).toEqual([...BRIDGE_STAGES.slice(1), BRIDGE_STAGES[0]]);
  });

  it('never lifts the deck unless the gates are fully down', () => {
    const bridge = createDrawbridge();
    bridge.press('boat');
    for (let i = 0; i < seconds(20); i += 1) expect(bridge.step().unsafe).toBe(0);
  });

  it('the boat passes only when the bridge is fully up', () => {
    const bridge = createDrawbridge();
    bridge.press('boat');
    for (let i = 0; i < seconds(20); i += 1) {
      const f = bridge.step();
      if (f.boatX > -5.9 && f.boatX < 5) expect(f.deck).toBeGreaterThan(0.97);
    }
  });

  it('replays bit for bit', () => {
    const bridge = createDrawbridge();
    bridge.press('boat');
    run(bridge.step, 900);
    bridge.press('boat');
    run(bridge.step, 200);
    expect(identical(replayTicker(createDrawbridge, bridge.journal()), bridge.snapshot())).toBe(true);
  });
});

describe('plant circuit', () => {
  it('bends toward the sun', () => {
    const plant = createPlant();
    plant.set('sun', 1);
    plant.set('light', 1);
    expect(run(plant.step, seconds(10)).lean).toBeGreaterThan(0.5);
    plant.set('sun', -1);
    expect(run(plant.step, seconds(10)).lean).toBeLessThan(-0.5);
  });

  it('closes pores and stops growing when dry; water revives it', () => {
    const plant = createPlant();
    plant.set('light', 1);
    const dry = run(plant.step, seconds(30));
    expect(dry.thirsty).toBe(1);
    const a = run(plant.step, seconds(5)).height;
    const b = run(plant.step, seconds(5)).height;
    plant.press('water');
    plant.press('water');
    run(plant.step, seconds(3));
    const c = run(plant.step, seconds(5)).height;
    expect(c - b).toBeGreaterThan((b - a) * 2);
  });

  it('does not grow in the dark', () => {
    const plant = createPlant();
    plant.set('light', 0);
    const start = plant.step().height;
    expect(run(plant.step, seconds(10)).height).toBe(start);
  });

  it('replays bit for bit', () => {
    const plant = createPlant();
    plant.set('sun', 0.4);
    run(plant.step, 200);
    plant.press('water');
    plant.set('light', 0.3);
    run(plant.step, 300);
    expect(identical(replayTicker(createPlant, plant.journal()), plant.snapshot())).toBe(true);
  });
});

describe('oven circuit', () => {
  it('reaches the setpoint without big overshoot', () => {
    const oven = createOven();
    oven.set('setpoint', 180);
    let peak = 0;
    for (let i = 0; i < seconds(40); i += 1) peak = Math.max(peak, oven.step().temp);
    expect(Math.abs(oven.step().temp - 180)).toBeLessThan(4);
    expect(peak).toBeLessThan(200);
  });

  it('opening the door drops the heat and it recovers', () => {
    const oven = createOven();
    oven.set('setpoint', 180);
    run(oven.step, seconds(40));
    oven.press('door');
    const cold = run(oven.step, seconds(3)).temp;
    expect(cold).toBeLessThan(170);
    oven.press('door');
    expect(Math.abs(run(oven.step, seconds(30)).temp - 180)).toBeLessThan(4);
  });

  it('bakes only while near the setpoint', () => {
    const oven = createOven();
    oven.set('setpoint', 180);
    oven.press('start');
    expect(run(oven.step, seconds(3)).baked).toBe(0);
    expect(run(oven.step, seconds(40)).done).toBe(1);
    void OVEN;
  });

  it('replays bit for bit', () => {
    const oven = createOven();
    oven.press('start');
    run(oven.step, 600);
    oven.press('door');
    oven.set('setpoint', 220);
    run(oven.step, 300);
    expect(identical(replayTicker(createOven, oven.journal()), oven.snapshot())).toBe(true);
  });
});

describe('pinball circuit', () => {
  it('launch puts the ball in play and uses a ball', () => {
    const game = createPinball();
    tap(game, 'launch');
    const f = game.step();
    expect(f.inPlay).toBe(1);
    expect(f.balls).toBe(2);
  });

  it('the ball stays on the table', () => {
    const game = createPinball();
    game.press('launch');
    for (let i = 0; i < seconds(10); i += 1) {
      const f = game.step();
      expect(Math.abs(f.x)).toBeLessThanOrEqual(3);
      expect(f.y).toBeLessThanOrEqual(10);
    }
  });

  it('the ball eventually drains without flipping', () => {
    const game = createPinball();
    game.press('launch');
    let drained = false;
    for (let i = 0; i < seconds(30) && !drained; i += 1) drained = game.step().drained === 1;
    expect(drained).toBe(true);
  });

  it('bumpers score', () => {
    let best = 0;
    for (let trial = 0; trial < 6; trial += 1) {
      const game = createPinball();
      game.press('launch');
      for (let i = 0; i < seconds(20); i += 1) {
        if (i % (20 + trial * 7) === 0) game.press('flip');
        best = Math.max(best, game.step().score);
      }
    }
    expect(best).toBeGreaterThan(0);
  });

  it('replays bit for bit', () => {
    const game = createPinball();
    game.press('launch');
    for (let i = 0; i < 600; i += 1) {
      if (i % 37 === 0) game.press('flip');
      game.step();
    }
    expect(identical(replayTicker(createPinball, game.journal()), game.snapshot())).toBe(true);
  });
});

describe('drum machine circuit', () => {
  it('walks the 8 steps and wraps', () => {
    const drums = createDrums();
    drums.set('tempo', 120);
    const steps: number[] = [];
    for (let i = 0; i < seconds(5); i += 1) {
      const s = drums.step().step;
      if (steps.at(-1) !== s) steps.push(s);
    }
    expect(steps.slice(0, 10)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 0, 1]);
  });

  it('plays the kick on steps 1 and 5 of the preset', () => {
    const drums = createDrums();
    drums.set('tempo', 120);
    const kicks: number[] = [];
    for (let i = 0; i < seconds(4.1); i += 1) {
      const f = drums.step();
      if ((f.hits[0] ?? 0) > 0) kicks.push(f.step);
    }
    expect(kicks.slice(0, 4)).toEqual([4, 0, 4, 0]);
  });

  it('toggling a pad changes the pattern', () => {
    const drums = createDrums();
    drums.press('toggle1');
    expect(drums.step().pattern[1]).toBe(1);
    void DRUMS;
  });

  it('replays bit for bit', () => {
    const drums = createDrums();
    drums.set('swing', 0.2);
    run(drums.step, 120);
    drums.press('toggle10');
    drums.set('tempo', 150);
    run(drums.step, 200);
    expect(identical(replayTicker(createDrums, drums.journal()), drums.snapshot())).toBe(true);
  });
});

describe('safe circuit', () => {
  const turn = (safe: ReturnType<typeof createSafe>, dir: 'right' | 'left', times: number) =>
    tap(safe, ...Array.from({ length: times }, () => dir));

  it('opens with the right code and direction', () => {
    const safe = createSafe();
    turn(safe, 'right', DIAL.code[0]);
    tap(safe, 'enter');
    turn(safe, 'left', DIAL.code[0] - DIAL.code[1]);
    tap(safe, 'enter');
    turn(safe, 'right', DIAL.code[2] - DIAL.code[1]);
    expect(tap(safe, 'enter').open).toBe(1);
  });

  it('the right number turning the wrong way does not count', () => {
    const safe = createSafe();
    turn(safe, 'left', DIAL.numbers - DIAL.code[0]);
    expect(tap(safe, 'enter').progress).toBe(0);
  });

  it('a wrong number sends you back to the start', () => {
    const safe = createSafe();
    turn(safe, 'right', DIAL.code[0]);
    expect(tap(safe, 'enter').progress).toBe(1);
    turn(safe, 'left', 1);
    expect(tap(safe, 'enter').progress).toBe(0);
  });

  it('replays bit for bit', () => {
    const safe = createSafe();
    turn(safe, 'right', 9);
    tap(safe, 'enter', 'left', 'left', 'enter', 'reset');
    run(safe.step, 120);
    expect(identical(replayTicker(createSafe, safe.journal()), safe.snapshot())).toBe(true);
  });
});
