import * as THREE from 'three';
import { createSourceTable, event, input, list, state, stateBit } from 'handwired/src/runtime/cells.ts';
import { emitSelect, type Wire } from 'handwired/src/runtime/numeric-ui-core.ts';
import { definePage } from '../kit';
import { box } from '../scene';
import { createTicker, DT, gates, wiresOf } from '../ticker';

export const DRUMS = { steps: 8, tracks: ['kick', 'snare', 'hat'] as const } as const;
const PRESET = [
  [1, 0, 0, 0, 1, 0, 0, 0],
  [0, 0, 1, 0, 0, 0, 1, 0],
  [1, 1, 1, 1, 1, 1, 1, 1],
] as const;

export function buildDrums() {
  const table = createSourceTable();
  const cells = table.declare({
    dt: input([0, 0.1]),
    tempo: input([60, 200], { initial: 110 }),
    swing: input([0, 0.5]),
    phase: state([0, 1.1]),
    step: state([0, DRUMS.steps - 1]),
    pattern: list(DRUMS.tracks.length * DRUMS.steps, (i) => stateBit(PRESET[Math.floor(i / DRUMS.steps)]?.[i % DRUMS.steps] ?? 0)),
    toggles: list(DRUMS.tracks.length * DRUMS.steps, () => event()),
  });
  const circuit = table.createCircuit();
  const { all, is, atLeast } = gates(circuit);
  const c = (k: number) => circuit.constant(k);
  const pattern = cells.pattern.map((bit, i) => {
    const toggle = cells.toggles[i] as Wire;
    return circuit.affine([[bit, 1], [toggle, 1], [circuit.multiply(toggle, bit), -2]]);
  });
  const odd = circuit.affine(Array.from({ length: DRUMS.steps / 2 }, (_, k) => [is(cells.step, k * 2 + 1), 1] as const));
  const stretch = circuit.affine([[circuit.multiply(odd, cells.swing), -1], [circuit.multiply(circuit.affine([[odd, -1]], 1), cells.swing), 1]], 1);
  const rate = circuit.multiply(cells.tempo, circuit.constant(2 / 60));
  const advanced = circuit.affine([[cells.phase, 1], [circuit.multiply(circuit.multiply(rate, cells.dt), stretch), 1]]);
  const tick = atLeast(advanced, c(1));
  const wrap = is(cells.step, DRUMS.steps - 1);
  const nextStep = emitSelect(circuit, wrap, circuit.affine([[cells.step, 1]], 1), c(0));
  const step = emitSelect(circuit, tick, cells.step, nextStep);
  const phase = emitSelect(circuit, tick, advanced, c(0));
  const hits = DRUMS.tracks.map((_, t) =>
    Array.from({ length: DRUMS.steps }, (_, k) => all(tick, is(nextStep, k), pattern[t * DRUMS.steps + k] as Wire)).reduce((a, b) => circuit.affine([[a, 1], [b, 1]])),
  );
  table.next(cells.phase, phase);
  table.next(cells.step, step);
  cells.pattern.forEach((bit, i) => table.next(bit, pattern[i] as Wire));
  const output = { step, tick, hits, pattern, tempo: cells.tempo };
  const layout = DRUMS.tracks.map((name, t) => ({ label: name, wires: wiresOf(cells.pattern.slice(t * DRUMS.steps, (t + 1) * DRUMS.steps)) }));
  const events = Object.fromEntries(cells.toggles.map((wire, i) => [`toggle${i}`, wire])) as Record<string, Wire>;
  return {
    ...table.finish(),
    output,
    events,
    inputs: { tempo: cells.tempo, swing: cells.swing },
    dt: cells.dt,
    layout: [{ label: 'clock', wires: wiresOf({ p: cells.phase, s: cells.step }) }, ...layout],
  };
}

export const createDrums = () => createTicker(buildDrums());
type Frame = ReturnType<ReturnType<typeof createDrums>['step']>;

