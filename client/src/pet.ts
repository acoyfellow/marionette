import { createSourceTable, event, input, state } from 'handwired/src/runtime/cells.ts';
import { emitSelect } from 'handwired/src/runtime/numeric-ui-core.ts';
import { createTicker, DT, gates, wiresOf } from './ticker';

export const MOOD = ['happy', 'hungry', 'sleepy', 'sulky'] as const;
export const RATE = { hunger: 0.035, sleep: 0.025, sadness: 0.02, shrink: 0.01 } as const;
export const THRESHOLD = { hungry: 0.6, sleepy: 0.7, sulky: 0.25 } as const;

export function buildPet() {
  const table = createSourceTable();
  const cells = table.declare({
    poke: event(),
    feed: event(),
    dt: input([0, 0.1]),
    hunger: state([0, 1], { initial: 0.2 }),
    sleepiness: state([0, 1], { initial: 0.1 }),
    happiness: state([0, 1], { initial: 0.8 }),
    growth: state([0, 1]),
    squish: state([-2, 2]),
    wobble: state([-30, 30]),
  });
  const circuit = table.createCircuit();
  const { unit, below, above } = gates(circuit);

  const hunger = unit(
    circuit.affine(
      [
        [cells.hunger, 1],
        [cells.feed, -0.4],
      ],
      RATE.hunger * DT,
    ),
  );
  const sleepiness = unit(
    circuit.affine(
      [
        [cells.sleepiness, 1],
        [cells.poke, -0.3],
      ],
      RATE.sleep * DT,
    ),
  );
  const happiness = unit(
    circuit.affine(
      [
        [cells.happiness, 1],
        [cells.poke, 0.1],
        [cells.feed, 0.15],
      ],
      -RATE.sadness * DT,
    ),
  );
  const growth = unit(
    circuit.affine(
      [
        [cells.growth, 1],
        [cells.feed, 0.12],
      ],
      -RATE.shrink * DT,
    ),
  );
  const wobble = circuit.affine([
    [cells.wobble, 1 - 6 * DT],
    [cells.squish, -260 * DT],
    [cells.poke, 9],
  ]);
  const squish = circuit.affine([
    [cells.squish, 1],
    [wobble, DT],
  ]);

  const c = (k: number) => circuit.constant(k);
  const byHunger = emitSelect(circuit, above(hunger, THRESHOLD.hungry), c(0), c(1));
  const bySleep = emitSelect(circuit, above(sleepiness, THRESHOLD.sleepy), byHunger, c(2));
  const mood = emitSelect(circuit, below(happiness, THRESHOLD.sulky), bySleep, c(3));

  table.next(cells.hunger, hunger);
  table.next(cells.sleepiness, sleepiness);
  table.next(cells.happiness, happiness);
  table.next(cells.growth, growth);
  table.next(cells.squish, squish);
  table.next(cells.wobble, wobble);

  const output = { hunger, sleepiness, happiness, growth, squish, mood };
  const layout = [
    { label: 'meters', wires: wiresOf({ h: cells.hunger, s: cells.sleepiness, j: cells.happiness }) },
    { label: 'body', wires: wiresOf({ g: cells.growth, s: cells.squish, w: cells.wobble }) },
  ];
  return { ...table.finish(), output, events: { poke: cells.poke, feed: cells.feed }, dt: cells.dt, layout };
}

export const createPet = () => createTicker(buildPet());
export type Pet = ReturnType<typeof createPet>;
export type PetFrame = ReturnType<Pet['step']>;
