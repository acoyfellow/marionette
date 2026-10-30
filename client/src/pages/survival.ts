import * as THREE from 'three';
import { createSourceTable, event, input, state, stateBit } from 'handwired/src/runtime/cells.ts';
import { emitMinimum, emitRelu, emitSelect } from 'handwired/src/runtime/numeric-ui-core.ts';
import { definePage } from '../kit';
import { box } from '../scene';
import { createTicker, DT, gates, wiresOf } from '../ticker';

export const SURVIVAL = {
  perInstance: 12,
  maxInstances: 8,
  warmup: 2,
  cooldown: 3,
  breakerOpen: 4,
  spike: 60,
  spikeLength: 2.5,
} as const;

export function buildSurvival() {
  const table = createSourceTable();
  const cells = table.declare({
    spike: event(),
    dt: input([0, 0.1]),
    load: input([0, 100]),
    instances: state([1, SURVIVAL.maxInstances], { initial: 1 }),
    warming: state([0, SURVIVAL.warmup]),
    cooldown: state([0, SURVIVAL.cooldown]),
    spikeLeft: state([0, SURVIVAL.spikeLength]),
    errors: state([0, 1]),
    open: stateBit(0),
    openLeft: state([0, SURVIVAL.breakerOpen]),
  });
  const circuit = table.createCircuit();
  const { all, not, above, below, either, atLeast } = gates(circuit);
  const c = (k: number) => circuit.constant(k);
  const tick = (wire: typeof cells.warming) => emitRelu(circuit, circuit.affine([[wire, 1], [cells.dt, -1]]));

  const spikeDecay = tick(cells.spikeLeft);
  const spikeLeft = emitSelect(circuit, cells.spike, spikeDecay, c(SURVIVAL.spikeLength));
  const demand = circuit.affine([[cells.load, 1], [above(cells.spikeLeft, 0), SURVIVAL.spike]]);
  const capacity = circuit.affine([[cells.instances, SURVIVAL.perInstance]]);
  const hot = atLeast(demand, circuit.affine([[cells.instances, SURVIVAL.perInstance * 0.7]]));
  const cold = below(circuit.affine([[demand, 1], [cells.instances, -SURVIVAL.perInstance * 0.3]]), 0);

  const idle = all(not(above(cells.cooldown, 0)), not(above(cells.warming, 0)));
  const startWarm = all(hot, idle, below(cells.instances, SURVIVAL.maxInstances));
  const warmDecay = tick(cells.warming);
  const arrive = all(above(cells.warming, 0), not(above(warmDecay, 0)));
  const shrink = all(cold, idle, above(cells.instances, 1));
  const instances = circuit.affine([[cells.instances, 1], [arrive, 1], [shrink, -1]]);
  const warming = emitSelect(circuit, startWarm, warmDecay, c(SURVIVAL.warmup));
  const cooldown = emitSelect(circuit, either(arrive, shrink), tick(cells.cooldown), c(SURVIVAL.cooldown));

  const closed = not(cells.open);
  const overloaded = all(closed, above(circuit.affine([[demand, 1], [capacity, -1]]), 0));
  const errors = circuit.affine([[cells.errors, 0.97], [overloaded, 0.03]]);
  const trip = all(closed, above(errors, 0.5));
  const openDecay = tick(cells.openLeft);
  const open = either(trip, all(cells.open, above(openDecay, 0)));
  const openLeft = emitSelect(circuit, trip, openDecay, c(SURVIVAL.breakerOpen));
  const served = circuit.multiply(not(open), emitMinimum(circuit, demand, capacity));
  const dropped = emitRelu(circuit, circuit.affine([[demand, 1], [served, -1]]));

  table.next(cells.instances, instances);
  table.next(cells.warming, warming);
  table.next(cells.cooldown, cooldown);
  table.next(cells.spikeLeft, spikeLeft);
  table.next(cells.errors, errors);
  table.next(cells.open, open);
  table.next(cells.openLeft, openLeft);

  const output = { demand, capacity, instances, warming, served, dropped, errors, open, hot };
  const layout = [
    { label: 'fleet', wires: wiresOf({ i: cells.instances, w: cells.warming, c: cells.cooldown }) },
    { label: 'breaker', wires: wiresOf({ e: cells.errors, o: cells.open, t: cells.openLeft }) },
    { label: 'traffic', wires: wiresOf({ s: cells.spikeLeft }) },
  ];
  return {
    ...table.finish(),
    output,
    events: { spike: cells.spike },
    inputs: { load: cells.load },
    dt: cells.dt,
    layout,
  };
}

