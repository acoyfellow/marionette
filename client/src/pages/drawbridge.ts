import * as THREE from 'three';
import { createSourceTable, event, input, list, state } from 'handwired/src/runtime/cells.ts';
import { emitMaximum, emitMinimum, emitSelect } from 'handwired/src/runtime/numeric-ui-core.ts';
import { definePage } from '../kit';
import { box } from '../scene';
import { createTicker, DT, gates, wiresOf } from '../ticker';

export const BRIDGE_STAGES = ['open to cars', 'lights flash', 'gates down', 'bridge up', 'boat passes', 'bridge down', 'gates up'] as const;
export const STAGE_TIME = [0, 1.5, 1.5, 2.5, 3, 2.5, 1.5] as const;

export function buildDrawbridge() {
  const table = createSourceTable();
  const cells = table.declare({
    boat: event(),
    dt: input([0, 0.1]),
    stage: state([0, BRIDGE_STAGES.length - 1]),
    timer: state([0, 10]),
    gate: state([0, 1]),
    deck: state([0, 1]),
    boatX: state([-6, 8], { initial: -6 }),
    cars: list(2, (i) => state([-6, 6], { initial: -5 + i * 4 })),
  });
  const circuit = table.createCircuit();
  const { all, is, atLeast, above, below, either, not } = gates(circuit);
  const c = (k: number) => circuit.constant(k);
  const clamp01 = (w: ReturnType<typeof c>) => emitMaximum(circuit, c(0), emitMinimum(circuit, c(1), w));
  const stages = BRIDGE_STAGES.map((_, k) => is(cells.stage, k));
  const idle = stages[0] ?? c(0);
  const begin = all(cells.boat, idle);
  const length = circuit.affine(stages.map((bit, k) => [bit, STAGE_TIME[k] ?? 0] as const));
  const ticked = circuit.affine([[cells.timer, 1], [circuit.multiply(not(idle), cells.dt), 1]]);
  const done = all(not(idle), atLeast(ticked, length));
  const wrap = is(cells.stage, BRIDGE_STAGES.length - 1);
  const nextStage = emitSelect(circuit, wrap, circuit.affine([[cells.stage, 1]], 1), c(0));
  const stage = emitSelect(circuit, either(begin, done), cells.stage, nextStage);
  const timer = emitSelect(circuit, either(begin, done), ticked, c(0));
  const gateWanted = either(either(stages[2] ?? c(0), stages[3] ?? c(0)), either(stages[4] ?? c(0), stages[5] ?? c(0)));
  const deckWanted = either(stages[3] ?? c(0), stages[4] ?? c(0));
  const gate = clamp01(circuit.affine([[cells.gate, 1], [gateWanted, 2 * DT * 1.2], [not(gateWanted), -DT * 1.2]], 0));
  const deckSafe = above(cells.gate, 0.98);
  const deck = clamp01(circuit.affine([[cells.deck, 1], [all(deckWanted, deckSafe), 2 * DT / 2.5], [not(deckWanted), -DT / 2.5]], 0));
  const boatGo = all(stages[4] ?? c(0), above(cells.deck, 0.98));
  const boatX = emitSelect(circuit, begin, emitMinimum(circuit, c(7), emitSelect(circuit, boatGo, cells.boatX, circuit.affine([[cells.boatX, 1]], 4 * DT))), c(-6));
  const cars = cells.cars.map((car) => {
    const nearStop = all(above(car, -2.2), below(car, -1.2));
    const stop = all(nearStop, not(idle));
    const moved = circuit.affine([[car, 1], [not(stop), 2 * DT]]);
    return emitSelect(circuit, above(moved, 6), moved, c(-6));
  });
  table.next(cells.stage, stage);
  table.next(cells.timer, timer);
  table.next(cells.gate, gate);
  table.next(cells.deck, deck);
  table.next(cells.boatX, boatX);
  cells.cars.forEach((car, i) => table.next(car, cars[i] ?? c(0)));
  const unsafe = all(above(deck, 0.01), not(above(gate, 0.98)));
  const output = { stage, timer, gate, deck, boatX, cars, flashing: not(idle), unsafe };
  const layout = [
    { label: 'sequence', wires: wiresOf({ s: cells.stage, t: cells.timer }) },
    { label: 'machines', wires: wiresOf({ g: cells.gate, d: cells.deck }) },
    { label: 'traffic', wires: wiresOf({ b: cells.boatX, c: cells.cars }) },
  ];
  return { ...table.finish(), output, events: { boat: cells.boat }, dt: cells.dt, layout };
}

