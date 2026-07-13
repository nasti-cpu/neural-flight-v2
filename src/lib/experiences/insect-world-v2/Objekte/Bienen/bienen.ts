/**
 * insect-world-v2 — Bienen.
 *
 * Lädt ein Bienen-GLB einmalig und erzeugt mehrere Bienen.
 * Jede Biene schwebt mit einer Wander-Steuerung umher und
 * bleibt immer sichtbar (kein Ein-/Ausblenden mehr).
 *
 * Keine "new THREE.Vector3()" im Update-Loop (Pool-Nutzung).
 *
 * WebGPU-konform (GLTFLoader + Instancing).
 */
import * as THREE from "three/webgpu";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export interface BeeConfig {
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

const DEFAULT_CONFIG: BeeConfig = {
  count: 20,
  scale: 0.04,
  fieldRadius: 200,
  flyRadiusMin: 3,
  flyRadiusMax: 10,
  speedMin: 2.0,
  speedMax: 4.0,
  heightBaseMin: 0.9,
  heightBaseMax: 1.6,
  heightRange: 0.4,
};

/** Interner Zustand einer Biene */
interface BeeState {
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

export interface BeeSwarm {
  group: THREE.Group;
  update: (time: number, delta: number) => void;
  dispose: () => void;
}

/** Lädt ein GLB und gibt die Szene zurück */
function loadGLB(url: string): Promise<THREE.Group> {
  return new Promise((resolve, reject) => {
    new GLTFLoader().load(url, (gltf) => resolve(gltf.scene), undefined, reject);
  });
}

export async function createBees(
  glbUrl: string,
  config: BeeConfig = DEFAULT_CONFIG,
): Promise<BeeSwarm> {
  const group = new THREE.Group();
  const beeScene = await loadGLB(glbUrl);

  // GLB einmal laden → als Template für alle Bienen klonen
  const template = new THREE.Group();
  beeScene.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      template.add(child.clone());
    }
  });

  const bees: BeeState[] = [];

  for (let i = 0; i < config.count; i++) {
    const beeGroup = new THREE.Group();
    beeGroup.add(template.clone(true));
    beeGroup.scale.setScalar(config.scale);

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

    beeGroup.position.set(cx, cy, cz);
    beeGroup.rotation.y = heading + Math.PI;

    group.add(beeGroup);

    bees.push({
      group: beeGroup,
      centerX: cx,
      centerZ: cz,
      flyRadius,
      speed,
      heightBase,
      heightRange,
      tiltSpeed: 2 + Math.random() * 2,
      originalScale: config.scale,
      phase: Math.random() * Math.PI * 2,
      heading,
    });
  }

  function update(time: number, delta: number): void {
    for (const bee of bees) {
      // ── Wander-Steuerung (sanftes Umherschweben) ──
      // Statt Kreisbahn oder Wegpunkten: Die Biene ändert ihre
      // Flugrichtung zufällig und lenkt sanft zum Zentrum zurück.
      // Das ergibt fließende, natürliche Bahnen ohne ruckartige
      // Richtungswechsel.

      // Zufällige Richtungsänderung (sanftes Abdriften)
      bee.heading += (Math.random() - 0.5) * 1.0 * delta;

      // Zu weit vom Zentrum? → sanft zurück lenken
      const dxC = bee.group.position.x - bee.centerX;
      const dzC = bee.group.position.z - bee.centerZ;
      const distCenterSq = dxC * dxC + dzC * dzC;
      const maxDist = bee.flyRadius * 0.7;

      if (distCenterSq > maxDist * maxDist) {
        const angleToCenter = Math.atan2(-dxC, -dzC);
        let diff = angleToCenter - bee.heading;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        bee.heading += diff * 0.3 * delta;
      }

      // Vorwärts in Flugrichtung bewegen
      const step = bee.speed * delta;
      bee.group.position.x += Math.sin(bee.heading) * step;
      bee.group.position.z += Math.cos(bee.heading) * step;

      // Vertikales Schweben (sanfte Sinus-Welle)
      const targetY =
        bee.heightBase +
        Math.sin(time * 2.0 + bee.phase) * bee.heightRange * 0.5;
      bee.group.position.y += (targetY - bee.group.position.y) * 0.1;

      // Rotation = Flugrichtung (+PI weil Bee.glb nach +Z zeigt)
      bee.group.rotation.y = bee.heading + Math.PI;

      // Natürliches Kippen
      bee.group.rotation.z =
        Math.sin(time * bee.tiltSpeed + bee.phase) * 0.08;
      bee.group.rotation.x =
        Math.sin(time * 1.5) * 0.05 +
        Math.sin(time * 0.5 + bee.phase) * 0.03;
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
