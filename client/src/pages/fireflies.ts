import * as THREE from 'three';
import { createSourceTable, event, input, list, state } from 'handwired/src/runtime/cells.ts';
import { emitSelect } from 'handwired/src/runtime/numeric-ui-core.ts';
import { definePage } from '../kit';
import { createTicker, DT, gates, wiresOf } from '../ticker';

export const SWARM = { count: 12, rate: 0.8 } as const;

const seeded = (i: number) => ((Math.sin(i * 12.9898) * 43758.5453) % 1 + 1) % 1;

export function buildFireflies() {
  const table = createSourceTable();
  const cells = table.declare({
    scatter: event(),
    dt: input([0, 0.1]),
    coupling: input([0, 0.5]),
    phases: list(SWARM.count, (i) => state([0, 1], { initial: seeded(i + 1) })),
  });
  const circuit = table.createCircuit();
  const { atLeast, either } = gates(circuit);
  const one = circuit.constant(1);
  const advanced = cells.phases.map((phase) => circuit.affine([[phase, 1]], SWARM.rate * DT));
  const flashing = advanced.map((phase) => atLeast(phase, one));
  const anyFlash = flashing.reduce((a, b) => either(a, b));
  const flashes = circuit.affine(flashing.map((bit) => [bit, 1] as const));
  const phases = advanced.map((phase, i) => {
    const nudge = circuit.multiply(anyFlash, cells.coupling);
    const pushed = circuit.affine([[phase, 1], [circuit.multiply(nudge, phase), 1]]);
    const fired = either(flashing[i] ?? one, atLeast(pushed, one));
    const wrapped = emitSelect(circuit, fired, pushed, circuit.constant(0));
    const scattered = emitSelect(circuit, cells.scatter, wrapped, circuit.constant(seeded(i * 7 + 3)));
    return { phase: scattered, fired };
  });
  cells.phases.forEach((cell, i) => {
    const next = phases[i];
    if (next !== undefined) table.next(cell, next.phase);
  });
  const output = { phases: phases.map((each) => each.phase), fired: phases.map((each) => each.fired), flashes };
  const layout = [
    { label: 'clocks 1-6', wires: wiresOf(cells.phases.slice(0, 6)) },
    { label: 'clocks 7-12', wires: wiresOf(cells.phases.slice(6)) },
  ];
  return {
    ...table.finish(),
    output,
    events: { scatter: cells.scatter },
    inputs: { coupling: cells.coupling },
    dt: cells.dt,
    layout,
  };
}

export const createFireflies = () => createTicker(buildFireflies());
type Frame = ReturnType<ReturnType<typeof createFireflies>['step']>;

export function spread(phases: readonly number[]) {
  const x = phases.reduce((sum, p) => sum + Math.cos(p * Math.PI * 2), 0) / phases.length;
  const y = phases.reduce((sum, p) => sum + Math.sin(p * Math.PI * 2), 0) / phases.length;
  return Math.hypot(x, y);
}

export const firefliesPage = definePage({
  slug: 'fireflies',
  title: 'firefly swarm',
  topic: 'synchronization · coupled oscillators',
  lesson:
    'Each firefly has its own clock. When any one flashes, the others jump a little ahead. No leader, yet they all end up blinking together. Scatter them and watch them find each other again. Set the pull to 0 and they never sync.',
  eye: [0, 2, 9],
  make: createFireflies,
  controls: [
    { kind: 'slider', label: 'pull', input: 'coupling', min: 0, max: 0.3, step: 0.01, initial: 0.08 },
    { kind: 'button', label: 'scatter ✨', event: 'scatter' },
  ],
  view: ({ scene }) => {
    scene.background = new THREE.Color(0x050a12);
    const flies = Array.from({ length: SWARM.count }, (_, i) => {
      const fly = new THREE.Mesh(
        new THREE.SphereGeometry(0.16, 16, 12),
        new THREE.MeshStandardMaterial({ color: 0x1a2e05, emissive: 0x000000 }),
      );
      const light = new THREE.PointLight(0xd9f99d, 0, 3);
      fly.add(light);
      fly.userData.home = new THREE.Vector3((seeded(i + 11) - 0.5) * 8, 0.5 + seeded(i + 23) * 3, (seeded(i + 37) - 0.5) * 4);
      scene.add(fly);
      return { fly, light, glow: 0 };
    });
    const grass = new THREE.Mesh(new THREE.PlaneGeometry(20, 10), new THREE.MeshStandardMaterial({ color: 0x0a1a0a }));
    grass.rotation.x = -Math.PI / 2;
    scene.add(grass);
    let t = 0;
    return (frame: Frame) => {
      t += DT;
      flies.forEach((each, i) => {
        each.glow = frame.fired[i] === 1 ? 1 : each.glow * 0.9;
        const home = each.fly.userData.home as THREE.Vector3;
        each.fly.position.set(home.x + Math.sin(t * 0.7 + i) * 0.3, home.y + Math.sin(t * 1.1 + i * 2) * 0.2, home.z);
        each.fly.material.emissive.setRGB(0.85 * each.glow, 0.98 * each.glow, 0.45 * each.glow);
        each.light.intensity = each.glow * 3;
      });
      const sync = spread(frame.phases);
      return `in sync: ${Math.round(sync * 100)}%${frame.flashes > SWARM.count * 0.8 ? ' · ✨ together!' : ''}`;
    };
  },
});
