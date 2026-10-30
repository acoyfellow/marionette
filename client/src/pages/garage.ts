import * as THREE from 'three';
import { createSourceTable, event, input, state } from 'handwired/src/runtime/cells.ts';
import { emitMaximum, emitMinimum, emitSelect } from 'handwired/src/runtime/numeric-ui-core.ts';
import { definePage } from '../kit';
import { box } from '../scene';
import { createTicker, DT, gates, wiresOf } from '../ticker';

export const DOOR = { speed: 0.35, beamHeight: 0.15 } as const;
export const MOTION = { stopped: 0, opening: 1, closing: 2 } as const;

export function buildGarage() {
  const table = createSourceTable();
  const cells = table.declare({
    remote: event(),
    dt: input([0, 0.1]),
    blocked: input([0, 1]),
    height: state([0, 1], { initial: 1 }),
    motion: state([0, 2]),
    lastDir: state([1, 2], { initial: 2 }),
    reversals: state([0, 1e6]),
  });
  const circuit = table.createCircuit();
  const { all, is, above, below, either, not } = gates(circuit);
  const c = (k: number) => circuit.constant(k);
  const stopped = is(cells.motion, MOTION.stopped);
  const opening = is(cells.motion, MOTION.opening);
  const closing = is(cells.motion, MOTION.closing);
  const opposite = circuit.affine([[cells.lastDir, -1]], 3);
  const pressedWhileStopped = all(cells.remote, stopped);
  const pressedWhileMoving = all(cells.remote, not(stopped));
  const beamBroken = all(closing, above(cells.blocked, 0.5), below(cells.height, DOOR.beamHeight * 4));
  const moved = circuit.affine([[cells.height, 1], [opening, DOOR.speed * DT], [closing, -DOOR.speed * DT]]);
  const height = emitMaximum(circuit, c(0), emitMinimum(circuit, c(1), moved));
  const reachedEnd = either(all(opening, above(moved, 0.999)), all(closing, below(moved, 0.001)));
  const startMotion = emitSelect(circuit, above(cells.height, 0.5), c(MOTION.opening), c(MOTION.closing));
  const fromStop = emitSelect(circuit, above(circuit.affine([[cells.height, 1]], -0.001), 0), c(MOTION.opening), startMotion);
  const resumed = emitSelect(circuit, all(above(cells.height, 0.001), below(cells.height, 0.999)), fromStop, opposite);
  let motion = cells.motion as ReturnType<typeof c>;
  motion = emitSelect(circuit, pressedWhileStopped, motion, resumed);
  motion = emitSelect(circuit, pressedWhileMoving, motion, c(MOTION.stopped));
  motion = emitSelect(circuit, reachedEnd, motion, c(MOTION.stopped));
  motion = emitSelect(circuit, beamBroken, motion, c(MOTION.opening));
  const lastDir = emitSelect(circuit, either(opening, closing), cells.lastDir, cells.motion);
  table.next(cells.height, height);
  table.next(cells.motion, motion);
  table.next(cells.lastDir, lastDir);
  table.next(cells.reversals, circuit.affine([[cells.reversals, 1], [beamBroken, 1]]));
  const output = { height, motion, beamBroken, reversals: cells.reversals, blocked: cells.blocked };
  const layout = [
    { label: 'door', wires: wiresOf({ h: cells.height, m: cells.motion, d: cells.lastDir }) },
    { label: 'safety', wires: wiresOf({ r: cells.reversals }) },
  ];
  return {
    ...table.finish(),
    output,
    events: { remote: cells.remote },
    inputs: { blocked: cells.blocked },
    dt: cells.dt,
    layout,
  };
}

export const createGarage = () => createTicker(buildGarage());
type Frame = ReturnType<ReturnType<typeof createGarage>['step']>;

const MOTION_NAME = ['stopped', 'opening ↑', 'closing ↓'] as const;

export const garagePage = definePage({
  slug: 'garage',
  title: 'garage door',
  topic: 'fail-safe design · safety interlocks',
  lesson:
    'One button does everything: open, stop, close. A light beam near the floor guards the door. If anything breaks the beam while the door is closing, it reverses at once, because a safe default beats a fast one. Put the cat in the way.',
  eye: [5, 3, 7],
  make: createGarage,
  controls: [
    { kind: 'button', label: 'remote ⏏', event: 'remote' },
    { kind: 'slider', label: 'cat in doorway 🐈', input: 'blocked', min: 0, max: 1, step: 1, initial: 0 },
  ],
  view: ({ scene, aim }) => {
    aim(0, 1.2, 0);
    const floor = box(8, 0.1, 6, 0x334155);
    floor.position.y = -0.05;
    scene.add(floor);
    for (const x of [-2.1, 2.1]) {
      const post = box(0.3, 2.8, 0.3, 0x1e293b);
      post.position.set(x, 1.4, 0);
      scene.add(post);
    }
    const header = box(4.5, 0.3, 0.3, 0x1e293b);
    header.position.set(0, 2.95, 0);
    scene.add(header);
    const door = box(3.9, 2.6, 0.12, 0xe2e8f0);
    scene.add(door);
    const beam = box(3.9, 0.03, 0.03, 0xef4444);
    beam.position.set(0, DOOR.beamHeight * 2, 0.3);
    scene.add(beam);
    const cat = new THREE.Group();
    const torso = box(0.8, 0.4, 0.35, 0xf6821f);
    torso.position.y = 0.3;
    const head = box(0.35, 0.35, 0.35, 0xf6821f);
    head.position.set(0.5, 0.55, 0);
    cat.add(torso, head);
    cat.position.z = 0.3;
    scene.add(cat);
    return (frame: Frame) => {
      const h = frame.height * 2.6;
      door.scale.y = Math.max(0.02, 1 - frame.height);
      door.position.set(0, 2.8 - (2.6 * door.scale.y) / 2, 0.05);
      cat.visible = frame.blocked > 0.5;
      (beam.material as THREE.MeshStandardMaterial).emissive.setHex(frame.beamBroken === 1 ? 0xff0000 : 0x330000);
      beam.visible = !(frame.blocked > 0.5) || Math.sin(performance.now() / 80) > 0;
      void h;
      const name = MOTION_NAME[frame.motion] ?? 'stopped';
      const pos = frame.height > 0.99 ? 'open' : frame.height < 0.01 ? 'shut' : `${Math.round(frame.height * 100)}% open`;
      return `${name} · ${pos}${frame.reversals > 0 ? ` · safety reversals ${frame.reversals}` : ''}`;
    };
  },
});
