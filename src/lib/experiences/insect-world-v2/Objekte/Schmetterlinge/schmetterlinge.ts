/**
 * insect-world-v2 — Schmetterlinge.
 *
 * Lädt ein Schmetterlings-GLB einmalig und erzeugt mehrere Exemplare.
 * Gleiches Flug- und Nebel-Verhalten wie die Bienen:
 * zufällige Sinus-Bahnen + Ein-/Ausblenden im Nebel.
 *
 * Keine "new THREE.Vector3()" im Update-Loop.
 *
 * WebGPU-konform (GLTFLoader + Instancing).
 */
import * as THREE from "three/webgpu";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export interface ButterflyConfig {
  count: number;
  scale: number;
  fieldRadius: number;
  flyRadiusMin: number;
  flyRadiusMax: number;
  speedMin: number;
  speedMax: number;
  heightBaseMin: number;
  heightBaseMax: number;
  heightRange: number;
}

const DEFAULT_CONFIG: ButterflyConfig = {
  count: 12,
  scale: 0.036,
  fieldRadius: 200,
  flyRadiusMin: 1,
  flyRadiusMax: 4,
  speedMin: 0.8,
  speedMax: 1.8,
  heightBaseMin: 1.3,
  heightBaseMax: 2.3,
  heightRange: 0.4,
};

interface ButterflyState {
  group: THREE.Group;
  centerX: number;
  centerZ: number;
  flyRadius: number;
  speed: number;
  phase: number;
  phase2: number;
  freqY: number;
  heightBase: number;
  heightRange: number;
  tiltSpeed: number;
  originalScale: number;
  isVisible: boolean;
  fadeProgress: number;
  fadeTimer: number;
}

export interface ButterflySwarm {
  group: THREE.Group;
  update: (time: number, delta: number) => void;
  dispose: () => void;
}

function loadGLB(url: string): Promise<THREE.Group> {
  return new Promise((resolve, reject) => {
    new GLTFLoader().load(url, (gltf) => resolve(gltf.scene), undefined, reject);
  });
}

export async function createButterflies(
  glbUrl: string,
  config: ButterflyConfig = DEFAULT_CONFIG,
): Promise<ButterflySwarm> {
  const group = new THREE.Group();
  const butterflyScene = await loadGLB(glbUrl);

  const template = new THREE.Group();
  butterflyScene.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      template.add(child.clone());
    }
  });

  const butterflies: ButterflyState[] = [];

  for (let i = 0; i < config.count; i++) {
    const bGroup = new THREE.Group();
    bGroup.add(template.clone(true));
    bGroup.scale.setScalar(config.scale);

    const angle = Math.random() * Math.PI * 2;
    const dist = Math.random() * config.fieldRadius;
    const cx = Math.cos(angle) * dist;
    const cz = Math.sin(angle) * dist;
    const cy =
      config.heightBaseMin +
      Math.random() * (config.heightBaseMax - config.heightBaseMin);

    bGroup.position.set(cx, cy, cz);
    bGroup.rotation.y = Math.random() * Math.PI * 2;

    group.add(bGroup);

    butterflies.push({
      group: bGroup,
      centerX: cx,
      centerZ: cz,
      flyRadius:
        config.flyRadiusMin +
        Math.random() * (config.flyRadiusMax - config.flyRadiusMin),
      speed:
        config.speedMin + Math.random() * (config.speedMax - config.speedMin),
      phase: Math.random() * Math.PI * 2,
      phase2: Math.random() * Math.PI * 2,
      freqY: 1.0 + Math.random() * 1.0,
      heightBase:
        config.heightBaseMin +
        Math.random() * (config.heightBaseMax - config.heightBaseMin),
      heightRange: config.heightRange * (0.5 + Math.random() * 0.5),
      tiltSpeed: 1.5 + Math.random() * 1.5,
      originalScale: config.scale,
      isVisible: true,
      fadeProgress: 1,
      fadeTimer: 4 + Math.random() * 8,
    });
  }

  function update(time: number, delta: number): void {
    for (const b of butterflies) {
      b.fadeTimer -= delta;
      if (b.fadeTimer <= 0) {
        b.isVisible = !b.isVisible;
        b.fadeTimer = b.isVisible
          ? 4 + Math.random() * 8
          : 2 + Math.random() * 4;
      }

      if (b.isVisible) {
        b.fadeProgress = Math.min(1, b.fadeProgress + delta * 1.25);
      } else {
        b.fadeProgress = Math.max(0, b.fadeProgress - delta * 1.25);
        if (b.fadeProgress <= 0) {
          const a = Math.random() * Math.PI * 2;
          const d = Math.random() * config.fieldRadius;
          b.centerX = Math.cos(a) * d;
          b.centerZ = Math.sin(a) * d;
        }
      }

      const s = b.fadeProgress * b.originalScale;
      b.group.scale.setScalar(s);

      if (b.fadeProgress > 0) {
        const t = time * b.speed;

        const cx1 = Math.cos(t + b.phase) * b.flyRadius;
        const cz1 = Math.sin(t + b.phase) * b.flyRadius;
        const cx2 = Math.cos(t * 0.7 + b.phase2) * b.flyRadius * 0.3;
        const cz2 = Math.sin(t * 0.5 + b.phase2) * b.flyRadius * 0.3;

        const x = b.centerX + cx1 + cx2;
        const z = b.centerZ + cz1 + cz2;
        const y =
          b.heightBase +
          Math.sin(t * b.freqY + b.phase) * b.heightRange;

        const dx = x - b.group.position.x;
        const dz = z - b.group.position.z;

        b.group.position.set(x, y, z);

        if (Math.abs(dx) > 0.001 || Math.abs(dz) > 0.001) {
          b.group.rotation.y = Math.atan2(dx, dz) + Math.PI;
        }

        b.group.rotation.z =
          Math.sin(t * b.tiltSpeed + b.phase) * 0.08;
        b.group.rotation.x =
          Math.sin(t * 1.5 + b.phase2) * 0.05 +
          Math.sin(t * 0.5 + b.phase) * 0.03;
      }
    }
  }

  function dispose(): void {
    for (const child of group.children) {
      if (child instanceof THREE.Group) {
        for (const mesh of child.children) {
          if (mesh instanceof THREE.Mesh) {
            mesh.geometry.dispose();
            if (Array.isArray(mesh.material)) {
              for (const m of mesh.material) m.dispose();
            } else {
              mesh.material.dispose();
            }
          }
        }
      }
    }
    group.clear();
  }

  return { group, update, dispose };
}
