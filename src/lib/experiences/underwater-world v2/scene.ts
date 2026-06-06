import * as THREE from "three";
import type { ExperienceState, SetupContext, TickContext } from "../types";
import { hash2d, getBiome, getTerrainHeight } from "./welt/terrain";
import type { TerrainChunk } from "./welt/terrain";
import { CHUNK_SIZE } from "./welt/terrain";
import {
  createWaterSurface,
  updateWaterSurface,
  disposeWaterSurface,
  WATER_SURFACE_Y,
} from "./welt/wasser";
import {
  createInitialTerrainChunks,
  disposeTerrainChunk,
  queueTerrainChunks,
  processChunkQueue,
  createCoralField,
  updateCoralStreaming,
} from "./welt/chunks";
import type { CoralField } from "./welt/chunks";
import {
  createSeagrassMeadow,
  updateSeagrassSway,
  disposeSeagrassMeadow,
  SEAGRASS_META,
  type SeagrassMeadow,
} from "$lib/experiences/underwater-world v2/Objekte/Seegras/seagrass";
import {
  createDuneSand,
  disposeDuneSand,
} from "$lib/experiences/underwater-world v2/Biome/Sand/sand";
import type { DuneSandResult } from "$lib/experiences/underwater-world v2/Biome/Sand/sand";
import {
  createCity,
  disposeCity,
  updateCityPulse,
} from "$lib/experiences/underwater-world v2/Biome/Städte/city";
import type {
  CityResult,
  CityVariant,
} from "$lib/experiences/underwater-world v2/Biome/Städte/city";
import {
  createFishSchool,
  disposeFishSchool,
  loadFishGeometry,
  updateFishSchool,
  STANDARD_SCHOOL_CONFIGS,
  type FishSchool,
} from "$lib/experiences/underwater-world v2/Objekte/Fische/fish";
import { createProceduralCoralGeometry } from "$lib/experiences/underwater-world v2/Biome/Korallenriff/korallenriff";
import {
  createGuidancePath,
  VARIANT_CONFIGS,
} from "$lib/experiences/underwater-world v2/Sinne/Leitsystem/guidance";
import type { GuidancePath } from "$lib/experiences/underwater-world v2/Sinne/Leitsystem/guidance";
import {
  createCoralReef,
  disposeCoralReef,
} from "$lib/experiences/underwater-world v2/Biome/Korallenriff/korallenriff";
import type {
  CoralReef,
  CoralBiome,
} from "$lib/experiences/underwater-world v2/Biome/Korallenriff/korallenriff";
import {
  scatterCoralModels,
  disposeScatterGroup,
  ensureModelLoaded as ensureCoralModelLoaded,
} from "$lib/experiences/underwater-world v2/Biome/Korallenriff/modelCoralReef";
import {
  createEchoVR,
  updateEchoVR,
  disposeEchoVR,
  type EchoVRState,
} from "$lib/experiences/underwater-world v2/Sinne/Echoortung/echoVRIntegration";

// ── Constants ──

const SAND_PATCH_COUNT = 400;
const SAND_STREAM_PER_FRAME = 8;
const CORAL_MAX_PER_TYPE = 500;
const CORAL_STREAM_RADIUS = 300;

const CITY_VARIANTS: CityVariant[] = ["altstadt", "zentrum", "vorort"];
const SEAGRASS_TYPES: ("algae" | "long" | "bushy")[] = SEAGRASS_META.map(
  (m) => m.id,
);
const STREAM_INIT_RADIUS = 200;
const CITY_DOME_RADIUS = 65;
const CITY_SPACING_MIN = 150;
const CITY_SPACING_MAX = 350;

// ── Biome / Height (moved to welt/terrain.ts) ──

// ── Types ──

interface AudioState {
  ctx: AudioContext;
  masterGain: GainNode;
  bgGain: GainNode;
  bgSrc: AudioBufferSourceNode;
  surfaceGain: GainNode;
  surfaceSrc: AudioBufferSourceNode | null;
  surfaceBlend: number;
  moveBuffer: AudioBuffer | null;
  wasSpace: boolean;
}

