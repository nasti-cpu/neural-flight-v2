/**
 * coralReef.ts – Korallenriff-Daten + Riff-Erzeugung
 *
 * Enthält die Konfiguration aller Korallen-Typen und die Logik,
 * ein zufälliges Riff aus mehreren Korallen-Klonen zusammenzubauen.
 *
 * Das World-Management (Lebenszyklus, Fade-In, Sichtbarkeit) bleibt
 * in coralReefWorld.ts.
 */

import * as THREE from "three/webgpu";

// ---------------------------------------------------------------------------
// Korallen-Konfiguration
// ---------------------------------------------------------------------------

export interface CoralConfig {
  key: string;
  path: string;
  baseSize: number;
  sizeVariance: number;
  verticalOffset: number;
  minCount: number;
  maxCount: number;
}

export const CORAL_CONFIGS: CoralConfig[] = [
  {
    key: "coral1",
    path: "/3D Modelle/korallen/Coral.glb",
    baseSize: 1.5,
    sizeVariance: 0.5,
    verticalOffset: 0.0,
    minCount: 1,
    maxCount: 4,
  },
  {
    key: "coral2",
    path: "/3D Modelle/korallen/Coral(1).glb",
    baseSize: 0.055,
    sizeVariance: 0.02,
    verticalOffset: 0.0,
    minCount: 1,
    maxCount: 4,
  },
  {
    key: "enviro",
    path: "/3D Modelle/korallen/underwater_enviro_coral.glb",
    baseSize: 1.2,
    sizeVariance: 0.4,
    verticalOffset: 0.0,
    minCount: 1,
    maxCount: 3,
  },
  {
    key: "anemone",
    path: "/3D Modelle/korallen/Sea anemone.glb",
    baseSize: 0.002,
    sizeVariance: 0.0007,
    verticalOffset: 0.1,
    minCount: 0,
    maxCount: 2,
  },
];

// ---------------------------------------------------------------------------
// Riff-Erzeugung
// ---------------------------------------------------------------------------

/**
 * Baut eine zufällige Korallengruppe an einer Welt-Position.
 * Zwischen 4 und 11 Korallen werden zufällig aus den Templates ausgewählt
 * und ohne Überlappung innerhalb eines Radius von 1–6 m platziert.
 *
 * @param templates – Vorgeladene Korallen-Modelle (Map<path, Group>)
 * @param worldX    – Welt-X-Position des Riffs
 * @param worldZ    – Welt-Z-Position des Riffs
 * @param floorY    – Boden-Y (Korallen stehen darauf)
 * @returns         – Fertige THREE.Group (noch ohne Opazität)
 */
export function buildReefGroup(
  templates: Map<string, THREE.Group>,
  worldX: number,
  worldZ: number,
  floorY: number,
): THREE.Group | null {
  if (templates.size === 0) return null;

  const group = new THREE.Group();
  group.position.set(worldX, floorY, worldZ);

  const coralCount = 4 + Math.floor(Math.random() * 8);
  const placedPositions: Array<{ x: number; z: number }> = [];

  for (let i = 0; i < coralCount; i++) {
    const config = CORAL_CONFIGS[Math.floor(Math.random() * CORAL_CONFIGS.length)];
    const template = templates.get(config.path);
    if (!template) continue;

    let x = 0;
    let z = 0;
    let attempts = 0;
    let valid = false;
    const minDist = 1.5;

    do {
      const a = Math.random() * Math.PI * 2;
      const d = 1 + Math.random() * 5;
      x = Math.cos(a) * d;
      z = Math.sin(a) * d;
      valid = placedPositions.every((p) => {
        const dx = x - p.x;
        const dz = z - p.z;
        return Math.sqrt(dx * dx + dz * dz) >= minDist;
      });
      attempts++;
    } while (!valid && attempts < 20);

    placedPositions.push({ x, z });

    const clone = template.clone(true);
    const scaleVariation = (Math.random() - 0.5) * config.sizeVariance * 2;
    const finalScale = Math.max(0.01, config.baseSize + scaleVariation);
    clone.scale.setScalar(finalScale);
    clone.position.set(x, config.verticalOffset, z);
    clone.rotation.y = Math.random() * Math.PI * 2;

    clone.updateWorldMatrix(true, false);
    const bbox = new THREE.Box3().setFromObject(clone);
    clone.position.y -= bbox.min.y;

    group.add(clone);
  }

  return group;
}
