import { describe, expect, it } from 'vitest';
import { createPuppeteer, identical, replay, SPACING } from '../client/src/strings';

const settle = (puppeteer: ReturnType<typeof createPuppeteer>, from: number) => {
  let time = from;
  let output = puppeteer.step(time);
  while (puppeteer.animating() && time < from + 5000) {
    time += 16;
    output = puppeteer.step(time);
  }
  return { output, time };
};

describe('marionette strings', () => {
  it('selects the clicked cube and lifts it', () => {
    const puppeteer = createPuppeteer();
    puppeteer.queue({ kind: 'down', x: 0, z: 0, timeStamp: 10 });
    puppeteer.queue({ kind: 'up', x: 0, z: 0, timeStamp: 20 });
    const { output } = settle(puppeteer, 30);
    expect(output.cubes.map((cube) => cube.selected)).toEqual([0, 0, 0, 0, 1, 0, 0, 0, 0]);
    expect(output.cubes[4]?.lift).toBeCloseTo(1.2, 2);
  });

  it('drags a selected cube to the pointer and clears on floor click', () => {
    const puppeteer = createPuppeteer();
    puppeteer.queue({ kind: 'down', x: -SPACING, z: -SPACING, timeStamp: 10 });
    puppeteer.queue({ kind: 'move', x: -3.5, z: 1.25, timeStamp: 40 });
    puppeteer.queue({ kind: 'up', x: -3.5, z: 1.25, timeStamp: 60 });
    const dragged = settle(puppeteer, 70);
    expect(dragged.output.cubes[0]?.x).toBeCloseTo(-3.5, 2);
    expect(dragged.output.cubes[0]?.z).toBeCloseTo(1.25, 2);

    puppeteer.queue({ kind: 'down', x: 5, z: 5, timeStamp: dragged.time + 10 });
    puppeteer.queue({ kind: 'up', x: 5, z: 5, timeStamp: dragged.time + 20 });
    const cleared = settle(puppeteer, dragged.time + 30);
    expect(cleared.output.cubes.every((cube) => cube.selected === 0)).toBe(true);
  });

  it('replays its journal to bit-identical cells', () => {
    const puppeteer = createPuppeteer();
    puppeteer.queue({ kind: 'down', x: 0, z: 0, timeStamp: 10 });
    puppeteer.queue({ kind: 'move', x: 2.5, z: -1, timeStamp: 30 });
    puppeteer.queue({ kind: 'up', x: 2.5, z: -1, timeStamp: 50 });
    settle(puppeteer, 60);
    expect(puppeteer.journal().length).toBeGreaterThan(10);
    expect(identical(replay(puppeteer.journal()), puppeteer.snapshot())).toBe(true);
  });

  it('lays out every cell exactly once', () => {
    const puppeteer = createPuppeteer();
    const wires = puppeteer.layout.flatMap((group) => group.wires);
    expect(new Set(wires).size).toBe(wires.length);
    expect(wires.length).toBe(puppeteer.size.cells);
  });
});