export interface UnderwaterWorldState extends ExperienceState {
  camera: THREE.PerspectiveCamera;
  scene: THREE.Scene;
  driftSpeed: number;
  wasdSpeed: number;
  lightIntensity: number;
  terrainAmplitude: number;
  terrainScale: number;
  terrainColor: string;
  terrainChunks: TerrainChunk[];
  pendingChunks: { gx: number; gz: number }[];
  prevGx: number;
  prevGz: number;
  onKeyDown: (e: KeyboardEvent) => void;
  onKeyUp: (e: KeyboardEvent) => void;
  terrainMat: THREE.MeshStandardMaterial;
  sandEntries: {
    wx: number;
    wz: number;
    variant: "plain" | "seagrass" | "city" | "reef";
    cityVariant?: CityVariant;
    seagrassType?: "algae" | "long" | "bushy";
    reefBiome?: CoralBiome;
    dune?: DuneSandResult;
    meadow?: SeagrassMeadow;
    city?: CityResult;
    reef?: CoralReef;
    modelCoralReef?: THREE.Group;
  }[];
  sandPositions: {
    wx: number;
    wz: number;
    variant: "plain" | "seagrass" | "city" | "reef";
    cityVariant?: CityVariant;
    seagrassType?: "algae" | "long" | "bushy";
    reefBiome?: CoralBiome;
  }[];
  waterSurface: THREE.Mesh;
  audio: AudioState | null;
  keys: Set<string>;
  fishSchools: FishSchool[];
  coralField: CoralField;
  coralColors: number[];
  startCityCity: CityResult | null;
  startCityCityVariant: CityVariant | null;
  startCityX: number;
  startCityZ: number;
  startCoralReef: THREE.Group | null;
  cityGuidancePath: GuidancePath | null;
  cityGuidanceArrived: Set<string>;
  echoVR: EchoVRState | null;
  coralMaterials: THREE.MeshStandardMaterial[];
  // Shared colour instances to avoid per-frame allocations in the tick loop
  _flashColor: THREE.Color;
  _fishBaseColor: THREE.Color;
  _domeAltstadtColor: THREE.Color;
  _domeZentrumColor: THREE.Color;
  _domeVorortColor: THREE.Color;
  _domeModelCityColor: THREE.Color;
  _coralIdleColor: THREE.Color;
}

// ── Terrain (moved to welt/terrain.ts + welt/chunks.ts) ──

// ── Audio ──

function initAudio(ctx: AudioContext, masterGain: GainNode): AudioState {
  const bgGain = ctx.createGain();
  bgGain.gain.value = 0;
  bgGain.connect(masterGain);
  const bgSrc = ctx.createBufferSource();
  bgSrc.loop = true;
  bgSrc.connect(bgGain);

  const surfaceGain = ctx.createGain();
  surfaceGain.gain.value = 0;
  surfaceGain.connect(masterGain);

  return {
    ctx,
    masterGain,
    bgGain,
    bgSrc,
    surfaceGain,
    surfaceSrc: null,
    surfaceBlend: 0,
    moveBuffer: null,
    wasSpace: false,
  };
}

async function loadAudioAssets(audio: AudioState): Promise<void> {
  const ctx = audio.ctx;
  try {
    const bgRes = await fetch(
      "/sounds/dragon-studio-deep-sea-underwater-ambience-472383.mp3",
    );
    const bgBuf = await bgRes.arrayBuffer();
    audio.bgSrc.buffer = await ctx.decodeAudioData(bgBuf);
    audio.bgSrc.start();
    audio.bgGain.gain.value = 0.2;
  } catch {
    /* bg silent */
  }

  try {
    const sfRes = await fetch(
      "/sounds/dragon-studio-deep-sea-underwater-ambience-482888.mp3",
    );
    const sfBuf = await sfRes.arrayBuffer();
    const sfSrc = ctx.createBufferSource();
    sfSrc.loop = true;
    sfSrc.buffer = await ctx.decodeAudioData(sfBuf);
    sfSrc.connect(audio.surfaceGain);
    sfSrc.start();
    audio.surfaceSrc = sfSrc;
  } catch {
    /* surface silent */
  }

  try {
    const mvRes = await fetch(
      "/sounds/freesound_community-underwater-movement-66914.mp3",
    );
    const mvBuf = await mvRes.arrayBuffer();
    audio.moveBuffer = await ctx.decodeAudioData(mvBuf);
  } catch {
    /* movement silent */
  }
}

function playMovementSound(audio: AudioState): void {
  if (!audio.moveBuffer) return;
  if (audio.ctx.state === "suspended") audio.ctx.resume();
  const src = audio.ctx.createBufferSource();
  src.buffer = audio.moveBuffer;
  const g = audio.ctx.createGain();
  g.gain.value = 0.5;
  src.connect(g);
  g.connect(audio.masterGain);
  src.start();
}

// ── Setup ──