function makeVoice() {
  let context: AudioContext | null = null;
  return (track: number) => {
    context ??= new AudioContext();
    const now = context.currentTime;
    const gain = context.createGain();
    gain.connect(context.destination);
    if (track === 0) {
      const osc = context.createOscillator();
      osc.frequency.setValueAtTime(150, now);
      osc.frequency.exponentialRampToValueAtTime(40, now + 0.15);
      gain.gain.setValueAtTime(0.8, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
      osc.connect(gain);
      osc.start(now);
      osc.stop(now + 0.2);
      return;
    }
    const length = track === 1 ? 0.15 : 0.04;
    const buffer = context.createBuffer(1, Math.floor(context.sampleRate * length), context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = (((i * 1103515245 + 12345) >>> 0) / 4294967296) * 2 - 1;
    const noise = context.createBufferSource();
    noise.buffer = buffer;
    const filter = context.createBiquadFilter();
    filter.type = track === 1 ? 'bandpass' : 'highpass';
    filter.frequency.value = track === 1 ? 1800 : 7000;
    gain.gain.setValueAtTime(track === 1 ? 0.5 : 0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + length);
    noise.connect(filter).connect(gain);
    noise.start(now);
  };
}

export const drumsPage = definePage({
  slug: 'drums',
  title: 'drum machine',
  topic: 'clocks · step sequencers',
  lesson:
    'A drum machine is a clock plus a grid. The clock counts to 8 and wraps around. At each count, every lit square in that column plays. Tap squares to write a beat. Swing stretches every other step, which is the whole trick behind a groove.',
  eye: [0, 9, 4],
  make: createDrums,
  controls: [
    { kind: 'slider', label: 'tempo', input: 'tempo', min: 60, max: 200, step: 1, initial: 110 },
    { kind: 'slider', label: 'swing', input: 'swing', min: 0, max: 0.4, step: 0.02, initial: 0 },
  ],
  view: ({ scene, pick, renderer }, ticker) => {
    const colors = [0xf6821f, 0x71b8d8, 0x34d399] as const;
    const pads = DRUMS.tracks.flatMap((_, t) =>
      Array.from({ length: DRUMS.steps }, (_, k) => {
        const pad = box(0.85, 0.25, 0.85, 0x1e293b);
        pad.position.set(k - DRUMS.steps / 2 + 0.5, 0, t * 1.1 - 1.1);
        pad.userData.index = t * DRUMS.steps + k;
        scene.add(pad);
        return pad;
      }),
    );
    const head = box(0.95, 0.05, 3.4, 0xffffff);
    (head.material as THREE.MeshStandardMaterial).transparent = true;
    (head.material as THREE.MeshStandardMaterial).opacity = 0.15;
    scene.add(head);
    const play = makeVoice();
    let armed = false;
    renderer.domElement.addEventListener('pointerdown', (event) => {
      armed = true;
      const hit = pick(event, pads);
      if (hit !== null) ticker.press(`toggle${hit.userData.index as number}`);
    });
    addEventListener('pointerdown', () => {
      armed = true;
    });
    return (frame: Frame) => {
      pads.forEach((pad, i) => {
        const t = Math.floor(i / DRUMS.steps);
        const k = i % DRUMS.steps;
        const on = frame.pattern[i] === 1;
        const now = k === frame.step;
        (pad.material as THREE.MeshStandardMaterial).color.setHex(on ? (colors[t] ?? 0xffffff) : 0x1e293b);
        (pad.material as THREE.MeshStandardMaterial).emissive.setHex(on && now ? 0x444444 : 0);
        pad.scale.y = on && now ? 2 : 1;
      });
      head.position.set(frame.step - DRUMS.steps / 2 + 0.5, 0.2, 0);
      if (armed) frame.hits.forEach((hit, t) => hit > 0 && play(t));
      return `step ${frame.step + 1}/8 · ${Math.round(frame.tempo)} bpm${armed ? '' : ' · tap anywhere for sound'}`;
    };
  },
});

void DT;
