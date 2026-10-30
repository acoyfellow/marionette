import * as THREE from 'three';
import { createSourceTable, event, input, list, state, stateBit } from 'handwired/src/runtime/cells.ts';
import { emitSelect, type Wire } from 'handwired/src/runtime/numeric-ui-core.ts';
import { definePage } from '../kit';
import { box } from '../scene';
import { createTicker, DT, gates, wiresOf } from '../ticker';

export const DIAL = { numbers: 12, code: [7, 2, 9] as const, directions: [1, -1, 1] as const } as const;

export function buildSafe() {
  const table = createSourceTable();
  const cells = table.declare({
    right: event(),
    left: event(),
    enter: event(),
    reset: event(),
    dt: input([0, 0.1]),
    dial: state([0, DIAL.numbers - 1]),
    lastDir: state([-1, 1]),
    progress: state([0, 3]),
    open: stateBit(0),
    wrong: state([0, 1.6]),
    tries: state([0, 1e6]),
  });
  const circuit = table.createCircuit();
  const { all, not, is, either, above } = gates(circuit);
  const c = (k: number) => circuit.constant(k);
  const turned = circuit.affine([[cells.dial, 1], [cells.right, 1], [cells.left, -1]]);
  const dial = emitSelect(circuit, above(turned, DIAL.numbers - 1), emitSelect(circuit, above(circuit.affine([[turned, -1]]), 0), turned, c(DIAL.numbers - 1)), c(0));
  const dir = emitSelect(circuit, either(cells.right, cells.left), cells.lastDir, circuit.affine([[cells.right, 1], [cells.left, -1]]));
  const expectedNumber = circuit.affine(DIAL.code.map((n, k) => [is(cells.progress, k), n] as const));
  const expectedDir = circuit.affine(DIAL.directions.map((d, k) => [is(cells.progress, k), d] as const));
  const right = all(is(circuit.affine([[cells.dial, 1], [expectedNumber, -1]]), 0), is(circuit.affine([[cells.lastDir, 1], [expectedDir, -1]]), 0));
  const good = all(cells.enter, not(cells.open), right);
  const bad = all(cells.enter, not(cells.open), not(right));
  const progress = emitSelect(circuit, either(bad, cells.reset), circuit.affine([[cells.progress, 1], [good, 1]]), c(0));
  const open = all(either(cells.open, is(progress, 3)), not(cells.reset));
  const wrong = emitSelect(circuit, bad, emitSelect(circuit, above(cells.wrong, 0), cells.wrong, circuit.affine([[cells.wrong, 1], [cells.dt, -1]])), c(1.5));
  const capped = emitSelect(circuit, above(circuit.affine([[wrong, -1]]), 0), wrong, c(0));
  table.next(cells.dial, dial);
  table.next(cells.lastDir, dir);
  table.next(cells.progress, progress);
  table.next(cells.open, open);
  table.next(cells.wrong, capped);
  table.next(cells.tries, circuit.affine([[cells.tries, 1], [bad, 1]]));
  const output = { dial, dir, progress, open, wrong: capped, tries: cells.tries, good };
  const layout = [
    { label: 'dial', wires: wiresOf({ d: cells.dial, l: cells.lastDir }) },
    { label: 'lock', wires: wiresOf({ p: cells.progress, o: cells.open, w: cells.wrong, t: cells.tries }) },
  ];
  const events: Record<string, Wire> = { right: cells.right, left: cells.left, enter: cells.enter, reset: cells.reset };
  return { ...table.finish(), output, events, dt: cells.dt, layout };
}

export const createSafe = () => createTicker(buildSafe());
type Frame = ReturnType<ReturnType<typeof createSafe>['step']>;

export const safePage = definePage({
  slug: 'safe',
  title: 'combination safe',
  topic: 'sequence detection · state memory',
  lesson:
    'The code is 7 → 2 → 9, turning right, then left, then right. The lock only remembers how far along the code you are. One wrong number sends it back to the start, which is why you cannot crack it one digit at a time. Turn the dial, then press enter.',
  eye: [0, 1.5, 7],
  make: createSafe,
  controls: [
    { kind: 'button', label: '⟲ left', event: 'left' },
    { kind: 'button', label: 'right ⟳', event: 'right' },
    { kind: 'button', label: 'enter', event: 'enter' },
    { kind: 'button', label: 'lock again', event: 'reset' },
  ],
  view: ({ scene, aim }) => {
    aim(0, 1.5, 0);
    const body = box(3, 3, 2.4, 0x334155);
    body.position.y = 1.5;
    scene.add(body);
    const doorPivot = new THREE.Group();
    doorPivot.position.set(-1.4, 1.5, 1.22);
    const door = box(2.8, 2.8, 0.15, 0x475569);
    door.position.x = 1.4;
    doorPivot.add(door);
    scene.add(doorPivot);
    const dial = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.2, 32), new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.8, roughness: 0.3 }));
    dial.rotation.x = Math.PI / 2;
    dial.position.set(1.4, 0, 0.15);
    door.add(dial);
    const tick = box(0.06, 0.3, 0.06, 0xf6821f);
    tick.position.set(0, 0.12, -0.45);
    dial.add(tick);
    const lamps = [0, 1, 2].map((k) => {
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), new THREE.MeshStandardMaterial({ color: 0x1f2937 }));
      lamp.position.set(0.8 + k * 0.6, 1, 0.1);
      door.add(lamp);
      return lamp;
    });
    const gold = box(1.2, 0.5, 0.8, 0xfacc15);
    gold.position.set(0, 0.6, 0.4);
    scene.add(gold);
    let shown = 0;
    return (frame: Frame) => {
      const target = -(frame.dial / DIAL.numbers) * Math.PI * 2;
      shown += (target - shown) * 0.25;
      dial.rotation.y = shown;
      lamps.forEach((lamp, k) => {
        const lit = k < frame.progress;
        lamp.material.color.setHex(frame.wrong > 0 ? 0xef4444 : lit ? 0x34d399 : 0x1f2937);
        lamp.material.emissive.setHex(frame.wrong > 0 ? 0x450a0a : lit ? 0x064e3b : 0);
      });
      doorPivot.rotation.y = frame.open === 1 ? Math.min(doorPivot.rotation.y + DT * 2, 1.7) : 0;
      const dir = frame.dir > 0 ? 'right' : frame.dir < 0 ? 'left' : '—';
      if (frame.open === 1) return '🔓 open! · press lock again';
      if (frame.wrong > 0) return '✕ wrong: back to the start';
      return `dial ${frame.dial} (turned ${dir}) · ${frame.progress}/3 correct · wrong tries ${frame.tries}`;
    };
  },
});