export async function setup(ctx: SetupContext): Promise<UnderwaterWorldState> {
  const camera = ctx.camera;
  const scene = ctx.scene;
  const amplitude = 50;
  const scale = 0.012;

  camera.position.set(0, 4, 0);
  camera.rotation.set(0, 0, 0);

  // Terrain
  const terrainMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.9,
    metalness: 0.0,
  });

  const terrainChunks = createInitialTerrainChunks(
    scene,
    amplitude,
    scale,
    terrainMat,
  );
  const pendingChunks: { gx: number; gz: number }[] = [];

  // ── Sand patch positions (sand biome ≥ 0.50) ──
  // Distribution: 40% seagrass, 20% city, 20% reef, 20% plain

  const sandPositions: {
    wx: number;
    wz: number;
    variant: "plain" | "seagrass" | "city" | "reef";
    cityVariant?: CityVariant;
    seagrassType?: "algae" | "long" | "bushy";
    reefBiome?: CoralBiome;
  }[] = [];
  const cityCoords: { wx: number; wz: number }[] = [];
  for (let si = 0; si < SAND_PATCH_COUNT * 4; si++) {
    const wx = (hash2d(si * 19 + 3, si * 31 + 7) - 0.5) * 2800;
    const wz = (hash2d(si * 23 + 11, si * 17 + 5) - 0.5) * 2800;
    const biome = getBiome(wx, wz);
    if (biome >= 0.5) {
      const roll = hash2d(wx * 13, wz * 17);
      let variant: "plain" | "seagrass" | "city" | "reef";
      if (roll < 0.4) variant = "seagrass";
      else if (roll < 0.6) variant = "city";
      else if (roll < 0.8) variant = "reef";
      else variant = "plain";

      if (variant === "city") {
        const tooClose = cityCoords.some((c) => {
          const dSq = (c.wx - wx) ** 2 + (c.wz - wz) ** 2;
          return dSq < CITY_SPACING_MIN ** 2;
        });
        if (tooClose) {
          const rr = hash2d(wx * 7, wz * 13);
          if (rr < 0.5) variant = "seagrass";
          else if (rr < 0.75) variant = "reef";
          else variant = "plain";
        } else {
          cityCoords.push({ wx, wz });
        }
      }

      const entry: (typeof sandPositions)[number] = { wx, wz, variant };
      if (variant === "city")
        entry.cityVariant =
          CITY_VARIANTS[
            Math.floor(hash2d(wx * 7, wz * 11) * CITY_VARIANTS.length)
          ];
      if (variant === "seagrass")
        entry.seagrassType =
          SEAGRASS_TYPES[
            Math.floor(hash2d(wx * 5, wz * 13) * SEAGRASS_TYPES.length)
          ];
      if (variant === "reef")
        entry.reefBiome = hash2d(wx * 3, wz * 7) < 0.5 ? "shallow" : "deep";
      sandPositions.push(entry);
      if (sandPositions.length >= SAND_PATCH_COUNT) break;
    }
  }

  // Water surface
  const water = createWaterSurface(scene);

  // Lighting + Fog handled by Loader via manifest.ts config

  // Coral field (slot-tracking)
  const CORAL_COLORS = [
    0xff4466, 0xff8844, 0xffcc44, 0x44ff88, 0x66ddff, 0xdd66ff, 0xff66aa,
    0x88ff66, 0xffaa44, 0x66ffcc,
  ];
  const coralGeos = [0, 1, 2, 3, 4].map((t) =>
    createProceduralCoralGeometry(t),
  );
  const coralPosArr: number[] = [];
  const coralTypesArr: number[] = [];
  const coralColorsArr: number[] = [];
  for (let ci = 0; ci < CORAL_MAX_PER_TYPE * 5; ci++) {
    const wx = (hash2d(ci * 37 + 5, ci * 41 + 13) - 0.5) * 3000;
    const wz = (hash2d(ci * 43 + 17, ci * 29 + 7) - 0.5) * 3000;
    const biome = getBiome(wx, wz);
    if (biome >= 0.25 && biome < 0.5) {
      const type = Math.floor(hash2d(wx * 11, wz * 17) * 5);
      const color =
        CORAL_COLORS[Math.floor(hash2d(wx * 3, wz * 7) * CORAL_COLORS.length)];
      coralPosArr.push(wx, wz);
      coralTypesArr.push(type);
      coralColorsArr.push(color);
    }
  }
  const coralField = createCoralField(
    scene,
    coralGeos,
    CORAL_MAX_PER_TYPE,
    new Float32Array(coralPosArr),
    new Int32Array(coralTypesArr),
    new Float32Array(coralColorsArr),
  );

  // Fish
  const fishModel = await loadFishGeometry();
  const fishSchools: FishSchool[] = [];
  for (const cfg of STANDARD_SCHOOL_CONFIGS) {
    const school = createFishSchool(
      cfg.count,
      fishModel ?? undefined,
      cfg.spread,
      cfg.heightRange,
    );
    school.mesh.position.set(0, 0, 0);
    scene.add(school.mesh);
    fishSchools.push(school);
  }

  // Audio (lazy — created on first user interaction to avoid autoplay warning)
  let audio: AudioState | null = null;
  let audioInitAttempted = false;

  const echoVR = createEchoVR(scene);

  const coralMaterials: THREE.MeshStandardMaterial[] = [];
  for (const m of coralField.meshes) {
    const mat = m.material as THREE.MeshStandardMaterial;
    coralMaterials.push(mat);
  }

  const keys = new Set<string>();
  const onKeyDown = (e: KeyboardEvent) => {
    keys.add(e.code);
    if (e.code === "KeyR" && echoVR) {
      echoVR.enabled = !echoVR.enabled;
    }
  };
  const onKeyUp = (e: KeyboardEvent) => {
    keys.delete(e.code);
  };
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  const initAudioOnInteraction = () => {
    if (audioInitAttempted) return;
    audioInitAttempted = true;
    try {
      const audioCtx = new AudioContext();
      const masterGain = audioCtx.createGain();
      masterGain.gain.value = 0.4;
      masterGain.connect(audioCtx.destination);
      audio = initAudio(audioCtx, masterGain);
      loadAudioAssets(audio);
    } catch {
      /* audio unavailable */
    }
  };
  window.addEventListener("keydown", initAudioOnInteraction, { once: true });
  window.addEventListener("pointerdown", initAudioOnInteraction, {
    once: true,
  });

  const stateObj: UnderwaterWorldState = {
    camera,
    scene,
    driftSpeed: 2,
    wasdSpeed: 6,
    lightIntensity: 1.5,
    terrainAmplitude: amplitude,
    terrainScale: scale,
    terrainColor: "#ffffff",
    terrainChunks,
    pendingChunks: [],
    prevGx: 0,
    prevGz: 0,
    terrainMat,
    sandEntries: [],
    sandPositions,
    waterSurface: water,
    audio,
    keys,
    onKeyDown,
    onKeyUp,
    fishSchools,
    coralField,
    coralColors: CORAL_COLORS,
    startCityCity: null,
    startCityCityVariant: null,
    startCityX: 0,
    startCityZ: 0,
    startCoralReef: null,
    cityGuidancePath: null,
    cityGuidanceArrived: new Set(),
    echoVR,
    coralMaterials,
    _flashColor: new THREE.Color(0xffff00),
    _fishBaseColor: new THREE.Color(0x00e5ff),
    _domeAltstadtColor: new THREE.Color(0x553311),
    _domeZentrumColor: new THREE.Color(0x224466),
    _domeVorortColor: new THREE.Color(0x446644),
    _domeModelCityColor: new THREE.Color(0x224466),
    _coralIdleColor: new THREE.Color(0x000000),
  };

  // ── Find sand position near start for city + corals ──
  // Scan spiral outward from (0, -50) so the city is visible from the spawn
  // (player spawns at (0, 4, 0); fogFar=180; aim for city 30-80m away)
  let startSandX = 0,
    startSandZ = -50;
  for (let range = 0; range <= 100; range += 10) {
    for (let angle = 0; angle < Math.PI * 2; angle += 0.4) {
      const bx = Math.round((Math.cos(angle) * range) / 10) * 10;
      const bz = Math.round(-50 + (Math.sin(angle) * range) / 10) * 10;
      if (getBiome(bx, bz) >= 0.5) {
        startSandX = bx;
        startSandZ = bz;
        range = 999;
        break;
      }
    }
  }
  const startSandY = getTerrainHeight(startSandX, startSandZ, amplitude, scale);
  stateObj.startCityX = startSandX;
  stateObj.startCityZ = startSandZ;

  // ── Start City (procedural, altstadt or vorort, random pick) ──
  {
    const startVariant: "altstadt" | "vorort" =
      Math.random() < 0.5 ? "altstadt" : "vorort";
    const sc = createCity(startVariant);
    sc.group.position.set(startSandX, startSandY, startSandZ);
    sc.group.visible = true;
    scene.add(sc.group);
    stateObj.startCityCity = sc;
    stateObj.startCityCityVariant = startVariant;
  }

  // ── Start Coral Reef (model) — 3 Riffe in unterschiedlichen Entfernungen ──
  stateObj.startCoralReef = new THREE.Group();
  stateObj.startCoralReef.visible = true;
  scene.add(stateObj.startCoralReef);

  const reefPatches = [
    {
      label: "nah",
      dx: -30,
      dz: -25,
      radius: 18,
      count: [10, 16],
      scale: [1.0, 2.5],
    },
    {
      label: "mittel",
      dx: 50,
      dz: 10,
      radius: 22,
      count: [12, 18],
      scale: [1.2, 3.0],
    },
    {
      label: "fern",
      dx: -15,
      dz: 70,
      radius: 26,
      count: [14, 22],
      scale: [1.5, 3.0],
    },
  ];
  for (const p of reefPatches) {
    const px = startSandX + p.dx;
    const pz = startSandZ + p.dz;
    if (getBiome(px, pz) < 0.5) continue;
    const py = getTerrainHeight(px, pz, amplitude, scale);
    ensureCoralModelLoaded().then(() => {
      const rc = scatterCoralModels({
        count:
          p.count[0] + Math.floor(Math.random() * (p.count[1] - p.count[0])),
        radius: p.radius,
        cx: px,
        cz: pz,
        groundY: py,
        scaleRange: p.scale as [number, number],
        kaleidoChance: 0.5,
      });
      if (rc) stateObj.startCoralReef!.add(rc);
    });
  }

  return stateObj;
}

