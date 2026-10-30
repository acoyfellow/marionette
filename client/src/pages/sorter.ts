import * as THREE from 'three';
import { createSourceTable, event, input, list, state, stateBit } from 'handwired/src/runtime/cells.ts';
import { emitSelect } from 'handwired/src/runtime/numeric-ui-core.ts';
import { definePage } from '../kit';
import { box } from '../scene';
import { createTicker, DT, gates, wiresOf } from '../ticker';

export const BELT = { length: 12, sensor: 3, gates: [6, 9], speed: 2, slots: 6 } as const;
export const KIND = { small: 0, big: 1 } as const;

export function buildSorter() {
  const table = createSourceTable();
  const cells = table.declare({
    dropSmall: event(),
    dropBig: event(),
    dt: input([0, 0.1]),
    running: stateBit(1),
    stop: event(),
    nextSlot: state([0, BELT.slots - 1]),
    boxes: list(BELT.slots, () => ({ position: state([-1, BELT.length + 1], { initial: -1 }), big: stateBit(0), lane: state([0, 2]) })),
    sorted: list(3, () => state([0, 1e6])),
  });
  const circuit = table.createCircuit();
  const { all, not, is, above, below, either } = gates(circuit);
  const running = circuit.affine([[cells.running, 1], [cells.stop, 1], [circuit.multiply(cells.stop, cells.running), -2]]);
  const drop = either(cells.dropSmall, cells.dropBig);
  const boxes = cells.boxes.map((each, i) => {
    const mine = all(drop, is(cells.nextSlot, i));
    const onBelt = above(each.position, -0.5);
    const atSensor = all(onBelt, above(each.position, BELT.sensor - 0.05), below(each.position, BELT.sensor + 0.05));
    const big = emitSelect(circuit, mine, emitSelect(circuit, atSensor, each.big, each.big), cells.dropBig);
    const seen = above(each.position, BELT.sensor);
    const lane = emitSelect(circuit, seen, circuit.constant(0), circuit.affine([[big, 1]], 1));
    const gateHere = (g: 0 | 1) => all(above(each.position, (BELT.gates[g] ?? 0) - 0.05), below(each.position, BELT.gates[g] ?? 0));
    const pushed = either(all(gateHere(0), is(lane, 1)), all(gateHere(1), is(lane, 2)));
    const atEnd = above(each.position, BELT.length);
    const leaving = either(pushed, atEnd);
    const moved = circuit.affine([[each.position, 1], [circuit.multiply(running, onBelt), BELT.speed * DT]]);
    const position = emitSelect(circuit, mine, emitSelect(circuit, leaving, moved, circuit.constant(-1)), circuit.constant(0));
    table.next(each.position, position);
    table.next(each.big, big);
    table.next(each.lane, lane);
    return { position, big, lane, pushed, atEnd, onBelt };
  });
  cells.sorted.forEach((count, bin) => {
    const arrivals = boxes.map((each) =>
      bin === 0 ? each.atEnd : all(each.pushed, is(each.lane, bin)),
    );
    table.next(count, circuit.affine([[count, 1], ...arrivals.map((bit) => [bit, 1] as const)]));
  });
  const wrapped = circuit.affine([[cells.nextSlot, 1]], 1);
  table.next(cells.nextSlot, emitSelect(circuit, drop, cells.nextSlot, emitSelect(circuit, above(wrapped, BELT.slots - 1), wrapped, circuit.constant(0))));
  table.next(cells.running, running);
  const gateOpen = [0, 1].map((g) =>
    boxes.map((each) => all(each.onBelt, is(each.lane, g + 1), above(each.position, (BELT.gates[g] ?? 0) - 1.2))).reduce((a, b) => either(a, b)),
  );
  void not;
  const output = { boxes, sorted: cells.sorted, running, gateOpen };
  const layout = [
    { label: 'belt', wires: wiresOf({ r: cells.running, n: cells.nextSlot }) },
    ...cells.boxes.map((each, i) => ({ label: `box ${i + 1}`, wires: wiresOf(each) })),
    { label: 'bins', wires: wiresOf(cells.sorted) },
  ];
  return {
    ...table.finish(),
    output,
    events: { dropSmall: cells.dropSmall, dropBig: cells.dropBig, stop: cells.stop },
    dt: cells.dt,
    layout,
  };
}

export const createSorter = () => createTicker(buildSorter());
type Frame = ReturnType<ReturnType<typeof createSorter>['step']>;

const X = (position: number) => position - BELT.length / 2;

export const sorterPage = definePage({
  slug: 'sorter',
  title: 'conveyor sorter',
  topic: 'PLC ladder logic · scan cycles',
  lesson:
    'Factories run like this: a fixed program reads every sensor and sets every output, about 60 times a second, forever. The sensor measures each box, and the right paddle kicks it into its bin. Small boxes go to bin 1, big ones to bin 2.',
  eye: [0, 9, 8],
  make: createSorter,
  controls: [
    { kind: 'button', label: 'drop small box', event: 'dropSmall' },
    { kind: 'button', label: 'drop big box', event: 'dropBig' },
    { kind: 'button', label: 'stop / start belt', event: 'stop' },
  ],
  view: ({ scene }) => {
    const belt = box(BELT.length + 1, 0.2, 1.4, 0x334155);
    belt.position.set(0, 0.4, 0);
    scene.add(belt);
    const sensor = box(0.1, 1.6, 0.1, 0xef4444);
    sensor.position.set(X(BELT.sensor), 1.1, -0.9);
    scene.add(sensor);
    const paddles = BELT.gates.map((g) => {
      const paddle = box(0.15, 0.6, 1.3, 0xf6821f);
      paddle.position.set(X(g), 0.8, -0.9);
      scene.add(paddle);
      return paddle;
    });
    const bins = [...BELT.gates.map((g) => [X(g), 1.9] as const), [X(BELT.length) + 1.2, 0] as const].map(([x, z]) => {
      const bin = box(1.4, 0.6, 1.2, 0x1e293b);
      bin.position.set(x, 0.3, z);
      scene.add(bin);
      return bin;
    });
    const meshes = Array.from({ length: BELT.slots }, () => {
      const mesh = box(0.6, 0.6, 0.6, 0x71b8d8);
      scene.add(mesh);
      return mesh;
    });
    return (frame: Frame) => {
      frame.boxes.forEach((each, i) => {
        const mesh = meshes[i];
        if (mesh === undefined) return;
        mesh.visible = each.onBelt === 1;
        const size = each.big === 1 ? 1.4 : 0.8;
        mesh.scale.setScalar(size);
        mesh.position.set(X(each.position), 0.5 + 0.3 * size, 0);
        (mesh.material as THREE.MeshStandardMaterial).color.setHex(
          each.lane === 0 ? 0x94a3b8 : each.lane === 1 ? 0x71b8d8 : 0xf6821f,
        );
      });
      paddles.forEach((paddle, g) => {
        paddle.position.z = frame.gateOpen[g] === 1 ? -0.2 : -0.9;
      });
      (sensor.material as THREE.MeshStandardMaterial).emissive.setHex(
        frame.boxes.some((each) => each.onBelt === 1 && Math.abs(each.position - BELT.sensor) < 0.4) ? 0x7f1d1d : 0,
      );
      void bins;
      const [end, small, big] = frame.sorted;
      return `${frame.running === 1 ? 'belt running' : 'belt stopped'} · bin 1: ${small} small · bin 2: ${big} big · missed: ${end}`;
    };
  },
});
