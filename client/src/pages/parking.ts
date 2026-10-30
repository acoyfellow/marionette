import * as THREE from 'three';
import { createSourceTable, event, input, state } from 'handwired/src/runtime/cells.ts';
import { emitRelu, emitSelect } from 'handwired/src/runtime/numeric-ui-core.ts';
import { definePage } from '../kit';
import { box } from '../scene';
import { createTicker, DT, gates, wiresOf } from '../ticker';

export const LOT = { spaces: 8, armTime: 1.2 } as const;

export function buildParking() {
  const table = createSourceTable();
  const cells = table.declare({
    arrive: event(),
    leave: event(),
    dt: input([0, 0.1]),
    parked: state([0, LOT.spaces]),
    turnedAway: state([0, 1e6]),
    armIn: state([0, LOT.armTime + 0.01]),
    armOut: state([0, LOT.armTime + 0.01]),
  });
  const circuit = table.createCircuit();
  const { all, not, above, below } = gates(circuit);
  const c = (k: number) => circuit.constant(k);
  const full = not(below(cells.parked, LOT.spaces));
  const admit = all(cells.arrive, not(full));
  const refuse = all(cells.arrive, full);
  const exit = all(cells.leave, above(cells.parked, 0));
  const parked = circuit.affine([[cells.parked, 1], [admit, 1], [exit, -1]]);
  const decay = (wire: typeof cells.armIn) => emitRelu(circuit, circuit.affine([[wire, 1], [cells.dt, -1]]));
  table.next(cells.parked, parked);
  table.next(cells.turnedAway, circuit.affine([[cells.turnedAway, 1], [refuse, 1]]));
  table.next(cells.armIn, emitSelect(circuit, admit, decay(cells.armIn), c(LOT.armTime)));
  table.next(cells.armOut, emitSelect(circuit, exit, decay(cells.armOut), c(LOT.armTime)));
  const fullNow = not(below(parked, LOT.spaces));
  const output = { parked, full: fullNow, free: circuit.affine([[parked, -1]], LOT.spaces), refuse, admit, exit, turnedAway: cells.turnedAway, armIn: cells.armIn, armOut: cells.armOut };
  const layout = [
    { label: 'count', wires: wiresOf({ p: cells.parked, t: cells.turnedAway }) },
    { label: 'gates', wires: wiresOf({ i: cells.armIn, o: cells.armOut }) },
  ];
  return { ...table.finish(), output, events: { arrive: cells.arrive, leave: cells.leave }, dt: cells.dt, layout };
}

export const createParking = () => createTicker(buildParking());
type Frame = ReturnType<ReturnType<typeof createParking>['step']>;

export const parkingPage = definePage({
  slug: 'parking',
  title: 'parking garage',
  topic: 'counters · invariants',
  lesson:
    'The garage never looks at the spaces. It only counts: +1 at the entry gate, −1 at the exit. One rule keeps it honest, 0 ≤ cars ≤ 8, so the FULL sign is just the count reaching 8. A counter like this guards every rate limit you have ever hit.',
  eye: [0, 8, 7],
  make: createParking,
  controls: [
    { kind: 'button', label: 'car arrives 🚗', event: 'arrive' },
    { kind: 'button', label: 'car leaves', event: 'leave' },
  ],
  view: ({ scene }) => {
    const lot = box(9, 0.1, 5, 0x1e293b);
    scene.add(lot);
    const bays = Array.from({ length: LOT.spaces }, (_, i) => {
      const car = box(0.8, 0.5, 1.4, [0xf6821f, 0x71b8d8, 0x34d399, 0xf43f5e][i % 4] ?? 0xffffff);
      car.position.set(-3.5 + i, 0.3, -1.2);
      scene.add(car);
      const line = box(0.04, 0.02, 1.6, 0xe2e8f0);
      line.position.set(-4 + i, 0.06, -1.2);
      scene.add(line);
      return car;
    });
    const armIn = box(2, 0.1, 0.1, 0xef4444);
    armIn.position.set(-3.5, 1, 2);
    scene.add(armIn);
    const armOut = box(2, 0.1, 0.1, 0xef4444);
    armOut.position.set(3.5, 1, 2);
    scene.add(armOut);
    const sign = box(2.4, 0.7, 0.1, 0x14532d);
    sign.position.set(0, 2, 2.3);
    scene.add(sign);
    return (frame: Frame) => {
      bays.forEach((car, i) => {
        car.visible = i < frame.parked;
      });
      armIn.rotation.z = frame.armIn > 0 ? 1.2 : 0;
      armIn.position.x = frame.armIn > 0 ? -4.1 : -3.5;
      armOut.rotation.z = frame.armOut > 0 ? -1.2 : 0;
      armOut.position.x = frame.armOut > 0 ? 4.1 : 3.5;
      (sign.material as THREE.MeshStandardMaterial).color.setHex(frame.full === 1 ? 0x991b1b : 0x14532d);
      (sign.material as THREE.MeshStandardMaterial).emissive.setHex(frame.full === 1 ? 0x450a0a : 0x052e16);
      return `${frame.full === 1 ? 'FULL' : `${frame.free} free`} · ${frame.parked}/${LOT.spaces} parked · turned away ${frame.turnedAway}`;
    };
  },
});

void DT;
