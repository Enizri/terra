import type { MeshStandardMaterial, WebGLRenderer } from "three";

const MODEL_URL = "/terra/models/celestial-globe-sphere.glb";

export type CelestialGlobeFrame = {
  width: number;
  height: number;
  diameter: number;
  x: number;
  y: number;
  yaw: number;
  pitch: number;
  spin: number;
  opacity: number;
  /** Warm backlight so the hall composite reads as one object. */
  hallLight?: number;
};

export type CelestialGlobeRenderer = {
  resize: (width: number, height: number, dpr: number) => void;
  render: (frame: CelestialGlobeFrame) => void;
  dispose: () => void;
};

/** Draws the isolated CC0 museum sphere behind the existing glyph canvas. */
export async function createCelestialGlobeRenderer(
  canvas: HTMLCanvasElement,
  onReady: () => void,
): Promise<CelestialGlobeRenderer | null> {
  const THREE = await import("three");
  const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
  let renderer: WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      powerPreference: "high-performance",
    });
  } catch {
    return null;
  }

  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 4000);
  camera.position.z = 1000;
  scene.add(new THREE.AmbientLight(0xffffff, 2.2));
  const key = new THREE.DirectionalLight(0xfff4dc, 2.8);
  key.position.set(-3, 4, 6);
  scene.add(key);
  const hall = new THREE.DirectionalLight(0xff9a40, 0);
  hall.position.set(0.2, -0.4, -6);
  scene.add(hall);

  const globe = new THREE.Group();
  scene.add(globe);
  let disposed = false;
  let loaded = false;
  let modelDiameter = 1;
  let lastOpacity = -1;
  const materials: MeshStandardMaterial[] = [];

  new GLTFLoader().load(
    MODEL_URL,
    ({ scene: model }) => {
      if (disposed) return;
      // Photogrammetry of the museum sphere, minus the stand. Close any scan
      // holes with a solid core so the hall never shows through the mesh.
      model.position.set(0, 0, 0);
      model.rotation.set(0, 0, 0);
      model.scale.set(1, 1, 1);
      globe.add(model);
      globe.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(globe);
      const center = bounds.getCenter(new THREE.Vector3());
      const size = bounds.getSize(new THREE.Vector3());
      model.position.sub(center);
      modelDiameter = Math.max(size.x, size.y, size.z);
      const coreMaterial = new THREE.MeshStandardMaterial({
        color: 0xb8893a,
        roughness: 1,
        metalness: 0,
        emissive: 0x4a2a08,
        emissiveIntensity: 0.2,
      });
      const core = new THREE.Mesh(
        new THREE.SphereGeometry(modelDiameter * 0.46, 64, 48),
        coreMaterial,
      );
      core.renderOrder = -1;
      globe.add(core);
      materials.push(coreMaterial);
      model.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const list = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of list) {
          if (material instanceof THREE.MeshStandardMaterial) {
            material.side = THREE.FrontSide;
            material.depthWrite = true;
            material.metalnessMap?.dispose();
            material.metalnessMap = null;
            material.metalness = 0;
            material.roughness = 1;
            material.needsUpdate = true;
            materials.push(material);
          }
        }
      });
      loaded = true;
      onReady();
    },
    undefined,
    () => onReady(),
  );

  return {
    resize(width, height, dpr) {
      renderer.setPixelRatio(Math.min(1.5, dpr));
      renderer.setSize(width, height, false);
      camera.left = -width / 2;
      camera.right = width / 2;
      camera.top = height / 2;
      camera.bottom = -height / 2;
      camera.updateProjectionMatrix();
    },
    render(frame) {
      renderer.clear();
      if (!loaded || frame.opacity <= 0) return;
      globe.position.set(frame.x - frame.width / 2, frame.height / 2 - frame.y, 0);
      globe.scale.setScalar(frame.diameter / modelDiameter);
      globe.rotation.set(frame.pitch, frame.yaw, frame.spin);
      hall.intensity = frame.hallLight ?? 0;
      if (frame.opacity !== lastOpacity) {
        lastOpacity = frame.opacity;
        const opaque = frame.opacity >= 0.999;
        for (const material of materials) {
          material.opacity = frame.opacity;
          material.transparent = !opaque;
          material.depthWrite = true;
        }
      }
      renderer.render(scene, camera);
    },
    dispose() {
      disposed = true;
      globe.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        object.geometry.dispose();
        const list = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of list) {
          if (material instanceof THREE.MeshStandardMaterial) {
            material.map?.dispose();
            material.metalnessMap?.dispose();
          }
          material.dispose();
        }
      });
      renderer.dispose();
    },
  };
}
