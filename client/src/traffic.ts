import { createSourceTable, event, input, state, stateBit } from 'handwired/src/runtime/cells.ts';
import { emitSelect, type Wire } from 'handwired/src/runtime/numeric-ui-core.ts';
import { createTicker, DT, gates, wiresOf } from './ticker';

export const PHASE = { mainGreen: 0, mainYellow: 1, crossGreen: 2, crossYellow: 3, walk: 4 } as const;
export const DURATION = [5, 1.5, 5, 1.5, 4] as const;
export const LANE = 12;
export const STOP = -2;
export const CRUISE = 4;
export const CARS = [
  { road: 'main', start: -9 },
  { road: 'main', start: 3 },
  { road: 'cross', start: -6 },
  { road: 'cross', start: 6 },
] as const;

const car = (start: number) => ({
  position: state([-LANE - 1, LANE + 1], { initial: start }),
  speed: state([0, CRUISE + 1], { initial: CRUISE }),
});

export function buildTraffic() {
  const table = createSourceTable();
  const cells = table.declare({
    press: event(),
    dt: input([0, 0.1]),
    phase: state([0, 4]),
    timer: state([0, 10]),
    request: stateBit(0),
    cars: CARS.map((each) => car(each.start)),
  });
  const circuit = table.createCircuit();
  const { all, not, is, atLeast, above, either } = gates(circuit);
  const c = (k: number) => circuit.constant(k);

  const phaseIs = DURATION.map((_, k) => is(cells.phase, k));
  const duration = circuit.affine(phaseIs.map((bit, k) => [bit, DURATION[k] ?? 0] as const));
  const ticked = circuit.affine([
    [cells.timer, 1],
    [cells.dt, 1],
  ]);
  const done = atLeast(ticked, duration);
  const request = either(cells.request, cells.press);
  const afterYellow = circuit.reglu([[request, 2]], 2, [[phaseIs[1] as Wire, 1]], 0);
  const nextPhase = circuit.affine([
    [phaseIs[0] as Wire, 1],
    [afterYellow, 1],
    [phaseIs[2] as Wire, 3],
    [phaseIs[4] as Wire, 2],
  ]);
  const phase = emitSelect(circuit, done, cells.phase, nextPhase);
  const timer = emitSelect(circuit, done, ticked, c(0));
  const enteringWalk = all(done, phaseIs[1] as Wire, request);
  table.next(cells.phase, phase);
  table.next(cells.timer, timer);
  table.next(cells.request, all(request, not(enteringWalk)));

  const red = (...phases: number[]) => circuit.affine(phases.map((k) => [phaseIs[k] as Wire, 1] as const));
  const mainLight = circuit.affine([
    [phaseIs[1] as Wire, 1],
    [red(2, 3, 4), 2],
  ]);
  const crossLight = circuit.affine([
    [phaseIs[3] as Wire, 1],
    [red(0, 1, 4), 2],
  ]);
  const greenFor = { main: phaseIs[0] as Wire, cross: phaseIs[2] as Wire };

  const cars = cells.cars.map((each, index) => {
    const road = CARS[index]?.road ?? 'main';
    const gap = circuit.affine([[each.position, -1]], STOP);
    const beforeLine = above(gap, 0);
    const brakeTo = circuit.affine([[gap, 1.6]]);
    const braking = emitSelect(circuit, above(brakeTo, CRUISE), brakeTo, c(CRUISE));
    const mustStop = all(beforeLine, not(greenFor[road]));
    const wanted = emitSelect(circuit, mustStop, c(CRUISE), emitSelect(circuit, above(braking, 0), c(0), braking));
    const speed = circuit.affine([
      [each.speed, 0.88],
      [wanted, 0.12],
    ]);
    const moved = circuit.affine([
      [each.position, 1],
      [speed, DT],
    ]);
    const position = emitSelect(circuit, above(moved, LANE), moved, circuit.affine([[moved, 1]], -2 * LANE));
    table.next(each.position, position);
    table.next(each.speed, speed);
    return { position, speed, waiting: all(mustStop, not(above(speed, 0.2))) };
  });

  const output = { phase, mainLight, crossLight, walk: phaseIs[4] as Wire, request, timer, cars };
  const { cars: carCells, ...controller } = cells;
  const layout = [
    { label: 'signal', wires: wiresOf({ phase: controller.phase, timer: controller.timer, request: controller.request }) },
    ...carCells.map((each, index) => ({ label: `car ${index + 1}`, wires: wiresOf(each) })),
  ];
  return { ...table.finish(), output, events: { press: cells.press }, dt: cells.dt, layout };
}

export const createTraffic = () => createTicker(buildTraffic());
export type Traffic = ReturnType<typeof createTraffic>;
export type TrafficFrame = ReturnType<Traffic['step']>;
