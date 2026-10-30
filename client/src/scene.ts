import * as THREE from 'three';

export type Scene = {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly aim: (x: number, y: number, z: number) => void;
  readonly pick: (event: PointerEvent, objects: readonly THREE.Object3D[]) => THREE.Object3D | null;
};

export function makeScene(canvas: HTMLCanvasElement, eye: THREE.Vector3Tuple): Scene {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b1118);
  scene.fog = new THREE.Fog(0x0b1118, 18, 40);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  const home = new THREE.Vector3(...eye);
  const focus = new THREE.Vector3();
  camera.position.copy(home);
  camera.lookAt(focus);
  scene.add(new THREE.HemisphereLight(0xf7f9fb, 0x111a24, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.position.set(6, 12, 5);
  sun.castShadow = true;
  scene.add(sun);
  const raycaster = new THREE.Raycaster();
  const resize = () => {
    const { clientWidth, clientHeight } = canvas;
    renderer.setSize(clientWidth, clientHeight, false);
    camera.aspect = clientWidth / Math.max(1, clientHeight);
    const pullBack = Math.max(1, 1.5 / camera.aspect);
    camera.position.copy(focus).add(home.clone().sub(focus).multiplyScalar(pullBack));
    camera.lookAt(focus);
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(canvas);
  resize();
  const pick = (event: PointerEvent, objects: readonly THREE.Object3D[]) => {
    const rect = canvas.getBoundingClientRect();
    raycaster.setFromCamera(
      new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      ),
      camera,
    );
    return raycaster.intersectObjects([...objects], true)[0]?.object ?? null;
  };
  const aim = (x: number, y: number, z: number) => {
    focus.set(x, y, z);
    resize();
  };
  return { renderer, scene, camera, pick, aim };
}

export const box = (w: number, h: number, d: number, color: number) => {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color, roughness: 0.6 }),
  );
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
};

export function loop(step: () => void) {
  const frame = () => {
    step();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
