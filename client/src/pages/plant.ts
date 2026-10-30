import * as THREE from 'three';
import { createSourceTable, event, input, state } from 'handwired/src/runtime/cells.ts';
import { emitMaximum, emitMinimum, emitRelu } from 'handwired/src/runtime/numeric-ui-core.ts';
import { definePage } from '../kit';
import { box } from '../scene';
import { createTicker, DT, gates, wiresOf } from '../ticker';

export const PLANT = { growth: 0.08, bend: 0.6, maxHeight: 4 } as const;

export function buildPlant() {
  const table = createSourceTable();
  const cells = table.declare({
    water: event(),
    dt: input([0, 0.1]),
    sun: input([-1, 1]),
    light: input([0, 1], { initial: 1 }),
    height: state([0, PLANT.maxHeight], { initial: 0.4 }),
    lean: state([-1, 1]),
    moisture: state([0, 1], { initial: 0.6 }),
    pores: state([0, 1], { initial: 0.5 }),
  });
  const circuit = table.createCircuit();
  const { below } = gates(circuit);
  const c = (k: number) => circuit.constant(k);
  const clamp = (w: ReturnType<typeof c>, lo: number, hi: number) => emitMaximum(circuit, c(lo), emitMinimum(circuit, c(hi), w));
  const thirsty = below(cells.moisture, 0.3);
  const poresTarget = emitMaximum(circuit, c(0.05), circuit.affine([[cells.light, 0.9], [thirsty, -0.8]]));
  const pores = circuit.affine([[cells.pores, 0.95], [poresTarget, 0.05]]);
  const moisture = clamp(circuit.affine([[cells.moisture, 1], [pores, -0.06 * DT], [cells.water, 0.5]]), 0, 1);
  const energy = circuit.multiply(cells.light, emitMinimum(circuit, pores, moisture));
  const room = emitRelu(circuit, circuit.affine([[cells.height, -1]], PLANT.maxHeight));
  const height = circuit.affine([[cells.height, 1], [circuit.multiply(energy, emitMinimum(circuit, c(1), room)), PLANT.growth * DT * 3]]);
  const leanTarget = circuit.multiply(cells.sun, cells.light);
  const lean = clamp(circuit.affine([[cells.lean, 1 - PLANT.bend * DT], [leanTarget, PLANT.bend * DT]]), -1, 1);
  table.next(cells.height, height);
  table.next(cells.lean, lean);
  table.next(cells.moisture, moisture);
  table.next(cells.pores, pores);
  const output = { height, lean, moisture, pores, energy, thirsty, sun: cells.sun, light: cells.light };
  const layout = [
    { label: 'stem', wires: wiresOf({ h: cells.height, l: cells.lean }) },
    { label: 'leaves', wires: wiresOf({ m: cells.moisture, p: cells.pores }) },
  ];
  return {
    ...table.finish(),
    output,
    events: { water: cells.water },
    inputs: { sun: cells.sun, light: cells.light },
    dt: cells.dt,
    layout,
  };
}

export const createPlant = () => createTicker(buildPlant());
type Frame = ReturnType<ReturnType<typeof createPlant>['step']>;

export const plantPage = definePage({
  slug: 'plant',
  title: 'sunflower',
  topic: 'tropism · trade-offs',
  lesson:
    'A plant has no brain, but it still decides. It bends toward the sun. It opens its pores to catch light, but open pores lose water, so when the soil dries it closes them and stops growing. Move the sun, dim it, or water it.',
  eye: [0, 3, 8],
  make: createPlant,
  controls: [
    { kind: 'slider', label: 'sun position', input: 'sun', min: -1, max: 1, step: 0.05, initial: 0.6 },
    { kind: 'slider', label: 'brightness', input: 'light', min: 0, max: 1, step: 0.05, initial: 1 },
    { kind: 'button', label: 'water 💧', event: 'water' },
  ],
  view: ({ scene, aim }) => {
    aim(0, 1.8, 0);
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.45, 0.8, 24), new THREE.MeshStandardMaterial({ color: 0xb45309 }));
    pot.position.y = 0.4;
    scene.add(pot);
    const soil = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.05, 24), new THREE.MeshStandardMaterial({ color: 0x422006 }));
    soil.position.y = 0.8;
    scene.add(soil);
    const segments = Array.from({ length: 12 }, () => {
      const seg = box(0.12, 1, 0.12, 0x16a34a);
      scene.add(seg);
      return seg;
    });
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.12, 24), new THREE.MeshStandardMaterial({ color: 0xfacc15 }));
    scene.add(head);
    const center = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.14, 24), new THREE.MeshStandardMaterial({ color: 0x422006 }));
    head.add(center);
    const sun = new THREE.Mesh(new THREE.SphereGeometry(0.4, 20, 14), new THREE.MeshStandardMaterial({ color: 0xfde047, emissive: 0xfacc15 }));
    scene.add(sun);
    return (frame: Frame) => {
      const step = frame.height / segments.length;
      let x = 0;
      let y = 0.82;
      segments.forEach((seg, i) => {
        const bend = frame.lean * 0.9 * ((i + 1) / segments.length);
        seg.scale.y = step;
        seg.position.set(x + Math.sin(bend) * step * 0.5, y + Math.cos(bend) * step * 0.5, 0);
        seg.rotation.z = -bend;
        x += Math.sin(bend) * step;
        y += Math.cos(bend) * step;
        (seg.material as THREE.MeshStandardMaterial).color.setHex(frame.thirsty === 1 ? 0x65a30d : 0x16a34a);
      });
      head.position.set(x, y, 0.1);
      head.rotation.set(Math.PI / 2.4, 0, -frame.lean * 0.9);
      head.scale.setScalar(0.6 + frame.pores * 0.4);
      sun.position.set(frame.sun * 4, 4.2, 0);
      (sun.material as THREE.MeshStandardMaterial).emissiveIntensity = frame.light;
      (soil.material as THREE.MeshStandardMaterial).color.setRGB(0.26 - frame.moisture * 0.15, 0.13 - frame.moisture * 0.07, 0.02);
      return `${frame.thirsty === 1 ? 'thirsty: pores closing' : 'growing'} · height ${frame.height.toFixed(2)} · soil ${Math.round(frame.moisture * 100)}% wet`;
    };
  },
});
