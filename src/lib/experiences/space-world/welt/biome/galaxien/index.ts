/**
 * Galaxien-Biome — drei Hubble-Varianten für den Space-World-Level
 *
 * Varianten (forschungsbasiert, angelehnt an Hubble-Schema + de Vaucouleurs):
 *   - "spiral"   — Spiralgalaxie (Sa-Typ): flache Scheibe, 4 logarithmische Arme,
 *                  zentraler Bulge, Staubspuren, Halo-Glühen
 *   - "elliptical" — Elliptische Galaxie (E3-Typ): smooth ellipsoidale Verteilung,
 *                    de-Vaucouleurs r¹/⁴-Profil, rötlich-goldene alte Sterne
 *   - "irregular"   — Irreguläre Galaxie (Magellanic-Typ): chaotische Klumpen,
 *                     gasförmige Filamente, junge blaue Sterneinbettungen
 *
 * Recherchequellen: Wikipedia "Galaxy morphological classification",
 * "Hubble sequence", "de Vaucouleurs system" (2026)
 */

import {
  attribute,
  float,
  smoothstep,
  length,
  pointUV,
  vec3,
  vec4,
} from "three/tsl";
import { PointsNodeMaterial, MeshBasicNodeMaterial } from "three/webgpu";
import * as THREE from "three/webgpu";

// ── Types ──────────────────────────────────────────────────────

export type GalaxyVariant = "spiral" | "elliptical" | "irregular";

export interface GalaxyBiomeSystem {
  group: THREE.Group;
  variant: GalaxyVariant;
  setVariant: (v: GalaxyVariant) => void;
  update: (delta: number, elapsed: number) => void;
  dispose: () => void;
}

// ── Constants ──────────────────────────────────────────────────

const GALAXY_RADIUS = 500;
const BULGE_RADIUS = 50;
const DISK_THICKNESS = 5;
const ELLIPTICAL_EFF_RADIUS = 80;

// ── Metadata ───────────────────────────────────────────────────

export const VARIANT_META: Record<
  GalaxyVariant,
  { label: string; desc: string }
> = {
  spiral: {
    label: "Spiralgalaxie (Sa)",
    desc: "Flache Scheibe mit 4 logarithmischen Armen, zentralem Bulge und Staubspuren — klassische Grand-Design-Spirale",
  },
  elliptical: {
    label: "Elliptische Galaxie (E3)",
    desc: "Glatter Ellipsoid mit de-Vaucouleurs r¹/⁴-Profil, rötlich-goldene alte Sternpopulation — massereicher Early-Type",
  },
  irregular: {
    label: "Irreguläre Galaxie (Im)",
    desc: "Chaotische Sternklumpen, gasförmige Filamente, junge blaue OB-Assoziationen — Magellanic-Typ",
  },
};

// ── Helpers ────────────────────────────────────────────────────

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function gauss(): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return Math.max(-3, Math.min(3, z));
}

function hsl(h: number, s: number, l: number): THREE.Color {
  return new THREE.Color().setHSL(h, s, l);
}

// ── TSL Point Material Factory (vertex colors) ─────────────────
// Reads vertex color attribute into colorNode — TSL-native approach.

function createVertexColorPointsMaterial(
  aSizeAttr: THREE.BufferAttribute,
  config?: { opacity?: number },
): PointsNodeMaterial {
  const aSize = attribute("aSize", "float");
  const vertexColor = attribute("color", "vec3");

  const mat = new PointsNodeMaterial();
  mat.sizeNode = aSize;
  mat.sizeAttenuation = true;
  mat.transparent = true;
  mat.depthWrite = false;
  mat.blending = THREE.AdditiveBlending;
  if (config?.opacity !== undefined) mat.opacity = config.opacity;

  // Pass vertex color directly into colorNode
  mat.colorNode = vec4(vertexColor, float(1.0));

  return mat;
}

// ═══════════════════════════════════════════════════════════════
// Variant 1: Spiral Galaxy (Sa — tight arms, large bulge)
// ═══════════════════════════════════════════════════════════════
//
// Aufbau:
//   1. Flache Sternscheibe (exponentielle Radialdichte)
//   2. 4 logarithmische Spiralarme (Pitch angle ~10°)
//   3. Zentraler Bulge (r¹/⁴-Profil, warme Farben)
//   4. Dunkle Staubspuren zwischen den Armen
//   5. Diffuser galaktischer Halo

