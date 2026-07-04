/**
 * insect-world-v2 — Blumen.
 * Lädt die 3 Lowpoly-GLB-Blumen und verteilt sie in der Wiese.
 * Jede GLB kann mehrere Sub-Meshes mit eigenen Materialien haben
 * (z.B. grüner Stiel + bunte Blüte). Pro Material wird ein
 * separater InstancedMesh erzeugt.
 */

import * as THREE from "three/webgpu";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

import pinkUrl from "./Flower pink.glb?url";
import whiteUrl from "./Flower white.glb?url";
import yellowUrl from "./Flower yellow.glb?url";

const FLOWER_FILES = [
  { url: pinkUrl, scale: 0.42, label: "pink", color: 0xe87da0 },
  { url: whiteUrl, scale: 0.462, label: "weiß", color: 0xf0ece4 },
  { url: yellowUrl, scale: 0.42, label: "gelb", color: 0xf5d742 },
];

export interface FlowerConfig {
  count: number;
  fieldSize: number;
}

const DEFAULT_CONFIG: FlowerConfig = {
  count: 400,
  fieldSize: 120,
};

export interface FlowerTarget {
  position: THREE.Vector3;
  color: THREE.Color;
}

export interface PreloadedFlower {
  materialGroups: {
    geometry: THREE.BufferGeometry;
    material: THREE.Material;
  }[];
  scale: number;
  color: THREE.Color;
  label: string;
}

/**
 * Lädt alle 3 Blumenmodelle einmalig vor und bereitet ihre Geometrien und Materialien vor.
 * Dies verhindert Performance-Einbrüche beim dynamischen Laden von Chunks.
 */
export async function preloadFlowers(): Promise<PreloadedFlower[]> {
  const scenes = await Promise.all(FLOWER_FILES.map((f) => loadGLTF(f.url)));

  // Höhe jeder Blumen-Art messen und Ziel-Höhe bestimmen (größte = pink)
  const heights = scenes.map((scene) => {
    const box = new THREE.Box3().setFromObject(scene);
    return box.max.y - box.min.y;
  });
  const targetHeight = Math.max(...heights);

  return scenes.map((scene, typeIdx) => {
    const materialGroups = groupMeshesByMaterial(scene);
    const scale =
      FLOWER_FILES[typeIdx].scale * (targetHeight / heights[typeIdx]);
    const color = new THREE.Color(FLOWER_FILES[typeIdx].color);
    const label = FLOWER_FILES[typeIdx].label;
    return { materialGroups, scale, color, label };
  });
}

export interface MeadowFlowers {
  group: THREE.Group;
  dispose: () => void;
  targets: FlowerTarget[];
}

function loadGLTF(url: string): Promise<THREE.Group> {
  return new Promise((resolve, reject) => {
    const loader = new GLTFLoader();
    loader.load(
      url,
      (gltf) => resolve(gltf.scene),
      undefined,
      (err) => {
        console.error("Blumen GLB-Fehler:", url, err);
        reject(err);
      },
    );
  });
}

/**
 * Sammelt alle Meshes aus einer GLB-Szene, gruppiert sie nach
 * Material-Identität merged die Geometrien einer Gruppe.
 * Gibt ein Array pro einzigartigem Material zurück.
 */
function groupMeshesByMaterial(
  group: THREE.Group,
): { geometry: THREE.BufferGeometry; material: THREE.Material }[] {
  const materialGroups = new Map<THREE.Material, THREE.BufferGeometry[]>();

  group.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.updateWorldMatrix(true, false);
    const geo = child.geometry.clone();
    geo.applyMatrix4(child.matrixWorld);

    const mat = Array.isArray(child.material)
      ? child.material[0]
      : child.material;
    const list = materialGroups.get(mat);
    if (list) {
      list.push(geo);
    } else {
      materialGroups.set(mat, [geo]);
    }
  });

  const results: {
    geometry: THREE.BufferGeometry;
    material: THREE.Material;
  }[] = [];
  for (const [material, geos] of materialGroups) {
    const merged = mergeGeometries(geos);
    if (merged) {
      const mat = material.clone();
      mat.side = THREE.DoubleSide;
      mat.depthWrite = true;
      results.push({ geometry: merged, material: mat });
    }
  }

  return results;
}

/**
 * Lädt alle 3 Blumenmodelle und platziert sie als InstancedMesh
 * in einem Feld um (cx, cz).
 *
 * Pro GLB können mehrere Sub-Meshes (z.B. Stiel + Blüte) mit
 * eigenen Materialien entstehen – jedes bekommt einen eigenen
 * InstancedMesh.
 *
 * @param getHeightAt Optionale Funktion für Bodenanpassung
 */
export async function createFlowers(
  cx: number,
  cz: number,
  config: FlowerConfig = DEFAULT_CONFIG,
  getHeightAt?: (x: number, z: number) => number,
): Promise<MeadowFlowers> {
  const group = new THREE.Group();
  const dummy = new THREE.Object3D();
  const targets: FlowerTarget[] = [];

  const scenes = await Promise.all(FLOWER_FILES.map((f) => loadGLTF(f.url)));

  // Höhe jeder Blumen-Art messen und Ziel-Höhe bestimmen (größte = pink)
  const heights = scenes.map((scene) => {
    const box = new THREE.Box3().setFromObject(scene);
    return box.max.y - box.min.y;
  });
  const targetHeight = Math.max(...heights);
  console.log("Blumen-Höhen:", heights, "Ziel:", targetHeight);

  const perType = Math.max(1, Math.floor(config.count / scenes.length));

  for (let typeIdx = 0; typeIdx < scenes.length; typeIdx++) {
    const materialGroups = groupMeshesByMaterial(scenes[typeIdx]);
    const scale =
      FLOWER_FILES[typeIdx].scale * (targetHeight / heights[typeIdx]);
    const flowerColor = new THREE.Color(FLOWER_FILES[typeIdx].color);

    const name = FLOWER_FILES[typeIdx].label;
    console.log(
      `Blume ${name}: Höhe=${heights[typeIdx].toFixed(3)}, Skalierung=${scale.toFixed(3)}`,
    );

    // Positionen für alle Instanzen dieser Blumen-Art vorbereiten
    const positions: {
      x: number;
      y: number;
      z: number;
      rotY: number;
      s: number;
    }[] = [];
    for (let i = 0; i < perType; i++) {
      const x = cx + (Math.random() - 0.5) * config.fieldSize;
      const z = cz + (Math.random() - 0.5) * config.fieldSize;
      const y = (getHeightAt ? getHeightAt(x, z) : 0) + Math.random() * 0.05;
      const rotY = Math.random() * Math.PI * 2;
      const s = scale * (0.8 + Math.random() * 0.7);
      positions.push({ x, y, z, rotY, s });
    }

    for (const { geometry, material } of materialGroups) {
      const mesh = new THREE.InstancedMesh(geometry, material, perType);

      for (let i = 0; i < perType; i++) {
        const p = positions[i];
        dummy.position.set(p.x, p.y, p.z);
        dummy.scale.setScalar(p.s);
        dummy.rotation.set(0, p.rotY, 0);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }

      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      group.add(mesh);
    }

    // Targets pro Instanz speichern
    for (const p of positions) {
      targets.push({
        position: new THREE.Vector3(p.x, p.y, p.z),
        color: flowerColor.clone(),
      });
    }
  }

  function dispose() {
    group.children.forEach((child) => {
      if (child instanceof THREE.InstancedMesh) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    });
    group.clear();
  }

  return { group, dispose, targets };
}
