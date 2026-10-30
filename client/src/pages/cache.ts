import * as THREE from 'three';
import { createSourceTable, event, input, list, state } from 'handwired/src/runtime/cells.ts';
import { emitSelect, type Wire } from 'handwired/src/runtime/numeric-ui-core.ts';
import { definePage } from '../kit';
import { box } from '../scene';
import { createTicker, DT, gates, wiresOf } from '../ticker';

export const CACHE = { slots: 4, keys: 8, empty: -1 } as const;
export const KEY_COLORS = [0xf6821f, 0x71b8d8, 0x34d399, 0xf43f5e, 0xa78bfa, 0xfbbf24, 0x2dd4bf, 0xe2e8f0] as const;

export function buildCache() {
  const table = createSourceTable();
  const cells = table.declare({
    dt: input([0, 0.1]),
    requests: list(CACHE.keys, () => event()),
    slots: list(CACHE.slots, () => ({ key: state([CACHE.empty, CACHE.keys], { initial: CACHE.empty }), age: state([0, 1e6]) })),
    hits: state([0, 1e6]),
    misses: state([0, 1e6]),
    lastHit: state([0, 1]),
    lastSlot: state([-1, CACHE.slots], { initial: -1 }),
  });
  const circuit = table.createCircuit();
  const { all, not, is, either, atLeast } = gates(circuit);
  const anyRequest = cells.requests.reduce<Wire>((a, b) => either(a, b), circuit.constant(0));
  const requested = circuit.affine(cells.requests.map((bit, k) => [bit, k] as const));
  const matches = cells.slots.map((slot) => all(anyRequest, is(circuit.affine([[slot.key, 1], [requested, -1]]), 0)));
  const hit = matches.reduce((a, b) => either(a, b));
  const miss = all(anyRequest, not(hit));

  const oldest = cells.slots.map((slot, i) => {
    const beatsAll = cells.slots
      .map((other, j) => {
        if (j === i) return circuit.constant(1);
        const strict = j < i ? '>' : '>=';
        return strict === '>'
          ? all(atLeast(slot.age, other.age), not(is(circuit.affine([[slot.age, 1], [other.age, -1]]), 0)))
          : atLeast(slot.age, other.age);
      })
      .reduce((a, b) => all(a, b));
    return beatsAll;
  });
  const victim = oldest.map((bit) => all(miss, bit));

  const slots = cells.slots.map((slot, i) => {
    const touched = either(matches[i] ?? circuit.constant(0), victim[i] ?? circuit.constant(0));
    const key = emitSelect(circuit, victim[i] ?? circuit.constant(0), slot.key, requested);
    const aged = circuit.affine([[slot.age, 1], [anyRequest, 1]]);
    const age = emitSelect(circuit, touched, aged, circuit.constant(0));
    table.next(slot.key, key);
    table.next(slot.age, age);
    return { key, age, touched };
  });
  const slotIndex = circuit.affine(slots.map((slot, i) => [slot.touched, i + 1] as const), -1);
  table.next(cells.hits, circuit.affine([[cells.hits, 1], [hit, 1]]));
  table.next(cells.misses, circuit.affine([[cells.misses, 1], [miss, 1]]));
  table.next(cells.lastHit, emitSelect(circuit, anyRequest, cells.lastHit, hit));
  table.next(cells.lastSlot, emitSelect(circuit, anyRequest, cells.lastSlot, slotIndex));
  const output = { slots, hit, miss, hits: cells.hits, misses: cells.misses, lastHit: cells.lastHit, lastSlot: cells.lastSlot };
  const layout = [
    ...cells.slots.map((slot, i) => ({ label: `slot ${i + 1}`, wires: wiresOf(slot) })),
    { label: 'score', wires: wiresOf({ h: cells.hits, m: cells.misses }) },
  ];
  const events = Object.fromEntries(cells.requests.map((bit, k) => [`get${k}`, bit])) as Record<string, Wire>;
  void DT;
  return { ...table.finish(), output, events, dt: cells.dt, layout };
}

export const createCache = () => createTicker(buildCache());
type Frame = ReturnType<ReturnType<typeof createCache>['step']>;

export const cachePage = definePage({
  slug: 'cache',
  title: 'cache shelf',
  topic: 'caching · LRU eviction',
  lesson:
    'The shelf holds 4 of 8 items. Asking for an item on the shelf is a fast hit. A miss fetches it from far away and throws out whichever item was used least recently. Keep asking for the same few and watch the hit rate climb.',
  eye: [0, 6, 9],
  make: createCache,
  controls: KEY_COLORS.map((_, k) => ({ kind: 'button' as const, label: `get ${'ABCDEFGH'[k]}`, event: `get${k}` })),
  view: ({ scene }) => {
    const shelf = box(8, 0.2, 1.6, 0x334155);
    shelf.position.set(0, 1, 0);
    scene.add(shelf);
    const store = box(10, 0.2, 1.2, 0x1e293b);
    store.position.set(0, 0.1, -4);
    scene.add(store);
    const far = KEY_COLORS.map((color, k) => {
      const item = box(0.7, 0.7, 0.7, color);
      item.position.set(-4.4 + k * 1.25, 0.6, -4);
      scene.add(item);
      return item;
    });
    const items = Array.from({ length: CACHE.slots }, (_, i) => {
      const item = box(1.2, 1.2, 1.2, 0x1f2937);
      item.position.set(-3 + i * 2, 1.7, 0);
      scene.add(item);
      return item;
    });
    let pulse = 0;
    return (frame: Frame) => {
      pulse = Math.max(0, pulse - DT * 2);
      if (frame.slots.some((slot) => slot.touched === 1)) pulse = 1;
      items.forEach((item, i) => {
        const slot = frame.slots[i];
        if (slot === undefined) return;
        const key = slot.key;
        (item.material as THREE.MeshStandardMaterial).color.setHex(key < 0 ? 0x1f2937 : (KEY_COLORS[key] ?? 0));
        const fresh = i === frame.lastSlot ? pulse : 0;
        item.position.y = 1.7 + fresh * 0.4;
        (item.material as THREE.MeshStandardMaterial).emissive.setHex(fresh > 0 ? (frame.lastHit === 1 ? 0x14532d : 0x7f1d1d) : 0);
      });
      far.forEach((item, k) => {
        item.material.opacity = frame.slots.some((slot) => slot.key === k) ? 0.3 : 1;
        item.material.transparent = true;
      });
      const total = frame.hits + frame.misses;
      const rate = total > 0 ? Math.round((frame.hits / total) * 100) : 0;
      return `${frame.lastHit === 1 ? 'HIT ⚡' : total > 0 ? 'MISS 🐢' : 'ask for an item'} · hit rate ${rate}% (${frame.hits}/${total})`;
    };
  },
});
