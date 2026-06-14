/**
 * Sternen-Biome — drei Varianten für den Space-World-Level (WebGPU)
 *
 * Varianten (forschungsbasiert, angelehnt an reale Astronomie):
 *   - "classic"   — klassisches Sternenfeld (gleichmäßig, twinkelnd)
 *   - "milky"     — Milchstraße (Balkenspiralgalaxie, extrem flache Scheibe,
 *                   zentraler Bulge, Spiralarme, dunkle Staubwolken)
 *   - "nebula"    — Nebelwolken (H II-Emission, Reflexion, planetarisch, dunkel;
 *                   filamentäre Strukturen, eingebettete helle Sterne)
 *
 * All materials use PointsNodeMaterial — WebGPU-native, no GLSL.
 */

import { attribute, float, vec3, vec4 } from "three/tsl";
import { PointsNodeMaterial, MeshBasicNodeMaterial } from "three/webgpu";
import * as THREE from "three/webgpu";

// ── Types ──────────────────────────────────────────────────────

export type StarVariant = "classic" | "milky" | "nebula";

export interface StarBiomeSystem {
  group: THREE.Group;
  variant: StarVariant;
  setVariant: (v: StarVariant) => void;
  update: (delta: number, elapsed: number) => void;
  dispose: () => void;
}

// ── Constants ──────────────────────────────────────────────────

const GALACTIC_RADIUS = 500;
const DISK_THICKNESS = 5;
const BULGE_RADIUS = 50;
const SUN_DISTANCE = 135;

// ── Metadata ───────────────────────────────────────────────────

export const VARIANT_META: Record<
  StarVariant,
  { label: string; desc: string }
> = {
  classic: {
    label: "Klassisches Sternenfeld",
    desc: "Gleichmäßig verteilte Sterne mit Funkeln — der zeitlose Weltraum-Look",
  },
  milky: {
    label: "Milchstraße",
    desc: "Balkenspiralgalaxie mit 4 Armen, zentralem Bulge und dunklen Staubbahnen — Flug durch unsere Heimatgalaxie",
  },
  nebula: {
    label: "Nebelwolken",
    desc: "Filamentäre Gaswolken mit eingebetteten hellen Sternen — farbenprächtige Emissions- und Reflexionsnebel",
  },
};

// ── Helpers ────────────────────────────────────────────────────

function rand(seed: number): number {
  return ((seed * 16807 + 0) % 2147483647) / 2147483647;
}

function gauss(seed: number): number {
  const u = rand(seed + 1);
  const v = rand(seed + 2);
  const z = Math.sqrt(-2 * Math.log(Math.max(u, 0.0001)));
  return z * Math.cos(2 * Math.PI * v);
}

// ── Vertex-Color Point Material ────────────────────────────────
// Reads vertex color attribute into colorNode — TSL-native approach.

function createVertexColorPointsMaterial(
  aSizeAttr: THREE.BufferAttribute,
): PointsNodeMaterial {
  const aSize = attribute("aSize", "float");
  const vertexColor = attribute("color", "vec3");

  const mat = new PointsNodeMaterial();
  mat.sizeNode = aSize;
  mat.sizeAttenuation = true;
  mat.transparent = true;
  mat.depthWrite = false;
  mat.blending = THREE.AdditiveBlending;

  // Pass vertex color directly into colorNode
  mat.colorNode = vec4(vertexColor, float(1.0));

  return mat;
}

// ── Classic Variant ────────────────────────────────────────────

function buildClassic(group: THREE.Group): () => void {
  // Sparse starfield — enough to feel immersive, light enough for 72fps VR
  const count = 1500;
  const radius = 500;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const r = radius * (0.8 + Math.random() * 0.2);

    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = r * Math.cos(phi);

    // All white with slight warmth variation
    const brightness = 0.7 + Math.random() * 0.3;
    colors[i * 3] = brightness;
    colors[i * 3 + 1] = brightness * (0.9 + Math.random() * 0.1);
    colors[i * 3 + 2] = brightness * (0.8 + Math.random() * 0.2);

    sizes[i] = 0.3 + Math.random() * 1.7; // minSize: 0.3, maxSize: 2.0
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const sizeAttr = new THREE.BufferAttribute(sizes, 1);
  geo.setAttribute("aSize", sizeAttr);

  const mat = createVertexColorPointsMaterial(sizeAttr);

  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  group.add(points);

  return () => {
    geo.dispose();
    mat.dispose();
  };
}