// ── Tick ──

export function tick(
  state: ExperienceState,
  ctx: TickContext,
): { state: ExperienceState; outputs?: Record<string, number> } {
  const s = state as UnderwaterWorldState;
  const delta = Math.min(ctx.delta, 0.05);
  const pos = ctx.camera.position;
  const elapsed = ctx.elapsed;

  // ── Keyboard ──

  const yawAmt = s.wasdSpeed * delta * 0.25;
  if (s.keys.has("KeyA")) ctx.camera.rotation.y += yawAmt;
  if (s.keys.has("KeyD")) ctx.camera.rotation.y -= yawAmt;
  if (s.keys.has("ArrowLeft")) ctx.camera.rotation.y += yawAmt;
  if (s.keys.has("ArrowRight")) ctx.camera.rotation.y -= yawAmt;

  const vertAmt = s.wasdSpeed * delta;
  if (s.keys.has("KeyW")) pos.y += vertAmt;
  if (s.keys.has("KeyS")) pos.y -= vertAmt;

  // Space boost
  const spaceDown = s.keys.has("Space");
  if (spaceDown) {
    s.driftSpeed = Math.min(20, s.driftSpeed + delta * 30);
    if (s.audio && !s.audio.wasSpace) {
      s.audio.wasSpace = true;
      playMovementSound(s.audio);
    }
  } else {
    s.driftSpeed = Math.max(1.5, s.driftSpeed - delta * 8);
    if (s.audio) s.audio.wasSpace = false;
  }

  // Auto-drift
  const driftDir = new THREE.Vector3(0, 0, -1).applyQuaternion(
    ctx.camera.quaternion,
  );
  driftDir.y = 0;
  driftDir.normalize();
  pos.add(driftDir.multiplyScalar(s.driftSpeed * delta));

  // ── Collision ──

  const terrainY = getTerrainHeight(
    pos.x,
    pos.z,
    s.terrainAmplitude,
    s.terrainScale,
  );
  const waterBob = WATER_SURFACE_Y + Math.sin(elapsed * 0.1) * 0.5;
  pos.y = Math.max(terrainY + 1.5, Math.min(waterBob - 0.8, pos.y));

  // ── Terrain Chunks ──

  const gx = Math.round(pos.x / CHUNK_SIZE);
  const gz = Math.round(pos.z / CHUNK_SIZE);
  if (gx !== s.prevGx || gz !== s.prevGz) {
    s.prevGx = gx;
    s.prevGz = gz;
    s.terrainChunks = queueTerrainChunks(
      s.terrainChunks,
      s.pendingChunks,
      pos.x,
      pos.z,
    );
  }

  processChunkQueue(
    s.terrainChunks,
    s.pendingChunks,
    s.scene,
    s.terrainAmplitude,
    s.terrainScale,
    s.terrainMat,
  );

  // ── Sand Biome Entries (plain / seagrass / city) ──

  for (let i = s.sandEntries.length - 1; i >= 0; i--) {
    const e = s.sandEntries[i];
    const dx = e.wx - pos.x;
    const dz = e.wz - pos.z;
    if (dx * dx + dz * dz > 400 * 400) {
      if (e.dune) disposeDuneSand(e.dune, s.scene);
      if (e.meadow) disposeSeagrassMeadow(e.meadow, s.scene);
      if (e.modelCoralReef) disposeScatterGroup(e.modelCoralReef, s.scene);
      else if (e.reef) disposeCoralReef(e.reef, s.scene);
      if (e.city) disposeCity(e.city, s.scene);
      s.sandEntries.splice(i, 1);
    }
  }

  if (s.sandEntries.length < 10) {
    const loaded = new Set(s.sandEntries.map((e) => `${e.wx},${e.wz}`));
    for (const sp of s.sandPositions) {
      if (s.sandEntries.length >= 10 + SAND_STREAM_PER_FRAME) break;
      const key = `${sp.wx},${sp.wz}`;
      if (loaded.has(key)) continue;
      const dx = sp.wx - pos.x;
      const dz = sp.wz - pos.z;
      if (dx * dx + dz * dz > STREAM_INIT_RADIUS * STREAM_INIT_RADIUS) continue;

      const sy = getTerrainHeight(
        sp.wx,
        sp.wz,
        s.terrainAmplitude,
        s.terrainScale,
      );
      const dune =
        sp.variant !== "reef"
          ? (() => {
              const d = createDuneSand();
              d.terrain.position.set(sp.wx, sy, sp.wz);
              s.scene.add(d.terrain);
              return d;
            })()
          : undefined;

      let meadow: SeagrassMeadow | undefined;
      let city: CityResult | undefined;

      if (sp.variant === "seagrass" && sp.seagrassType) {
        meadow = createSeagrassMeadow(sp.seagrassType, (x, z) =>
          getTerrainHeight(x, z, s.terrainAmplitude, s.terrainScale),
        );
        s.scene.add(meadow.group);
      }

      if (sp.variant === "city") {
        // Random procedural city (altstadt or vorort). No model city — the 154 MB
        // GLB was a one-off from a model-swap test, the procedural variants are
        // cheap (instanced meshes) and match what /test/staedte shows.
        const variant: "altstadt" | "vorort" =
          Math.random() < 0.5 ? "altstadt" : "vorort";
        city = createCity(variant);
        city.group.position.set(sp.wx, sy, sp.wz);
        city.group.visible = true;
        s.scene.add(city.group);
      }

      let reef: CoralReef | undefined;
      let modelCoralReef: THREE.Group | undefined;
      if (sp.variant === "reef") {
        const mc = scatterCoralModels({
          count: 8 + Math.floor(Math.random() * 5),
          radius: 25 + Math.random() * 15,
          cx: sp.wx,
          cz: sp.wz,
          groundY: sy,
          scaleRange: [1.2, 2.8],
          kaleidoChance: 0.4,
        });
        if (mc) {
          mc.visible = true;
          s.scene.add(mc);
          modelCoralReef = mc;
        } else if (sp.reefBiome) {
          reef = createCoralReef(sp.reefBiome);
          reef.terrain.position.set(sp.wx, sy, sp.wz);
          reef.rocks.position.set(sp.wx, sy, sp.wz);
          s.scene.add(reef.terrain);
          s.scene.add(reef.rocks);
          for (const m of reef.coralMeshes) {
            m.position.set(sp.wx, sy, sp.wz);
            s.scene.add(m);
          }
        }
      }

      s.sandEntries.push({
        wx: sp.wx,
        wz: sp.wz,
        variant: sp.variant,
        cityVariant: sp.cityVariant,
        seagrassType: sp.seagrassType,
        reefBiome: sp.reefBiome,
        dune,
        meadow,
        city,
        reef,
        modelCoralReef,
      });
    }
  }

  for (const e of s.sandEntries) {
    if (e.meadow && e.seagrassType)
      updateSeagrassSway(e.meadow, elapsed, e.seagrassType);
    if (e.city && e.cityVariant) {
      const sy = getTerrainHeight(
        e.wx,
        e.wz,
        s.terrainAmplitude,
        s.terrainScale,
      );
      updateCityPulse(e.city, elapsed, true, sy);
    }
  }

  // ── Coral streaming (slot-tracking) ──

  updateCoralStreaming(
    s.coralField,
    pos.x,
    pos.z,
    s.terrainAmplitude,
    s.terrainScale,
    CORAL_STREAM_RADIUS,
  );

  // ── Fish ──

  const behindDir = new THREE.Vector3(0, 0, 1).applyQuaternion(
    ctx.camera.quaternion,
  );
  const fishTerrain = (wx: number, wz: number) =>
    getTerrainHeight(wx, wz, s.terrainAmplitude, s.terrainScale);

  // ── City dome repel centers ──
  const repelCenters: { x: number; z: number; radius: number }[] = [];
  if (s.startCityCity)
    repelCenters.push({
      x: s.startCityX,
      z: s.startCityZ,
      radius: CITY_DOME_RADIUS,
    });
  for (const e of s.sandEntries) {
    if (e.city)
      repelCenters.push({ x: e.wx, z: e.wz, radius: CITY_DOME_RADIUS });
  }
  const repelArg = repelCenters.length > 0 ? repelCenters : undefined;

  for (let fi = 0; fi < s.fishSchools.length; fi++) {
    const school = s.fishSchools[fi];
    const behind = new THREE.Vector3(
      pos.x + behindDir.x * (8 + fi * 4),
      Math.max(pos.y - 3, 0),
      pos.z + behindDir.z * (8 + fi * 4),
    );
    school.mesh.position.copy(behind);
    updateFishSchool(
      school,
      delta,
      elapsed,
      STANDARD_SCHOOL_CONFIGS[fi].swimMode,
      behind,
      fishTerrain,
      repelArg,
    );
    school.material.emissiveIntensity =
      0.3 + Math.sin(elapsed * 0.5 + fi) * 0.2;
  }

  // ── Start City ──

  if (s.startCityModelCity) {
    const sy = getTerrainHeight(
      s.startCityX,
      s.startCityZ,
      s.terrainAmplitude,
      s.terrainScale,
    );
    if (s.startCityCity) updateCityPulse(s.startCityCity, elapsed, true, sy);
  }

  // ── City Guidance (one path → nearest unvisited city) ──

  const ARRIVE_RADIUS = 20;
  const cityTargets: { wx: number; wz: number; key: string }[] = [];
  if (s.startCityCity) {
    const key = `${s.startCityX},${s.startCityZ}`;
    cityTargets.push({ wx: s.startCityX, wz: s.startCityZ, key });
  }
  for (const e of s.sandEntries) {
    if (!e.city) continue;
    const key = `${e.wx},${e.wz}`;
    if (!s.cityGuidanceArrived.has(key)) {
      cityTargets.push({ wx: e.wx, wz: e.wz, key });
    }
  }

  if (cityTargets.length === 0) {
    if (s.cityGuidancePath) {
      s.scene.remove(s.cityGuidancePath.group);
      s.cityGuidancePath.dispose();
      s.cityGuidancePath = null;
    }
  } else {
    let nearest = cityTargets[0];
    let nearDistSq = (nearest.wx - pos.x) ** 2 + (nearest.wz - pos.z) ** 2;
    for (let i = 1; i < cityTargets.length; i++) {
      const dSq =
        (cityTargets[i].wx - pos.x) ** 2 + (cityTargets[i].wz - pos.z) ** 2;
      if (dSq < nearDistSq) {
        nearest = cityTargets[i];
        nearDistSq = dSq;
      }
    }

    const dist = Math.sqrt(nearDistSq);

    // Arrived at current target?
    if (dist < ARRIVE_RADIUS) {
      s.cityGuidanceArrived.add(nearest.key);
      if (s.cityGuidancePath) {
        s.scene.remove(s.cityGuidancePath.group);
        s.cityGuidancePath.dispose();
        s.cityGuidancePath = null;
      }
    } else {
      const sy = getTerrainHeight(
        nearest.wx,
        nearest.wz,
        s.terrainAmplitude,
        s.terrainScale,
      );
      const toCity = new THREE.Vector3(
        nearest.wx - pos.x,
        0,
        nearest.wz - pos.z,
      ).normalize();
      const distToCity = Math.sqrt(nearDistSq);

      const playerGround = getTerrainHeight(
        pos.x,
        pos.z,
        s.terrainAmplitude,
        s.terrainScale,
      );
      const startY = Math.max(playerGround + 3, pos.y - 10);
      const endY = sy + 3;

      const midDist = Math.min(distToCity * 0.5, 80);
      const midGround = getTerrainHeight(
        pos.x + toCity.x * midDist,
        pos.z + toCity.z * midDist,
        s.terrainAmplitude,
        s.terrainScale,
      );

      const pts = [
        new THREE.Vector3(pos.x, startY, pos.z),
        new THREE.Vector3(
          pos.x + toCity.x * midDist * 0.3,
          startY + 2,
          pos.z + toCity.z * midDist * 0.3,
        ),
        new THREE.Vector3(
          pos.x + toCity.x * midDist,
          midGround + 4,
          pos.z + toCity.z * midDist,
        ),
        new THREE.Vector3(nearest.wx, endY, nearest.wz),
      ];

      if (s.cityGuidancePath) {
        s.scene.remove(s.cityGuidancePath.group);
        s.cityGuidancePath.dispose();
      }
      const path = createGuidancePath(VARIANT_CONFIGS.city, pts);
      s.scene.add(path.group);
      s.cityGuidancePath = path;
      s.cityGuidancePath.update(elapsed);
    }
  }

  // ── Water Surface ──

  updateWaterSurface(s.waterSurface, elapsed);

  // ── Audio ──

  if (s.audio) {
    const a = s.audio;

    const targetSurface = THREE.MathUtils.clamp((pos.y - 460) / 30, 0, 1);
    a.surfaceBlend += (targetSurface - a.surfaceBlend) * delta * 2;
    a.surfaceGain.gain.value = a.surfaceBlend * 0.35;

    const duck = 1 - a.surfaceBlend * 0.5;
    a.bgGain.gain.value = 0.14 + duck * 0.1;
  }

  // ── Echoortung ──

  if (s.echoVR) {
    const echoTargets: { key: string; x: number; z: number }[] = [];

    for (let fi = 0; fi < s.fishSchools.length; fi++) {
      const p = s.fishSchools[fi].mesh.position;
      echoTargets.push({ key: `fish_${fi}`, x: p.x, z: p.z });
    }

    if (s.startCityCity) {
      echoTargets.push({ key: "startCity", x: s.startCityX, z: s.startCityZ });
    }

    for (let ei = 0; ei < s.sandEntries.length; ei++) {
      const e = s.sandEntries[ei];
      if (e.city) echoTargets.push({ key: `city_${ei}`, x: e.wx, z: e.wz });
    }

    updateEchoVR(s.echoVR, delta, pos, echoTargets);

    for (let fi = 0; fi < s.fishSchools.length; fi++) {
      const flash = s.echoVR.flashStates.get(`fish_${fi}`);
      const school = s.fishSchools[fi];
      const t = flash ? flash.timer / flash.duration : 0;
      if (flash) {
        school.material.emissive.copy(s._flashColor);
        school.material.emissiveIntensity = 0.3 + t * t * 1.5;
      } else {
        school.material.emissive.copy(s._fishBaseColor);
        school.material.emissiveIntensity =
          0.3 + Math.sin(elapsed * 0.5 + fi) * 0.2;
      }
    }

    if (s.startCityCity) {
      const flash = s.echoVR.flashStates.get("startCity");
      const t = flash ? flash.timer / flash.duration : 0;
      // altstadt = 0x553311, vorort = 0x446644
      const base =
        s.startCityCityVariant === "altstadt"
          ? s._domeAltstadtColor
          : s._domeVorortColor;
      if (flash) {
        s.startCityCity.domeMat.emissive.copy(s._flashColor);
        s.startCityCity.domeMat.emissiveIntensity = 0.5 + t * t;
      } else {
        s.startCityCity.domeMat.emissive.copy(base);
        s.startCityCity.domeMat.emissiveIntensity =
          0.3 + Math.sin(elapsed * 0.4) * 0.15;
      }
    }

    for (let ei = 0; ei < s.sandEntries.length; ei++) {
      const e = s.sandEntries[ei];
      if (e.city) {
        const flash = s.echoVR.flashStates.get(`city_${ei}`);
        const t = flash ? flash.timer / flash.duration : 0;
        if (flash) {
          e.city.domeMat.emissive.copy(s._flashColor);
          e.city.domeMat.emissiveIntensity = 0.5 + t * t;
        } else {
          // Altstadt=0x553311, Zentrum=0x224466, Vorort=0x446644
          const base =
            e.cityVariant === "altstadt"
              ? s._domeAltstadtColor
              : e.cityVariant === "zentrum"
                ? s._domeZentrumColor
                : s._domeVorortColor;
          e.city.domeMat.emissive.copy(base);
          e.city.domeMat.emissiveIntensity =
            0.6 + Math.sin(elapsed * 0.4) * 0.3;
        }
      }
      // e.modelCity no longer set anywhere; city-pulse handled above.
    }

    let coralFlash = 0;
    for (const [, flash] of s.echoVR.flashStates) {
      const t = flash.timer / flash.duration;
      coralFlash = Math.max(coralFlash, t * t);
    }
    for (const mat of s.coralMaterials) {
      if (coralFlash > 0.01) {
        mat.emissive.copy(s._flashColor);
        mat.emissiveIntensity = coralFlash * 0.5;
      } else {
        mat.emissive.copy(s._coralIdleColor);
        mat.emissiveIntensity = 0;
      }
    }
  }

  return { state: s };
}

