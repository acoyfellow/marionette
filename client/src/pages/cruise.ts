import { createSourceTable, event, input, state, stateBit } from 'handwired/src/runtime/cells.ts';
import { emitMaximum, emitMinimum, emitSelect } from 'handwired/src/runtime/numeric-ui-core.ts';
import { definePage } from '../kit';
import { box } from '../scene';
import { createTicker, DT, gates, wiresOf } from '../ticker';

export const ROAD = { maxAccel: 3, maxBrake: 8, lead: 25, timeGap: 1.5, minGap: 4, loop: 120 } as const;

export function buildCruise() {
  const table = createSourceTable();
  const cells = table.declare({
    leadBrake: event(),
    dt: input([0, 0.1]),
    setSpeed: input([0, 40]),
    hill: input([-3, 3]),
    speed: state([0, 60], { initial: 15 }),
    leadSpeed: state([0, 60], { initial: 20 }),
    gap: state([-10, 500], { initial: 40 }),
    leadBraking: state([0, 3]),
    closest: state([-10, 500], { initial: 40 }),
    followed: stateBit(0),
  });
  const circuit = table.createCircuit();
  const { above, below, all } = gates(circuit);
  const c = (k: number) => circuit.constant(k);
  const clamp = (value: ReturnType<typeof c>, lo: number, hi: number) => emitMaximum(circuit, c(lo), emitMinimum(circuit, c(hi), value));
  const brakeLeft = emitSelect(circuit, cells.leadBrake, emitMaximum(circuit, c(0), circuit.affine([[cells.leadBraking, 1], [cells.dt, -1]])), c(3));
  const leadTarget = emitSelect(circuit, above(brakeLeft, 0), c(ROAD.lead), c(5));
  const leadSpeed = circuit.affine([[cells.leadSpeed, 0.97], [leadTarget, 0.03]]);
  const safeGap = circuit.affine([[cells.speed, ROAD.timeGap]], ROAD.minGap);
  const gapError = circuit.affine([[cells.gap, 1], [safeGap, -1]]);
  const followSpeed = circuit.affine([[leadSpeed, 1], [gapError, 0.4]]);
  const desired = emitMinimum(circuit, cells.setSpeed, emitMaximum(circuit, c(0), followSpeed));
  const following = below(circuit.affine([[followSpeed, 1], [cells.setSpeed, -1]]), 0);
  const accel = clamp(circuit.affine([[desired, 1.2], [cells.speed, -1.2]]), -ROAD.maxBrake, ROAD.maxAccel);
  const speed = emitMaximum(circuit, c(0), circuit.affine([[cells.speed, 1], [accel, DT], [cells.hill, -DT]]));
  const gap = circuit.affine([[cells.gap, 1], [leadSpeed, DT], [speed, -DT]]);
  table.next(cells.speed, speed);
  table.next(cells.leadSpeed, leadSpeed);
  table.next(cells.gap, gap);
  table.next(cells.leadBraking, brakeLeft);
  table.next(cells.closest, emitMinimum(circuit, cells.closest, gap));
  table.next(cells.followed, all(following, c(1)));
  const output = { speed, leadSpeed, gap, safeGap, accel, following, closest: cells.closest, setSpeed: cells.setSpeed };
  const layout = [
    { label: 'my car', wires: wiresOf({ s: cells.speed, g: cells.gap }) },
    { label: 'lead car', wires: wiresOf({ s: cells.leadSpeed, b: cells.leadBraking }) },
    { label: 'safety', wires: wiresOf({ c: cells.closest, f: cells.followed }) },
  ];
  return {
    ...table.finish(),
    output,
    events: { leadBrake: cells.leadBrake },
    inputs: { setSpeed: cells.setSpeed, hill: cells.hill },
    dt: cells.dt,
    layout,
  };
}

export const createCruise = () => createTicker(buildCruise());
type Frame = ReturnType<ReturnType<typeof createCruise>['step']>;

export const cruisePage = definePage({
  slug: 'cruise',
  title: 'adaptive cruise',
  topic: 'feedback control · safe following',
  lesson:
    'Your car (orange) wants your set speed, but it also keeps a 1.5 second gap to the car ahead. Make the lead car brake: yours slows on its own. Add a hill and it pushes harder to hold speed.',
  eye: [0, 7, 12],
  make: createCruise,
  controls: [
    { kind: 'slider', label: 'set speed', input: 'setSpeed', min: 5, max: 40, step: 1, initial: 30 },
    { kind: 'slider', label: 'hill', input: 'hill', min: -3, max: 3, step: 0.5, initial: 0 },
    { kind: 'button', label: 'lead car brakes 🛑', event: 'leadBrake' },
  ],
  view: ({ scene }) => {
    const road = box(30, 0.05, 3, 0x1e293b);
    scene.add(road);
    const dashes = Array.from({ length: 15 }, (_, i) => {
      const dash = box(1, 0.06, 0.1, 0xe2e8f0);
      dash.position.set(-15 + i * 2, 0.03, 0);
      scene.add(dash);
      return dash;
    });
    const me = box(2, 0.8, 1, 0xf6821f);
    const lead = box(2, 0.8, 1, 0x71b8d8);
    const safe = box(0.1, 0.02, 1.2, 0x34d399);
    scene.add(me, lead, safe);
    const brakeLights = box(0.05, 0.2, 0.9, 0xef4444);
    lead.add(brakeLights);
    brakeLights.position.x = -1.02;
    let scroll = 0;
    return (frame: Frame) => {
      scroll = (scroll + frame.speed * DT * 0.3) % 2;
      dashes.forEach((dash, i) => {
        dash.position.x = -15 + i * 2 - scroll;
      });
      const scale = 0.25;
      me.position.set(-8, 0.45, 0.6);
      lead.position.set(-8 + Math.min(40, frame.gap) * scale + 2, 0.45, 0.6);
      safe.position.set(-8 + frame.safeGap * scale + 1, 0.04, 0.6);
      brakeLights.visible = frame.leadSpeed < frame.speed - 1;
      return `${frame.speed.toFixed(0)} / ${frame.setSpeed} m/s · gap ${frame.gap.toFixed(0)} m · ${frame.following === 1 ? 'following' : 'cruising'}`;
    };
  },
});
