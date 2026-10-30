import * as THREE from 'three';
import { mountTickerPanel } from './panel';
import { box, loop, makeScene } from './scene';
import { CARS, createTraffic, LANE, STOP } from './traffic';

const LIGHT = [0x34d399, 0xfbbf24, 0xef4444] as const;
const PHASE_NAMES = ['main green', 'main yellow', 'cross green', 'cross yellow', 'walk'] as const;

function signal(scene: THREE.Scene, x: number, z: number, facing: number) {
  const pole = box(0.15, 2.4, 0.15, 0x334155);
  pole.position.set(x, 1.2, z);
  scene.add(pole);
  const lamps = LIGHT.map((_, index) => {
    const lamp = new THREE.Mesh(
      new THREE.SphereGeometry(0.2, 16, 12),
      new THREE.MeshStandardMaterial({ color: 0x1f2937, emissive: 0x000000 }),
    );
    lamp.position.set(x + Math.cos(facing) * 0.2, 2.6 - index * 0.45, z + Math.sin(facing) * 0.2);
    scene.add(lamp);
    return lamp;
  });
  return (state: number) =>
    lamps.forEach((lamp, index) => {
      const on = index === state;
      lamp.material.color.setHex(on ? (LIGHT[index] ?? 0) : 0x1f2937);
      lamp.material.emissive.setHex(on ? (LIGHT[index] ?? 0) : 0x000000);
    });
}

export function mountTraffic(canvas: HTMLCanvasElement, panel: HTMLElement, hud: HTMLElement) {
  const { renderer, scene, camera, pick } = makeScene(canvas, [11, 12, 13]);
  const ground = box(30, 0.1, 30, 0x111a24);
  ground.position.y = -0.05;
  scene.add(ground);
  const roadMain = box(LANE * 2 + 6, 0.02, 3, 0x1e293b);
  const roadCross = box(3, 0.02, LANE * 2 + 6, 0x1e293b);
  scene.add(roadMain, roadCross);
  for (const [x, z, w, d] of [
    [STOP, 0, 0.15, 3],
    [0, STOP, 3, 0.15],
  ] as const) {
    const line = box(w, 0.03, d, 0xe2e8f0);
    line.position.set(x, 0.02, z);
    scene.add(line);
  }
  const zebra = Array.from({ length: 5 }, (_, i) => {
    const stripe = box(0.4, 0.03, 2.6, 0xe2e8f0);
    stripe.position.set(2.2, 0.02, -1 + i * 0.5 - 0.0);
    stripe.rotation.y = Math.PI / 2;
    stripe.position.set(2.4, 0.02, -1.2 + i * 0.6);
    scene.add(stripe);
    return stripe;
  });
  const showMain = signal(scene, STOP - 0.3, 2, 0);
  const showCross = signal(scene, 2, STOP - 0.3, Math.PI / 2);
  const button = box(0.6, 0.8, 0.6, 0x60a5fa);
  button.position.set(3.6, 0.4, 3.6);
  scene.add(button);
  const walker = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.25, 0.6, 4, 8),
    new THREE.MeshStandardMaterial({ color: 0xf6821f }),
  );
  walker.position.set(2.4, 0.6, 2.4);
  scene.add(walker);
  const cars = CARS.map((each) => {
    const car = box(each.road === 'main' ? 1.6 : 0.9, 0.7, each.road === 'main' ? 0.9 : 1.6, each.road === 'main' ? 0xf6821f : 0x71b8d8);
    scene.add(car);
    return car;
  });

  const traffic = createTraffic();
  canvas.addEventListener('pointerdown', (event) => {
    if (pick(event, [button])) traffic.press('press');
  });
  const panelView = mountTickerPanel(panel, traffic, createTraffic, 'press the blue button: it sets one bit');

  let walkT = 0;
  loop(() => {
    const frame = traffic.step();
    showMain(frame.mainLight);
    showCross(frame.crossLight);
    button.material.emissive.setHex(frame.request === 1 ? 0x1d4ed8 : 0x000000);
    walkT = frame.walk === 1 ? Math.min(1, walkT + 1 / 240) : 0;
    walker.position.z = 2.4 - walkT * 4.8;
    zebra.forEach((stripe) => stripe.material.color.setHex(frame.walk === 1 ? 0xffffff : 0x64748b));
    frame.cars.forEach((each, index) => {
      const mesh = cars[index];
      const road = CARS[index]?.road;
      if (mesh === undefined) return;
      if (road === 'main') mesh.position.set(each.position, 0.4, 0.7);
      else mesh.position.set(-0.7, 0.4, each.position);
    });
    hud.textContent = `${PHASE_NAMES[frame.phase] ?? '?'} · ${frame.timer.toFixed(1)} s${frame.request === 1 ? ' · walk requested' : ''}`;
    panelView();
    renderer.render(scene, camera);
  });
}
