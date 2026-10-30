import * as THREE from 'three';
import { createSourceTable, event, input, list, state, stateBit } from 'handwired/src/runtime/cells.ts';
import { emitRelu, emitSelect, type Wire } from 'handwired/src/runtime/numeric-ui-core.ts';
import { definePage } from '../kit';
import { box } from '../scene';
import { createTicker, DT, gates, wiresOf } from '../ticker';

export const LB = { servers: 4, drain: 6, maxQueue: 40 } as const;

export function buildBalancer() {
  const table = createSourceTable();
  const cells = table.declare({
    dt: input([0, 0.1]),
    rate: input([0, 30]),
    kill: list(LB.servers, () => event()),
    carry: state([0, 1]),
    servers: list(LB.servers, () => ({ queue: state([0, LB.maxQueue]), up: stateBit(1), served: state([0, 1e7]) })),
    dropped: state([0, 1e7]),
  });
  const circuit = table.createCircuit();
  const { all, not, above, atLeast, either } = gates(circuit);
  const flip = (bit: Wire, toggle: Wire) => circuit.affine([[bit, 1], [toggle, 1], [circuit.multiply(toggle, bit), -2]]);
  const arrivals = circuit.affine([[cells.carry, 1], [cells.rate, DT]]);
  const arrive = atLeast(arrivals, circuit.constant(1));
  const carry = circuit.affine([[arrivals, 1], [arrive, -1]]);
  const ups = cells.servers.map((server, i) => flip(server.up, cells.kill[i] ?? circuit.constant(0)));
  const score = cells.servers.map((server, i) =>
    circuit.affine([[server.queue, 1], [not(ups[i] ?? circuit.constant(0)), 1000]]),
  );
  const chosen = score.map((mine, i) =>
    score
      .map((other, j) => (j === i ? circuit.constant(1) : j < i ? above(circuit.affine([[other, 1], [mine, -1]]), 0) : atLeast(other, mine)))
      .reduce((a, b) => all(a, b)),
  );
  const anyUp = ups.reduce((a, b) => either(a, b));
  const servers = cells.servers.map((server, i) => {
    const up = ups[i] ?? circuit.constant(0);
    const assigned = all(arrive, anyUp, chosen[i] ?? circuit.constant(0));
    const work = circuit.multiply(up, emitRelu(circuit, circuit.affine([[server.queue, 1]])));
    const done = emitSelect(circuit, above(work, LB.drain * DT), work, circuit.constant(LB.drain * DT));
    const lost = circuit.multiply(not(up), server.queue);
    const queue = emitRelu(circuit, circuit.affine([[server.queue, 1], [assigned, 1], [done, -1], [lost, -1]]));
    table.next(server.queue, queue);
    table.next(server.up, up);
    table.next(server.served, circuit.affine([[server.served, 1], [done, 1]]));
    return { queue, up, assigned, lost };
  });
  const dropped = circuit.affine([
    [cells.dropped, 1],
    [all(arrive, not(anyUp)), 1],
    ...servers.map((server) => [server.lost, 1] as const),
  ]);
  table.next(cells.dropped, dropped);
  table.next(cells.carry, carry);
  const output = { servers, dropped, arrive };
  const layout = [
    ...cells.servers.map((server, i) => ({ label: `server ${i + 1}`, wires: wiresOf(server) })),
    { label: 'front', wires: wiresOf({ c: cells.carry, d: cells.dropped }) },
  ];
  const events = Object.fromEntries(cells.kill.map((bit, i) => [`kill${i}`, bit])) as Record<string, Wire>;
  return { ...table.finish(), output, events, inputs: { rate: cells.rate }, dt: cells.dt, layout };
}

export const createBalancer = () => createTicker(buildBalancer());
type Frame = ReturnType<ReturnType<typeof createBalancer>['step']>;

export const balancerPage = definePage({
  slug: 'balancer',
  title: 'load balancer',
  topic: 'least-connections routing · failover',
  lesson:
    'Every request goes to the server with the shortest line. Unplug a server: its queue is lost, and new requests flow around it to the healthy ones. Plug it back and it fills up again.',
  eye: [0, 8, 8],
  make: createBalancer,
  controls: [
    { kind: 'slider', label: 'requests/s', input: 'rate', min: 0, max: 30, step: 1, initial: 12 },
    ...Array.from({ length: LB.servers }, (_, i) => ({ kind: 'button' as const, label: `unplug/plug ${i + 1}`, event: `kill${i}` })),
  ],
  view: ({ scene }) => {
    const front = box(1.4, 1, 1.4, 0xf6821f);
    front.position.set(-4, 0.5, 0);
    scene.add(front);
    const servers = Array.from({ length: LB.servers }, (_, i) => {
      const server = box(1, 1.6, 1, 0x34d399);
      const z = (i - (LB.servers - 1) / 2) * 1.8;
      server.position.set(3, 0.8, z);
      scene.add(server);
      const stack = Array.from({ length: 10 }, (_, k) => {
        const item = box(0.35, 0.35, 0.35, 0x71b8d8);
        item.position.set(2.1 - k * 0.42, 0.2, z);
        scene.add(item);
        return item;
      });
      const wire = box(5.2, 0.04, 0.04, 0x475569);
      wire.position.set(-0.6, 0.1, z * 0.5);
      wire.rotation.y = -Math.atan2(z, 7);
      scene.add(wire);
      return { server, stack, wire };
    });
    let flash = 0;
    return (frame: Frame) => {
      flash = frame.arrive === 1 ? 1 : flash * 0.85;
      (front.material as THREE.MeshStandardMaterial).emissive.setRGB(flash * 0.4, flash * 0.2, 0);
      frame.servers.forEach((server, i) => {
        const view = servers[i];
        if (view === undefined) return;
        (view.server.material as THREE.MeshStandardMaterial).color.setHex(server.up === 1 ? 0x34d399 : 0x475569);
        view.server.rotation.z = server.up === 1 ? 0 : 0.4;
        view.stack.forEach((item, k) => {
          item.visible = k < Math.ceil(server.queue);
        });
        (view.wire.material as THREE.MeshStandardMaterial).color.setHex(server.assigned === 1 ? 0xf6821f : 0x475569);
      });
      const queues = frame.servers.map((server) => (server.up === 1 ? server.queue.toFixed(0) : '✕')).join(' · ');
      return `queues ${queues} · dropped ${Math.round(frame.dropped)}`;
    };
  },
});
