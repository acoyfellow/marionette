import * as THREE from 'three';
import { createSourceTable, event, input, state, stateBit } from 'handwired/src/runtime/cells.ts';
import { emitRelu, emitSelect } from 'handwired/src/runtime/numeric-ui-core.ts';
import { definePage } from '../kit';
import { box } from '../scene';
import { createTicker, DT, gates, wiresOf } from '../ticker';

export const STEPS = ['ready', 'fill', 'wash', 'drain', 'rinse', 'spin', 'done'] as const;
export const LENGTH = [0, 2, 4, 1.5, 3, 3, 0] as const;

export function buildWasher() {
  const table = createSourceTable();
  const cells = table.declare({
    start: event(),
    lid: event(),
    dt: input([0, 0.1]),
    step: state([0, STEPS.length - 1]),
    timer: state([0, 10]),
    lidOpen: stateBit(0),
    water: state([0, 1]),
    refused: state([0, 2]),
  });
  const circuit = table.createCircuit();
  const { all, not, is, atLeast, above, either } = gates(circuit);
  const c = (k: number) => circuit.constant(k);
  const steps = STEPS.map((_, k) => is(cells.step, k));
  const running = circuit.affine(steps.slice(1, -1).map((bit) => [bit, 1] as const));
  const locked = either(running, above(cells.water, 0.02));
  const lidAllowed = all(cells.lid, not(locked));
  const lidOpen = circuit.affine([[cells.lidOpen, 1], [lidAllowed, 1], [circuit.multiply(lidAllowed, cells.lidOpen), -2]]);
  const begin = all(cells.start, either(steps[0] ?? c(0), steps[6] ?? c(0)), not(lidOpen));
  const length = circuit.affine(steps.map((bit, k) => [bit, LENGTH[k] ?? 0] as const));
  const ticked = circuit.affine([[cells.timer, 1], [circuit.multiply(running, cells.dt), 1]]);
  const finished = all(running, atLeast(ticked, length));
  const advance = either(begin, finished);
  const step = emitSelect(circuit, advance, cells.step, emitSelect(circuit, begin, circuit.affine([[cells.step, 1]], 1), c(1)));
  const timer = emitSelect(circuit, advance, ticked, c(0));
  const filling = either(steps[1] ?? c(0), steps[4] ?? c(0));
  const draining = either(steps[3] ?? c(0), steps[5] ?? c(0));
  const water = emitRelu(
    circuit,
    circuit.affine([[cells.water, 1], [filling, 0.5 * DT], [draining, -0.7 * DT]]),
  );
  const capped = emitSelect(circuit, above(water, 1), water, c(1));
  const refusedNow = either(all(cells.lid, locked), all(cells.start, lidOpen));
  const refused = emitSelect(circuit, refusedNow, emitRelu(circuit, circuit.affine([[cells.refused, 1], [cells.dt, -1]])), c(1.5));
  table.next(cells.step, step);
  table.next(cells.timer, timer);
  table.next(cells.lidOpen, lidOpen);
  table.next(cells.water, capped);
  table.next(cells.refused, refused);
  const output = { step, timer, length, lidOpen, locked, water: capped, refused };
  const layout = [
    { label: 'program', wires: wiresOf({ s: cells.step, t: cells.timer }) },
    { label: 'drum', wires: wiresOf({ l: cells.lidOpen, w: cells.water, r: cells.refused }) },
  ];
  return { ...table.finish(), output, events: { start: cells.start, lid: cells.lid }, dt: cells.dt, layout };
}

export const createWasher = () => createTicker(buildWasher());
type Frame = ReturnType<ReturnType<typeof createWasher>['step']>;

export const washerPage = definePage({
  slug: 'washer',
  title: 'washing machine',
  topic: 'sequencers · safety locks',
  lesson:
    'A washer runs a fixed recipe: fill, wash, drain, rinse, spin. Each step has a timer, and the end of one step starts the next. The lid locks while there is water or spinning. Try to open it halfway through: the machine says no.',
  eye: [0, 3, 7],
  make: createWasher,
  controls: [
    { kind: 'button', label: 'start ▶', event: 'start' },
    { kind: 'button', label: 'open / close lid', event: 'lid' },
  ],
  view: ({ scene, aim }) => {
    aim(0, 1.3, 0);
    const body = box(2.4, 2.6, 2, 0xe2e8f0);
    body.position.y = 1.3;
    scene.add(body);
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 0.2, 32), new THREE.MeshStandardMaterial({ color: 0x334155 }));
    drum.rotation.x = Math.PI / 2;
    drum.position.set(0, 1.2, 1.02);
    scene.add(drum);
    const water = new THREE.Mesh(new THREE.CircleGeometry(0.75, 32), new THREE.MeshStandardMaterial({ color: 0x71b8d8, transparent: true, opacity: 0.8 }));
    water.position.set(0, 1.2, 1.13);
    scene.add(water);
    const socks = Array.from({ length: 3 }, (_, i) => {
      const sock = box(0.25, 0.12, 0.05, [0xf6821f, 0xf43f5e, 0x34d399][i] ?? 0xffffff);
      scene.add(sock);
      return sock;
    });
    const lid = box(2.3, 0.08, 1.9, 0x94a3b8);
    scene.add(lid);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8), new THREE.MeshStandardMaterial({ color: 0x34d399 }));
    lamp.position.set(0.9, 2.4, 1.02);
    scene.add(lamp);
    let angle = 0;
    return (frame: Frame) => {
      const name = STEPS[frame.step] ?? 'ready';
      const speed = name === 'wash' || name === 'rinse' ? 3 : name === 'spin' ? 18 : 0;
      angle += speed * DT * (name === 'wash' ? Math.sign(Math.sin(frame.timer * 2)) || 1 : 1);
      socks.forEach((sock, i) => {
        const a = angle + (i * Math.PI * 2) / 3;
        const r = name === 'spin' ? 0.65 : 0.35 + 0.2 * frame.water;
        sock.position.set(Math.cos(a) * r, 1.2 + Math.sin(a) * r, 1.15);
        sock.rotation.z = a;
      });
      water.scale.setScalar(Math.max(0.01, frame.water));
      lid.position.set(0, frame.lidOpen === 1 ? 3.2 : 2.64, frame.lidOpen === 1 ? -0.7 : 0);
      lid.rotation.x = frame.lidOpen === 1 ? -1.2 : 0;
      lamp.material.color.setHex(frame.refused > 0 ? 0xef4444 : frame.locked === 1 ? 0xfbbf24 : 0x34d399);
      const left = Math.max(0, frame.length - frame.timer).toFixed(1);
      if (frame.refused > 0) return frame.lidOpen === 1 ? 'close the lid first' : '🔒 lid locked: water or spinning';
      return `${name}${frame.length > 0 ? ` · ${left} s left` : ''} · lid ${frame.locked === 1 ? 'locked 🔒' : frame.lidOpen === 1 ? 'open' : 'closed'}`;
    };
  },
});