function buildSpiral(group: THREE.Group): () => void {
  const disposables: { dispose(): void }[] = [];

  // ── 1. Scheibensterne ────────────────────────────────────
  const diskCount = 15000;
  const diskPos = new Float32Array(diskCount * 3);
  const diskCol = new Float32Array(diskCount * 3);

  // 4 Hauptarme
  const armOffsets = [0, Math.PI * 0.5, Math.PI, Math.PI * 1.5];
  const pitchAngle = 0.18; // ~10° pitch — tight arms (Sa type)

  for (let i = 0; i < diskCount; i++) {
    // Exponentielle Radialverteilung
    const r = -Math.log(1 - Math.random() * 0.999) * GALAXY_RADIUS * 0.15;

    let angle: number;
    // 70% der Sterne in Spiralarmen, 30% zwischen den Armen
    if (Math.random() < 0.7 && r > 10 && r < GALAXY_RADIUS * 0.85) {
      const armOffset = armOffsets[i % 4];
      const armAngle = armOffset + Math.log(r / 8) * pitchAngle;
      angle = armAngle + gauss() * 0.12;
    } else {
      angle = Math.random() * Math.PI * 2;
    }

    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;

    // Vertikal: sech²-Profil
    const scaleHeight = DISK_THICKNESS * (0.5 + (r / GALAXY_RADIUS) * 0.8);
    const y = gauss() * scaleHeight;

    diskPos[i * 3] = x;
    diskPos[i * 3 + 1] = y;
    diskPos[i * 3 + 2] = z;

    // Farbtemperatur-Gradient
    const t = r / GALAXY_RADIUS;
    if (t < 0.08) {
      diskCol[i * 3] = 1.0;
      diskCol[i * 3 + 1] = 0.85;
      diskCol[i * 3 + 2] = 0.6;
    } else if (t < 0.25) {
      const c = hsl(rand(0.12, 0.55), rand(0.05, 0.25), rand(0.7, 1.0));
      diskCol[i * 3] = c.r;
      diskCol[i * 3 + 1] = c.g;
      diskCol[i * 3 + 2] = c.b;
    } else {
      const c = hsl(rand(0.55, 0.7), rand(0.05, 0.2), rand(0.65, 0.95));
      diskCol[i * 3] = c.r;
      diskCol[i * 3 + 1] = c.g;
      diskCol[i * 3 + 2] = c.b;
    }
  }

  const diskGeo = new THREE.BufferGeometry();
  diskGeo.setAttribute("position", new THREE.BufferAttribute(diskPos, 3));
  diskGeo.setAttribute("color", new THREE.BufferAttribute(diskCol, 3));
  const diskSizeAttr = new THREE.BufferAttribute(
    new Float32Array(diskCount).fill(0.4),
    1,
  );
  diskGeo.setAttribute("aSize", diskSizeAttr);

  const diskMat = createVertexColorPointsMaterial(diskSizeAttr, {
    opacity: 0.9,
  });

  const diskPoints = new THREE.Points(diskGeo, diskMat);
  diskPoints.frustumCulled = false;
  group.add(diskPoints);
  disposables.push(diskGeo, diskMat);

  // ── 2. Spiralarm-Verdichtungen (hellere Knoten) ──────────
  const knotCount = 6000;
  const knotPos = new Float32Array(knotCount * 3);
  const knotCol = new Float32Array(knotCount * 3);

  for (let i = 0; i < knotCount; i++) {
    const armIdx = i % 4;
    const armOffset = armOffsets[armIdx];
    const r = rand(15, GALAXY_RADIUS * 0.7);
    const armAngle = armOffset + Math.log(r / 8) * pitchAngle;
    const angle = armAngle + gauss() * 0.06;

    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;
    const y = gauss() * DISK_THICKNESS * 0.3;

    knotPos[i * 3] = x;
    knotPos[i * 3 + 1] = y;
    knotPos[i * 3 + 2] = z;

    // Blaue OB-Assoziationen (junge Sterne in Spiralarmen)
    const c = hsl(rand(0.55, 0.68), 0.15, rand(0.8, 1.0));
    knotCol[i * 3] = c.r;
    knotCol[i * 3 + 1] = c.g;
    knotCol[i * 3 + 2] = c.b;
  }

  const knotGeo = new THREE.BufferGeometry();
  knotGeo.setAttribute("position", new THREE.BufferAttribute(knotPos, 3));
  knotGeo.setAttribute("color", new THREE.BufferAttribute(knotCol, 3));
  const knotSizeAttr = new THREE.BufferAttribute(
    new Float32Array(knotCount).fill(0.6),
    1,
  );
  knotGeo.setAttribute("aSize", knotSizeAttr);

  const knotMat = createVertexColorPointsMaterial(knotSizeAttr, {
    opacity: 0.85,
  });

  const knotPoints = new THREE.Points(knotGeo, knotMat);
  group.add(knotPoints);
  disposables.push(knotGeo, knotMat);

  // ── 3. Zentraler Bulge (de Vaucouleurs r¹/⁴) ─────────────
  const bulgeCount = 5000;
  const bulgePos = new Float32Array(bulgeCount * 3);
  const bulgeCol = new Float32Array(bulgeCount * 3);

  for (let i = 0; i < bulgeCount; i++) {
    // r¹/⁴ sampling: solve for r from uniform via gamma
    // P(r) ∝ r² exp(-7.67 * (r/Re)¹/⁴)
    let r: number;
    let accept: boolean;
    do {
      r = rand(0.5, BULGE_RADIUS * 3);
      const prob =
        ((r * r) / (BULGE_RADIUS * BULGE_RADIUS)) *
        Math.exp(-7.67 * Math.pow(r / BULGE_RADIUS, 0.25) + 7.67);
      accept = Math.random() < prob * 0.5;
    } while (!accept);

    const theta = Math.acos(2 * Math.random() - 1);
    const phi = Math.random() * Math.PI * 2;
    // Oblate: squash Y
    const x = Math.sin(theta) * Math.cos(phi) * r;
    const z = Math.sin(theta) * Math.sin(phi) * r;
    const y = Math.cos(theta) * r * 0.5;

    bulgePos[i * 3] = x;
    bulgePos[i * 3 + 1] = y;
    bulgePos[i * 3 + 2] = z;

    // Gelb-goldene alte Sterne
    const c = hsl(rand(0.1, 0.18), rand(0.15, 0.4), rand(0.7, 1.0));
    bulgeCol[i * 3] = c.r;
    bulgeCol[i * 3 + 1] = c.g;
    bulgeCol[i * 3 + 2] = c.b;
  }

  const bulgeGeo = new THREE.BufferGeometry();
  bulgeGeo.setAttribute("position", new THREE.BufferAttribute(bulgePos, 3));
  bulgeGeo.setAttribute("color", new THREE.BufferAttribute(bulgeCol, 3));
  const bulgeSizeAttr = new THREE.BufferAttribute(
    new Float32Array(bulgeCount).fill(0.5),
    1,
  );
  bulgeGeo.setAttribute("aSize", bulgeSizeAttr);

  const bulgeMat = createVertexColorPointsMaterial(bulgeSizeAttr, {
    opacity: 0.8,
  });

  const bulgePoints = new THREE.Points(bulgeGeo, bulgeMat);
  group.add(bulgePoints);
  disposables.push(bulgeGeo, bulgeMat);

  // ── 4. Kern-Glühen ───────────────────────────────────────
  const coreGlowGeo = new THREE.SphereGeometry(BULGE_RADIUS * 0.4, 32, 32);
  const coreGlowMat = new MeshBasicNodeMaterial();
  coreGlowMat.colorNode = vec4(
    float(1.0),
    float(0.87),
    float(0.8),
    float(0.45),
  );
  coreGlowMat.transparent = true;
  coreGlowMat.depthWrite = false;
  const coreGlow = new THREE.Mesh(coreGlowGeo, coreGlowMat);
  group.add(coreGlow);
  disposables.push(coreGlowGeo, coreGlowMat);

  // ── 5. Dunkle Staubspuren (Planes zwischen den Armen) ────
  const dustCount = 80;
  for (let i = 0; i < dustCount; i++) {
    const r = rand(40, GALAXY_RADIUS * 0.6);
    const interArmOffset = Math.PI * 0.25 + (i % 2) * Math.PI * 0.5;
    const armOffset = armOffsets[i % 4];
    const baseAngle = armOffset + Math.log(r / 8) * pitchAngle;
    const angle = baseAngle + interArmOffset + gauss() * 0.15;

    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;
    const y = gauss() * DISK_THICKNESS * 0.2;

    const size = rand(3, 20);
    const dustGeo = new THREE.PlaneGeometry(size, size);
    const dustMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: rand(0.3, 0.6),
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const dustPlane = new THREE.Mesh(dustGeo, dustMat);
    dustPlane.position.set(x, y, z);
    dustPlane.rotation.set(0, angle, Math.PI / 2);
    group.add(dustPlane);
    disposables.push(dustGeo, dustMat);
  }

  return () => {
    for (const d of disposables) d.dispose();
    while (group.children.length > 0) {
      group.remove(group.children[0]);
    }
  };
}

