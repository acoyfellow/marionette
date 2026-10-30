import {
  advanceFrame,
  defaultSpringClockConfig,
  type SpringClock,
  springMatrixBound,
  springMatrixPower,
  springStepMatrix,
  stoppedSpringClock,
} from 'handwired/src/runtime/host-timing.ts';
import {
  createEvaluator,
  createSourceTable,
  event,
  input,
  list,
  state,
  stateBit,
  type WireValues,
} from 'handwired/src/runtime/cells.ts';
import {
  emitAnimatedObject,
  emitCompare,
  emitSelect,
  type Wire,
} from 'handwired/src/runtime/numeric-ui-core.ts';

export const GRID = 3;
export const COUNT = GRID * GRID;
export const SPACING = 2;
export const HALF = 0.6;
export const FLOOR = 6;
export const LIFT = 1.2;
export const GROW = 0.35;

const springs = { stiffness: 260, damping: 22 };
const bound = springMatrixBound(springs);
const matrixEntry = input([-bound, bound]);
const floorCoordinate = () => input([-FLOOR, FLOOR], { grid: 1 / 64 });
const home = (index: number) => ({
  x: (index % GRID) * SPACING - SPACING,
  z: Math.floor(index / GRID) * SPACING - SPACING,
});

const axis = (initial: number, span: number) => ({
  displacement: state([-span, span]),
  velocity: state([-40 * span, 40 * span]),
  destination: state([-span, span], { initial }),
});

export const cubeCells = (index: number) => ({
  selected: stateBit(0),
  x: axis(home(index).x, 2 * FLOOR),
  z: axis(home(index).z, 2 * FLOOR),
  lift: axis(0, 2 * LIFT),
});

export const stageCells = {
  pointer: { x: floorCoordinate(), z: floorCoordinate() },
  down: event(),
  up: event(),
  dragging: stateBit(0),
  grabX: state([-2 * FLOOR, 2 * FLOOR]),
  grabZ: state([-2 * FLOOR, 2 * FLOOR]),
  springMatrix: [matrixEntry, matrixEntry, matrixEntry, matrixEntry] as const,
  settleCheck: input([0, 1]),
  snap: input([0, 1]),
  cubes: list(COUNT, cubeCells),
};

export function buildStage() {
  const table = createSourceTable();
  const cells = table.declare(stageCells);
  const circuit = table.createCircuit();

  const all = (...bits: Wire[]) =>
    circuit.reglu(
      [],
      1,
      bits.map((bit) => [bit, 1] as const),
      1 - bits.length,
    );
  const not = (bit: Wire) => circuit.affine([[bit, -1]], 1);
  const sum = (wires: readonly Wire[]) => circuit.affine(wires.map((wire) => [wire, 1] as const));
  const within = (point: Wire, center: Wire) =>
    all(
      emitCompare(circuit, point, '>=', circuit.affine([[center, 1]], -HALF)),
      emitCompare(circuit, point, '<', circuit.affine([[center, 1]], HALF)),
    );

  const hits = cells.cubes.map((cube) =>
    all(
      within(cells.pointer.x, cube.x.destination),
      within(cells.pointer.z, cube.z.destination),
    ),
  );

  const firstHit = hits.map((hit, index) => all(hit, ...hits.slice(0, index).map(not)));
  const anyHit = sum(firstHit);
  const pressedCube = firstHit.map((hit) => all(cells.down, hit));
  const pressedEmpty = all(cells.down, not(anyHit));

  const selectedAfterDown = cells.cubes.map((cube, index) =>
    emitSelect(
      circuit,
      pressedEmpty,
      emitSelect(circuit, all(cells.down, anyHit), cube.selected, pressedCube[index] as Wire),
      circuit.constant(0),
    ),
  );

  const grabbedSelected = sum(
    cells.cubes.map((_, index) => all(pressedCube[index] as Wire, selectedAfterDown[index] as Wire)),
  );
  const startsDrag = all(cells.down, grabbedSelected);
  const dragging = all(emitSelect(circuit, startsDrag, cells.dragging, circuit.constant(1)), not(cells.up));

  const selectedCubeX = sum(
    cells.cubes.map((cube, index) =>
      circuit.reglu([[cube.x.destination, 1]], 0, [[selectedAfterDown[index] as Wire, 1]], 0),
    ),
  );
  const selectedCubeZ = sum(
    cells.cubes.map((cube, index) =>
      circuit.reglu([[cube.z.destination, 1]], 0, [[selectedAfterDown[index] as Wire, 1]], 0),
    ),
  );
  const grabX = emitSelect(
    circuit,
    startsDrag,
    cells.grabX,
    circuit.affine([
      [selectedCubeX, 1],
      [cells.pointer.x, -1],
    ]),
  );
  const grabZ = emitSelect(
    circuit,
    startsDrag,
    cells.grabZ,
    circuit.affine([
      [selectedCubeZ, 1],
      [cells.pointer.z, -1],
    ]),
  );
  const targetX = circuit.affine([
    [cells.pointer.x, 1],
    [grabX, 1],
  ]);
  const targetZ = circuit.affine([
    [cells.pointer.z, 1],
    [grabZ, 1],
  ]);

  const outputs = cells.cubes.map((cube, index) => {
    const selected = selectedAfterDown[index] as Wire;
    const moving = all(dragging, selected);
    const destinationX = emitSelect(circuit, moving, cube.x.destination, targetX);
    const destinationZ = emitSelect(circuit, moving, cube.z.destination, targetZ);
    const destinationLift = circuit.affine([[selected, LIFT]]);

    const motion = emitAnimatedObject(
      circuit,
      [
        {
          matrix: cells.springMatrix,
          displacement: cube.x.displacement,
          velocity: cube.x.velocity,
          destination: destinationX,
          destinationDuringSteps: cube.x.destination,
        },
        {
          matrix: cells.springMatrix,
          displacement: cube.z.displacement,
          velocity: cube.z.velocity,
          destination: destinationZ,
          destinationDuringSteps: cube.z.destination,
        },
        {
          matrix: cells.springMatrix,
          displacement: cube.lift.displacement,
          velocity: cube.lift.velocity,
          destination: destinationLift,
          destinationDuringSteps: cube.lift.destination,
        },
      ],
      { settleCheck: cells.settleCheck, snap: cells.snap },
    );

    table.next(cube.selected, selected);
    table.next(cube.x, {
      displacement: motion.displacements[0] as Wire,
      velocity: motion.velocities[0] as Wire,
      destination: destinationX,
    });
    table.next(cube.z, {
      displacement: motion.displacements[1] as Wire,
      velocity: motion.velocities[1] as Wire,
      destination: destinationZ,
    });
    table.next(cube.lift, {
      displacement: motion.displacements[2] as Wire,
      velocity: motion.velocities[2] as Wire,
      destination: destinationLift,
    });

    return {
      x: motion.positions[0] as Wire,
      z: motion.positions[1] as Wire,
      lift: motion.positions[2] as Wire,
      hovered: firstHit[index] as Wire,
      selected,
      active: motion.active,
    };
  });

  table.next(cells.dragging, dragging);
  table.next(cells.grabX, grabX);
  table.next(cells.grabZ, grabZ);

  const output = {
    cubes: outputs,
    dragging,
    active: sum(outputs.map((cube) => cube.active)),
  };

  return { cells, output, ...table.finish() };
}