// ── Milky Way Variant ──────────────────────────────────────────

function buildMilky(group: THREE.Group): () => void {
  const disposables: { dispose(): void }[] = [];

  const ARM_COUNT = 4;
  const PITCH_ANGLE = 0.35;
  const armOffsets = [0, Math.PI, Math.PI * 0.5, Math.PI * 1.5];

  // Disk stars
  const diskStarCount = 3000;
  const diskPos = new Float32Array(diskStarCount * 3);
  const diskCol = new Float32Array(diskStarCount * 3);
  const diskSizes = new Float32Array(diskStarCount);

  for (let i = 0; i < diskStarCount; i++) {
    let r = 0;
    let armAngle = 0;

    for (let attempt = 0; attempt < 20; attempt++) {
      r = Math.random() * GALACTIC_RADIUS;
      const armIdx = Math.floor(Math.random() * ARM_COUNT);
      const armOffset = armOffsets[armIdx];
      const baseAngle = armOffset + (r * PITCH_ANGLE) / GALACTIC_RADIUS;
      const scatter = (Math.random() - 0.5) * 0.6;
      armAngle = baseAngle + scatter;

      const bestDist = Math.abs(armAngle - baseAngle);
      if (bestDist < 0.3 || attempt >= 19) break;
    }

    const x = r * Math.cos(armAngle);
    const z = r * Math.sin(armAngle);
    const scaleHeight = DISK_THICKNESS * (0.1 + Math.random() * 0.9);
    const y = gauss(i * 3 + 1000) * scaleHeight;

    diskPos[i * 3] = x;
    diskPos[i * 3 + 1] = y;
    diskPos[i * 3 + 2] = z;

    const t = r / GALACTIC_RADIUS;
    const hue = 0.12 + t * 0.08;
    const sat = 0.3 + t * 0.2;
    const light = 0.7 + (1 - t) * 0.2;
    const color = new THREE.Color().setHSL(hue, sat, light);
    diskCol[i * 3] = color.r;
    diskCol[i * 3 + 1] = color.g;
    diskCol[i * 3 + 2] = color.b;

    diskSizes[i] = 0.3 + Math.random() * 1.2;
  }

  const diskGeo = new THREE.BufferGeometry();
  diskGeo.setAttribute("position", new THREE.BufferAttribute(diskPos, 3));
  diskGeo.setAttribute("color", new THREE.BufferAttribute(diskCol, 3));
  const diskSizeAttr = new THREE.BufferAttribute(diskSizes, 1);
  diskGeo.setAttribute("aSize", diskSizeAttr);
  const diskMat = createVertexColorPointsMaterial(diskSizeAttr);
  const diskPoints = new THREE.Points(diskGeo, diskMat);
  diskPoints.frustumCulled = false;
  group.add(diskPoints);
  disposables.push(diskGeo, diskMat);

  // Bulge stars
  const bulgeCount = 800;
  const bulgePos = new Float32Array(bulgeCount * 3);
  const bulgeCol = new Float32Array(bulgeCount * 3);
  const bulgeSizes = new Float32Array(bulgeCount);

  for (let i = 0; i < bulgeCount; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const r = BULGE_RADIUS * Math.pow(Math.random(), 0.4);

    bulgePos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    bulgePos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta) * 0.4;
    bulgePos[i * 3 + 2] = r * Math.cos(phi);

    const dist = r / BULGE_RADIUS;
    const color = new THREE.Color().setHSL(0.14, 0.5, 0.6 + dist * 0.3);
    bulgeCol[i * 3] = color.r;
    bulgeCol[i * 3 + 1] = color.g;
    bulgeCol[i * 3 + 2] = color.b;

    bulgeSizes[i] = 0.4 + Math.random() * 1.0;
  }

  const bulgeGeo = new THREE.BufferGeometry();
  bulgeGeo.setAttribute("position", new THREE.BufferAttribute(bulgePos, 3));
  bulgeGeo.setAttribute("color", new THREE.BufferAttribute(bulgeCol, 3));
  const bulgeSizeAttr = new THREE.BufferAttribute(bulgeSizes, 1);
  bulgeGeo.setAttribute("aSize", bulgeSizeAttr);
  const bulgeMat = createVertexColorPointsMaterial(bulgeSizeAttr);
  const bulgePoints = new THREE.Points(bulgeGeo, bulgeMat);
  bulgePoints.frustumCulled = false;
  group.add(bulgePoints);
  disposables.push(bulgeGeo, bulgeMat);

  // Bar
  const barCount = 400;
  const barPos = new Float32Array(barCount * 3);
  const barCol = new Float32Array(barCount * 3);
  const barSizes = new Float32Array(barCount);
  const BAR_HALF_LENGTH = 80;
  const BAR_WIDTH = 15;

  for (let i = 0; i < barCount; i++) {
    const along = (Math.random() - 0.5) * 2 * BAR_HALF_LENGTH;
    const across =
      (Math.random() - 0.5) *
      BAR_WIDTH *
      (1 - Math.abs(along) / BAR_HALF_LENGTH);
    const height = gauss(i * 5 + 2000) * DISK_THICKNESS * 0.5;

    barPos[i * 3] = along;
    barPos[i * 3 + 1] = height;
    barPos[i * 3 + 2] = across;

    const color = new THREE.Color().setHSL(
      0.14,
      0.6,
      0.7 + Math.random() * 0.2,
    );
    barCol[i * 3] = color.r;
    barCol[i * 3 + 1] = color.g;
    barCol[i * 3 + 2] = color.b;

    barSizes[i] = 0.3 + Math.random() * 0.8;
  }

  const barGeo = new THREE.BufferGeometry();
  barGeo.setAttribute("position", new THREE.BufferAttribute(barPos, 3));
  barGeo.setAttribute("color", new THREE.BufferAttribute(barCol, 3));
  const barSizeAttr = new THREE.BufferAttribute(barSizes, 1);
  barGeo.setAttribute("aSize", barSizeAttr);
  const barMat = createVertexColorPointsMaterial(barSizeAttr);
  const barPoints = new THREE.Points(barGeo, barMat);
  barPoints.frustumCulled = false;
  group.add(barPoints);
  disposables.push(barGeo, barMat);

  // Core glow
  const coreGlowGeo = new THREE.SphereGeometry(8, 32, 32);
  const coreGlowMat = new MeshBasicNodeMaterial();
  coreGlowMat.colorNode = vec4(float(1.0), float(0.9), float(0.7), float(0.6));
  coreGlowMat.transparent = true;
  coreGlowMat.depthWrite = false;
  const coreGlow = new THREE.Mesh(coreGlowGeo, coreGlowMat);
  group.add(coreGlow);
  disposables.push(coreGlowGeo, coreGlowMat);

  // Inner core
  const innerCoreGeo = new THREE.SphereGeometry(3, 32, 32);
  const innerCoreMat = new MeshBasicNodeMaterial();
  innerCoreMat.colorNode = vec4(
    float(1.0),
    float(1.0),
    float(0.95),
    float(0.9),
  );
  innerCoreMat.transparent = true;
  innerCoreMat.depthWrite = false;
  const innerCore = new THREE.Mesh(innerCoreGeo, innerCoreMat);
  group.add(innerCore);
  disposables.push(innerCoreGeo, innerCoreMat);

  // Dust clouds — round, semi-transparent disks scattered across the disk
  const dustCount = 200;
  for (let i = 0; i < dustCount; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = 20 + Math.random() * 200;
    const x = dist * Math.cos(angle);
    const z = dist * Math.sin(angle);
    const y = gauss(i * 7 + 3000) * DISK_THICKNESS * 2;
    const radius = 2 + Math.random() * 10;

    // Round disk instead of rectangular plane
    const dustGeo = new THREE.CircleGeometry(radius, 16);
    const dustMat = new MeshBasicNodeMaterial();
    dustMat.colorNode = vec4(
      float(0.04 + Math.random() * 0.03),
      float(0.02 + Math.random() * 0.02),
      float(0.08 + Math.random() * 0.05),
      float(0.2 + Math.random() * 0.35),
    );
    dustMat.transparent = true;
    dustMat.depthWrite = false;
    dustMat.side = THREE.DoubleSide;

    const dustPlane = new THREE.Mesh(dustGeo, dustMat);
    dustPlane.position.set(x, y, z);
    dustPlane.lookAt(0, 0, 0);
    dustPlane.rotateZ(Math.random() * Math.PI * 2);
    group.add(dustPlane);
    disposables.push(dustGeo, dustMat);
  }

  // Halo
  const haloCount = 300;
  const haloPos = new Float32Array(haloCount * 3);
  const haloCol = new Float32Array(haloCount * 3);
  const haloSizes = new Float32Array(haloCount);

  for (let i = 0; i < haloCount; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.random() * Math.PI * 0.15;
    const r = GALACTIC_RADIUS * 0.4 + Math.random() * GALACTIC_RADIUS * 0.3;

    haloPos[i * 3] = r * Math.sin(phi + Math.PI * 0.5) * Math.cos(theta);
    haloPos[i * 3 + 1] = r * Math.cos(phi + Math.PI * 0.5);
    haloPos[i * 3 + 2] = r * Math.sin(phi + Math.PI * 0.5) * Math.sin(theta);

    const color = new THREE.Color().setHSL(0.6, 0.2, 0.4 + Math.random() * 0.3);
    haloCol[i * 3] = color.r;
    haloCol[i * 3 + 1] = color.g;
    haloCol[i * 3 + 2] = color.b;

    haloSizes[i] = 0.5 + Math.random() * 1.0;
  }

  const haloGeo = new THREE.BufferGeometry();
  haloGeo.setAttribute("position", new THREE.BufferAttribute(haloPos, 3));
  haloGeo.setAttribute("color", new THREE.BufferAttribute(haloCol, 3));
  const haloSizeAttr = new THREE.BufferAttribute(haloSizes, 1);
  haloGeo.setAttribute("aSize", haloSizeAttr);
  const haloMat = createVertexColorPointsMaterial(haloSizeAttr);
  const haloPoints = new THREE.Points(haloGeo, haloMat);
  haloPoints.frustumCulled = false;
  group.add(haloPoints);
  disposables.push(haloGeo, haloMat);

  // Star clouds in arms
  for (let arm = 0; arm < 3; arm++) {
    const cloudAngle = Math.random() * Math.PI * 2;
    const cloudDist = 80 + Math.random() * 200;
    const cx = cloudDist * Math.cos(cloudAngle);
    const cz = cloudDist * Math.sin(cloudAngle);

    const starCloudCount = 200;
    const scPos = new Float32Array(starCloudCount * 3);
    const scCol = new Float32Array(starCloudCount * 3);
    const scSizes = new Float32Array(starCloudCount);

    for (let i = 0; i < starCloudCount; i++) {
      const sr = Math.random() * 25;
      const stheta = Math.random() * Math.PI * 2;
      scPos[i * 3] = cx + sr * Math.cos(stheta);
      scPos[i * 3 + 1] = gauss(i * 11 + 4000 + arm) * DISK_THICKNESS;
      scPos[i * 3 + 2] = cz + sr * Math.sin(stheta);

      const scolor = new THREE.Color().setHSL(
        0.1 + Math.random() * 0.15,
        0.4,
        0.7 + Math.random() * 0.25,
      );
      scCol[i * 3] = scolor.r;
      scCol[i * 3 + 1] = scolor.g;
      scCol[i * 3 + 2] = scolor.b;

      scSizes[i] = 0.3 + Math.random() * 0.7;
    }

    const scGeo = new THREE.BufferGeometry();
    scGeo.setAttribute("position", new THREE.BufferAttribute(scPos, 3));
    scGeo.setAttribute("color", new THREE.BufferAttribute(scCol, 3));
    const scSizeAttr = new THREE.BufferAttribute(scSizes, 1);
    scGeo.setAttribute("aSize", scSizeAttr);
    const scMat = createVertexColorPointsMaterial(scSizeAttr);
    const scPoints = new THREE.Points(scGeo, scMat);
    scPoints.frustumCulled = false;
    group.add(scPoints);
    disposables.push(scGeo, scMat);
  }

  return () => {
    for (const d of disposables) d.dispose();
  };
}

