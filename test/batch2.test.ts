import { describe, expect, it } from 'vitest';
import { createDrone, DRONE } from '../client/src/pages/drone';
import { createFireflies, spread } from '../client/src/pages/fireflies';
import { createRailway, TRACK } from '../client/src/pages/railway';
import { identical, replayTicker } from '../client/src/ticker';

const seconds = (s: number) => Math.round(s * 60);
const run = <T>(step: () => T, frames: number) => {
  let last = step();
  for (let i = 1; i < frames; i += 1) last = step();
  return last;
};
const tune = (drone: ReturnType<typeof createDrone>, kp: number, ki: number, kd: number) => {
  drone.set('kp', kp);
  drone.set('ki', ki);
  drone.set('kd', kd);
  drone.set('target', DRONE.target);
};

describe('drone PID circuit', () => {
  it('settles at the target with a good tune', () => {
    const drone = createDrone();
    tune(drone, 8, 1, 4);
    expect(Math.abs(run(drone.step, seconds(15)).error)).toBeLessThan(0.05);
  });

  it('overshoots more without D', () => {
    const peak = (kd: number) => {
      const drone = createDrone();
      tune(drone, 8, 1, kd);
      let top = 0;
      for (let i = 0; i < seconds(6); i += 1) top = Math.max(top, drone.step().height);
      return top;
    };
    expect(peak(0)).toBeGreaterThan(peak(4) + 0.3);
  });

  it('cannot lift off with P, I and D at zero', () => {
    const drone = createDrone();
    tune(drone, 0, 0, 0);
    expect(run(drone.step, seconds(3)).height).toBeLessThan(0.6);
  });

  it('recovers from a gust', () => {
    const drone = createDrone();
    tune(drone, 8, 1, 4);
    run(drone.step, seconds(8));
    drone.press('gust');
    const hit = run(drone.step, seconds(0.5));
    expect(hit.error).toBeGreaterThan(0.1);
    expect(Math.abs(run(drone.step, seconds(15)).error)).toBeLessThan(0.05);
  });

  it('replays bit for bit', () => {
    const drone = createDrone();
    tune(drone, 6, 2, 3);
    run(drone.step, 100);
    drone.press('gust');
    drone.set('kd', 0.5);
    run(drone.step, 200);
    expect(identical(replayTicker(createDrone, drone.journal()), drone.snapshot())).toBe(true);
  });
});

describe('railway interlock circuit', () => {
  it('never lets both trains into the block together', () => {
    const rail = createRailway();
    rail.press('sendA');
    rail.press('sendB');
    for (let i = 0; i < seconds(20); i += 1) expect(rail.step().crash).toBe(0);
  });

  it('holds train B at red while the switch points at A', () => {
    const rail = createRailway();
    rail.press('sendB');
    const waiting = run(rail.step, seconds(5));
    expect(waiting.trains[1]?.position).toBeLessThan(TRACK.junction - TRACK.block);
    expect(waiting.trains[1]?.held).toBe(1);
    rail.press('throwSwitch');
    expect(run(rail.step, seconds(3)).trains[1]?.position).toBeGreaterThan(TRACK.junction);
  });

  it('refuses to throw the switch while the block is occupied', () => {
    const rail = createRailway();
    rail.press('sendA');
    run(rail.step, seconds(TRACK.junction / TRACK.speed));
    rail.press('throwSwitch');
    const frame = rail.step();
    expect(frame.refused).toBe(1);
    expect(frame.switchToB).toBe(0);
  });

  it('replays bit for bit', () => {
    const rail = createRailway();
    rail.press('sendA');
    run(rail.step, 90);
    rail.press('sendB');
    run(rail.step, 300);
    rail.press('throwSwitch');
    run(rail.step, 200);
    expect(identical(replayTicker(createRailway, rail.journal()), rail.snapshot())).toBe(true);
  });
});

describe('firefly sync circuit', () => {
  it('syncs with pull, stays scattered without it', () => {
    const synced = createFireflies();
    synced.set('coupling', 0.08);
    const apart = createFireflies();
    apart.set('coupling', 0);
    const start = spread(synced.step().phases);
    expect(spread(run(synced.step, seconds(40)).phases)).toBeGreaterThan(0.95);
    expect(spread(run(apart.step, seconds(40)).phases)).toBeLessThan(Math.max(0.6, start + 0.1));
  });

  it('scatter breaks the sync', () => {
    const swarm = createFireflies();
    swarm.set('coupling', 0.08);
    run(swarm.step, seconds(40));
    swarm.press('scatter');
    expect(spread(swarm.step().phases)).toBeLessThan(0.7);
  });

  it('replays bit for bit', () => {
    const swarm = createFireflies();
    swarm.set('coupling', 0.12);
    run(swarm.step, 300);
    swarm.press('scatter');
    run(swarm.step, 200);
    expect(identical(replayTicker(createFireflies, swarm.journal()), swarm.snapshot())).toBe(true);
  });
});
