import * as THREE from "three";
import { loadGLTF } from "$lib/three/loader";

const MODEL_PATH = "/models/unterwasser%20stadt/la_night_city.glb";

let _cachedScene: THREE.Group | null = null;
let _cachedScale = 1;
let _cachedOffset = new THREE.Vector3();
let _domeRadius = 12;
let _domeHeight = 10;
let _modelLoadFailed = false;
let _loadResolve: (() => void) | null = null;
let _loadPromise: Promise<void> | null = null;

function _ensureLoadStarted(): void {
  if (_loadPromise) return; // already started
  _loadPromise = new Promise((resolve) => {
    _loadResolve = resolve;
  });
  _loadGLB().catch(() => {
    // Errors already logged by _loadGLB; ensure promise resolves.
  });
}

async function _loadGLB(): Promise<void> {
  // Skip entirely on the server: fetch("/models/...") has no origin in SSR.
  if (typeof window === "undefined") {
    _modelLoadFailed = true;
    _loadResolve?.();
    return;
  }
  try {
    // Resolve absolute /models/... path against the current origin so it
    // works whether we're on https://localhost:5173 or http://<lan-ip>:5173.
    const url = new URL(MODEL_PATH, window.location.origin).href;
    const gltf = await loadGLTF(url);
    const src = gltf.scene;
    src.updateWorldMatrix(true, false);

    const box = new THREE.Box3().setFromObject(src);
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const modelWorldSize = 100;
    _cachedScale = modelWorldSize / maxDim;
    const center = box.getCenter(new THREE.Vector3());
    const bmin = box.min;
    _cachedOffset.set(
      -center.x * _cachedScale,
      -bmin.y * _cachedScale,
      -center.z * _cachedScale,
    );
    _domeRadius = modelWorldSize * 0.5 * 1.3;
    _domeHeight = Math.max(size.y * _cachedScale * 0.5 + 2, _domeRadius * 0.6);

    src.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const mat = child.material as THREE.MeshStandardMaterial;
        if (mat) {
          mat.roughness = 0.4;
          mat.metalness = 0.3;
        }
      }
    });

    _cachedScene = src;
  } catch (e) {
    console.warn("ModelCity: GLB load failed, using procedural fallback", e);
    _modelLoadFailed = true;
  } finally {
    _loadResolve?.();
  }
}

export function ensureModelLoaded(): Promise<void> {
  _ensureLoadStarted();
  return _loadPromise as Promise<void>;
}

export function isModelReady(): boolean {
  return _cachedScene !== null;
}

export function isModelFailed(): boolean {
  return _modelLoadFailed;
}

export type ModelCityVariant = "stadt";

export interface ModelCityResult {
  group: THREE.Group;
  structureGroup: THREE.Group;
  domeMat: THREE.MeshStandardMaterial;
  pointLight: THREE.PointLight;
}

// Synchronous creation – returns null if model hasn't loaded yet
function _createModelCityScene(): ModelCityResult {
  const group = new THREE.Group();
  const structureGroup = new THREE.Group();

  if (_cachedScene) {
    const model = _cachedScene.clone();
    model.scale.setScalar(_cachedScale);
    model.position.copy(_cachedOffset);
    structureGroup.add(model);
  }

  const light = new THREE.PointLight(0xaaccff, 15, 200);
  light.position.set(0, _domeHeight * 0.6, 0);
  light.userData.baseIntensity = 15;
  group.add(light);

  const domeMat = new THREE.MeshStandardMaterial({
    color: 0x4488aa,
    emissive: 0x224466,
    emissiveIntensity: 0.1,
    transparent: true,
    opacity: 0.15,
    roughness: 0.1,
    metalness: 0.0,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const domeGeo = new THREE.SphereGeometry(
    _domeRadius,
    32,
    24,
    0,
    Math.PI * 2,
    0,
    Math.PI / 2,
  );
  const dome = new THREE.Mesh(domeGeo, domeMat);
  dome.position.y = 0;
  structureGroup.add(dome);

  group.add(structureGroup);
  group.visible = false;

  return { group, structureGroup, domeMat, pointLight: light };
}

export function createModelCitySync(): ModelCityResult | null {
  if (!_cachedScene && !_modelLoadFailed) return null;
  if (_modelLoadFailed) return null;
  return _createModelCityScene();
}

export async function createModelCity(
  variant: ModelCityVariant,
): Promise<ModelCityResult> {
  await _loadPromise;
  return _createModelCityScene();
}

export function updateModelCityPulse(
  result: ModelCityResult,
  elapsed: number,
  active: boolean,
  worldY: number,
): void {
  if (!active) {
    result.group.visible = false;
    return;
  }
  result.group.visible = true;
  result.group.position.y = worldY;

  result.domeMat.emissiveIntensity = 0.3 + Math.sin(elapsed * 0.4) * 0.15;
  result.domeMat.opacity = 0.15 + Math.sin(elapsed * 0.4) * 0.04;

  const baseIntensity =
    (result.pointLight.userData.baseIntensity as number) ?? 6;
  result.pointLight.intensity =
    result.pointLight.intensity * 0.98 +
    baseIntensity * (0.8 + Math.sin(elapsed * 0.7) * 0.2) * 0.02;
}

export function disposeModelCity(
  result: ModelCityResult,
  scene: THREE.Scene,
): void {
  scene.remove(result.group);
  result.group.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      if (child.material instanceof THREE.Material) child.material.dispose();
    }
  });
}
