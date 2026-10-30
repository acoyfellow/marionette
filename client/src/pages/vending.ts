import * as THREE from 'three';
import { createSourceTable, event, input, list, state } from 'handwired/src/runtime/cells.ts';
import { emitRelu, emitSelect, type Wire } from 'handwired/src/runtime/numeric-ui-core.ts';
import { definePage } from '../kit';
import { box } from '../scene';
import { createTicker, DT, gates, wiresOf } from '../ticker';

export const COINS = [5, 10, 25, 100] as const;
export const PRODUCTS = [
  { name: 'gum', price: 35, color: 0xf43f5e },
  { name: 'chips', price: 75, color: 0xfbbf24 },
  { name: 'soda', price: 125, color: 0x71b8d8 },
] as const;

export function buildVending() {
  const table = createSourceTable();
  const cells = table.declare({
    dt: input([0, 0.1]),
    coins: list(COINS.length, () => event()),
    picks: list(PRODUCTS.length, () => event()),
    refund: event(),
    credit: state([0, 1000]),
    stock: list(PRODUCTS.length, () => state([0, 5], { initial: 3 })),
    lastVend: state([-1, PRODUCTS.length], { initial: -1 }),
    lastChange: state([0, 1000]),
    message: state([0, 4]),
    flash: state([0, 2]),
  });
  const circuit = table.createCircuit();
  const { all, not, atLeast, either, above } = gates(circuit);
  const c = (k: number) => circuit.constant(k);
  const inserted = circuit.affine(cells.coins.map((coin, i) => [coin, COINS[i] ?? 0] as const));
  const credit = circuit.affine([[cells.credit, 1], [inserted, 1]]);
  const vend = PRODUCTS.map((product, i) => all(cells.picks[i] as Wire, atLeast(credit, c(product.price)), above(cells.stock[i] as Wire, 0)));
  const short = PRODUCTS.map((product, i) => all(cells.picks[i] as Wire, not(atLeast(credit, c(product.price)))));
  const empty = PRODUCTS.map((_, i) => all(cells.picks[i] as Wire, not(above(cells.stock[i] as Wire, 0))));
  const anyVend = vend.reduce((a, b) => either(a, b));
  const spent = circuit.affine(vend.map((bit, i) => [bit, PRODUCTS[i]?.price ?? 0] as const));
  const change = emitSelect(circuit, either(anyVend, cells.refund), c(0), emitRelu(circuit, circuit.affine([[credit, 1], [spent, -1]])));
  const after = circuit.affine([[credit, 1], [spent, -1], [change, -1]]);
  const anyShort = short.reduce((a, b) => either(a, b));
  const anyEmpty = empty.reduce((a, b) => either(a, b));
  const event_ = either(either(anyVend, anyShort), either(anyEmpty, cells.refund));
  const code = circuit.affine([[anyVend, 1], [anyShort, 2], [anyEmpty, 3], [all(cells.refund, not(anyVend)), 4]]);
  const creditNow = emitRelu(circuit, after);
  const lastChange = emitSelect(circuit, event_, cells.lastChange, change);
  table.next(cells.credit, creditNow);
  cells.stock.forEach((stock, i) => table.next(stock, circuit.affine([[stock, 1], [vend[i] as Wire, -1]])));
  table.next(cells.lastVend, emitSelect(circuit, anyVend, cells.lastVend, circuit.affine(vend.map((bit, i) => [bit, i + 1] as const), -1)));
  table.next(cells.lastChange, lastChange);
  table.next(cells.message, emitSelect(circuit, event_, cells.message, emitSelect(circuit, above(code, 4), code, c(4))));
  table.next(cells.flash, emitSelect(circuit, event_, emitRelu(circuit, circuit.affine([[cells.flash, 1], [cells.dt, -1]])), c(2)));
  const stockNow = cells.stock.map((stock, i) => circuit.affine([[stock, 1], [vend[i] as Wire, -1]]));
  const output = { credit: creditNow, stock: stockNow, lastVend: cells.lastVend, lastChange, change, message: cells.message, flash: cells.flash, vend };
  const layout = [
    { label: 'credit', wires: wiresOf({ c: cells.credit, ch: cells.lastChange }) },
    { label: 'stock', wires: wiresOf(cells.stock) },
    { label: 'display', wires: wiresOf({ v: cells.lastVend, m: cells.message, f: cells.flash }) },
  ];
  const events: Record<string, Wire> = { refund: cells.refund };
  cells.coins.forEach((wire, i) => {
    events[`coin${i}`] = wire;
  });
  cells.picks.forEach((wire, i) => {
    events[`pick${i}`] = wire;
  });
  return { ...table.finish(), output, events, dt: cells.dt, layout };
}