export const createDrawbridge = () => createTicker(buildDrawbridge());
type Frame = ReturnType<ReturnType<typeof createDrawbridge>['step']>;

export const drawbridgePage = definePage({
  slug: 'drawbridge',
  title: 'drawbridge',
  topic: 'ordered sequences · preconditions',
  lesson:
    'Order is everything. Lights flash, then the gates drop, and only once the gates are fully down may the bridge rise. The boat waits until the bridge is fully up. Then the steps run again in reverse. Every step checks the last one actually finished.',
  eye: [6, 6, 8],
  make: createDrawbridge,
  controls: [{ kind: 'button', label: 'boat coming ⛵', event: 'boat' }],
  view: ({ scene }) => {
    const water = box(4, 0.05, 14, 0x0c4a6e);
    water.position.y = -0.4;
    scene.add(water);
    for (const x of [-4, 4]) {
      const bank = box(4, 0.6, 3, 0x334155);
      bank.position.set(x, -0.1, 0);
      scene.add(bank);
    }
    const leaves = [-1, 1].map((side) => {
      const pivot = new THREE.Group();
      pivot.position.set(side * 2, 0.2, 0);
      const leaf = box(2, 0.15, 2.4, 0x64748b);
      leaf.position.x = -side;
      pivot.add(leaf);
      scene.add(pivot);
      return { pivot, side };
    });
    const gates = [-1, 1].map((side) => {
      const gate = box(0.1, 0.1, 2.4, 0xef4444);
      gate.position.set(side * 3, 0.9, 0);
      scene.add(gate);
      return gate;
    });
    const lights = [-1, 1].map((side) => {
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 8), new THREE.MeshStandardMaterial({ color: 0x7f1d1d }));
      lamp.position.set(side * 3.3, 1.6, 1.4);
      scene.add(lamp);
      return lamp;
    });
    const boat = box(1, 0.6, 1.8, 0xf6821f);
    scene.add(boat);
    const mast = box(0.08, 2.4, 0.08, 0xe2e8f0);
    mast.position.y = 1.4;
    boat.add(mast);
    const cars = [0x71b8d8, 0x34d399].map((color) => {
      const car = box(0.9, 0.5, 0.6, color);
      scene.add(car);
      return car;
    });
    let t = 0;
    return (frame: Frame) => {
      t += DT;
      leaves.forEach(({ pivot, side }) => {
        pivot.rotation.z = side * frame.deck * 1.2;
      });
      gates.forEach((gate) => {
        gate.rotation.x = (1 - frame.gate) * 1.4;
        gate.position.y = 0.9 + (1 - frame.gate) * 0.6;
      });
      const blink = frame.flashing === 1 && Math.sin(t * 10) > 0;
      lights.forEach((lamp, i) => {
        const on = frame.flashing === 1 && (i === 0 ? blink : !blink);
        lamp.material.color.setHex(on ? 0xef4444 : 0x7f1d1d);
        lamp.material.emissive.setHex(on ? 0x7f1d1d : 0);
      });
      boat.position.set(0, -0.1, frame.boatX);
      frame.cars.forEach((x, i) => {
        const car = cars[i];
        if (car !== undefined) car.position.set(x, 0.45, i === 0 ? -0.6 : 0.6);
      });
      return `${BRIDGE_STAGES[frame.stage] ?? ''} · gates ${Math.round(frame.gate * 100)}% · bridge ${Math.round(frame.deck * 100)}% up`;
    };
  },
});
