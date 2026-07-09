/**
 * insect-world-v2 — Blumen.
 *
 * Erzeugt LowPoly-Blumen direkt im Code:
 * - Grüner Stiel (CylinderGeometry)
 * - 6 radiale Blütenblätter (PlaneGeometry) in der Blütenfarbe
 *
 * Zwei materialGroups pro Typ (Stiel + Blüte) wie das Original-GLB.
 * Spart GLB-Laden, mergeGeometries und GPU-Speicher.
 *
 * WebGPU-konform.
 */
import * as THREE from "three/webgpu";

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

/** Einmalig erzeugte Geometrien (wiederverwendet für alle Instanzen) */
let _stemGeo: THREE.BufferGeometry | null = null;
let _petalGeo: THREE.BufferGeometry | null = null;
let _stemMat: THREE.MeshBasicMaterial | null = null;

function getStemGeometry(): THREE.BufferGeometry {
  if (!_stemGeo) {
    _stemGeo = new THREE.CylinderGeometry(0.01, 0.014, 0.35, 5);
    _stemGeo.translate(0, 0.175, 0);
  }
  return _stemGeo;
}

function getPetalGeometry(): THREE.BufferGeometry {
  if (!_petalGeo) {
    // 6 Blütenblätter radial angeordnet
    const petals: THREE.BufferGeometry[] = [];
    const numPetals = 6;
    const pWidth = 0.05;
    const pHeight = 0.12;

    for (let i = 0; i < numPetals; i++) {
      const angle = (i / numPetals) * Math.PI * 2;
      const p = new THREE.PlaneGeometry(pWidth, pHeight);

      // Blatt nach außen neigen (von der Senkrechten wegkippen)
      p.rotateX(-0.35);
      // Radial um die Y-Achse positionieren
      p.rotateY(angle);
      // Nach oben verschieben (an die Spitze des Stiels)
      const r = 0.04; // kleiner Radius vom Zentrum
      p.translate(Math.sin(angle) * r, 0.36, Math.cos(angle) * r);

      petals.push(p);
    }

    _petalGeo = mergeGeometriesSafe(petals);
  }
  return _petalGeo;
}

function getStemMaterial(): THREE.MeshBasicMaterial {
  if (!_stemMat) {
    _stemMat = new THREE.MeshBasicMaterial({ color: 0x5a9e4a });
  }
  return _stemMat;
}

/** mergeGeometries, aber ohne Import des Utils (eigenbau für 2+ Geometrien) */
function mergeGeometriesSafe(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  if (geos.length === 0) return new THREE.BufferGeometry();
  if (geos.length === 1) return geos[0].clone();

  // Einfaches Merging: Positionen + Indices konkatenieren
  const positions: number[] = [];
  const indices: number[] = [];
  let vertexOffset = 0;

  for (const g of geos) {
    const pos = g.getAttribute("position");
    if (!pos) continue;
    const idx = g.getIndex();
    if (!idx) continue;

    for (let i = 0; i < pos.count * 3; i++) {
      positions.push(pos.array[i]);
    }
    for (let i = 0; i < idx.count; i++) {
      indices.push(idx.array[i] + vertexOffset);
    }
    vertexOffset += pos.count;
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  merged.setIndex(indices);
  merged.computeVertexNormals();
  return merged;
}

export async function preloadFlowers(): Promise<PreloadedFlower[]> {
  const stemGeo = getStemGeometry();
  const petalGeo = getPetalGeometry();
  const stemMat = getStemMaterial();

  return FLOWER_COLORS.map((f) => {
    const petalMat = new THREE.MeshBasicMaterial({
      color: f.color,
      side: THREE.DoubleSide,
    });

    return {
      materialGroups: [
        { geometry: stemGeo, material: stemMat },
        { geometry: petalGeo, material: petalMat },
      ],
      scale: f.scale,
      color: new THREE.Color(f.color),
      label: f.label,
    };
  });
}
