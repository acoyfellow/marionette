import { describe, expect, it } from 'vitest';
import { createCruise } from '../client/src/pages/cruise';
import { BODY, createInsulin } from '../client/src/pages/insulin';
import { createPacemaker } from '../client/src/pages/pacemaker';
import { createThermostat } from '../client/src/pages/thermostat';
import { identical, replayTicker } from '../client/src/ticker';

const seconds = (s: number) => Math.round(s * 60);
const run = <T>(step: () => T, frames: number) => {
  let last = step();
  for (let i = 1; i < frames; i += 1) last = step();
  return last;
};

describe('thermostat circuit', () => {
  const room = (band: number) => {
    const t = createThermostat();
    t.set('target', 21);
    t.set('band', band);
    t.set('outside', 5);
    return t;
  };

  it('holds the room inside the band', () => {
    const t = room(2);
    run(t.step, seconds(30));
    for (let i = 0; i < seconds(30); i += 1) {
      const f = t.step();
      expect(f.temp).toBeGreaterThan(19.5);
      expect(f.temp).toBeLessThan(22.5);
    }
  });

  it('a wider band clicks less often', () => {
    const clicks = (band: number) => {
      const t = room(band);
      return run(t.step, seconds(90)).switches;
    };
    expect(clicks(0)).toBeGreaterThan(clicks(3) * 3);
  });

  it('cools on a hot day', () => {
    const t = room(2);
    t.set('outside', 38);
    run(t.step, seconds(60));
    expect(t.step().temp).toBeLessThan(23);
  });

  it('replays bit for bit', () => {
    const t = room(1.5);
    run(t.step, 200);
    t.press('window');
    t.set('target', 25);
    run(t.step, 300);
    expect(identical(replayTicker(createThermostat, t.journal()), t.snapshot())).toBe(true);
  });
});

describe('adaptive cruise circuit', () => {
  it('reaches the set speed on an open road', () => {
    const car = createCruise();
    car.set('setSpeed', 18);
    expect(Math.abs(run(car.step, seconds(20)).speed - 18)).toBeLessThan(0.5);
  });

  it('slows to follow a braking lead car and never hits it', () => {
    const car = createCruise();
    car.set('setSpeed', 30);
    run(car.step, seconds(10));
    car.press('leadBrake');
    let slowest = 99;
    for (let i = 0; i < seconds(15); i += 1) {
      const f = car.step();
      slowest = Math.min(slowest, f.speed);
      expect(f.gap).toBeGreaterThan(1);
    }
    expect(slowest).toBeLessThan(15);
  });

  it('replays bit for bit', () => {
    const car = createCruise();
    car.set('setSpeed', 35);
    run(car.step, 300);
    car.press('leadBrake');
    car.set('hill', 2);
    run(car.step, 300);
    expect(identical(replayTicker(createCruise, car.journal()), car.snapshot())).toBe(true);
  });
});

describe('pacemaker circuit', () => {
  it('stays quiet while the heart beats on its own', () => {
    const pm = createPacemaker();
    pm.set('naturalRate', 80);
    expect(run(pm.step, seconds(20)).paced).toBe(0);
  });

  it('paces a slow heart up to 60 bpm', () => {
    const pm = createPacemaker();
    pm.set('naturalRate', 30);
    const f = run(pm.step, seconds(30));
    expect(f.beats).toBeGreaterThanOrEqual(29);
    expect(f.paced).toBeGreaterThan(10);
  });

  it('takes over completely when the signal is blocked', () => {
    const pm = createPacemaker();
    pm.set('naturalRate', 80);
    pm.press('block');
    const before = pm.step();
    const after = run(pm.step, seconds(10));
    expect(after.paced - before.paced).toBe(after.beats - before.beats);
    expect(after.beats - before.beats).toBeGreaterThanOrEqual(9);
  });

  it('never leaves more than 1 s between beats', () => {
    const pm = createPacemaker();
    pm.set('naturalRate', 25);
    for (let i = 0; i < seconds(20); i += 1) expect(pm.step().since).toBeLessThanOrEqual(1.0001 + 1 / 60);
  });

  it('replays bit for bit', () => {
    const pm = createPacemaker();
    pm.set('naturalRate', 55);
    run(pm.step, 300);
    pm.press('block');
    run(pm.step, 200);
    expect(identical(replayTicker(createPacemaker, pm.journal()), pm.snapshot())).toBe(true);
  });
});

describe('insulin pump circuit', () => {
  it('brings high sugar down into the band', () => {
    const pump = createInsulin();
    const f = run(pump.step, seconds(60));
    expect(f.glucose).toBeLessThan(BODY.high);
    expect(f.glucose).toBeGreaterThan(BODY.low);
  });

  it('doses after a meal', () => {
    const pump = createInsulin();
    run(pump.step, seconds(40));
    pump.press('meal');
    let dosed = 0;
    for (let i = 0; i < seconds(20); i += 1) dosed = Math.max(dosed, pump.step().dose);
    expect(dosed).toBeGreaterThan(0.05);
  });

  it('suspends before a run takes sugar low', () => {
    const pump = createInsulin();
    run(pump.step, seconds(40));
    pump.press('run');
    let suspended = false;
    for (let i = 0; i < seconds(30); i += 1) suspended = suspended || pump.step().suspend === 1;
    expect(suspended).toBe(true);
  });

  it('replays bit for bit', () => {
    const pump = createInsulin();
    pump.press('meal');
    run(pump.step, 400);
    pump.press('run');
    run(pump.step, 400);
    expect(identical(replayTicker(createInsulin, pump.journal()), pump.snapshot())).toBe(true);
  });
});
