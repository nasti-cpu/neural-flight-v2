import * as THREE from "three";

export type SeagrassType = "algae" | "long" | "bushy";

// ── Single blade geometry (ribbon, base at origin) ──

function createBladeGeometry(
  length: number,
  width: number,
  curveAmt: number,
): THREE.BufferGeometry {
  const segs = 10;
  const positions: number[] = [];
  const indices: number[] = [];
  const uvs: number[] = [];

  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const y = t * length;
    const w = width * (1 - t * 0.6);
    const bend = Math.sin(t * Math.PI) * curveAmt;

    positions.push(-w / 2, y, bend, w / 2, y, bend);
    uvs.push(0, t, 1, t);

    if (i < segs) {
      const a = i * 2,
        b = i * 2 + 1;
      indices.push(a, a + 2, a + 1);
      indices.push(a + 1, a + 2, a + 3);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

// ── Algae frond geometry (wide, ruffled, irregular) ──

function createAlgaeGeometry(
  length: number,
  width: number,
  ruffles: number,
): THREE.BufferGeometry {
  const segs = 14;
  const positions: number[] = [];
  const indices: number[] = [];
  const uvs: number[] = [];

  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const y = t * length;
    const taper = 1 - t * 0.65;
    const ruffle =
      1 +
      Math.sin(t * Math.PI * 3.7 + ruffles * 4) * 0.2 * taper +
      Math.sin(t * Math.PI * 7.3) * 0.08;
    const w = width * taper * ruffle;
    const cx = Math.sin(t * Math.PI * 4 + ruffles * 2) * width * 0.12 * taper;
    const bend = Math.sin(t * Math.PI) * (ruffles * 0.3 + 0.2);

    positions.push(-w / 2 + cx, y, bend, w / 2 + cx, y, bend);
    uvs.push(0, t, 1, t);

    if (i < segs) {
      const a = i * 2,
        b = i * 2 + 1;
      indices.push(a, a + 2, a + 1);
      indices.push(a + 1, a + 2, a + 3);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

// ── Types & Config ──

interface SeagrassConfig {
  count: number;
  lengthRange: [number, number];
  widthRange: [number, number];
  curveRange: [number, number];
  color: number;
  spread: number;
  density: number;
  speed: number;
}

export interface SeagrassMeta {
  id: SeagrassType;
  label: string;
  description: string;
}

export const SEAGRASS_META: SeagrassMeta[] = [
  { id: "algae", label: "Algen", description: "Breite, krause Algenfiedern" },
  {
    id: "long",
    label: "Langes Seegras",
    description: "Wie Eelgrass — lange, schmale Bänder",
  },
  {
    id: "bushy",
    label: "Buschiges Seegras",
    description: "Dichte Büschel, verzweigt",
  },
];

const CONFIG: Record<SeagrassType, SeagrassConfig> = {
  algae: {
    count: 220,
    lengthRange: [2, 5],
    widthRange: [0.3, 0.7],
    curveRange: [0.2, 0.7],
    color: 0x668844,
    spread: 28,
    density: 0.5,
    speed: 1.4,
  },
  long: {
    count: 200,
    lengthRange: [4, 9],
    widthRange: [0.12, 0.3],
    curveRange: [0.3, 0.9],
    color: 0x338833,
    spread: 32,
    density: 0.3,
    speed: 0.8,
  },
  bushy: {
    count: 180,
    lengthRange: [3, 6],
    widthRange: [0.15, 0.35],
    curveRange: [0.2, 0.6],
    color: 0x44aa44,
    spread: 28,
    density: 0.5,
    speed: 1.0,
  },
};

// ── Instanced Management ──

const MAX_MEADOWS_PER_TYPE = 12;
const MAX_BLADES_PER_TYPE = 220 * MAX_MEADOWS_PER_TYPE;

const instanceMeshes: Record<string, THREE.InstancedMesh> = {};
const typeGeos: Record<string, THREE.BufferGeometry> = {};
const typeMaterials: Record<string, THREE.MeshStandardMaterial> = {};

// Track slots for each type
const typeSlots: Record<string, boolean[]> = {
  algae: new Array(MAX_MEADOWS_PER_TYPE).fill(false),
  long: new Array(MAX_MEADOWS_PER_TYPE).fill(false),
  bushy: new Array(MAX_MEADOWS_PER_TYPE).fill(false),
};

function ensureResources(type: SeagrassType, scene: THREE.Scene) {
  if (!typeGeos[type]) {
    const cfg = CONFIG[type];
    // Create a "master" geometry for this type (using average values)
    const avgLen = (cfg.lengthRange[0] + cfg.lengthRange[1]) / 2;
    const avgW = (cfg.widthRange[0] + cfg.widthRange[1]) / 2;
    const avgCurve = (cfg.curveRange[0] + cfg.curveRange[1]) / 2;

    if (type === "algae") {
      typeGeos[type] = createAlgaeGeometry(avgLen, avgW, avgCurve);
    } else {
      typeGeos[type] = createBladeGeometry(avgLen, avgW, avgCurve);
    }

    typeMaterials[type] = new THREE.MeshStandardMaterial({
      color: cfg.color,
      roughness: 0.6,
      metalness: 0.0,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85,
    });

    const imesh = new THREE.InstancedMesh(
      typeGeos[type],
      typeMaterials[type],
      MAX_BLADES_PER_TYPE,
    );
    imesh.frustumCulled = true;
    imesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    // Initialize with scale 0 to hide unused
    const dummy = new THREE.Object3D();
    dummy.scale.setScalar(0);
    dummy.updateMatrix();
    for (let i = 0; i < MAX_BLADES_PER_TYPE; i++) {
      imesh.setMatrixAt(i, dummy.matrix);
    }
    imesh.instanceMatrix.needsUpdate = true;

    scene.add(imesh);
    instanceMeshes[type] = imesh;
  }
}

// ── Per-blade state (simplified for instancing) ──

interface BladeData {
  pos: THREE.Vector3;
  rot: THREE.Euler;
  scale: THREE.Vector3;
  phase: number;
  amp: number;
}

export interface SeagrassMeadow {
  type: SeagrassType;
  slotIndex: number;
  blades: BladeData[];
  group: THREE.Group; // Keep for scene hierarchy compatibility, but remains empty
}

// ── Write blade matrices (shared between init and per-frame sway) ──

function writeMeadowMatrices(meadow: SeagrassMeadow, elapsed: number): void {
  const imesh = instanceMeshes[meadow.type];
  if (!imesh) return;

  const cfg = CONFIG[meadow.type];
  const offset = meadow.slotIndex * 220;

  for (let i = 0; i < meadow.blades.length; i++) {
    const b = meadow.blades[i];
    const sway = Math.sin(elapsed * cfg.speed + b.phase) * b.amp;

    _dummy.position.set(b.pos.x + sway, b.pos.y, b.pos.z);
    _dummy.rotation.copy(b.rot);
    _dummy.scale.copy(b.scale);
    _dummy.updateMatrix();
    imesh.setMatrixAt(offset + i, _dummy.matrix);
  }
  imesh.instanceMatrix.needsUpdate = true;
}

// ── Create meadow ──

const _mat4 = new THREE.Matrix4();
const _dummy = new THREE.Object3D();

export function createSeagrassMeadow(
  type: SeagrassType,
  terrainHeight: (x: number, z: number) => number,
  centerX = 0,
  centerZ = 0,
): SeagrassMeadow {
  const cfg = CONFIG[type];
  const group = new THREE.Group();
  const blades: BladeData[] = [];

  // Find free slot
  const slots = typeSlots[type];
  let slotIndex = slots.indexOf(false);
  if (slotIndex === -1) {
    console.warn(`No free slots for seagrass type ${type}, reusing slot 0`);
    slotIndex = 0;
  }
  slots[slotIndex] = true;

  // Generate cluster centers
  const clusterCount = Math.max(4, Math.floor(cfg.count / 25));
  const clusters: { x: number; z: number; tightness: number }[] = [];
  for (let c = 0; c < clusterCount; c++) {
    clusters.push({
      x: (Math.random() - 0.5) * cfg.spread,
      z: (Math.random() - 0.5) * cfg.spread,
      tightness: 0.3 + Math.random() * 1.2,
    });
  }

  for (let i = 0; i < cfg.count; i++) {
    const ci = Math.floor(Math.random() * clusters.length);
    const cl = clusters[ci];
    const dist =
      (0.2 + Math.random() * 0.8) * cl.tightness * (cfg.spread / clusterCount);
    const ca = Math.random() * Math.PI * 2;
    const wx = centerX + cl.x + Math.cos(ca) * dist;
    const wz = centerZ + cl.z + Math.sin(ca) * dist;
    const wy = terrainHeight(wx, wz);

    const rotY = Math.random() * Math.PI * 2;
    const tiltX = (Math.random() - 0.5) * 0.15;
    const tiltZ = (Math.random() - 0.5) * 0.15;

    // Variation in size (relative to the "master" geometry)
    const s = 0.7 + Math.random() * 0.6;

    const b: BladeData = {
      pos: new THREE.Vector3(wx, wy, wz),
      rot: new THREE.Euler(tiltX, rotY, tiltZ),
      scale: new THREE.Vector3(s, s, s),
      phase: Math.random() * Math.PI * 2,
      amp: 0.03 + Math.random() * 0.06,
    };
    blades.push(b);
  }

  // Write blades immediately (not just on first sway update)
  writeMeadowMatrices({ type, slotIndex, blades, group }, 0);

  return { type, slotIndex, blades, group };
}

// ── Update sway per frame ──

export function updateSeagrassSway(
  meadow: SeagrassMeadow,
  elapsed: number,
  _type: SeagrassType,
): void {
  writeMeadowMatrices(meadow, elapsed);
}

// ── Global Init (for scene.ts) ──

export function initSeagrassSystem(scene: THREE.Scene): void {
  (Object.keys(CONFIG) as SeagrassType[]).forEach((type) => {
    ensureResources(type, scene);
  });
}

// ── Dispose ──

export function disposeSeagrassMeadow(
  meadow: SeagrassMeadow,
  scene: THREE.Scene,
): void {
  scene.remove(meadow.group);

  // Release slot
  typeSlots[meadow.type][meadow.slotIndex] = false;

  // Hide instances in the shared mesh
  const imesh = instanceMeshes[meadow.type];
  if (imesh) {
    const offset = meadow.slotIndex * 220;
    _dummy.scale.setScalar(0);
    _dummy.updateMatrix();
    for (let i = 0; i < 220; i++) {
      imesh.setMatrixAt(offset + i, _dummy.matrix);
    }
    imesh.instanceMatrix.needsUpdate = true;
  }
}
