import { describe, expect, it } from 'vitest';
import { createPet, THRESHOLD } from '../client/src/pet';
import { identical, replayTicker } from '../client/src/ticker';
import { CARS, createTraffic, DURATION, PHASE, STOP } from '../client/src/traffic';

const run = <T>(step: () => T, frames: number) => {
  let last = step();
  for (let i = 1; i < frames; i += 1) last = step();
  return last;
};

const seconds = (s: number) => Math.round(s * 60);

describe('traffic circuit', () => {
  it('cycles main green, yellow, then cross green without a press', () => {
    const traffic = createTraffic();
    const phases: number[] = [];
    for (let i = 0; i < seconds(15); i += 1) {
      const phase = traffic.step().phase;
      if (phases.at(-1) !== phase) phases.push(phase);
    }
    expect(phases.slice(0, 4)).toEqual([PHASE.mainGreen, PHASE.mainYellow, PHASE.crossGreen, PHASE.crossYellow]);
    expect(phases).not.toContain(PHASE.walk);
  });

  it('runs the walk phase only after a press', () => {
    const traffic = createTraffic();
    traffic.press('press');
    const seen = new Set<number>();
    let walk = 0;
    for (let i = 0; i < seconds(DURATION[0] + DURATION[1] + 1); i += 1) {
      const frame = traffic.step();
      seen.add(frame.phase);
      walk = Math.max(walk, frame.walk);
    }
    expect(seen.has(PHASE.walk)).toBe(true);
    expect(walk).toBe(1);
    expect(seen.has(PHASE.crossGreen)).toBe(false);
  });

  it('holds cross-road cars behind the stop line on red and releases them on green', () => {
    const traffic = createTraffic();
    const crossIndex = CARS.findIndex((each) => each.road === 'cross' && each.start < STOP);
    const held = run(traffic.step, seconds(DURATION[0] + DURATION[1] - 0.2));
    expect(held.crossLight).toBe(2);
    expect(held.cars[crossIndex]?.position).toBeLessThan(STOP);
    expect(held.cars[crossIndex]?.speed).toBeLessThan(0.5);
    const released = run(traffic.step, seconds(3));
    expect(released.crossLight).toBe(0);
    expect(released.cars[crossIndex]?.position).toBeGreaterThan(STOP);
  });

  it('replays its journal bit for bit', () => {
    const traffic = createTraffic();
    run(traffic.step, 100);
    traffic.press('press');
    run(traffic.step, 400);
    expect(identical(replayTicker(createTraffic, traffic.journal()), traffic.snapshot())).toBe(true);
  });
});

describe('pet circuit', () => {
  it('squishes and cheers up when poked', () => {
    const pet = createPet();
    const before = pet.step();
    pet.press('poke');
    const after = run(pet.step, 4);
    expect(Math.abs(after.squish)).toBeGreaterThan(0.05);
    expect(after.happiness).toBeGreaterThan(before.happiness);
  });

  it('eats: hunger drops and it grows', () => {
    const pet = createPet();
    const hungry = run(pet.step, seconds(12));
    pet.press('feed');
    const fed = pet.step();
    expect(fed.hunger).toBeLessThan(hungry.hunger - 0.3);
    expect(fed.growth).toBeGreaterThan(hungry.growth);
  });

  it('left alone it gets hungry, then sleepy, then sulky', () => {
    const pet = createPet();
    const moods: number[] = [];
    for (let i = 0; i < seconds(60); i += 1) {
      const mood = pet.step().mood;
      if (moods.at(-1) !== mood) moods.push(mood);
    }
    expect(moods).toEqual([0, 1, 2, 3]);
  });

  it('mood matches its meters', () => {
    const pet = createPet();
    for (let i = 0; i < seconds(40); i += 1) {
      const f = pet.step();
      const expected =
        f.happiness < THRESHOLD.sulky ? 3 : f.sleepiness > THRESHOLD.sleepy ? 2 : f.hunger > THRESHOLD.hungry ? 1 : 0;
      expect(f.mood).toBe(expected);
    }
  });

  it('replays its journal bit for bit', () => {
    const pet = createPet();
    run(pet.step, 50);
    pet.press('poke');
    run(pet.step, 50);
    pet.press('feed');
    run(pet.step, 300);
    expect(identical(replayTicker(createPet, pet.journal()), pet.snapshot())).toBe(true);
  });
});
