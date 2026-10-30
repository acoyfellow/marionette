import * as THREE from 'three';
import { mountTickerPanel } from './panel';
import { createPet, MOOD } from './pet';
import { box, loop, makeScene } from './scene';

const MOOD_COLOR = [0xf6821f, 0xf43f5e, 0x818cf8, 0x64748b] as const;
const MOOD_FACE = ['◕‿◕', '◕︵◕', '−_−  z', '◔_◔'] as const;

export function mountPet(canvas: HTMLCanvasElement, panel: HTMLElement, hud: HTMLElement) {
  const { renderer, scene, camera, pick } = makeScene(canvas, [0, 4, 9]);
  const floor = box(20, 0.1, 20, 0x111a24);
  floor.position.y = -0.05;
  scene.add(floor);
  const material = new THREE.MeshStandardMaterial({ color: MOOD_COLOR[0], roughness: 0.25, metalness: 0.05 });
  const blob = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), material);
  blob.castShadow = true;
  scene.add(blob);
  const eyes = [-0.35, 0.35].map((x) => {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12), new THREE.MeshStandardMaterial({ color: 0x0b1118 }));
    eye.position.set(x, 0.25, 0.92);
    blob.add(eye);
    return eye;
  });
  const food = new THREE.Mesh(new THREE.DodecahedronGeometry(0.35), new THREE.MeshStandardMaterial({ color: 0x34d399 }));
  food.position.set(2.6, 0.35, 1);
  scene.add(food);

  const pet = createPet();
  canvas.addEventListener('pointerdown', (event) => {
    if (pick(event, [food])) pet.press('feed');
    else if (pick(event, [blob])) pet.press('poke');
  });
  const panelView = mountTickerPanel(panel, pet, createPet, 'poke the blob, click the green snack');

  const bars = document.createElement('div');
  bars.className = 'mt-2 grid grid-cols-[70px_1fr] items-center gap-x-2 gap-y-1 font-mono text-[11px] text-slate-300';
  const meter = (label: string, color: string) => {
    const name = document.createElement('span');
    name.textContent = label;
    const track = document.createElement('div');
    track.className = 'h-2 rounded bg-white/10';
    const fill = document.createElement('div');
    fill.className = 'h-2 rounded';
    fill.style.background = color;
    track.appendChild(fill);
    bars.appendChild(name);
    bars.appendChild(track);
    return (value: number) => {
      fill.style.width = `${Math.round(value * 100)}%`;
    };
  };
  const setHunger = meter('hunger', '#f43f5e');
  const setSleep = meter('sleepy', '#818cf8');
  const setHappy = meter('happy', '#f6821f');
  panel.appendChild(bars);

  let t = 0;
  loop(() => {
    t += 1 / 60;
    const frame = pet.step();
    const size = 1 + frame.growth * 0.6;
    const sleepy = frame.mood === 2 ? 0.25 : 1;
    blob.scale.set(size * (1 + frame.squish * 0.35), size * (1 - frame.squish * 0.5) * (1 + Math.sin(t * 2) * 0.02), size * (1 + frame.squish * 0.35));
    blob.position.y = blob.scale.y;
    eyes.forEach((eye) => eye.scale.set(1, sleepy, 1));
    material.color.setHex(MOOD_COLOR[frame.mood] ?? MOOD_COLOR[0]);
    food.rotation.y = t;
    setHunger(frame.hunger);
    setSleep(frame.sleepiness);
    setHappy(frame.happiness);
    hud.textContent = `${MOOD_FACE[frame.mood] ?? ''}  ${MOOD[frame.mood] ?? ''}`;
    panelView();
    renderer.render(scene, camera);
  });
}