// ═══════════════════════════════════════════════════════════════
// Variant 2: Elliptical Galaxy (E3 — de Vaucouleurs ellipsoid)
// ═══════════════════════════════════════════════════════════════
//
// Aufbau:
//   1. Triaxialer Ellipsoid (E3: Achsenverhältnis b/a = 0.7)
//   2. De-Vaucouleurs r¹/⁴-Profil (surface brightness)
//   3. Rötlich-goldene Farbpalette (Population II Sterne)
//   4. Diffuser Halo
//   5. Kern-Cusp (zentrale Verdichtung)

function buildElliptical(group: THREE.Group): () => void {
  const disposables: { dispose(): void }[] = [];

  // ── 1. Hauptkörper (de Vaucouleurs ellipsoid) ────────────
  const starCount = 18000;
  const starPos = new Float32Array(starCount * 3);
  const starCol = new Float32Array(starCount * 3);

  // Achsenverhältnisse für E3: b/a = 0.7
  // Dreiachsig: major (x), intermediate (y), minor (z)
  const axisRatioA = 1.0; // major
  const axisRatioB = 0.7; // intermediate (E3: b/a ≈ 0.7)
  const axisRatioC = 0.55; // minor

  const truncRadius = ELLIPTICAL_EFF_RADIUS * 4;

  for (let i = 0; i < starCount; i++) {
    // r¹/⁴ mit Rejection-Sampling
    let r: number;
    let accept: boolean;
    do {
      r = rand(0.2, truncRadius);
      // de Vaucouleurs law: μ(r) ∝ exp(-7.67 * [(r/Re)¹/⁴ - 1])
      // Volume-corrected probability (× r² for spherical volume)
      const re = ELLIPTICAL_EFF_RADIUS;
      const prob = (r / re) * Math.exp(-7.67 * Math.pow(r / re, 0.25));
      accept = Math.random() < prob * 0.35;
    } while (!accept);

    // Random direction on unit sphere, apply axis scaling
    const theta = Math.acos(2 * Math.random() - 1);
    const phi = Math.random() * Math.PI * 2;

    const ux = Math.sin(theta) * Math.cos(phi);
    const uy = Math.cos(theta);
    const uz = Math.sin(theta) * Math.sin(phi);

    starPos[i * 3] = ux * r * axisRatioA;
    starPos[i * 3 + 1] = uy * r * axisRatioB;
    starPos[i * 3 + 2] = uz * r * axisRatioC;

    // Farbtemperatur-Gradient: Kern warm (rot/gold), außen kühler
    const t = r / truncRadius;
    if (t < 0.2) {
      const c = hsl(rand(0.08, 0.14), rand(0.2, 0.5), rand(0.8, 1.0));
      starCol[i * 3] = c.r;
      starCol[i * 3 + 1] = c.g;
      starCol[i * 3 + 2] = c.b;
    } else if (t < 0.6) {
      const c = hsl(rand(0.1, 0.55), rand(0.05, 0.3), rand(0.7, 0.95));
      starCol[i * 3] = c.r;
      starCol[i * 3 + 1] = c.g;
      starCol[i * 3 + 2] = c.b;
    } else {
      const c = hsl(rand(0.5, 0.65), 0.05, rand(0.6, 0.8));
      starCol[i * 3] = c.r;
      starCol[i * 3 + 1] = c.g;
      starCol[i * 3 + 2] = c.b;
    }
  }

  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
  starGeo.setAttribute("color", new THREE.BufferAttribute(starCol, 3));
  const starSizeAttr = new THREE.BufferAttribute(
    new Float32Array(starCount).fill(0.45),
    1,
  );
  starGeo.setAttribute("aSize", starSizeAttr);

  const starMat = createVertexColorPointsMaterial(starSizeAttr, {
    opacity: 0.85,
  });

  const starPoints = new THREE.Points(starGeo, starMat);
  starPoints.frustumCulled = false;
  group.add(starPoints);
  disposables.push(starGeo, starMat);

  // ── 2. Kern-Cusp (zentrale Verdichtung) ──────────────────
  const cuspCount = 3000;
  const cuspPos = new Float32Array(cuspCount * 3);
  const cuspCol = new Float32Array(cuspCount * 3);

  const cuspRadius = ELLIPTICAL_EFF_RADIUS * 0.25;

  for (let i = 0; i < cuspCount; i++) {
    const r = Math.pow(Math.random(), 0.5) * cuspRadius; // concentration
    const theta = Math.acos(2 * Math.random() - 1);
    const phi = Math.random() * Math.PI * 2;

    cuspPos[i * 3] = Math.sin(theta) * Math.cos(phi) * r * axisRatioA;
    cuspPos[i * 3 + 1] = Math.cos(theta) * r * axisRatioB;
    cuspPos[i * 3 + 2] = Math.sin(theta) * Math.sin(phi) * r * axisRatioC;

    const c = hsl(rand(0.08, 0.13), rand(0.3, 0.6), rand(0.85, 1.0));
    cuspCol[i * 3] = c.r;
    cuspCol[i * 3 + 1] = c.g;
    cuspCol[i * 3 + 2] = c.b;
  }

  const cuspGeo = new THREE.BufferGeometry();
  cuspGeo.setAttribute("position", new THREE.BufferAttribute(cuspPos, 3));
  cuspGeo.setAttribute("color", new THREE.BufferAttribute(cuspCol, 3));
  const cuspSizeAttr = new THREE.BufferAttribute(
    new Float32Array(cuspCount).fill(0.35),
    1,
  );
  cuspGeo.setAttribute("aSize", cuspSizeAttr);

  const cuspMat = createVertexColorPointsMaterial(cuspSizeAttr, {
    opacity: 0.8,
  });

  const cuspPoints = new THREE.Points(cuspGeo, cuspMat);
  group.add(cuspPoints);
  disposables.push(cuspGeo, cuspMat);

  // ── 3. Kern-Glühen ───────────────────────────────────────
  const glowGeo = new THREE.SphereGeometry(
    ELLIPTICAL_EFF_RADIUS * 0.15,
    32,
    32,
  );
  const glowMat = new MeshBasicNodeMaterial();
  glowMat.colorNode = vec4(float(1.0), float(0.85), float(0.7), float(0.12));
  glowMat.transparent = true;
  glowMat.depthWrite = false;
  const glow = new THREE.Mesh(glowGeo, glowMat);
  group.add(glow);
  disposables.push(glowGeo, glowMat);

  // ── 4. Diffuser Halo (große schwache Hülle) ──────────────
  const haloCount = 2000;
  const haloPos = new Float32Array(haloCount * 3);
  const haloCol = new Float32Array(haloCount * 3);

  for (let i = 0; i < haloCount; i++) {
    const r = rand(ELLIPTICAL_EFF_RADIUS, truncRadius * 1.5);
    const theta = Math.acos(2 * Math.random() - 1);
    const phi = Math.random() * Math.PI * 2;

    haloPos[i * 3] = Math.sin(theta) * Math.cos(phi) * r * axisRatioA;
    haloPos[i * 3 + 1] = Math.cos(theta) * r * axisRatioB;
    haloPos[i * 3 + 2] = Math.sin(theta) * Math.sin(phi) * r * axisRatioC;

    // Sehr blass
    haloCol[i * 3] = 0.8;
    haloCol[i * 3 + 1] = 0.6;
    haloCol[i * 3 + 2] = 0.4;
  }

  const haloGeo = new THREE.BufferGeometry();
  haloGeo.setAttribute("position", new THREE.BufferAttribute(haloPos, 3));
  haloGeo.setAttribute("color", new THREE.BufferAttribute(haloCol, 3));
  const haloSizeAttr = new THREE.BufferAttribute(
    new Float32Array(haloCount).fill(0.8),
    1,
  );
  haloGeo.setAttribute("aSize", haloSizeAttr);

  const haloMat = createVertexColorPointsMaterial(haloSizeAttr, {
    opacity: 0.3,
  });

  const haloPoints = new THREE.Points(haloGeo, haloMat);
  haloPoints.frustumCulled = false;
  group.add(haloPoints);
  disposables.push(haloGeo, haloMat);

  return () => {
    for (const d of disposables) d.dispose();
    while (group.children.length > 0) {
      group.remove(group.children[0]);
    }
  };
}

