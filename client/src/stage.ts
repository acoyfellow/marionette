import * as THREE from 'three';
import {
  COUNT,
  createPuppeteer,
  FLOOR,
  GROW,
  type Puppeteer,
  quantize,
  type StageOutput,
} from './strings';

export type Frame = {
  readonly output: StageOutput;
  readonly stepMicros: number;
};

const COLORS = { idle: 0xf6821f, hover: 0xf7b53b, selected: 0x71b8d8 } as const;

const colorFor = (cube: StageOutput['cubes'][number]) =>
  cube.selected === 1 ? COLORS.selected : cube.hovered === 1 ? COLORS.hover : COLORS.idle;

export type Stage = {
  readonly puppeteer: Puppeteer;
  readonly onFrame: (listener: (frame: Frame) => void) => void;
};

export function mountStage(canvas: HTMLCanvasElement): Stage {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b1118);
  scene.fog = new THREE.Fog(0x0b1118, 14, 30);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(7, 9, 9);
  camera.lookAt(0, 0, 0);

  scene.add(new THREE.HemisphereLight(0xf7f9fb, 0x111a24, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(5, 10, 4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  scene.add(sun);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(FLOOR * 2, FLOOR * 2),
    new THREE.MeshStandardMaterial({ color: 0x111a24, roughness: 0.95 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  scene.add(new THREE.GridHelper(FLOOR * 2, FLOOR * 2, 0x2a3a4a, 0x182431));

  const cubes = Array.from({ length: COUNT }, () => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, 1.2, 1.2),
      new THREE.MeshStandardMaterial({ color: COLORS.idle, roughness: 0.35, metalness: 0.1 }),
    );
    mesh.castShadow = true;
    scene.add(mesh);
    return mesh;
  });

  const puppeteer = createPuppeteer();
  const raycaster = new THREE.Raycaster();
  const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();
  const listeners: ((frame: Frame) => void)[] = [];

  const toFloor = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, camera);
    return raycaster.ray.intersectPlane(ground, hit) === null
      ? null
      : { x: quantize(hit.x), z: quantize(hit.z) };
  };

  let scheduled: number | null = null;
  const schedule = () => {
    scheduled ??= requestAnimationFrame(render);
  };

  const queueFrom = (kind: 'down' | 'up' | 'move') => (event: PointerEvent) => {
    const point = toFloor(event);
    if (point === null) return;
    if (kind === 'down') canvas.setPointerCapture(event.pointerId);
    puppeteer.queue({ kind, ...point, timeStamp: event.timeStamp });
    schedule();
  };

  canvas.addEventListener('pointerdown', queueFrom('down'));
  canvas.addEventListener('pointerup', queueFrom('up'));
  canvas.addEventListener('pointermove', queueFrom('move'));

  const resize = () => {
    const { clientWidth, clientHeight } = canvas;
    renderer.setSize(clientWidth, clientHeight, false);
    camera.aspect = clientWidth / Math.max(1, clientHeight);
    camera.updateProjectionMatrix();
    schedule();
  };
  new ResizeObserver(resize).observe(canvas);

  function render(frameTime: number) {
    scheduled = null;
    const started = performance.now();
    const output = puppeteer.step(frameTime);
    const stepMicros = Math.round((performance.now() - started) * 1000);

    output.cubes.forEach((cube, index) => {
      const mesh = cubes[index];
      if (mesh === undefined) return;
      const scale = 1 + cube.lift * (GROW / 1.2);
      mesh.position.set(cube.x, 0.6 + cube.lift, cube.z);
      mesh.scale.setScalar(scale);
      mesh.material.color.setHex(colorFor(cube));
    });

    renderer.render(scene, camera);
    for (const listener of listeners) listener({ output, stepMicros });
    if (puppeteer.animating()) schedule();
  }

  resize();

  return {
    puppeteer,
    onFrame: (listener) => {
      listeners.push(listener);
    },
  };
}
