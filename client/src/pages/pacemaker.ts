import * as THREE from 'three';
import { createSourceTable, event, input, state, stateBit } from 'handwired/src/runtime/cells.ts';
import { emitSelect } from 'handwired/src/runtime/numeric-ui-core.ts';
import { definePage } from '../kit';
import { box } from '../scene';
import { createTicker, DT, gates, wiresOf } from '../ticker';

export const HEART = { pacedRate: 60, blockChance: 0.5 } as const;

export function buildPacemaker() {
  const table = createSourceTable();
  const cells = table.declare({
    block: event(),
    dt: input([0, 0.1]),
    naturalRate: input([20, 160], { initial: 75 }),
    natural: state([0, 1.1]),
    sinceBeat: state([0, 10]),
    blocked: stateBit(0),
    paced: state([0, 1e6]),
    beats: state([0, 1e6]),
    lastPaced: stateBit(0),
  });
  const circuit = table.createCircuit();
  const { all, not, atLeast, either } = gates(circuit);
  const blocked = circuit.affine([[cells.blocked, 1], [cells.block, 1], [circuit.multiply(cells.block, cells.blocked), -2]]);
  const advanced = circuit.affine([[cells.natural, 1], [circuit.multiply(cells.naturalRate, cells.dt), 1 / 60]]);
  const naturalFires = atLeast(advanced, circuit.constant(1));
  const conducted = all(naturalFires, not(blocked));
  const since = circuit.affine([[cells.sinceBeat, 1], [cells.dt, 1]]);
  const limit = circuit.constant(60 / HEART.pacedRate);
  const pace = all(atLeast(since, limit), not(conducted));
  const beat = either(conducted, pace);
  table.next(cells.natural, emitSelect(circuit, naturalFires, advanced, circuit.constant(0)));
  table.next(cells.sinceBeat, emitSelect(circuit, beat, since, circuit.constant(0)));
  table.next(cells.blocked, blocked);
  table.next(cells.paced, circuit.affine([[cells.paced, 1], [pace, 1]]));
  table.next(cells.beats, circuit.affine([[cells.beats, 1], [beat, 1]]));
  table.next(cells.lastPaced, emitSelect(circuit, beat, cells.lastPaced, pace));
  const output = { beat, pace, conducted, blocked, since, paced: cells.paced, beats: cells.beats, naturalRate: cells.naturalRate };
  const layout = [
    { label: 'heart', wires: wiresOf({ n: cells.natural, b: cells.blocked }) },
    { label: 'device', wires: wiresOf({ s: cells.sinceBeat, p: cells.paced, l: cells.lastPaced }) },
    { label: 'beats', wires: wiresOf({ b: cells.beats }) },
  ];
  return {
    ...table.finish(),
    output,
    events: { block: cells.block },
    inputs: { naturalRate: cells.naturalRate },
    dt: cells.dt,
    layout,
  };
}

export const createPacemaker = () => createTicker(buildPacemaker());
type Frame = ReturnType<ReturnType<typeof createPacemaker>['step']>;

export const pacemakerPage = definePage({
  slug: 'pacemaker',
  title: 'pacemaker',
  topic: 'demand pacing · watchdog timers',
  lesson:
    'A pacemaker mostly does nothing. It listens, and only fires when the heart has been quiet for too long, here 1 s. Slow the natural rhythm, or block the signal, and watch it step in. Speed the heart up and it goes quiet again.',
  eye: [0, 2.5, 7],
  make: createPacemaker,
  controls: [
    { kind: 'slider', label: 'natural bpm', input: 'naturalRate', min: 20, max: 140, step: 1, initial: 75 },
    { kind: 'button', label: 'block signal on/off', event: 'block' },
  ],
  view: ({ scene, aim }) => {
    aim(0, 1, 0);
    const heart = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 24), new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.4 }));
    heart.position.y = 1.5;
    scene.add(heart);
    const device = box(0.6, 0.8, 0.2, 0x94a3b8);
    device.position.set(2, 1.6, 0);
    scene.add(device);
    const trace: THREE.Vector3[] = [];
    const line = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x34d399 }));
    scene.add(line);
    let x = 0;
    let squeeze = 0;
    let spark = 0;
    return (frame: Frame) => {
      if (frame.beat === 1) squeeze = 1;
      if (frame.pace === 1) spark = 1;
      squeeze = Math.max(0, squeeze - DT * 5);
      spark = Math.max(0, spark - DT * 4);
      heart.scale.setScalar(1 - squeeze * 0.15);
      (device.material as THREE.MeshStandardMaterial).emissive.setRGB(spark, spark * 0.8, 0);
      (heart.material as THREE.MeshStandardMaterial).color.setHex(frame.blocked === 1 ? 0x7f1d1d : 0xdc2626);
      x += DT * 1.5;
      if (x > 8) {
        x = 0;
        trace.length = 0;
      }
      trace.push(new THREE.Vector3(x - 4, 0.1 + squeeze * squeeze * 0.9, 1.5));
      line.geometry.setFromPoints(trace);
      (line.material as THREE.LineBasicMaterial).color.setHex(spark > 0 ? 0xfbbf24 : 0x34d399);
      const share = frame.beats > 0 ? Math.round((frame.paced / frame.beats) * 100) : 0;
      return `${frame.blocked === 1 ? 'signal BLOCKED · ' : ''}paced ${share}% of beats · ${spark > 0 ? '⚡ device fired' : 'listening'}`;
    };
  },
});
