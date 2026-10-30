import * as THREE from 'three';
import { createSourceTable, event, input, list, state, stateBit } from 'handwired/src/runtime/cells.ts';
import { emitSelect, type Wire } from 'handwired/src/runtime/numeric-ui-core.ts';
import { definePage } from '../kit';
import { box } from '../scene';
import { createTicker, DT, gates, wiresOf } from '../ticker';

export const GRID = { size: 10, period: 0.25 } as const;
const GLIDER = [[1, 0], [2, 1], [0, 2], [1, 2], [2, 2]] as const;

export function buildLife() {
  const table = createSourceTable();
  const cells = table.declare({
    glider: event(),
    clear: event(),
    pause: event(),
    dt: input([0, 0.1]),
    clock: state([0, 1]),
    running: stateBit(1),
    alive: list(GRID.size * GRID.size, () => stateBit(0)),
    toggles: list(GRID.size * GRID.size, () => event()),
    generation: state([0, 1e7]),
  });
  const circuit = table.createCircuit();
  const { all, not, is, atLeast, either } = gates(circuit);
  const at = (x: number, y: number) => cells.alive[((y + GRID.size) % GRID.size) * GRID.size + ((x + GRID.size) % GRID.size)] as Wire;
  const running = circuit.affine([[cells.running, 1], [cells.pause, 1], [circuit.multiply(cells.pause, cells.running), -2]]);
  const advanced = circuit.affine([[cells.clock, 1], [circuit.multiply(running, cells.dt), 1 / GRID.period]]);
  const tick = atLeast(advanced, circuit.constant(1));
  const clock = emitSelect(circuit, tick, advanced, circuit.constant(0));
  const gliderCells = new Set(GLIDER.map(([x, y]) => `${x + 1},${y + 1}`));
  const next = cells.alive.map((cell, index) => {
    const x = index % GRID.size;
    const y = Math.floor(index / GRID.size);
    const neighbors = circuit.affine(
      [-1, 0, 1].flatMap((dy) => [-1, 0, 1].filter((dx) => dx !== 0 || dy !== 0).map((dx) => [at(x + dx, y + dy), 1] as const)),
    );
    const born = is(neighbors, 3);
    const survives = all(cell, is(neighbors, 2));
    const stepped = either(born, survives);
    const evolved = emitSelect(circuit, tick, cell, stepped);
    const cleared = all(evolved, not(cells.clear));
    const seeded = gliderCells.has(`${x},${y}`) ? either(cleared, cells.glider) : cleared;
    return { wire: seeded };
  });
  const toggles = cells.toggles;
  const alive = next.map(({ wire }, i) => {
    const toggle = toggles[i] as Wire;
    return circuit.affine([[wire, 1], [toggle, 1], [circuit.multiply(toggle, wire), -2]]);
  });
  cells.alive.forEach((cell, i) => table.next(cell, alive[i] as Wire));
  table.next(cells.clock, clock);
  table.next(cells.running, running);
  table.next(cells.generation, circuit.affine([[cells.generation, 1], [tick, 1]]));
  const population = circuit.affine(alive.map((wire) => [wire, 1] as const));
  const output = { alive, population, generation: cells.generation, running };
  const layout = Array.from({ length: GRID.size }, (_, y) => ({
    label: `row ${y + 1}`,
    wires: wiresOf(cells.alive.slice(y * GRID.size, (y + 1) * GRID.size)),
  }));
  const events: Record<string, Wire> = { glider: cells.glider, clear: cells.clear, pause: cells.pause };
  toggles.forEach((wire, i) => {
    events[`toggle${i}`] = wire;
  });
  return { ...table.finish(), output, events, dt: cells.dt, layout };
}

export const createLife = () => createTicker(buildLife());
type Frame = ReturnType<ReturnType<typeof createLife>['step']>;

export const lifePage = definePage({
  slug: 'life',
  title: 'game of life',
  topic: 'cellular automata · emergence',
  lesson:
    'Every square follows one rule: it is born with exactly 3 live neighbors, and survives with 2 or 3. That is all. Drop a glider and watch a shape walk across the grid, though no square ever moves. Tap squares to draw your own.',
  eye: [0, 11, 3],
  make: createLife,
  controls: [
    { kind: 'button', label: 'drop glider', event: 'glider' },
    { kind: 'button', label: 'pause / play', event: 'pause' },
    { kind: 'button', label: 'clear', event: 'clear' },
  ],
  view: ({ scene, pick, renderer }, ticker) => {
    const tiles = Array.from({ length: GRID.size * GRID.size }, (_, i) => {
      const tile = box(0.9, 0.2, 0.9, 0x1e293b);
      tile.position.set((i % GRID.size) - GRID.size / 2 + 0.5, 0, Math.floor(i / GRID.size) - GRID.size / 2 + 0.5);
      tile.userData.index = i;
      scene.add(tile);
      return tile;
    });
    renderer.domElement.addEventListener('pointerdown', (event) => {
      const hit = pick(event, tiles);
      if (hit !== null) ticker.press(`toggle${hit.userData.index as number}`);
    });
    return (frame: Frame) => {
      tiles.forEach((tile, i) => {
        const on = frame.alive[i] === 1;
        (tile.material as THREE.MeshStandardMaterial).color.setHex(on ? 0xf6821f : 0x1e293b);
        tile.scale.y = on ? 3 : 1;
        tile.position.y = on ? 0.3 : 0;
      });
      return `generation ${frame.generation} · ${frame.population} alive${frame.running === 1 ? '' : ' · paused'}`;
    };
  },
});

void DT;
