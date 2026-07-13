/**
 * insect-world-v2 — Schmetterlinge.
 *
 * Lädt ein Schmetterlings-GLB einmalig und erzeugt mehrere Exemplare.
 * Jeder Schmetterling schwebt mit einer Wander-Steuerung umher
 * und bleibt immer sichtbar (kein Ein-/Ausblenden mehr).
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
  flyRadiusMin: 3,
  flyRadiusMax: 12,
  speedMin: 1.5,
  speedMax: 3.0,
  heightBaseMin: 1.3,
  heightBaseMax: 2.3,
  heightRange: 0.6,
};

interface ButterflyState {
  group: THREE.Group;
  centerX: number;
  centerZ: number;
  flyRadius: number;
  speed: number;
  heightBase: number;
  heightRange: number;
  tiltSpeed: number;
  originalScale: number;
  phase: number;
  // Flugrichtung (sanftes Umherschweben, keine Wegpunkte)
  heading: number;
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

    // Zufällige Startposition und Kenngrößen
    const angle = Math.random() * Math.PI * 2;
    const dist = Math.random() * config.fieldRadius;
    const cx = Math.cos(angle) * dist;
    const cz = Math.sin(angle) * dist;
    const cy =
      config.heightBaseMin +
      Math.random() * (config.heightBaseMax - config.heightBaseMin);
    const flyRadius =
      config.flyRadiusMin +
      Math.random() * (config.flyRadiusMax - config.flyRadiusMin);
    const speed =
      config.speedMin + Math.random() * (config.speedMax - config.speedMin);
    const heightBase =
      config.heightBaseMin +
      Math.random() * (config.heightBaseMax - config.heightBaseMin);
    const heightRange = config.heightRange * (0.5 + Math.random() * 0.5);

    // Zufällige Anfangs-Flugrichtung (sanftes Schweben)
    const heading = Math.random() * Math.PI * 2;

    bGroup.position.set(cx, cy, cz);
    bGroup.rotation.y = heading + Math.PI;

    group.add(bGroup);

    butterflies.push({
      group: bGroup,
      centerX: cx,
      centerZ: cz,
      flyRadius,
      speed,
      heightBase,
      heightRange,
      tiltSpeed: 1.5 + Math.random() * 1.5,
      originalScale: config.scale,
      phase: Math.random() * Math.PI * 2,
      heading,
    });
  }

  function update(time: number, delta: number): void {
    for (const b of butterflies) {
      // ── Wander-Steuerung (sanftes Umherschweben) ──
      // Zufällige Richtungsänderung
      b.heading += (Math.random() - 0.5) * 1.2 * delta;

      // Zu weit vom Zentrum? → sanft zurück lenken
      const dxC = b.group.position.x - b.centerX;
      const dzC = b.group.position.z - b.centerZ;
      const distCenterSq = dxC * dxC + dzC * dzC;
      const maxDist = b.flyRadius * 0.7;

      if (distCenterSq > maxDist * maxDist) {
        const angleToCenter = Math.atan2(-dxC, -dzC);
        let diff = angleToCenter - b.heading;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        b.heading += diff * 0.3 * delta;
      }

      // Vorwärts in Flugrichtung bewegen
      const step = b.speed * delta;
      b.group.position.x += Math.sin(b.heading) * step;
      b.group.position.z += Math.cos(b.heading) * step;

      // Vertikales Schweben (sanfte Sinus-Welle)
      const targetY =
        b.heightBase +
        Math.sin(time * 2.0 + b.phase) * b.heightRange * 0.5;
      b.group.position.y += (targetY - b.group.position.y) * 0.1;

      b.group.rotation.y = b.heading + Math.PI;

      b.group.rotation.z =
        Math.sin(time * b.tiltSpeed + b.phase) * 0.08;
      b.group.rotation.x =
        Math.sin(time * 1.5) * 0.05 +
        Math.sin(time * 0.5 + b.phase) * 0.03;
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
