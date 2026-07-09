/**
 * insect-world-v2 — Bienen.
 *
 * Lädt ein Bienen-GLB einmalig und erzeugt mehrere Bienen.
 * Jede Biene fliegt zufällige Sinus-Bahnen über die Wiese.
 * In regelmäßigen Abständen blendet sie in den Nebel aus
 * (als ob sie darin verschwindet), teleportiert an eine
 * neue Position und wird wieder eingeblendet.
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
  flyRadiusMin: 1,
  flyRadiusMax: 3,
  speedMin: 2,
  speedMax: 4,
  heightBaseMin: 0.8,
  heightBaseMax: 1.5,
  heightRange: 0.2,
};

/** Interner Zustand einer Biene */
interface BeeState {
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
  // Nebel-Ein/Ausblend-Zyklus
  isVisible: boolean;
  fadeProgress: number;
  fadeTimer: number;
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

    // Zufällige Startposition
    const angle = Math.random() * Math.PI * 2;
    const dist = Math.random() * config.fieldRadius;
    const cx = Math.cos(angle) * dist;
    const cz = Math.sin(angle) * dist;
    const cy =
      config.heightBaseMin +
      Math.random() * (config.heightBaseMax - config.heightBaseMin);

    beeGroup.position.set(cx, cy, cz);
    beeGroup.rotation.y = Math.random() * Math.PI * 2;

    group.add(beeGroup);

    bees.push({
      group: beeGroup,
      centerX: cx,
      centerZ: cz,
      flyRadius:
        config.flyRadiusMin +
        Math.random() * (config.flyRadiusMax - config.flyRadiusMin),
      speed:
        config.speedMin + Math.random() * (config.speedMax - config.speedMin),
      phase: Math.random() * Math.PI * 2,
      phase2: Math.random() * Math.PI * 2,
      freqY: 1.5 + Math.random() * 1.5,
      heightBase:
        config.heightBaseMin +
        Math.random() * (config.heightBaseMax - config.heightBaseMin),
      heightRange: config.heightRange * (0.5 + Math.random() * 0.5),
      tiltSpeed: 2 + Math.random() * 2,
      originalScale: config.scale,
      // Alle Bienen starten sichtbar
      isVisible: true,
      fadeProgress: 1,
      fadeTimer: 4 + Math.random() * 8, // erste Unsichtbarkeit nach 4-12s
    });
  }

  function update(time: number, delta: number): void {
    for (const bee of bees) {
      // ── Nebel-Ein/Ausblend-Zyklus ──
      bee.fadeTimer -= delta;
      if (bee.fadeTimer <= 0) {
        bee.isVisible = !bee.isVisible;
        bee.fadeTimer = bee.isVisible
          ? 4 + Math.random() * 8   // sichtbar: 4-12s
          : 2 + Math.random() * 4;  // unsichtbar: 2-6s
      }

      if (bee.isVisible) {
        // Sanft einblenden (0.8s)
        bee.fadeProgress = Math.min(1, bee.fadeProgress + delta * 1.25);
      } else {
        // Sanft ausblenden (0.8s)
        bee.fadeProgress = Math.max(0, bee.fadeProgress - delta * 1.25);
        if (bee.fadeProgress <= 0) {
          // Komplett unsichtbar → an neue Position teleportieren
          const a = Math.random() * Math.PI * 2;
          const d = Math.random() * config.fieldRadius;
          bee.centerX = Math.cos(a) * d;
          bee.centerZ = Math.sin(a) * d;
        }
      }

      // Skalierung = fadeProgress * originale Größe
      const s = bee.fadeProgress * bee.originalScale;
      bee.group.scale.setScalar(s);

      // Position nur aktualisieren, wenn nicht komplett unsichtbar
      if (bee.fadeProgress > 0) {
        const t = time * bee.speed;

        const cx1 = Math.cos(t + bee.phase) * bee.flyRadius;
        const cz1 = Math.sin(t + bee.phase) * bee.flyRadius;
        const cx2 = Math.cos(t * 0.7 + bee.phase2) * bee.flyRadius * 0.3;
        const cz2 = Math.sin(t * 0.5 + bee.phase2) * bee.flyRadius * 0.3;

        const x = bee.centerX + cx1 + cx2;
        const z = bee.centerZ + cz1 + cz2;
        const y =
          bee.heightBase +
          Math.sin(t * bee.freqY + bee.phase) * bee.heightRange;

        const dx = x - bee.group.position.x;
        const dz = z - bee.group.position.z;

        bee.group.position.set(x, y, z);

        // Blickrichtung = Flugrichtung (+PI weil Bee.glb nach +Z zeigt)
        if (Math.abs(dx) > 0.001 || Math.abs(dz) > 0.001) {
          bee.group.rotation.y = Math.atan2(dx, dz) + Math.PI;
        }

        // Natürliches Kippen
        bee.group.rotation.z =
          Math.sin(t * bee.tiltSpeed + bee.phase) * 0.08;
        bee.group.rotation.x =
          Math.sin(t * 1.5 + bee.phase2) * 0.05 +
          Math.sin(t * 0.5 + bee.phase) * 0.03;
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