export const createSurvival = () => createTicker(buildSurvival());
type Frame = ReturnType<ReturnType<typeof createSurvival>['step']>;

export const survivalPage = definePage({
  slug: 'survival',
  title: 'workers survival',
  topic: 'autoscaling · circuit breakers',
  lesson:
    'Drag the traffic up. Past 70% busy, a new server starts, but it needs 2 s to warm up. Hit the spike: if errors stay high, the breaker trips and sheds load for 4 s so the fleet can recover.',
  eye: [0, 7, 11],
  make: createSurvival,
  controls: [
    { kind: 'slider', label: 'traffic', input: 'load', min: 0, max: 90, step: 1, initial: 8 },
    { kind: 'button', label: 'traffic spike ⚡', event: 'spike' },
  ],
  view: ({ scene }) => {
    const servers = Array.from({ length: SURVIVAL.maxInstances }, (_, i) => {
      const server = box(0.8, 1.4, 0.8, 0x1f2937);
      server.position.set(-3.5 + i, 0.7, -1.5);
      scene.add(server);
      return server;
    });
    const gate = box(0.2, 1.6, 3, 0x34d399);
    gate.position.set(-5.5, 0.8, 1);
    scene.add(gate);
    const floor = box(14, 0.1, 8, 0x111a24);
    floor.position.y = -0.05;
    scene.add(floor);
    const dots = Array.from({ length: 60 }, (_, i) => {
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshStandardMaterial({ color: 0x71b8d8 }));
      dot.userData.offset = i / 60;
      scene.add(dot);
      return dot;
    });
    let t = 0;
    return (frame: Frame) => {
      t += DT;
      servers.forEach((server, i) => {
        const active = i < frame.instances;
        const warming = i === frame.instances && frame.warming > 0;
        const color = active ? (frame.hot === 1 ? 0xfbbf24 : 0xf6821f) : warming ? 0x854d0e : 0x1f2937;
        (server.material as THREE.MeshStandardMaterial).color.setHex(color);
        server.scale.y = warming ? 0.4 + 0.6 * (1 - frame.warming / SURVIVAL.warmup) : 1;
        server.position.y = server.scale.y * 0.7;
      });
      (gate.material as THREE.MeshStandardMaterial).color.setHex(frame.open === 1 ? 0xef4444 : 0x34d399);
      gate.rotation.z = frame.open === 1 ? Math.PI / 2.4 : 0;
      const visible = Math.round((frame.demand / 150) * dots.length);
      const droppedShare = frame.demand > 0 ? frame.dropped / frame.demand : 0;
      dots.forEach((dot, i) => {
        const phase = (t * 0.5 + dot.userData.offset) % 1;
        const dropped = i / dots.length < droppedShare;
        dot.visible = i < visible;
        dot.position.set(-7 + phase * 10, 0.3 + (dropped ? -phase * 0.8 + 0.4 : 0.2), 1 + ((i * 7) % 5) * 0.25 - 0.5);
        (dot.material as THREE.MeshStandardMaterial).color.setHex(dropped ? 0xef4444 : 0x71b8d8);
      });
      const state = frame.open === 1 ? 'breaker OPEN: shedding load' : frame.warming > 0 ? 'cold start…' : 'serving';
      return `${Math.round(frame.demand)} req/s · ${frame.instances} servers · ${state}`;
    };
  },
});
