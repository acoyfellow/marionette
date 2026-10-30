import * as THREE from 'three';
import { createSourceTable, event, input, state } from 'handwired/src/runtime/cells.ts';
import { emitMaximum, emitMinimum } from 'handwired/src/runtime/numeric-ui-core.ts';
import { definePage } from '../kit';
import { box } from '../scene';
import { createTicker, DT, wiresOf } from '../ticker';

export const DRONE = { gravity: 9.8, maxThrust: 25, gust: -6, target: 3 } as const;

export function buildDrone() {
  const table = createSourceTable();
  const cells = table.declare({
    gust: event(),
    dt: input([0, 0.1]),
    kp: input([0, 20]),
    ki: input([0, 10]),
    kd: input([0, 10]),
    target: input([0, 6]),
    height: state([-50, 50], { initial: 0.5 }),
    velocity: state([-200, 200]),
    integral: state([-20, 20]),
  });
  const circuit = table.createCircuit();
  const error = circuit.affine([[cells.target, 1], [cells.height, -1]]);
  const integral = emitMaximum(
    circuit,
    circuit.constant(-20),
    emitMinimum(circuit, circuit.constant(20), circuit.affine([[cells.integral, 1], [error, DT]])),
  );
  const p = circuit.multiply(error, cells.kp);
  const i = circuit.multiply(integral, cells.ki);
  const d = circuit.multiply(circuit.affine([[cells.velocity, -1]]), cells.kd);
  const raw = circuit.affine([[p, 1], [i, 1], [d, 1]], DRONE.gravity);
  const thrust = emitMaximum(circuit, circuit.constant(0), emitMinimum(circuit, circuit.constant(DRONE.maxThrust), raw));
  const velocity = circuit.affine(
    [
      [cells.velocity, 0.995],
      [thrust, DT],
      [cells.gust, DRONE.gust],
    ],
    -DRONE.gravity * DT,
  );
  const lifted = circuit.affine([[cells.height, 1], [velocity, DT]]);
  const height = emitMaximum(circuit, circuit.constant(0), lifted);
  table.next(cells.height, height);
  table.next(cells.velocity, velocity);
  table.next(cells.integral, integral);
  const output = { height, velocity, thrust, error, p, i, d };
  const layout = [
    { label: 'body', wires: wiresOf({ h: cells.height, v: cells.velocity }) },
    { label: 'memory', wires: wiresOf({ i: cells.integral }) },
  ];
  return {
    ...table.finish(),
    output,
    events: { gust: cells.gust },
    inputs: { kp: cells.kp, ki: cells.ki, kd: cells.kd, target: cells.target },
    dt: cells.dt,
    layout,
  };
}

export const createDrone = () => createTicker(buildDrone());
type Frame = ReturnType<ReturnType<typeof createDrone>['step']>;

export const dronePage = definePage({
  slug: 'drone',
  title: 'hovering drone',
  topic: 'PID control',
  lesson:
    'Three knobs fly this drone. P pushes toward the target, I fixes slow drift, D brakes before overshoot. Set D to 0 and watch it bounce. Set P to 0 and it falls.',
  eye: [0, 4, 12],
  make: createDrone,
  controls: [
    { kind: 'slider', label: 'P', input: 'kp', min: 0, max: 20, step: 0.5, initial: 8 },
    { kind: 'slider', label: 'I', input: 'ki', min: 0, max: 10, step: 0.5, initial: 1 },
    { kind: 'slider', label: 'D', input: 'kd', min: 0, max: 10, step: 0.5, initial: 4 },
    { kind: 'slider', label: 'target', input: 'target', min: 0.5, max: 6, step: 0.1, initial: DRONE.target },
    { kind: 'button', label: 'wind gust 💨', event: 'gust' },
  ],
  view: ({ scene, aim }) => {
    const floor = box(12, 0.1, 6, 0x111a24);
    floor.position.y = -0.05;
    scene.add(floor);
    const drone = new THREE.Group();
    const body = box(1.2, 0.25, 1.2, 0xf6821f);
    drone.add(body);
    const rotors = [-1, 1].flatMap((x) =>
      [-1, 1].map((z) => {
        const rotor = new THREE.Mesh(
          new THREE.CylinderGeometry(0.4, 0.4, 0.04, 20),
          new THREE.MeshStandardMaterial({ color: 0x71b8d8, transparent: true, opacity: 0.7 }),
        );
        rotor.position.set(x * 0.7, 0.18, z * 0.7);
        drone.add(rotor);
        return rotor;
      }),
    );
    scene.add(drone);
    aim(0, 2.5, 0);
    const target = box(3, 0.03, 0.03, 0x34d399);
    scene.add(target);
    const flame = box(0.15, 1, 0.15, 0xfbbf24);
    drone.add(flame);
    const trail: THREE.Vector3[] = [];
    const line = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x71b8d8 }));
    scene.add(line);
    let x = -5;
    return (frame: Frame, ) => {
      const heightAbove = Math.max(0.15, frame.height + 0.15);
      drone.position.set(0, heightAbove, 0);
      drone.rotation.z = Math.max(-0.4, Math.min(0.4, frame.velocity * -0.04));
      rotors.forEach((rotor, i) => {
        rotor.rotation.y += frame.thrust * 0.05 + i * 0.001;
      });
      flame.scale.y = frame.thrust / DRONE.maxThrust;
      flame.position.y = -0.2 - flame.scale.y * 0.5;
      target.position.set(0, frame.height + frame.error + 0.15, 0);
      x += DT * 1.2;
      if (x > 5) {
        x = -5;
        trail.length = 0;
      }
      trail.push(new THREE.Vector3(x, heightAbove, -1.5));
      line.geometry.setFromPoints(trail);
      const status = Math.abs(frame.error) < 0.1 ? 'holding' : frame.error > 0 ? 'climbing' : 'sinking';
      return `${status} · height ${frame.height.toFixed(2)} m · error ${frame.error.toFixed(2)} · thrust ${frame.thrust.toFixed(1)}`;
    };
  },
});
