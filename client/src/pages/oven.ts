import * as THREE from 'three';
import { createSourceTable, event, input, state, stateBit } from 'handwired/src/runtime/cells.ts';
import { emitMaximum, emitMinimum, emitRelu, emitSelect } from 'handwired/src/runtime/numeric-ui-core.ts';
import { definePage } from '../kit';
import { box } from '../scene';
import { createTicker, DT, gates, wiresOf } from '../ticker';

export const OVEN = { room: 20, heat: 40, loss: 0.05, doorLoss: 0.4, bakeTime: 8 } as const;

export function buildOven() {
  const table = createSourceTable();
  const cells = table.declare({
    start: event(),
    door: event(),
    dt: input([0, 0.1]),
    setpoint: input([100, 260], { initial: 180 }),
    temp: state([0, 400], { initial: OVEN.room }),
    integral: state([-50, 50]),
    doorOpen: stateBit(0),
    baking: stateBit(0),
    baked: state([0, OVEN.bakeTime + 0.1]),
  });
  const circuit = table.createCircuit();
  const { all, not, above, below, either } = gates(circuit);
  const c = (k: number) => circuit.constant(k);
  const doorOpen = circuit.affine([[cells.doorOpen, 1], [cells.door, 1], [circuit.multiply(cells.door, cells.doorOpen), -2]]);
  const error = circuit.affine([[cells.setpoint, 1], [cells.temp, -1]]);
  const integral = emitMaximum(circuit, c(-50), emitMinimum(circuit, c(50), circuit.affine([[cells.integral, 1], [error, 0.2 * DT]])));
  const power = emitMaximum(circuit, c(0), emitMinimum(circuit, c(1), circuit.affine([[error, 0.04], [integral, 0.02]])));
  const loss = circuit.affine([[doorOpen, OVEN.doorLoss - OVEN.loss]], OVEN.loss);
  const cooling = circuit.multiply(loss, circuit.affine([[cells.temp, 1]], -OVEN.room));
  const temp = circuit.affine([[cells.temp, 1], [power, OVEN.heat * DT], [cooling, -DT]]);
  const near = below(emitMaximum(circuit, error, circuit.affine([[error, -1]])), 8);
  const baking = either(cells.start, all(cells.baking, below(cells.baked, OVEN.bakeTime)));
  const baked = emitSelect(circuit, cells.start, emitMinimum(circuit, c(OVEN.bakeTime), circuit.affine([[cells.baked, 1], [circuit.multiply(all(baking, near), cells.dt), 1]])), c(0));
  table.next(cells.temp, temp);
  table.next(cells.integral, integral);
  table.next(cells.doorOpen, doorOpen);
  table.next(cells.baking, baking);
  table.next(cells.baked, baked);
  const done = all(not(below(baked, OVEN.bakeTime)), above(baked, 0));
  const output = { temp, power, error, near, doorOpen, baking, baked, done, setpoint: cells.setpoint, overshoot: emitRelu(circuit, circuit.affine([[error, -1]])) };
  const layout = [
    { label: 'oven', wires: wiresOf({ t: cells.temp, i: cells.integral, d: cells.doorOpen }) },
    { label: 'cake', wires: wiresOf({ b: cells.baking, t: cells.baked }) },
  ];
  return {
    ...table.finish(),
    output,
    events: { start: cells.start, door: cells.door },
    inputs: { setpoint: cells.setpoint },
    dt: cells.dt,
    layout,
  };
}

export const createOven = () => createTicker(buildOven());
type Frame = ReturnType<ReturnType<typeof createOven>['step']>;

export const ovenPage = definePage({
  slug: 'oven',
  title: 'oven',
  topic: 'setpoint control · disturbance rejection',
  lesson:
    'Set a temperature. The oven pushes hard while far away and eases off as it gets close, so it lands without overshooting. Open the door: heat pours out, and the oven fights to win it back. The cake only counts time spent near the setpoint.',
  eye: [0, 2.5, 7],
  make: createOven,
  controls: [
    { kind: 'slider', label: 'set °C', input: 'setpoint', min: 100, max: 260, step: 5, initial: 180 },
    { kind: 'button', label: 'bake a cake 🎂', event: 'start' },
    { kind: 'button', label: 'open / close door', event: 'door' },
  ],
  view: ({ scene, aim }) => {
    aim(0, 1.2, 0);
    const body = box(3, 2.4, 2, 0x334155);
    body.position.y = 1.2;
    scene.add(body);
    const inside = box(2.4, 1.6, 0.05, 0x111827);
    inside.position.set(0, 1.1, 1.01);
    scene.add(inside);
    const coil = box(2.2, 0.06, 0.06, 0x7f1d1d);
    coil.position.set(0, 0.45, 1.05);
    scene.add(coil);
    const cake = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.35, 24), new THREE.MeshStandardMaterial({ color: 0xfde68a }));
    cake.position.set(0, 0.8, 1.1);
    scene.add(cake);
    const doorPivot = new THREE.Group();
    doorPivot.position.set(0, 0.3, 1.05);
    const door = box(2.6, 1.8, 0.08, 0x94a3b8);
    (door.material as THREE.MeshStandardMaterial).transparent = true;
    (door.material as THREE.MeshStandardMaterial).opacity = 0.35;
    door.position.y = 0.9;
    doorPivot.add(door);
    scene.add(doorPivot);
    return (frame: Frame) => {
      (coil.material as THREE.MeshStandardMaterial).emissive.setRGB(frame.power, frame.power * 0.25, 0);
      (inside.material as THREE.MeshStandardMaterial).color.setRGB(0.07 + Math.min(1, frame.temp / 260) * 0.35, 0.07, 0.07);
      doorPivot.rotation.x = frame.doorOpen === 1 ? 1.3 : 0;
      const doneness = frame.baked / OVEN.bakeTime;
      cake.visible = frame.baking === 1 || frame.baked > 0;
      cake.scale.y = 1 + doneness * 0.8;
      (cake.material as THREE.MeshStandardMaterial).color.setRGB(0.99 - doneness * 0.35, 0.9 - doneness * 0.45, 0.54 - doneness * 0.4);
      const cakeNote = frame.done === 1 ? ' · 🎂 done!' : frame.baking === 1 ? ` · cake ${Math.round(doneness * 100)}%` : '';
      return `${Math.round(frame.temp)} / ${frame.setpoint} °C · power ${Math.round(frame.power * 100)}%${cakeNote}`;
    };
  },
});
