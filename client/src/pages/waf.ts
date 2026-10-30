import * as THREE from 'three';
import { createSourceTable, event, input, list, state } from 'handwired/src/runtime/cells.ts';
import { emitSelect } from 'handwired/src/runtime/numeric-ui-core.ts';
import { definePage } from '../kit';
import { box } from '../scene';
import { createTicker, DT, gates, wiresOf } from '../ticker';

export const SIGNALS = ['bad IP reputation', 'SQL in the URL', 'no browser headers', 'too many requests'] as const;
export const WEIGHTS = [30, 45, 20, 25] as const;
export const VERDICT = { allow: 0, challenge: 1, block: 2 } as const;

export function buildWaf() {
  const table = createSourceTable();
  const cells = table.declare({
    send: event(),
    dt: input([0, 0.1]),
    challengeAt: input([0, 100]),
    blockAt: input([0, 100]),
    flags: list(SIGNALS.length, () => input([0, 1])),
    lastScore: state([0, 200]),
    lastVerdict: state([0, 2]),
    counts: list(3, () => state([0, 1e6])),
  });
  const circuit = table.createCircuit();
  const { all, atLeast, not } = gates(circuit);
  const score = circuit.affine(cells.flags.map((flag, i) => [flag, WEIGHTS[i] ?? 0] as const));
  const challenge = atLeast(score, cells.challengeAt);
  const block = atLeast(score, cells.blockAt);
  const verdict = circuit.affine([[challenge, 1], [block, 1]]);
  const verdictNow = emitSelect(circuit, cells.send, cells.lastVerdict, verdict);
  table.next(cells.lastScore, emitSelect(circuit, cells.send, cells.lastScore, score));
  table.next(cells.lastVerdict, verdictNow);
  const outcome = [all(cells.send, not(challenge)), all(cells.send, challenge, not(block)), all(cells.send, block)];
  cells.counts.forEach((count, k) => table.next(count, circuit.affine([[count, 1], [outcome[k] ?? circuit.constant(0), 1]])));
  const output = { score, verdict, lastScore: cells.lastScore, lastVerdict: verdictNow, counts: cells.counts, sent: cells.send, challengeAt: cells.challengeAt, blockAt: cells.blockAt };
  const layout = [
    { label: 'verdict', wires: wiresOf({ s: cells.lastScore, v: cells.lastVerdict }) },
    { label: 'tally', wires: wiresOf(cells.counts) },
  ];
  void DT;
  return {
    ...table.finish(),
    output,
    events: { send: cells.send },
    inputs: {
      challengeAt: cells.challengeAt,
      blockAt: cells.blockAt,
      ...Object.fromEntries(cells.flags.map((flag, i) => [`flag${i}`, flag])),
    },
    dt: cells.dt,
    layout,
  };
}

export const createWaf = () => createTicker(buildWaf());
type Frame = ReturnType<ReturnType<typeof createWaf>['step']>;

const VERDICT_COLOR = [0x34d399, 0xfbbf24, 0xef4444] as const;
const VERDICT_NAME = ['allowed ✓', 'challenged 🧩', 'blocked ✕'] as const;

export const wafPage = definePage({
  slug: 'waf',
  title: 'firewall bouncer',
  topic: 'risk scoring · thresholds',
  lesson:
    'Each warning sign adds points. Over the challenge line, the visitor gets a puzzle. Over the block line, they are turned away. Turn the signs on and off, send a request, and move the lines to trade safety against annoying real people.',
  eye: [0, 5, 10],
  make: createWaf,
  controls: [
    ...SIGNALS.map((label, i) => ({ kind: 'slider' as const, label, input: `flag${i}`, min: 0, max: 1, step: 1, initial: 0 })),
    { kind: 'slider', label: 'challenge at', input: 'challengeAt', min: 0, max: 120, step: 5, initial: 40 },
    { kind: 'slider', label: 'block at', input: 'blockAt', min: 0, max: 120, step: 5, initial: 70 },
    { kind: 'button', label: 'send request →', event: 'send' },
  ],
  view: ({ scene }) => {
    const gate = box(0.3, 2.4, 3.2, 0xf6821f);
    gate.position.set(0, 1.2, 0);
    scene.add(gate);
    const meter = box(0.4, 1, 0.4, 0x34d399);
    meter.position.set(0, 0, 2.2);
    scene.add(meter);
    const lines = [0, 1].map((k) => {
      const line = box(0.8, 0.05, 0.8, k === 0 ? 0xfbbf24 : 0xef4444);
      line.position.set(0, 0, 2.2);
      scene.add(line);
      return line;
    });
    const visitor = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.7, 4, 8), new THREE.MeshStandardMaterial({ color: 0x71b8d8 }));
    scene.add(visitor);
    let walk = 1;
    let verdict = 0;
    return (frame: Frame) => {
      if (frame.sent === 1) {
        walk = 0;
        verdict = frame.lastVerdict;
      }
      walk = Math.min(1, walk + DT * 0.6);
      const stopAt = verdict === 0 ? 1 : verdict === 1 ? 0.48 : 0.42;
      const p = Math.min(walk, stopAt);
      visitor.position.set(-5 + p * 10, 0.65, 0);
      visitor.material.color.setHex(walk > 0.4 ? (VERDICT_COLOR[verdict] ?? 0) : 0x71b8d8);
      visitor.rotation.z = verdict === 2 && walk > 0.42 ? Math.min(1.4, (walk - 0.42) * 6) : 0;
      const height = frame.score / 30;
      meter.scale.y = Math.max(0.02, height);
      meter.position.y = meter.scale.y / 2;
      (meter.material as THREE.MeshStandardMaterial).color.setHex(VERDICT_COLOR[frame.verdict] ?? 0);
      const [allowed, challenged, blocked] = frame.counts;
      lines.forEach((line, k) => {
        line.visible = true;
        line.position.y = (k === 0 ? frame.challengeAt : frame.blockAt) / 30;
      });
      return `score ${frame.score} → ${VERDICT_NAME[frame.verdict]} · tally ✓${allowed} 🧩${challenged} ✕${blocked}`;
    };
  },
});