// ═══════════════════════════════════════════════════════════════
// Variant 3: Irregular Galaxy (Magellanic type — chaotic clusters)
// ═══════════════════════════════════════════════════════════════
//
// Aufbau:
//   1. 5–8 Sternklumpen mit Gaswolken (chaotische Verteilung)
//   2. Filamentäre Gasstrukturen zwischen Klumpen
//   3. Junge blaue OB-Assoziationen in H II-Regionen
//   4. H II-Emission (rot) um blaue Klumpen
//   5. Verstreute Hintergrundsterne (diffuse Komponente)

function buildIrregular(group: THREE.Group): () => void {
  const disposables: { dispose(): void }[] = [];

  // ── 1. Diffuse Hintergrundsterne ─────────────────────────
  const bgCount = 6000;
  const bgPos = new Float32Array(bgCount * 3);
  const bgCol = new Float32Array(bgCount * 3);

  for (let i = 0; i < bgCount; i++) {
    const r = rand(5, GALAXY_RADIUS * 0.6);
    const theta = Math.acos(2 * Math.random() - 1);
    const phi = Math.random() * Math.PI * 2;

    bgPos[i * 3] = Math.sin(theta) * Math.cos(phi) * r;
    bgPos[i * 3 + 1] = Math.cos(theta) * r * 0.3;
    bgPos[i * 3 + 2] = Math.sin(theta) * Math.sin(phi) * r;

    const c = hsl(rand(0.1, 0.6), 0.05, rand(0.5, 0.8));
    bgCol[i * 3] = c.r;
    bgCol[i * 3 + 1] = c.g;
    bgCol[i * 3 + 2] = c.b;
  }

  const bgGeo = new THREE.BufferGeometry();
  bgGeo.setAttribute("position", new THREE.BufferAttribute(bgPos, 3));
  bgGeo.setAttribute("color", new THREE.BufferAttribute(bgCol, 3));
  const bgSizeAttr = new THREE.BufferAttribute(
    new Float32Array(bgCount).fill(0.5),
    1,
  );
  bgGeo.setAttribute("aSize", bgSizeAttr);

  const bgMat = createVertexColorPointsMaterial(bgSizeAttr, { opacity: 0.5 });

  const bgPoints = new THREE.Points(bgGeo, bgMat);
  bgPoints.frustumCulled = false;
  group.add(bgPoints);
  disposables.push(bgGeo, bgMat);

  // ── 2. Sternklumpen (chaotische Cluster) ─────────────────
  interface ClusterDef {
    center: THREE.Vector3;
    radius: number;
    starCount: number;
    hue: number;
    label: string;
  }

  const clusterDefs: ClusterDef[] = [
    {
      center: new THREE.Vector3(40, 5, -20),
      radius: 35,
      starCount: 2000,
      hue: 0.6,
      label: "OB1",
    }, // blau
    {
      center: new THREE.Vector3(-50, -3, 30),
      radius: 30,
      starCount: 1500,
      hue: 0.12,
      label: "RR Lyrae",
    }, // gold
    {
      center: new THREE.Vector3(70, -8, -60),
      radius: 40,
      starCount: 2200,
      hue: 0.58,
      label: "OB2",
    }, // blau
    {
      center: new THREE.Vector3(-80, 6, -50),
      radius: 25,
      starCount: 1200,
      hue: 0.15,
      label: "Red Clump",
    }, // warm
    {
      center: new THREE.Vector3(15, 2, 70),
      radius: 32,
      starCount: 1800,
      hue: 0.62,
      label: "OB3",
    }, // blau
    {
      center: new THREE.Vector3(-20, -6, -80),
      radius: 28,
      starCount: 1400,
      hue: 0.1,
      label: "Bulge remnant",
    }, // gold
    {
      center: new THREE.Vector3(90, 10, 40),
      radius: 22,
      starCount: 1000,
      hue: 0.57,
      label: "HII North",
    }, // cyan-blau
  ];

  for (const cluster of clusterDefs) {
    const pos = new Float32Array(cluster.starCount * 3);
    const col = new Float32Array(cluster.starCount * 3);

    for (let i = 0; i < cluster.starCount; i++) {
      const r = Math.pow(Math.random(), 0.4) * cluster.radius;
      const theta = Math.acos(2 * Math.random() - 1);
      const phi = Math.random() * Math.PI * 2;

      const x = Math.sin(theta) * Math.cos(phi) * r;
      const y = Math.cos(theta) * r * 0.4;
      const z = Math.sin(theta) * Math.sin(phi) * r;

      pos[i * 3] = cluster.center.x + x;
      pos[i * 3 + 1] = cluster.center.y + y;
      pos[i * 3 + 2] = cluster.center.z + z;

      const c = hsl(
        rand(cluster.hue - 0.05, cluster.hue + 0.08),
        rand(0.1, 0.4),
        rand(0.7, 1.0),
      );
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }

    const cGeo = new THREE.BufferGeometry();
    cGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    cGeo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const cSizeAttr = new THREE.BufferAttribute(
      new Float32Array(cluster.starCount).fill(0.7),
      1,
    );
    cGeo.setAttribute("aSize", cSizeAttr);

    const cMat = createVertexColorPointsMaterial(cSizeAttr, { opacity: 0.8 });

    const cPoints = new THREE.Points(cGeo, cMat);
    group.add(cPoints);
    disposables.push(cGeo, cMat);
  }

  // ── 3. H II-Emission (rote Gaswolken um blaue Klumpen) ───
  const hiiDefs = [
    { center: clusterDefs[0].center, radius: 45, count: 600 },
    { center: clusterDefs[2].center, radius: 50, count: 700 },
    { center: clusterDefs[4].center, radius: 42, count: 550 },
    { center: clusterDefs[6].center, radius: 30, count: 400 },
  ];

  for (const hii of hiiDefs) {
    const pos = new Float32Array(hii.count * 3);
    const col = new Float32Array(hii.count * 3);

    for (let i = 0; i < hii.count; i++) {
      const r = Math.sqrt(Math.random()) * hii.radius;
      const theta = Math.acos(2 * Math.random() - 1);
      const phi = Math.random() * Math.PI * 2;

      pos[i * 3] = hii.center.x + Math.sin(theta) * Math.cos(phi) * r;
      pos[i * 3 + 1] = hii.center.y + Math.cos(theta) * r * 0.3;
      pos[i * 3 + 2] = hii.center.z + Math.sin(theta) * Math.sin(phi) * r;

      // Rötliches H II-Leuchten
      const c = hsl(rand(0.0, 0.05), rand(0.6, 0.9), rand(0.3, 0.6));
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }

    const hGeo = new THREE.BufferGeometry();
    hGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    hGeo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const hSizeAttr = new THREE.BufferAttribute(
      new Float32Array(hii.count).fill(1.2),
      1,
    );
    hGeo.setAttribute("aSize", hSizeAttr);

    const hMat = createVertexColorPointsMaterial(hSizeAttr, { opacity: 0.35 });

    const hPoints = new THREE.Points(hGeo, hMat);
    group.add(hPoints);
    disposables.push(hGeo, hMat);
  }

  // ── 4. Gas-Filamente zwischen Klumpen ────────────────────
  const filamentCount = 4000;
  const filPos = new Float32Array(filamentCount * 3);
  const filCol = new Float32Array(filamentCount * 3);

  // Brücke zwischen OB-Klumpen
  for (let i = 0; i < filamentCount; i++) {
    const pairIdx = i % 3;
    const pairs: [THREE.Vector3, THREE.Vector3][] = [
      [clusterDefs[0].center, clusterDefs[2].center],
      [clusterDefs[2].center, clusterDefs[4].center],
      [clusterDefs[4].center, clusterDefs[6].center],
    ];
    const [a, b] = pairs[pairIdx];
    const t = Math.random();
    // Quadratic bezier with arc
    const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
    mid.y += rand(20, 50);
    mid.x += rand(-15, 15);

    const mt = 1 - t;
    const x = mt * mt * a.x + 2 * mt * t * mid.x + t * t * b.x;
    const y = mt * mt * a.y + 2 * mt * t * mid.y + t * t * b.y;
    const z = mt * mt * a.z + 2 * mt * t * mid.z + t * t * b.z;

    filPos[i * 3] = x + gauss() * 8;
    filPos[i * 3 + 1] = y + gauss() * 5;
    filPos[i * 3 + 2] = z + gauss() * 8;

    // Mischfarbe zwischen HII-rot und neutral
    const c = hsl(rand(0.55, 0.7), rand(0.1, 0.3), rand(0.3, 0.5));
    filCol[i * 3] = c.r;
    filCol[i * 3 + 1] = c.g;
    filCol[i * 3 + 2] = c.b;
  }

  const filGeo = new THREE.BufferGeometry();
  filGeo.setAttribute("position", new THREE.BufferAttribute(filPos, 3));
  filGeo.setAttribute("color", new THREE.BufferAttribute(filCol, 3));
  const filSizeAttr = new THREE.BufferAttribute(
    new Float32Array(filamentCount).fill(0.9),
    1,
  );
  filGeo.setAttribute("aSize", filSizeAttr);

  const filMat = createVertexColorPointsMaterial(filSizeAttr, { opacity: 0.4 });

  const filPoints = new THREE.Points(filGeo, filMat);
  group.add(filPoints);
  disposables.push(filGeo, filMat);

  return () => {
    for (const d of disposables) d.dispose();
    while (group.children.length > 0) {
      group.remove(group.children[0]);
    }
  };
}

