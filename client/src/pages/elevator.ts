import * as THREE from 'three';
import { createSourceTable, event, input, list, state, stateBit } from 'handwired/src/runtime/cells.ts';
import { emitRelu, emitSelect, type Wire } from 'handwired/src/runtime/numeric-ui-core.ts';
import { definePage } from '../kit';
import { box } from '../scene';
import { createTicker, DT, gates, wiresOf } from '../ticker';

export const BUILDING = { floors: 6, cars: 2, speed: 1.5, dwell: 1.2 } as const;

export function buildElevator() {
  const table = createSourceTable();
  const cells = table.declare({
    dt: input([0, 0.1]),
    calls: list(BUILDING.floors, () => event()),
    waiting: list(BUILDING.floors, () => stateBit(0)),
    cars: list(BUILDING.cars, (i) => ({
      position: state([0, BUILDING.floors - 1], { initial: i * (BUILDING.floors - 1) }),
      target: state([-1, BUILDING.floors - 1], { initial: -1 }),
      dwell: state([0, BUILDING.dwell + 0.01]),
    })),
    served: state([0, 1e6]),
  });
  const circuit = table.createCircuit();
  const { all, not, is, above, below, either } = gates(circuit);
  const c = (k: number) => circuit.constant(k);
  const abs = (wire: Wire) => circuit.affine([[emitRelu(circuit, wire), 1], [emitRelu(circuit, circuit.affine([[wire, -1]])), 1]]);

  const waiting = cells.waiting.map((bit, f) => either(bit, cells.calls[f] ?? c(0)));
  const idle = cells.cars.map((car) => all(below(car.target, 0), not(above(car.dwell, 0))));

  const claims = cells.cars.map(() => [] as Wire[]);
  const takenByCar = cells.cars.map(() => c(0));
  waiting.forEach((want, f) => {
    const alreadyTargeted = cells.cars.map((car) => is(car.target, f)).reduce((a, b) => either(a, b));
    const open = all(want, not(alreadyTargeted));
    const distance = cells.cars.map((car) => abs(circuit.affine([[car.position, 1]], -f)));
    const score = cells.cars.map((_, k) => circuit.affine([[distance[k] ?? c(0), 1], [not(idle[k] ?? c(0)), 100], [takenByCar[k] ?? c(0), 100]]));
    cells.cars.forEach((_, k) => {
      const best = score
        .map((other, j) => (j === k ? c(1) : j < k ? above(circuit.affine([[other, 1], [score[k] ?? c(0), -1]]), 0) : above(circuit.affine([[other, 1], [score[k] ?? c(0), -1]]), -0.0001)))
        .reduce((a, b) => all(a, b));
      const claim = all(open, idle[k] ?? c(0), best, not(takenByCar[k] ?? c(0)));
      claims[k]?.push(claim);
      takenByCar[k] = either(takenByCar[k] ?? c(0), claim);
    });
  });

  const cars = cells.cars.map((car, k) => {
    const chosen = circuit.affine((claims[k] ?? []).map((claim, f) => [claim, f] as const));
    const claimed = takenByCar[k] ?? c(0);
    const target = emitSelect(circuit, claimed, car.target, chosen);
    const hasTarget = above(target, -0.5);
    const gap = circuit.affine([[target, 1], [car.position, -1]]);
    const step = BUILDING.speed * DT;
    const up = all(hasTarget, above(gap, step));
    const down = all(hasTarget, below(gap, -step));
    const arrived = all(hasTarget, not(up), not(down));
    const moved = circuit.affine([[car.position, 1], [up, step], [down, -step]]);
    const position = emitSelect(circuit, arrived, moved, target);
    const dwellDecay = emitRelu(circuit, circuit.affine([[car.dwell, 1], [cells.dt, -1]]));
    const dwell = emitSelect(circuit, arrived, dwellDecay, c(BUILDING.dwell));
    const nextTarget = emitSelect(circuit, arrived, target, c(-1));
    table.next(car.position, position);
    table.next(car.target, nextTarget);
    table.next(car.dwell, dwell);
    return { position, target: nextTarget, doorsOpen: above(dwell, 0), arrived, up, down };
  });
  const arrivedAt = (f: number) => cars.map((car) => all(car.arrived, is(car.target, -1), below(abs(circuit.affine([[car.position, 1]], -f)), 0.01))).reduce((a, b) => either(a, b));
  const served = circuit.affine([[cells.served, 1], ...cars.map((car) => [car.arrived, 1] as const)]);
  cells.waiting.forEach((bit, f) => {
    table.next(bit, all(waiting[f] ?? c(0), not(arrivedAt(f))));
  });
  table.next(cells.served, served);
  const output = { cars, waiting: cells.waiting, served };
  const layout = [
    { label: 'calls', wires: wiresOf(cells.waiting) },
    ...cells.cars.map((car, k) => ({ label: `car ${k + 1}`, wires: wiresOf(car) })),
  ];
  const events = Object.fromEntries(cells.calls.map((bit, f) => [`call${f}`, bit])) as Record<string, Wire>;
  return { ...table.finish(), output, events, dt: cells.dt, layout };
}

