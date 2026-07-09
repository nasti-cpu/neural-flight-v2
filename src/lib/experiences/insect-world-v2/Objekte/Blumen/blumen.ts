/**
 * insect-world-v2 — Blumen.
 *
 * Erzeugt LowPoly-Blumen (Stiel + Blütenkopf) direkt im Code,
 * statt GLB-Dateien zu laden. Spart Netzwerk, Parsing und GPU-Speicher.
 *
 * Jede Blumen-Art bekommt eine eigene Farbe (pink / weiß / gelb)
 * und wird als InstancedMesh in den Chunks platziert.
 *
 * WebGPU-konform.
 */
import * as THREE from "three/webgpu";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export interface PreloadedFlower {
  materialGroups: {
    geometry: THREE.BufferGeometry;
    material: THREE.Material;
  }[];
  scale: number;
  color: THREE.Color;
  label: string;
}

const FLOWER_COLORS = [
  { scale: 0.42, label: "pink", color: 0xe87da0 },
  { scale: 0.462, label: "weiß", color: 0xf0ece4 },
  { scale: 0.42, label: "gelb", color: 0xf5d742 },
];

/**
 * Baut eine LowPoly-Blumen-Geometrie (Stiel + Blütenkopf).
 * Nutzt nur einfache Primitiven – kein GLB nötig.
 */
function createFlowerGeometry(): THREE.BufferGeometry {
  // Stiel: dünner 4-seitiger Zylinder, ~35cm hoch
  const stem = new THREE.CylinderGeometry(0.008, 0.012, 0.35, 4);
  stem.translate(0, 0.175, 0);

  // Blütenkopf: kleine Kugel (low-poly: 6×4 Segmente)
  const head = new THREE.SphereGeometry(0.08, 6, 4);
  head.translate(0, 0.42, 0);

  // Zwei überkreuzte Blütenblätter (dünne Quads)
  const petal = new THREE.PlaneGeometry(0.12, 0.1);
  petal.translate(0, 0.42, 0);

  const petal2 = petal.clone();
  petal2.rotateY(Math.PI / 2);

  return mergeGeometries([stem, head, petal, petal2]);
}

/** Einmal erzeugte, geteilte Geometrie für alle Blumen */
let _sharedGeo: THREE.BufferGeometry | null = null;

function getSharedGeometry(): THREE.BufferGeometry {
  if (!_sharedGeo) {
    _sharedGeo = createFlowerGeometry();
  }
  return _sharedGeo;
}

/**
 * Lädt keine GLBs mehr, sondern erzeugt LowPoly-Blumen prozedural.
 * Liefert das gleiche Interface wie vorher (PreloadedFlower),
 * damit GrassManager und Scene-Code unverändert bleiben.
 */
export async function preloadFlowers(): Promise<PreloadedFlower[]> {
  const geo = getSharedGeometry();

  return FLOWER_COLORS.map((f) => {
    const mat = new THREE.MeshBasicMaterial({
      color: f.color,
      side: THREE.DoubleSide,
    });

    return {
      materialGroups: [{ geometry: geo, material: mat }],
      scale: f.scale,
      color: new THREE.Color(f.color),
      label: f.label,
    };
  });
}
