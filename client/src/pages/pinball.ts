import * as THREE from 'three';
import { createSourceTable, event, input, list, state, stateBit } from 'handwired/src/runtime/cells.ts';
import { emitMaximum, emitMinimum, emitRelu, emitSelect, type Wire } from 'handwired/src/runtime/numeric-ui-core.ts';
import { definePage } from '../kit';
import { box } from '../scene';
import { createTicker, DT, gates, wiresOf } from '../ticker';

export const TABLE = { width: 6, height: 10, gravity: 6, ballR: 0.2 } as const;
export const BUMPERS = [
  [-1.4, 6.5],
  [1.4, 6.5],
  [0, 8],
] as const;

export function buildPinball() {
  const table = createSourceTable();
  const cells = table.declare({
    launch: event(),
    flip: event(),
    dt: input([0, 0.1]),
    x: state([-4, 4], { initial: 2.7 }),
    y: state([-2, 12], { initial: 0.6 }),
    vx: state([-40, 40]),
    vy: state([-40, 40]),
    inPlay: stateBit(0),
    flipper: state([0, 0.31]),
    score: state([0, 1e7]),
    combo: state([1, 8], { initial: 1 }),
    balls: state([0, 3], { initial: 3 }),
    lit: list(BUMPERS.length, () => state([0, 0.5])),
  });
  const circuit = table.createCircuit();
  const { all, not, above, below, either } = gates(circuit);
  const c = (k: number) => circuit.constant(k);
  const clamp = (w: Wire, lo: number, hi: number) => emitMaximum(circuit, c(lo), emitMinimum(circuit, c(hi), w));
  const abs = (w: Wire) => circuit.affine([[emitRelu(circuit, w), 1], [emitRelu(circuit, circuit.affine([[w, -1]])), 1]]);
  const half = TABLE.width / 2 - TABLE.ballR;

  const start = all(cells.launch, not(cells.inPlay), above(cells.balls, 0));
  const flipper = emitSelect(circuit, cells.flip, emitRelu(circuit, circuit.affine([[cells.flipper, 1], [cells.dt, -1]])), c(0.3));
  const flipping = above(flipper, 0);

  let vx: Wire = cells.vx;
  let vy: Wire = circuit.affine([[cells.vy, 1]], -TABLE.gravity * DT);
  let px: Wire = circuit.affine([[cells.x, 1], [vx, DT]]);
  let py: Wire = circuit.affine([[cells.y, 1], [vy, DT]]);

  const hitLeft = all(cells.inPlay, below(px, -half));
  const hitRight = all(cells.inPlay, above(px, half));
  vx = emitSelect(circuit, either(hitLeft, hitRight), vx, circuit.affine([[vx, -0.9]]));
  px = clamp(px, -half, half);
  const hitTop = all(cells.inPlay, above(py, TABLE.height - TABLE.ballR));
  vy = emitSelect(circuit, hitTop, vy, circuit.affine([[vy, -0.9]]));
  py = emitMinimum(circuit, c(TABLE.height - TABLE.ballR), py);

  let points: Wire = c(0);
  const lit = BUMPERS.map(([bx, by], i) => {
    const dx = circuit.affine([[px, 1]], -bx);
    const dy = circuit.affine([[py, 1]], -by);
    const close = all(cells.inPlay, below(circuit.affine([[abs(dx), 1], [abs(dy), 1]]), 0.75), below(cells.lit[i] as Wire, 0.35));
    vx = emitSelect(circuit, close, vx, circuit.affine([[dx, 10]]));
    vy = emitSelect(circuit, close, vy, circuit.affine([[dy, 10]], 2));
    points = circuit.affine([[points, 1], [close, 100]]);
    return { close, glow: emitSelect(circuit, close, emitRelu(circuit, circuit.affine([[cells.lit[i] as Wire, 1], [cells.dt, -1]])), c(0.5)) };
  });

  const overFlipper = all(cells.inPlay, below(py, 1.2), below(abs(px), 1.6), below(vy, 0));
  const flipped = all(overFlipper, flipping);
  vy = emitSelect(circuit, flipped, vy, circuit.affine([[abs(vy), 0.3]], 14));
  vx = emitSelect(circuit, flipped, vx, circuit.affine([[px, 3]]));
  const drained = all(cells.inPlay, below(py, -0.5), not(flipped));

  const anyHit = lit.map((l) => l.close).reduce((a, b) => either(a, b));
  const combo = emitSelect(circuit, drained, emitSelect(circuit, anyHit, cells.combo, emitMinimum(circuit, c(8), circuit.affine([[cells.combo, 1]], 1))), c(1));
  const score = circuit.affine([[cells.score, 1], [circuit.multiply(points, cells.combo), 1]]);
  const inPlay = either(start, all(cells.inPlay, not(drained)));
  const parked = not(inPlay);
  const x = emitSelect(circuit, parked, px, c(2.7));
  const y = emitSelect(circuit, parked, py, c(0.6));
  const vxOut = emitSelect(circuit, start, clamp(circuit.multiply(inPlay, vx), -40, 40), c(-1.5));
  const vyOut = emitSelect(circuit, start, clamp(circuit.multiply(inPlay, vy), -40, 40), c(15));

  table.next(cells.x, x);
  table.next(cells.y, y);
  table.next(cells.vx, vxOut);
  table.next(cells.vy, vyOut);
  table.next(cells.inPlay, inPlay);
  table.next(cells.flipper, flipper);
  table.next(cells.score, score);
  table.next(cells.combo, combo);
  table.next(cells.balls, circuit.affine([[cells.balls, 1], [start, -1]]));
  cells.lit.forEach((cell, i) => table.next(cell, lit[i]?.glow ?? c(0)));
  const output = { x, y, inPlay, flipping, score, combo, balls: cells.balls, lit: lit.map((l) => l.glow), drained, anyHit };
  const layout = [
    { label: 'ball', wires: wiresOf({ x: cells.x, y: cells.y, vx: cells.vx, vy: cells.vy, p: cells.inPlay }) },
    { label: 'bumpers', wires: wiresOf(cells.lit) },
    { label: 'game', wires: wiresOf({ f: cells.flipper, s: cells.score, c: cells.combo, b: cells.balls }) },
  ];
  return { ...table.finish(), output, events: { launch: cells.launch, flip: cells.flip }, dt: cells.dt, layout };
}