export const createElevator = () => createTicker(buildElevator());
type Frame = ReturnType<ReturnType<typeof createElevator>['step']>;

const FLOOR = 1.3;

export const elevatorPage = definePage({
  slug: 'elevator',
  title: 'elevator bank',
  topic: 'dispatch · scheduling',
  lesson:
    'Call a lift from any floor. The dispatcher sends the closest free car, and never sends two cars to the same call. Press lots of floors and watch the two cars split the work.',
  eye: [0, 4, 11],
  make: createElevator,
  controls: Array.from({ length: BUILDING.floors }, (_, f) => ({
    kind: 'button' as const,
    label: `call ${f === 0 ? 'G' : f}`,
    event: `call${f}`,
  })).reverse(),
  view: ({ scene, aim }) => {
    aim(0, (BUILDING.floors * FLOOR) / 2, 0);
    const shafts = Array.from({ length: BUILDING.cars }, (_, k) => {
      const shaft = box(1.4, BUILDING.floors * FLOOR, 0.1, 0x1e293b);
      shaft.position.set((k - 0.5) * 2.2, (BUILDING.floors * FLOOR) / 2, -0.8);
      scene.add(shaft);
      return shaft;
    });
    const lamps = Array.from({ length: BUILDING.floors }, (_, f) => {
      const slab = box(6, 0.06, 1.4, 0x334155);
      slab.position.set(0, f * FLOOR, 0);
      scene.add(slab);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 8), new THREE.MeshStandardMaterial({ color: 0x334155 }));
      lamp.position.set(2.6, f * FLOOR + 0.6, 0);
      scene.add(lamp);
      return lamp;
    });
    const cars = shafts.map((shaft, k) => {
      const car = box(1.1, 1, 1, k === 0 ? 0xf6821f : 0x71b8d8);
      car.position.x = shaft.position.x;
      scene.add(car);
      return car;
    });
    return (frame: Frame) => {
      frame.cars.forEach((car, k) => {
        const mesh = cars[k];
        if (mesh === undefined) return;
        mesh.position.y = car.position * FLOOR + 0.55;
        mesh.scale.x = car.doorsOpen === 1 ? 0.75 : 1;
      });
      lamps.forEach((lamp, f) => {
        const on = frame.waiting[f] === 1;
        lamp.material.color.setHex(on ? 0xfbbf24 : 0x334155);
        lamp.material.emissive.setHex(on ? 0x7c5a00 : 0);
      });
      const label = (p: number) => (Math.round(p) === 0 ? 'G' : String(Math.round(p)));
      const waitingCount = frame.waiting.filter((w) => w === 1).length;
      return frame.cars.map((car, k) => `car ${k + 1} @ ${label(car.position)}`).join(' · ') + ` · ${waitingCount} waiting`;
    };
  },
});