export type StageOutput = WireValues<ReturnType<typeof buildStage>['output']>;

export type StageEvent = {
  readonly kind: 'down' | 'up' | 'move';
  readonly x: number;
  readonly z: number;
  readonly timeStamp: number;
};

export const quantize = (value: number) =>
  Math.min(FLOOR, Math.max(-FLOOR, Math.round(value * 64) / 64));

export type Puppeteer = {
  readonly queue: (event: StageEvent) => void;
  readonly step: (frameTime: number) => StageOutput;
  readonly animating: () => boolean;
  readonly size: { readonly cells: number; readonly operations: number };
  readonly snapshot: () => Float32Array;
  readonly journal: () => readonly JournalEntry[];
  readonly layout: readonly CellGroup[];
};

export type JournalEntry = { readonly frameTime: number; readonly events: readonly StageEvent[] };

export type CellGroup = { readonly label: string; readonly wires: readonly number[] };

const wiresOf = (value: unknown): number[] =>
  typeof value === 'number' ? [value] : Object.values(value as object).flatMap(wiresOf);

function layoutOf(cells: ReturnType<typeof buildStage>['cells']): CellGroup[] {
  const { cubes, ...stage } = cells;
  return [
    { label: 'stage', wires: wiresOf(stage) },
    ...cubes.map((cube, index) => ({ label: `cube ${index + 1}`, wires: wiresOf(cube) })),
  ];
}

export function replay(entries: readonly JournalEntry[]): Float32Array {
  const fresh = createPuppeteer();
  for (const entry of entries) {
    entry.events.forEach(fresh.queue);
    fresh.step(entry.frameTime);
  }
  return fresh.snapshot();
}

export const identical = (a: Float32Array, b: Float32Array) =>
  a.length === b.length && a.every((value, index) => Object.is(value, b[index]));

export function createPuppeteer(): Puppeteer {
  const built = buildStage();
  const { cells } = built;
  const evaluate = createEvaluator(built);
  const matrices = Array.from({ length: defaultSpringClockConfig.maxStepsPerFrame + 1 }, (_, steps) =>
    springMatrixPower(springStepMatrix(springs), steps),
  );
  const source = new Float32Array(built.initialSource);
  const copy = new Float32Array(source.length);
  let clock: SpringClock = stoppedSpringClock;
  let queued: StageEvent[] = [];
  let pointer = { x: 0, z: 0 };
  let last: StageOutput | undefined;
  const entries: JournalEntry[] = [];

  return {
    queue: (incoming) => {
      queued.push(incoming);
    },
    animating: () => clock.animatedUntilMs !== null,
    snapshot: () => new Float32Array(source),
    journal: () => entries,
    layout: layoutOf(cells),
    size: { cells: source.length, operations: built.circuit.roundingPoints().length },
    step: (frameTime) => {
      entries.push({ frameTime, events: queued });
      clock = advanceFrame(
        clock,
        frameTime,
        queued,
        (evaluation) => {
          const values = evaluation.writesBack ? source : copy;
          if (!evaluation.writesBack) copy.set(source);
          const matrix = matrices[evaluation.steps] ?? matrices[0];
          cells.springMatrix.forEach((wire, index) => {
            values[wire] = matrix?.[index] ?? 0;
          });
          values[cells.settleCheck] = evaluation.settleCheck ? 1 : 0;
          values[cells.snap] = evaluation.snap ? 1 : 0;
          for (const each of evaluation.events) {
            pointer = { x: each.x, z: each.z };
            if (each.kind === 'down') values[cells.down] = 1;
            if (each.kind === 'up') values[cells.up] = 1;
          }
          values[cells.pointer.x] = pointer.x;
          values[cells.pointer.z] = pointer.z;
          const result = evaluate(values);
          if (evaluation.writesBack) source.set(result.nextValues);
          last = result.output;
          return result.output.active > 0;
        },
        'events and settle checks',
      );
      queued = [];
      return last ?? evaluate(source).output;
    },
  };
}
