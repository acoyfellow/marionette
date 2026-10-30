import * as THREE from 'three';
import { createSourceTable, event, input, list, state, stateBit } from 'handwired/src/runtime/cells.ts';
import { emitSelect } from 'handwired/src/runtime/numeric-ui-core.ts';
import { definePage } from '../kit';
import { box } from '../scene';
import { createTicker, DT, gates, wiresOf } from '../ticker';

export const TRACK = { length: 20, junction: 10, block: 3, speed: 3 } as const;

export function buildRailway() {
  const table = createSourceTable();
  const cells = table.declare({
    throwSwitch: event(),
    sendA: event(),
    sendB: event(),
    dt: input([0, 0.1]),
    switchToB: stateBit(0),
    trains: list(2, () => ({ position: state([0, TRACK.length + 1]), running: stateBit(0) })),
  });
  const circuit = table.createCircuit();
  const { all, not, above, below, either } = gates(circuit);
  const near = (train: { position: typeof cells.dt; running: typeof cells.dt }) =>
    all(
      train.running,
      above(train.position, TRACK.junction - TRACK.block),
      below(train.position, TRACK.junction + TRACK.block),
    );
  const [a, b] = cells.trains as [(typeof cells.trains)[0], (typeof cells.trains)[0]];
  const occupied = either(near(a), near(b));
  const refused = all(cells.throwSwitch, occupied);
  const flip = all(cells.throwSwitch, not(occupied));
  const switchToB = circuit.affine([[cells.switchToB, 1], [flip, 1], [circuit.multiply(flip, cells.switchToB), -2]]);

  const signalFor = (route: 0 | 1) => {
    const aligned = route === 1 ? cells.switchToB : not(cells.switchToB);
    const other = route === 0 ? b : a;
    return all(aligned, not(near(other)));
  };
  const signals = [signalFor(0), signalFor(1)] as const;

  const trains = ([a, b] as const).map((train, route) => {
    const send = route === 0 ? cells.sendA : cells.sendB;
    const atSignal = all(
      above(train.position, TRACK.junction - TRACK.block - 0.6),
      below(train.position, TRACK.junction - TRACK.block),
    );
    const held = all(atSignal, not(signals[route] as never));
    const running = either(all(train.running, below(train.position, TRACK.length)), send);
    const moving = all(running, not(held));
    const advanced = circuit.affine([[train.position, 1], [moving, TRACK.speed * DT]]);
    const position = emitSelect(circuit, all(send, not(train.running)), emitSelect(circuit, running, circuit.constant(0), advanced), circuit.constant(0));
    table.next(train.position, position);
    table.next(train.running, running);
    return { position, running, held };
  });
  table.next(cells.switchToB, switchToB);
  const crash = all(near(a), near(b), above(a.position, TRACK.junction - 0.5), above(b.position, TRACK.junction - 0.5));

  const output = { switchToB, occupied, refused, signalA: signals[0], signalB: signals[1], trains, crash };
  const layout = [
    { label: 'switch', wires: wiresOf({ s: cells.switchToB }) },
    { label: 'train A', wires: wiresOf(a) },
    { label: 'train B', wires: wiresOf(b) },
  ];
  return {
    ...table.finish(),
    output,
    events: { throwSwitch: cells.throwSwitch, sendA: cells.sendA, sendB: cells.sendB },
    dt: cells.dt,
    layout,
  };
}

export const createRailway = () => createTicker(buildRailway());
type Frame = ReturnType<ReturnType<typeof createRailway>['step']>;

const routePoint = (route: number, position: number) => {
  const merge = Math.min(1, Math.max(0, (position - (TRACK.junction - TRACK.block)) / TRACK.block));
  const lane = route === 0 ? -1 : 1;
  return new THREE.Vector3(position - TRACK.length / 2, 0.35, lane * 1.6 * (1 - merge));
};

export const railwayPage = definePage({
  slug: 'railway',
  title: 'railway junction',
  topic: 'interlocks · mutual exclusion',
  lesson:
    'Two tracks share one piece of rail. Send both trains. The interlock only shows green to a train whose path is set and whose block is empty. Try to throw the switch while a train is in the block: it refuses.',
  eye: [0, 11, 9],
  make: createRailway,
  controls: [
    { kind: 'button', label: 'send train A', event: 'sendA' },
    { kind: 'button', label: 'send train B', event: 'sendB' },
    { kind: 'button', label: 'throw switch', event: 'throwSwitch' },
  ],
  view: ({ scene }) => {
    const ground = box(24, 0.1, 8, 0x111a24);
    ground.position.y = -0.05;
    scene.add(ground);
    for (const route of [0, 1]) {
      const points = Array.from({ length: 41 }, (_, i) => routePoint(route, (i / 40) * TRACK.length).setY(0.03));
      scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: 0x64748b })));
    }
    const block = box(TRACK.block * 2, 0.02, 4.2, 0x1e293b);
    block.position.set(TRACK.junction - TRACK.length / 2, 0.01, 0);
    scene.add(block);
    const lamps = [0, 1].map((route) => {
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.45, 16, 12), new THREE.MeshStandardMaterial({ color: 0xef4444 }));
      lamp.position.copy(routePoint(route, TRACK.junction - TRACK.block - 0.3)).setY(1.2);
      scene.add(lamp);
      return lamp;
    });
    const lever = box(0.2, 1.2, 0.2, 0xf6821f);
    lever.position.set(TRACK.junction - TRACK.length / 2, 0.6, -3);
    scene.add(lever);
    const trains = [0xf6821f, 0x71b8d8].map((color) => {
      const train = box(1.6, 0.6, 0.8, color);
      scene.add(train);
      return train;
    });
    let refusedFlash = 0;
    return (frame: Frame) => {
      lamps.forEach((lamp, route) => {
        const green = (route === 0 ? frame.signalA : frame.signalB) === 1;
        lamp.material.color.setHex(green ? 0x34d399 : 0xef4444);
        lamp.material.emissive.setHex(green ? 0x0f5132 : 0x3f0d0d);
      });
      lever.rotation.z = frame.switchToB === 1 ? -0.5 : 0.5;
      refusedFlash = frame.refused === 1 ? 1 : Math.max(0, refusedFlash - DT * 1.5);
      block.material.color.setHex(refusedFlash > 0 ? 0x7f1d1d : frame.occupied === 1 ? 0x334155 : 0x1e293b);
      frame.trains.forEach((train, route) => {
        const mesh = trains[route];
        if (mesh === undefined) return;
        mesh.visible = train.running === 1;
        const here = routePoint(route, train.position);
        const ahead = routePoint(route, train.position + 0.2);
        mesh.position.copy(here);
        mesh.rotation.y = -Math.atan2(ahead.z - here.z, ahead.x - here.x);
      });
      if (refusedFlash > 0) return 'switch refused: a train is in the block';
      const held = frame.trains.some((train) => train.held === 1);
      return `switch → ${frame.switchToB === 1 ? 'B' : 'A'} · block ${frame.occupied === 1 ? 'occupied' : 'clear'}${held ? ' · a train waits at red' : ''}`;
    };
  },
});