export const createPinball = () => createTicker(buildPinball());
type Frame = ReturnType<ReturnType<typeof createPinball>['step']>;

export const pinballPage = definePage({
  slug: 'pinball',
  title: 'pinball',
  topic: 'physics as arithmetic · collision',
  lesson:
    'Physics here is just adding. Each frame, gravity changes speed and speed changes position. A wall flips the sign of the speed. A bumper adds a kick away from its center. Hit bumpers in a row to build the combo, and flip before the ball drains.',
  eye: [0, 12, 6],
  make: createPinball,
  controls: [
    { kind: 'button', label: 'launch ⏫', event: 'launch' },
    { kind: 'button', label: 'FLIP', event: 'flip' },
  ],
  view: ({ scene, aim, renderer }, ticker) => {
    aim(0, 0, -TABLE.height / 2 + 1);
    const tableTop = box(TABLE.width + 0.4, 0.1, TABLE.height + 0.4, 0x1e1b4b);
    tableTop.position.set(0, -0.05, -TABLE.height / 2);
    scene.add(tableTop);
    for (const x of [-TABLE.width / 2 - 0.1, TABLE.width / 2 + 0.1]) {
      const rail = box(0.2, 0.4, TABLE.height, 0x475569);
      rail.position.set(x, 0.2, -TABLE.height / 2);
      scene.add(rail);
    }
    const bumpers = BUMPERS.map(([x, y]) => {
      const bumper = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.4, 24), new THREE.MeshStandardMaterial({ color: 0xf43f5e }));
      bumper.position.set(x, 0.2, -y);
      scene.add(bumper);
      return bumper;
    });
    const flipperPivot = new THREE.Group();
    flipperPivot.position.set(0, 0.15, -0.8);
    const flipperArm = box(3.2, 0.2, 0.25, 0xf6821f);
    flipperPivot.add(flipperArm);
    scene.add(flipperPivot);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(TABLE.ballR, 20, 14), new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.9, roughness: 0.15 }));
    scene.add(ball);
    renderer.domElement.addEventListener('pointerdown', () => ticker.press('flip'));
    addEventListener('keydown', (event) => {
      if (event.key === ' ' || event.key === 'ArrowUp') ticker.press('flip');
      if (event.key === 'Enter') ticker.press('launch');
    });
    return (frame: Frame) => {
      ball.position.set(frame.x, TABLE.ballR, -frame.y);
      flipperPivot.rotation.y = frame.flipping === 1 ? 0 : 0;
      flipperArm.position.y = frame.flipping === 1 ? 0.25 : 0;
      (flipperArm.material as THREE.MeshStandardMaterial).emissive.setHex(frame.flipping === 1 ? 0x7c2d12 : 0);
      bumpers.forEach((bumper, i) => {
        const glow = (frame.lit[i] ?? 0) * 2;
        (bumper.material as THREE.MeshStandardMaterial).emissive.setRGB(glow, glow * 0.3, glow * 0.5);
        bumper.scale.setScalar(1 + glow * 0.15);
      });
      const status = frame.inPlay === 1 ? `combo ×${frame.combo}` : frame.balls > 0 ? 'press launch' : 'game over';
      return `score ${frame.score} · balls ${frame.balls} · ${status}`;
    };
  },
});