// ── Dispose ──

export function dispose(state: ExperienceState, scene: THREE.Scene): void {
  const s = state as UnderwaterWorldState;

  window.removeEventListener("keydown", s.onKeyDown);
  window.removeEventListener("keyup", s.onKeyUp);

  for (const ch of s.terrainChunks) {
    disposeTerrainChunk(ch, scene);
  }

  for (const e of s.sandEntries) {
    if (e.dune) disposeDuneSand(e.dune, scene);
    if (e.meadow) disposeSeagrassMeadow(e.meadow, scene);
    if (e.modelCoralReef) disposeScatterGroup(e.modelCoralReef, scene);
    else if (e.reef) disposeCoralReef(e.reef, scene);
    if (e.city) disposeCity(e.city, scene);
  }

  if (s.startCityCity) disposeCity(s.startCityCity, scene);

  if (s.startCoralReef) disposeScatterGroup(s.startCoralReef, scene);

  if (s.cityGuidancePath) {
    s.cityGuidancePath.dispose();
    scene.remove(s.cityGuidancePath.group);
  }

  disposeWaterSurface(s.waterSurface, scene);

  for (const school of s.fishSchools) {
    disposeFishSchool(school, scene);
  }

  for (const mesh of s.coralField.meshes) {
    scene.remove(mesh);
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  }

  if (s.echoVR) disposeEchoVR(s.echoVR, scene);

  s.terrainMat.dispose();

  if (s.audio) {
    try {
      s.audio.ctx.close();
    } catch {
      /* ignore */
    }
  }
}