export const createVending = () => createTicker(buildVending());
type Frame = ReturnType<ReturnType<typeof createVending>['step']>;

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const MESSAGES = ['insert coins', 'enjoy!', 'not enough credit', 'sold out', 'refunded'] as const;

export const vendingPage = definePage({
  slug: 'vending',
  title: 'vending machine',
  topic: 'finite state machines · accounting',
  lesson:
    'A vending machine is a tiny accountant. Coins add credit. A pick only works if credit covers the price and the item is in stock, and the change always balances to the cent. Try to buy soda with a quarter.',
  eye: [0, 3, 8],
  make: createVending,
  controls: [
    ...COINS.map((coin, i) => ({ kind: 'button' as const, label: `+${coin < 100 ? `${coin}¢` : '$1'}`, event: `coin${i}` })),
    ...PRODUCTS.map((product, i) => ({ kind: 'button' as const, label: `${product.name} ${money(product.price)}`, event: `pick${i}` })),
    { kind: 'button' as const, label: 'refund', event: 'refund' },
  ],
  view: ({ scene, aim }) => {
    aim(0, 1.8, 0);
    const cabinet = box(3, 3.6, 1.2, 0x7f1d1d);
    cabinet.position.y = 1.8;
    scene.add(cabinet);
    const glass = box(2.2, 2.4, 0.05, 0x94a3b8);
    (glass.material as THREE.MeshStandardMaterial).transparent = true;
    (glass.material as THREE.MeshStandardMaterial).opacity = 0.12;
    glass.position.set(-0.2, 2.1, 0.75);
    scene.add(glass);
    const rows = PRODUCTS.map((product, r) =>
      Array.from({ length: 5 }, (_, k) => {
        const item = box(0.32, 0.5, 0.3, product.color);
        item.position.set(-1 + k * 0.42, 2.9 - r * 0.75, 0.65);
        scene.add(item);
        return item;
      }),
    );
    const tray = box(1.4, 0.3, 0.3, 0x0b1118);
    tray.position.set(-0.2, 0.4, 0.65);
    scene.add(tray);
    const dropped = box(0.32, 0.5, 0.3, 0xffffff);
    scene.add(dropped);
    let fall = 0;
    return (frame: Frame) => {
      rows.forEach((row, r) => row.forEach((item, k) => {
        item.visible = k < (frame.stock[r] ?? 0);
      }));
      if (frame.vend.some((bit) => bit === 1)) fall = 1;
      fall = Math.max(0, fall - DT * 0.6);
      dropped.visible = frame.lastVend >= 0 && fall > 0;
      (dropped.material as THREE.MeshStandardMaterial).color.setHex(PRODUCTS[frame.lastVend]?.color ?? 0xffffff);
      dropped.position.set(-0.2, 0.5 + Math.max(0, fall - 0.6) * 4, 0.6);
      const note = frame.flash > 0 ? MESSAGES[frame.message] : MESSAGES[0];
      const change = frame.flash > 0 && frame.lastChange > 0 ? ` · change ${money(frame.lastChange)}` : '';
      return `credit ${money(frame.credit)} · ${note}${change}`;
    };
  },
});
