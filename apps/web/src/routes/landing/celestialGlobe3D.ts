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
  emergence: number;
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

  const globe = new THREE.Group();
  scene.add(globe);
  let disposed = false;
  let loaded = false;
  let modelDiameter = 1;
  let lastOpacity = -1;
  const materials: MeshStandardMaterial[] = [];
  const shardUniforms: Array<{ value: number }> = [];

  new GLTFLoader().load(
    MODEL_URL,
    ({ scene: model }) => {
      if (disposed) return;
      // The museum scan is the exposed upper hemisphere. Sketchfab rotates it
      // upright inside the stand; face the authentic cap toward our camera.
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
      model.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const list = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of list) {
          if (material instanceof THREE.MeshStandardMaterial) {
            material.transparent = true;
            material.metalnessMap?.dispose();
            material.metalnessMap = null;
            material.metalness = 0;
            material.roughness = 1;
            material.onBeforeCompile = (shader) => {
              shader.uniforms.uShardReveal = { value: 1 };
              shader.fragmentShader = shader.fragmentShader.replace(
                "#include <common>",
                "uniform float uShardReveal;\n#include <common>",
              ).replace(
                "#include <dithering_fragment>",
                `#ifdef USE_MAP
                if (uShardReveal < 0.999) {
                  vec2 shardCell = floor(vMapUv * 42.0);
                  float shard = fract(sin(dot(shardCell, vec2(12.9898, 78.233))) * 43758.5453);
                  if (shard > uShardReveal) discard;
                }
                #endif
                #include <dithering_fragment>`,
              );
              shardUniforms.push(shader.uniforms.uShardReveal);
            };
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
      if (frame.opacity !== lastOpacity) {
        lastOpacity = frame.opacity;
        for (const material of materials) material.opacity = frame.opacity;
      }
      for (const uniform of shardUniforms) uniform.value = frame.emergence;
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