// ── Nebula Variant ──────────────────────────────────────────────

interface NebulaDef {
  type: string;
  center: [number, number, number];
  color: THREE.Color;
  count: number;
  spread: number;
  size: number;
  opacity: number;
  filaments: number;
  brightStars: number;
}

function buildNebula(group: THREE.Group): () => void {
  const disposables: { dispose(): void }[] = [];

  // Background stars
  const bgCount = 1000;
  const bgPos = new Float32Array(bgCount * 3);
  const bgCol = new Float32Array(bgCount * 3);
  const bgSizes = new Float32Array(bgCount);

  for (let i = 0; i < bgCount; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const r = 300 + Math.random() * 200;

    bgPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    bgPos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    bgPos[i * 3 + 2] = r * Math.cos(phi);

    const color = new THREE.Color().setHSL(
      0.6 + Math.random() * 0.1,
      0.1,
      0.7 + Math.random() * 0.2,
    );
    bgCol[i * 3] = color.r;
    bgCol[i * 3 + 1] = color.g;
    bgCol[i * 3 + 2] = color.b;

    bgSizes[i] = 0.3 + Math.random() * 1.0;
  }

  const bgGeo = new THREE.BufferGeometry();
  bgGeo.setAttribute("position", new THREE.BufferAttribute(bgPos, 3));
  bgGeo.setAttribute("color", new THREE.BufferAttribute(bgCol, 3));
  const bgSizeAttr = new THREE.BufferAttribute(bgSizes, 1);
  bgGeo.setAttribute("aSize", bgSizeAttr);
  const bgMat = createVertexColorPointsMaterial(bgSizeAttr);
  const bgPoints = new THREE.Points(bgGeo, bgMat);
  bgPoints.frustumCulled = false;
  group.add(bgPoints);
  disposables.push(bgGeo, bgMat);

  // Nebula definitions
  const nebulaDefs: NebulaDef[] = [
    {
      type: "emission",
      center: [-80, 20, -50],
      color: new THREE.Color(0xff3366),
      count: 600,
      spread: 40,
      size: 2.5,
      opacity: 0.8,
      filaments: 8,
      brightStars: 8,
    },
    {
      type: "reflection",
      center: [50, -30, -80],
      color: new THREE.Color(0x3366ff),
      count: 500,
      spread: 35,
      size: 2.0,
      opacity: 0.7,
      filaments: 6,
      brightStars: 5,
    },
    {
      type: "emission",
      center: [-30, 50, -100],
      color: new THREE.Color(0x33ff99),
      count: 400,
      spread: 30,
      size: 2.2,
      opacity: 0.6,
      filaments: 5,
      brightStars: 6,
    },
    {
      type: "dark",
      center: [0, 0, -60],
      color: new THREE.Color(0x111122),
      count: 300,
      spread: 25,
      size: 3.0,
      opacity: 0.5,
      filaments: 4,
      brightStars: 0,
    },
    {
      type: "planetary",
      center: [100, 10, -120],
      color: new THREE.Color(0xffaa33),
      count: 200,
      spread: 15,
      size: 1.5,
      opacity: 0.9,
      filaments: 3,
      brightStars: 1,
    },
    {
      type: "emission",
      center: [-100, -20, -40],
      color: new THREE.Color(0xff66aa),
      count: 500,
      spread: 45,
      size: 2.8,
      opacity: 0.65,
      filaments: 7,
      brightStars: 7,
    },
    {
      type: "reflection",
      center: [30, 60, -90],
      color: new THREE.Color(0x66aaff),
      count: 450,
      spread: 38,
      size: 2.1,
      opacity: 0.55,
      filaments: 6,
      brightStars: 4,
    },
    {
      type: "emission",
      center: [-50, -50, -130],
      color: new THREE.Color(0xaa66ff),
      count: 550,
      spread: 42,
      size: 2.4,
      opacity: 0.7,
      filaments: 9,
      brightStars: 9,
    },
    {
      type: "dark",
      center: [60, -40, -70],
      color: new THREE.Color(0x0a0a1a),
      count: 200,
      spread: 20,
      size: 3.5,
      opacity: 0.4,
      filaments: 3,
      brightStars: 0,
    },
    {
      type: "planetary",
      center: [-20, -60, -110],
      color: new THREE.Color(0x44ddcc),
      count: 250,
      spread: 18,
      size: 1.8,
      opacity: 0.75,
      filaments: 4,
      brightStars: 1,
    },
  ];

  for (const def of nebulaDefs) {
    const [cx, cy, cz] = def.center;
    const positions = new Float32Array(def.count * 3);
    const colors = new Float32Array(def.count * 3);
    const sizes = new Float32Array(def.count);
    const filamentCenters: [number, number, number][] = [];

    // Generate filament centers
    for (let f = 0; f < def.filaments; f++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = def.spread * (0.3 + Math.random() * 0.7);
      filamentCenters.push([
        cx + r * Math.sin(phi) * Math.cos(theta),
        cy + r * Math.sin(phi) * Math.sin(theta),
        cz + r * Math.cos(phi),
      ]);
    }

    for (let i = 0; i < def.count; i++) {
      let px: number, py: number, pz: number;

      if (filamentCenters.length > 0 && Math.random() < 0.7) {
        const fc =
          filamentCenters[Math.floor(Math.random() * filamentCenters.length)];
        const alongFilament = (Math.random() - 0.5) * def.spread * 0.6;
        const acrossFilament =
          gauss(i * 13 + Math.random() * 1000) * def.spread * 0.15;
        px = fc[0] + alongFilament;
        py = fc[1] + acrossFilament;
        pz = fc[2] + (Math.random() - 0.5) * def.spread * 0.2;
      } else {
        px = cx + gauss(i * 7) * def.spread;
        py = cy + gauss(i * 11) * def.spread;
        pz = cz + gauss(i * 13) * def.spread;
      }

      positions[i * 3] = px;
      positions[i * 3 + 1] = py;
      positions[i * 3 + 2] = pz;

      const hueShift = (Math.random() - 0.5) * 0.1;
      const satShift = Math.random() * 0.2;
      const valShift = Math.random() * 0.15;
      const baseHSL: { h: number; s: number; l: number } = { h: 0, s: 0, l: 0 };
      def.color.getHSL(baseHSL);
      const color = new THREE.Color().setHSL(
        Math.max(0, Math.min(1, baseHSL.h + hueShift)),
        Math.max(0, Math.min(1, baseHSL.s + satShift)),
        Math.max(0, Math.min(1, baseHSL.l + valShift)),
      );
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;

      sizes[i] = def.size * (0.5 + Math.random() * 0.5);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const sizeAttr = new THREE.BufferAttribute(sizes, 1);
    geo.setAttribute("aSize", sizeAttr);
    const mat = createVertexColorPointsMaterial(sizeAttr);
    mat.opacity = def.opacity;
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    group.add(points);
    disposables.push(geo, mat);

    // Bright embedded stars
    for (let s = 0; s < def.brightStars; s++) {
      const starGeo = new THREE.SphereGeometry(0.3 + Math.random() * 0.5, 8, 8);
      const starMat = new MeshBasicNodeMaterial();
      const starColor = new THREE.Color().copy(def.color).multiplyScalar(1.5);
      starMat.colorNode = vec4(
        float(starColor.r),
        float(starColor.g),
        float(starColor.b),
        float(1.0),
      );
      starMat.transparent = true;
      starMat.depthWrite = false;

      const star = new THREE.Mesh(starGeo, starMat);
      const si = Math.floor(Math.random() * def.count);
      star.position.set(
        positions[si * 3],
        positions[si * 3 + 1],
        positions[si * 3 + 2],
      );
      group.add(star);
      disposables.push(starGeo, starMat);

      // Halo
      const haloGeo = new THREE.SphereGeometry(1.0 + Math.random() * 1.5, 8, 8);
      const haloMat = new MeshBasicNodeMaterial();
      haloMat.colorNode = vec4(
        float(starColor.r * 0.6),
        float(starColor.g * 0.6),
        float(starColor.b * 0.6),
        float(0.3),
      );
      haloMat.transparent = true;
      haloMat.depthWrite = false;
      const halo = new THREE.Mesh(haloGeo, haloMat);
      halo.position.copy(star.position);
      group.add(halo);
      disposables.push(haloGeo, haloMat);
    }
  }

  return () => {
    for (const d of disposables) d.dispose();
  };
}

// ═══════════════════════════════════════════════════════════════
// Factory
// ═══════════════════════════════════════════════════════════════

export function createStarBiome(
  initialVariant: StarVariant = "classic",
): StarBiomeSystem {
  const group = new THREE.Group();
  let current: StarVariant = initialVariant;
  let cleanup: (() => void) | null = null;

  function applyVariant(v: StarVariant): void {
    if (cleanup) {
      cleanup();
      cleanup = null;
    }
    while (group.children.length > 0) {
      group.remove(group.children[0]);
    }
    switch (v) {
      case "classic":
        cleanup = buildClassic(group);
        break;
      case "milky":
        cleanup = buildMilky(group);
        break;
      case "nebula":
        cleanup = buildNebula(group);
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
    set variant(v: StarVariant) {
      applyVariant(v);
    },
    setVariant(v: StarVariant) {
      applyVariant(v);
    },
    update(_delta: number, _elapsed: number) {
      // TSL materials use `time` uniform — auto-updating, no manual update needed
      // Milky Way: slow rotation for immersion
      if (current === "milky") {
        group.rotation.y += 0.00008;
      }
      // Nebula: very slow drift
      if (current === "nebula") {
        group.rotation.y += 0.00003;
      }
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