// ═══════════════════════════════════════════════════════════════
// Factory
// ═══════════════════════════════════════════════════════════════

export function createGalaxyBiome(
  initialVariant: GalaxyVariant = "spiral",
): GalaxyBiomeSystem {
  const group = new THREE.Group();
  let current: GalaxyVariant = initialVariant;
  let cleanup: (() => void) | null = null;

  function applyVariant(v: GalaxyVariant): void {
    if (cleanup) {
      cleanup();
      cleanup = null;
    }
    while (group.children.length > 0) {
      group.remove(group.children[0]);
    }
    switch (v) {
      case "spiral":
        cleanup = buildSpiral(group);
        break;
      case "elliptical":
        cleanup = buildElliptical(group);
        break;
      case "irregular":
        cleanup = buildIrregular(group);
        break;
    }
    current = v;
  }

  applyVariant(initialVariant);

  return {
    group,
    get variant() {
      return current;
    },
    set variant(v: GalaxyVariant) {
      applyVariant(v);
    },
    setVariant(v: GalaxyVariant) {
      applyVariant(v);
    },
    update(_delta: number, _elapsed: number) {
      // Sanfte Rotation für Lebendigkeit
      group.rotation.y += 0.00005;
    },
    dispose() {
      if (cleanup) cleanup();
      while (group.children.length > 0) {
        const child = group.children[0];
        group.remove(child);
        if (child instanceof THREE.Points || child instanceof THREE.Mesh) {
          child.geometry.dispose();
          const mat = child.material as THREE.Material;
          mat.dispose();
        }
      }
    },
  };
}
