import { describe, expect, it } from 'vitest';
import { createGarage, MOTION } from '../client/src/pages/garage';
import { createLife, GRID } from '../client/src/pages/life';
import { createVending, PRODUCTS } from '../client/src/pages/vending';
import { createWasher, STEPS } from '../client/src/pages/washer';
import { identical, replayTicker } from '../client/src/ticker';

const seconds = (s: number) => Math.round(s * 60);
const run = <T>(step: () => T, frames: number) => {
  let last = step();
  for (let i = 1; i < frames; i += 1) last = step();
  return last;
};

describe('game of life circuit', () => {
  const cell = (x: number, y: number) => y * GRID.size + x;

  it('a blinker flips between a row and a column', () => {
    const life = createLife();
    for (const x of [3, 4, 5]) life.press(`toggle${cell(x, 4)}`);
    life.step();
    const after = run(life.step, seconds(GRID.period) + 1);
    expect(after.alive[cell(4, 3)]).toBe(1);
    expect(after.alive[cell(4, 5)]).toBe(1);
    expect(after.alive[cell(3, 4)]).toBe(0);
    expect(after.population).toBe(3);
  });

  it('a glider keeps 5 cells and moves', () => {
    const life = createLife();
    life.press('glider');
    const start = life.step();
    const firstCells = start.alive.map((v, i) => (v === 1 ? i : -1)).filter((i) => i >= 0);
    const later = run(life.step, seconds(GRID.period * 4) + 2);
    const laterCells = later.alive.map((v, i) => (v === 1 ? i : -1)).filter((i) => i >= 0);
    expect(later.population).toBe(5);
    expect(laterCells).not.toEqual(firstCells);
  });

  it('clear empties the grid', () => {
    const life = createLife();
    life.press('glider');
    run(life.step, 30);
    life.press('clear');
    expect(life.step().population).toBe(0);
  });

  it('replays bit for bit', () => {
    const life = createLife();
    life.press('glider');
    run(life.step, 100);
    life.press(`toggle${cell(7, 7)}`);
    life.press('pause');
    run(life.step, 30);
    life.press('pause');
    run(life.step, 100);
    expect(identical(replayTicker(createLife, life.journal()), life.snapshot())).toBe(true);
  });
});

describe('vending machine circuit', () => {
  const tap = (machine: ReturnType<typeof createVending>, ...names: string[]) => {
    for (const name of names) {
      machine.press(name);
      machine.step();
    }
    return machine.step();
  };

  it('vends gum and returns exact change', () => {
    const machine = createVending();
    const f = tap(machine, 'coin2', 'coin2', 'pick0');
    expect(f.lastVend).toBe(0);
    expect(f.lastChange).toBe(50 - PRODUCTS[0].price);
    expect(f.credit).toBe(0);
    expect(f.stock[0]).toBe(2);
    expect(f.lastChange).toBe(15);
  });

  it('refuses without enough credit and keeps the money', () => {
    const machine = createVending();
    const f = tap(machine, 'coin2', 'pick2');
    expect(f.lastVend).toBe(-1);
    expect(f.credit).toBe(25);
  });

  it('refuses when sold out', () => {
    const machine = createVending();
    for (let i = 0; i < 3; i += 1) tap(machine, 'coin3', 'pick0');
    const f = tap(machine, 'coin3', 'pick0');
    expect(f.stock[0]).toBe(0);
    expect(f.credit).toBe(100);
  });

  it('money in equals products plus change out', () => {
    const machine = createVending();
    let paidIn = 0;
    let changeOut = 0;
    let value = 0;
    const coins = [5, 10, 25, 100];
    for (const step of ['coin3', 'coin1', 'pick1', 'coin2', 'coin2', 'coin0', 'pick0', 'coin3', 'refund']) {
      machine.press(step);
      const f = machine.step();
      if (step.startsWith('coin')) paidIn += coins[Number(step.slice(4))] ?? 0;
      if (f.vend.some((v) => v === 1)) value += PRODUCTS[f.vend.findIndex((v) => v === 1)]?.price ?? 0;
      changeOut += f.change;
    }
    expect(paidIn).toBe(value + changeOut + machine.step().credit);
  });

  it('replays bit for bit', () => {
    const machine = createVending();
    tap(machine, 'coin3', 'pick1', 'coin0', 'refund', 'coin2', 'pick2');
    run(machine.step, 50);
    expect(identical(replayTicker(createVending, machine.journal()), machine.snapshot())).toBe(true);
  });
});

describe('washing machine circuit', () => {
  it('runs every step in order', () => {
    const washer = createWasher();
    washer.press('start');
    const seen: string[] = [];
    for (let i = 0; i < seconds(20); i += 1) {
      const name = STEPS[washer.step().step] ?? '';
      if (seen.at(-1) !== name) seen.push(name);
    }
    expect(seen).toEqual(['fill', 'wash', 'drain', 'rinse', 'spin', 'done']);
  });

  it('keeps the lid locked while running', () => {
    const washer = createWasher();
    washer.press('start');
    run(washer.step, seconds(3));
    washer.press('lid');
    const f = washer.step();
    expect(f.lidOpen).toBe(0);
    expect(f.refused).toBeGreaterThan(0);
  });

  it('will not start with the lid open', () => {
    const washer = createWasher();
    washer.press('lid');
    washer.step();
    washer.press('start');
    expect(run(washer.step, 30).step).toBe(0);
  });

  it('replays bit for bit', () => {
    const washer = createWasher();
    washer.press('start');
    run(washer.step, 200);
    washer.press('lid');
    run(washer.step, 700);
    washer.press('lid');
    run(washer.step, 20);
    expect(identical(replayTicker(createWasher, washer.journal()), washer.snapshot())).toBe(true);
  });
});

describe('garage door circuit', () => {
  it('closes fully on one press, opens on the next', () => {
    const garage = createGarage();
    garage.press('remote');
    expect(run(garage.step, seconds(4)).height).toBe(0);
    garage.press('remote');
    expect(run(garage.step, seconds(4)).height).toBe(1);
  });

  it('stops mid-way when pressed while moving', () => {
    const garage = createGarage();
    garage.press('remote');
    run(garage.step, seconds(1));
    garage.press('remote');
    const f = run(garage.step, seconds(1));
    expect(f.motion).toBe(MOTION.stopped);
    expect(f.height).toBeGreaterThan(0.3);
    expect(f.height).toBeLessThan(0.8);
  });

  it('reverses when the beam is broken and never crushes the cat', () => {
    const garage = createGarage();
    garage.set('blocked', 1);
    garage.press('remote');
    let lowest = 1;
    let reversed = false;
    for (let i = 0; i < seconds(6); i += 1) {
      const f = garage.step();
      lowest = Math.min(lowest, f.height);
      reversed = reversed || f.beamBroken === 1;
    }
    expect(reversed).toBe(true);
    expect(lowest).toBeGreaterThan(0.4);
  });

  it('replays bit for bit', () => {
    const garage = createGarage();
    garage.press('remote');
    run(garage.step, 80);
    garage.set('blocked', 1);
    run(garage.step, 200);
    garage.set('blocked', 0);
    garage.press('remote');
    run(garage.step, 200);
    expect(identical(replayTicker(createGarage, garage.journal()), garage.snapshot())).toBe(true);
  });
});
