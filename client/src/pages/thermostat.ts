import * as THREE from 'three';
import { createSourceTable, event, input, state, stateBit } from 'handwired/src/runtime/cells.ts';
import { definePage } from '../kit';
import { box } from '../scene';
import { createTicker, DT, gates, wiresOf } from '../ticker';

export const ROOM = { outside: 5, leak: 0.05, windowLeak: 0.5, heater: 2.5, cooler: 2.5 } as const;

export function buildThermostat() {
  const table = createSourceTable();
  const cells = table.declare({
    window: event(),
    dt: input([0, 0.1]),
    target: input([10, 30], { initial: 21 }),
    band: input([0, 4]),
    outside: input([-10, 40]),
    temp: state([-20, 60], { initial: 15 }),
    heating: stateBit(0),
    cooling: stateBit(0),
    windowOpen: stateBit(0),
    switches: state([0, 1e6]),
  });
  const circuit = table.createCircuit();
  const { all, not, above, below, either } = gates(circuit);
  const flip = circuit.affine([[cells.windowOpen, 1], [cells.window, 1], [circuit.multiply(cells.window, cells.windowOpen), -2]]);
  const half = circuit.affine([[cells.band, 0.5]]);
  const low = circuit.affine([[cells.target, 1], [half, -1]]);
  const high = circuit.affine([[cells.target, 1], [half, 1]]);
  const tooCold = below(circuit.affine([[cells.temp, 1], [low, -1]]), 0);
  const warmEnough = above(circuit.affine([[cells.temp, 1], [cells.target, -1]]), 0);
  const tooHot = above(circuit.affine([[cells.temp, 1], [high, -1]]), 0);
  const coolEnough = below(circuit.affine([[cells.temp, 1], [cells.target, -1]]), 0);
  const heating = either(tooCold, all(cells.heating, not(warmEnough)));
  const cooling = either(tooHot, all(cells.cooling, not(coolEnough)));
  const leak = circuit.affine([[flip, ROOM.windowLeak - ROOM.leak]], ROOM.leak);
  const drift = circuit.multiply(leak, circuit.affine([[cells.outside, 1], [cells.temp, -1]]));
  const temp = circuit.affine([[cells.temp, 1], [drift, DT], [heating, ROOM.heater * DT], [cooling, -ROOM.cooler * DT]]);
  const changed = either(
    above(circuit.affine([[heating, 1], [cells.heating, -1]]), 0),
    above(circuit.affine([[cooling, 1], [cells.cooling, -1]]), 0),
  );
  table.next(cells.temp, temp);
  table.next(cells.heating, heating);
  table.next(cells.cooling, cooling);
  table.next(cells.windowOpen, flip);
  table.next(cells.switches, circuit.affine([[cells.switches, 1], [changed, 1]]));
  const output = { temp, heating, cooling, windowOpen: flip, low, high, switches: cells.switches, target: cells.target };
  const layout = [
    { label: 'room', wires: wiresOf({ t: cells.temp, w: cells.windowOpen }) },
    { label: 'unit', wires: wiresOf({ h: cells.heating, c: cells.cooling, s: cells.switches }) },
  ];
  return {
    ...table.finish(),
    output,
    events: { window: cells.window },
    inputs: { target: cells.target, band: cells.band, outside: cells.outside },
    dt: cells.dt,
    layout,
  };
}

export const createThermostat = () => createTicker(buildThermostat());
type Frame = ReturnType<ReturnType<typeof createThermostat>['step']>;

export const thermostatPage = definePage({
  slug: 'thermostat',
  title: 'thermostat',
  topic: 'hysteresis · deadband',
  lesson:
    'The heater turns on below the band and stays on until the room passes the target. Shrink the band to 0 and count how often it clicks on and off: that is why every real thermostat has a band. Open the window to fight it.',
  eye: [0, 5, 9],
  make: createThermostat,
  controls: [
    { kind: 'slider', label: 'target °C', input: 'target', min: 14, max: 28, step: 0.5, initial: 21 },
    { kind: 'slider', label: 'band', input: 'band', min: 0, max: 4, step: 0.1, initial: 2 },
    { kind: 'slider', label: 'outside °C', input: 'outside', min: -10, max: 40, step: 1, initial: ROOM.outside },
    { kind: 'button', label: 'open / close window', event: 'window' },
  ],
  view: ({ scene }) => {
    const floor = box(6, 0.1, 5, 0x334155);
    scene.add(floor);
    const wall = box(6, 3, 0.1, 0x1e293b);
    wall.position.set(0, 1.5, -2.5);
    scene.add(wall);
    const pane = box(1.6, 1.2, 0.12, 0x71b8d8);
    pane.position.set(-1.5, 1.8, -2.45);
    scene.add(pane);
    const heater = box(1.4, 0.7, 0.3, 0x475569);
    heater.position.set(1.5, 0.45, -2.2);
    scene.add(heater);
    const air = new THREE.Mesh(new THREE.BoxGeometry(5.8, 2.8, 4.8), new THREE.MeshStandardMaterial({ color: 0x71b8d8, transparent: true, opacity: 0.12 }));
    air.position.y = 1.5;
    scene.add(air);
    const mercury = box(0.18, 1, 0.18, 0xef4444);
    scene.add(mercury);
    const tube = box(0.3, 3, 0.3, 0x1f2937);
    tube.position.set(2.7, 1.6, 0);
    scene.add(tube);
    return (frame: Frame) => {
      const t = Math.max(0, Math.min(1, (frame.temp - 5) / 30));
      (air.material as THREE.MeshStandardMaterial).color.setRGB(0.3 + t * 0.7, 0.45, 1 - t * 0.7);
      (heater.material as THREE.MeshStandardMaterial).color.setHex(frame.heating === 1 ? 0xf97316 : frame.cooling === 1 ? 0x38bdf8 : 0x475569);
      (heater.material as THREE.MeshStandardMaterial).emissive.setHex(frame.heating === 1 ? 0x7c2d12 : frame.cooling === 1 ? 0x0c4a6e : 0);
      pane.rotation.y = frame.windowOpen === 1 ? 1.2 : 0;
      mercury.scale.y = Math.max(0.05, t * 2.8);
      mercury.position.set(2.7, 0.1 + mercury.scale.y / 2, 0.2);
      const mode = frame.heating === 1 ? 'heating 🔥' : frame.cooling === 1 ? 'cooling ❄️' : 'idle';
      return `${frame.temp.toFixed(1)} °C · ${mode} · band ${frame.low.toFixed(1)}–${frame.high.toFixed(1)} · clicks ${frame.switches}`;
    };
  },
});
