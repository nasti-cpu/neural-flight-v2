import * as THREE from "three";
import type { ExperienceState, SetupContext, TickContext } from "../types";
import { createSeagrassMeadow, updateSeagrassSway, disposeSeagrassMeadow, SEAGRASS_META, type SeagrassMeadow } from "$lib/experiences/underwater-world v2/Objekte/Seegras/seagrass";
import { createDuneSand, disposeDuneSand } from "$lib/experiences/underwater-world v2/Biome/Sand/sand";
import type { DuneSandResult } from "$lib/experiences/underwater-world v2/Biome/Sand/sand";
import { createCity, disposeCity, updateCityPulse } from "$lib/experiences/underwater-world v2/Biome/Städte/city";
import type { CityResult, CityVariant } from "$lib/experiences/underwater-world v2/Biome/Städte/city";
import {
	createModelCitySync,
	updateModelCityPulse,
	disposeModelCity,
	ensureModelLoaded,
} from "$lib/experiences/underwater-world v2/Biome/Städte/modelCity";
import type { ModelCityResult } from "$lib/experiences/underwater-world v2/Biome/Städte/modelCity";
import { createGuidancePath, VARIANT_CONFIGS, type GuidancePath } from "$lib/experiences/underwater-world v2/Sinne/Leitsystem/guidance";
import { createFishSchool, disposeFishSchool, loadFishGeometry, updateFishSchool, STANDARD_SCHOOL_CONFIGS, type FishSchool } from "$lib/experiences/underwater-world v2/Objekte/Fische/fish";
import { createProceduralCoralGeometry } from "$lib/experiences/underwater-world v2/Biome/Korallenriff/korallenriff";
import { createDolphinPod, updateDolphinPod, disposeDolphinPod, loadDolphinGeometry, DOLPHIN_MODE_META, type DolphinPod } from "$lib/experiences/underwater-world v2/Objekte/Delfine/dolphin";
import { createJellySwarm, updateJellySwarm, disposeJellySwarm, JELLY_MODE_META } from "$lib/experiences/underwater-world v2/Objekte/Quallen/jellyfish";
import type { JellySwarm, JellyMode } from "$lib/experiences/underwater-world v2/Objekte/Quallen/jellyfish";
import { createCoralReef, disposeCoralReef } from "$lib/experiences/underwater-world v2/Biome/Korallenriff/korallenriff";
import type { CoralReef, CoralBiome } from "$lib/experiences/underwater-world v2/Biome/Korallenriff/korallenriff";
import { scatterCoralModels, disposeScatterGroup, ensureModelLoaded as ensureCoralModelLoaded } from "$lib/experiences/underwater-world v2/Biome/Korallenriff/modelCoralReef";

// ── Constants ──

const CHUNK_SIZE = 400;
const CHUNK_SEGMENTS = 32;
const CHUNK_RADIUS = 1;
const WATER_SURFACE_Y = 500;
const TERRAIN_BASE_Y = -3;
const BIOME_FREQ = 0.0025;
const SAND_PATCH_COUNT = 400;
const SAND_STREAM_PER_FRAME = 8;
const CORAL_MAX_PER_TYPE = 500;
const CORAL_STREAM_RADIUS = 300;

const CITY_VARIANTS: CityVariant[] = ["altstadt", "zentrum", "vorort"];
const SEAGRASS_TYPES: ("algae" | "long" | "bushy")[] = SEAGRASS_META.map((m) => m.id);
const STREAM_INIT_RADIUS = 200;
const CITY_DOME_RADIUS = 65;

// ── Noise ──

function hash2d(x: number, y: number): number {
	const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
	return n - Math.floor(n);
}

function noise2d(x: number, y: number): number {
	const ix = Math.floor(x);
	const iy = Math.floor(y);
	const fx = x - ix;
	const fy = y - iy;
	const sx = fx * fx * (3 - 2 * fx);
	const sy = fy * fy * (3 - 2 * fy);
	const a = hash2d(ix, iy);
	const b = hash2d(ix + 1, iy);
	const c = hash2d(ix, iy + 1);
	const d = hash2d(ix + 1, iy + 1);
	return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function fbm(x: number, y: number, octaves: number): number {
	let value = 0;
	let amp = 0.5;
	let freq = 1;
	for (let i = 0; i < octaves; i++) {
		value += amp * noise2d(x * freq, y * freq);
		freq *= 2;
		amp *= 0.5;
	}
	return value;
}

// ── Biome / Height ──

export function getBiome(wx: number, wz: number): number {
	return fbm(wx * BIOME_FREQ, wz * BIOME_FREQ, 2);
}

export function getTerrainHeight(wx: number, wz: number, amplitude: number, scale: number): number {
	return (fbm(wx * scale, wz * scale, 4) - 0.5) * 2 * amplitude + TERRAIN_BASE_Y;
}

function getBiomeParams(biome: number): { ampMul: number; scaleMul: number; color: THREE.Color } {
	if (biome < 0.25) return { ampMul: 1.0, scaleMul: 1.0, color: new THREE.Color(0x3a5a7a) };
	if (biome < 0.50) return { ampMul: 0.7, scaleMul: 0.8, color: new THREE.Color(0x3a7a5a) };
	return { ampMul: 0.4, scaleMul: 0.7, color: new THREE.Color(0xc4a87a) };
}

// ── Types ──

interface TerrainChunk {
	mesh: THREE.Mesh;
	gx: number;
	gz: number;
}

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
	terrainMat: THREE.MeshStandardMaterial;
	sandEntries: {
		wx: number; wz: number;
		variant: "plain" | "seagrass" | "city" | "reef";
		cityVariant?: CityVariant;
		seagrassType?: "algae" | "long" | "bushy";
		reefBiome?: CoralBiome;
		dune?: DuneSandResult;
		meadow?: SeagrassMeadow;
		city?: CityResult;
		modelCity?: ModelCityResult;
		reef?: CoralReef;
		modelCoralReef?: THREE.Group;
	}[];
	sandPositions: {
		wx: number; wz: number;
		variant: "plain" | "seagrass" | "city" | "reef";
		cityVariant?: CityVariant;
		seagrassType?: "algae" | "long" | "bushy";
		reefBiome?: CoralBiome;
	}[];
	waterSurface: THREE.Mesh;
	audio: AudioState | null;
	keys: Set<string>;
	cityGuidance: { key: string; path: GuidancePath }[];
	fishSchools: FishSchool[];
	coralMeshes: THREE.InstancedMesh[];
	coralGeos: THREE.BufferGeometry[];
	coralPositions: { wx: number; wz: number; type: number; color: number }[];
	dolphinPod: DolphinPod;
	dolphinModeIndex: number;
	dolphinModeTimer: number;
	dolphinPrevMode: string;
	dolphinSpawnTimer: number;
	jellySpawnTimer: number;
	startCityModelCity: ModelCityResult | null;
	startCityX: number;
	startCityZ: number;
	startCoralReef: THREE.Group | null;
	jellySwarm: JellySwarm;
	jellyMode: JellyMode;
	jellyTimer: number;
}

// ── Terrain ──

function fillTerrainGeometry(geo: THREE.BufferGeometry, cx: number, cz: number, amplitude: number, scale: number, baseColor: THREE.Color): void {
	const pos = geo.attributes.position.array as Float32Array;
	const colors = new Float32Array(pos.length);
	for (let i = 0; i < pos.length; i += 3) {
		const wx = pos[i] + cx;
		const wz = pos[i + 2] + cz;
		const biome = getBiome(wx, wz);
		const bp = getBiomeParams(biome);
		pos[i + 1] = (fbm(wx * scale * bp.scaleMul, wz * scale * bp.scaleMul, 4) - 0.5) * 2 * amplitude * bp.ampMul;
		const c = bp.color.clone().multiply(baseColor);
		colors[i] = c.r;
		colors[i + 1] = c.g;
		colors[i + 2] = c.b;
	}
	geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
	geo.computeVertexNormals();
}

function createTerrainChunk(gx: number, gz: number, amplitude: number, scale: number, baseColor: THREE.Color, mat: THREE.MeshStandardMaterial): TerrainChunk {
	const cx = gx * CHUNK_SIZE;
	const cz = gz * CHUNK_SIZE;
	const geo = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE, CHUNK_SEGMENTS, CHUNK_SEGMENTS);
	geo.rotateX(-Math.PI / 2);
	fillTerrainGeometry(geo, cx, cz, amplitude, scale, baseColor);
	const mesh = new THREE.Mesh(geo, mat);
	mesh.position.set(cx, TERRAIN_BASE_Y, cz);
	return { mesh, gx, gz };
}

function disposeTerrainChunk(chunk: TerrainChunk, scene: THREE.Scene): void {
	scene.remove(chunk.mesh);
	chunk.mesh.geometry.dispose();
}

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
		const bgRes = await fetch("/sounds/dragon-studio-deep-sea-underwater-ambience-472383.mp3");
		const bgBuf = await bgRes.arrayBuffer();
		audio.bgSrc.buffer = await ctx.decodeAudioData(bgBuf);
		audio.bgSrc.start();
		audio.bgGain.gain.value = 0.2;
	} catch { /* bg silent */ }

	try {
		const sfRes = await fetch("/sounds/dragon-studio-deep-sea-underwater-ambience-482888.mp3");
		const sfBuf = await sfRes.arrayBuffer();
		const sfSrc = ctx.createBufferSource();
		sfSrc.loop = true;
		sfSrc.buffer = await ctx.decodeAudioData(sfBuf);
		sfSrc.connect(audio.surfaceGain);
		sfSrc.start();
		audio.surfaceSrc = sfSrc;
	} catch { /* surface silent */ }

	try {
		const mvRes = await fetch("/sounds/freesound_community-underwater-movement-66914.mp3");
		const mvBuf = await mvRes.arrayBuffer();
		audio.moveBuffer = await ctx.decodeAudioData(mvBuf);
	} catch { /* movement silent */ }
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

	const keys = new Set<string>();
	const onKeyDown = (e: KeyboardEvent) => { keys.add(e.code); };
	const onKeyUp = (e: KeyboardEvent) => { keys.delete(e.code); };
	window.addEventListener("keydown", onKeyDown);
	window.addEventListener("keyup", onKeyUp);

	// Terrain
	const terrainMat = new THREE.MeshStandardMaterial({
		vertexColors: true,
		flatShading: true,
		roughness: 0.9,
		metalness: 0.0,
	});

	const terrainChunks: TerrainChunk[] = [];
	const pendingChunks: { gx: number; gz: number }[] = [];
	const baseColor = new THREE.Color("#ffffff");

	for (let gx = -1; gx <= 1; gx++) {
		for (let gz = -1; gz <= 1; gz++) {
			pendingChunks.push({ gx, gz });
		}
	}
	while (pendingChunks.length > 0) {
		const { gx, gz } = pendingChunks.pop()!;
		const chunk = createTerrainChunk(gx, gz, amplitude, scale, baseColor, terrainMat);
		scene.add(chunk.mesh);
		terrainChunks.push(chunk);
	}

	// ── Sand patch positions (sand biome ≥ 0.50) ──
	// Distribution: 40% seagrass, 20% city, 20% reef, 20% plain

	const sandPositions: {
		wx: number; wz: number;
		variant: "plain" | "seagrass" | "city" | "reef";
		cityVariant?: CityVariant;
		seagrassType?: "algae" | "long" | "bushy";
		reefBiome?: CoralBiome;
	}[] = [];
	for (let si = 0; si < SAND_PATCH_COUNT * 4; si++) {
		const wx = (hash2d(si * 19 + 3, si * 31 + 7) - 0.5) * 2800;
		const wz = (hash2d(si * 23 + 11, si * 17 + 5) - 0.5) * 2800;
		const biome = getBiome(wx, wz);
		if (biome >= 0.50) {
			const roll = hash2d(wx * 13, wz * 17);
			let variant: "plain" | "seagrass" | "city" | "reef";
			if (roll < 0.4) variant = "seagrass";
			else if (roll < 0.6) variant = "city";
			else if (roll < 0.8) variant = "reef";
			else variant = "plain";
			const entry: typeof sandPositions[number] = { wx, wz, variant };
			if (variant === "city") entry.cityVariant = CITY_VARIANTS[Math.floor(hash2d(wx * 7, wz * 11) * CITY_VARIANTS.length)];
			if (variant === "seagrass") entry.seagrassType = SEAGRASS_TYPES[Math.floor(hash2d(wx * 5, wz * 13) * SEAGRASS_TYPES.length)];
			if (variant === "reef") entry.reefBiome = hash2d(wx * 3, wz * 7) < 0.5 ? "shallow" : "deep";
			sandPositions.push(entry);
			if (sandPositions.length >= SAND_PATCH_COUNT) break;
		}
	}

	// Water surface
	const waterMat = new THREE.MeshPhysicalMaterial({
		color: 0x1a6a9a,
		transparent: true,
		opacity: 0.35,
		roughness: 0.0,
		metalness: 0.0,
		side: THREE.DoubleSide,
	});
	const water = new THREE.Mesh(new THREE.CircleGeometry(2000, 64), waterMat);
	water.rotation.x = -Math.PI / 2;
	water.position.y = WATER_SURFACE_Y;
	water.renderOrder = 1;
	scene.add(water);

	// Lighting
	const ambient = new THREE.AmbientLight(0x4488cc, 1.0);
	scene.add(ambient);
	const sun = new THREE.DirectionalLight(0xffeedd, 2.0);
	sun.position.set(200, 300, -100);
	scene.add(sun);

	// Fog
	scene.fog = new THREE.Fog(0x001020, 10, 180);

	// Coral field
	const CORAL_COLORS = [0xff4466, 0xff8844, 0xffcc44, 0x44ff88, 0x66ddff, 0xdd66ff, 0xff66aa, 0x88ff66, 0xffaa44, 0x66ffcc];
	const coralGeos = [0, 1, 2, 3, 4].map((t) => createProceduralCoralGeometry(t));
	const coralMeshes: THREE.InstancedMesh[] = [];
	for (let ti = 0; ti < 5; ti++) {
		const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.6, metalness: 0.05 });
		const mesh = new THREE.InstancedMesh(coralGeos[ti], mat, CORAL_MAX_PER_TYPE);
		mesh.frustumCulled = true;
		const colors = new Float32Array(CORAL_MAX_PER_TYPE * 3);
		mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
		scene.add(mesh);
		coralMeshes.push(mesh);
	}
	const coralPositions: { wx: number; wz: number; type: number; color: number }[] = [];
	for (let ci = 0; ci < CORAL_MAX_PER_TYPE * 5; ci++) {
		const wx = (hash2d(ci * 37 + 5, ci * 41 + 13) - 0.5) * 3000;
		const wz = (hash2d(ci * 43 + 17, ci * 29 + 7) - 0.5) * 3000;
		const biome = getBiome(wx, wz);
		if (biome >= 0.25 && biome < 0.50) {
			const type = Math.floor(hash2d(wx * 11, wz * 17) * 5);
			const color = CORAL_COLORS[Math.floor(hash2d(wx * 3, wz * 7) * CORAL_COLORS.length)];
			coralPositions.push({ wx, wz, type, color });
		}
	}

	// Fish
	const fishModel = await loadFishGeometry();
	const fishSchools: FishSchool[] = [];
	for (const cfg of STANDARD_SCHOOL_CONFIGS) {
		const school = createFishSchool(cfg.count, fishModel ?? undefined, cfg.spread, cfg.heightRange);
		school.mesh.position.set(0, 0, 0);
		scene.add(school.mesh);
		fishSchools.push(school);
	}

	// Dolphins (hidden, spawns after 2s behind player)
	const dolphinGeo = await loadDolphinGeometry();
	const dolphinPod = createDolphinPod(3, dolphinGeo ?? undefined);
	dolphinPod.mesh.position.set(
		camera.position.x + 5,
		Math.max(camera.position.y - 2, 0),
		camera.position.z - 22,
	);
	dolphinPod.mesh.visible = false;
	scene.add(dolphinPod.mesh);

	// Jellyfish (hidden, spawns after 5s behind player)
	const jellySwarm = createJellySwarm(6, 6, 4);
	jellySwarm.mesh.position.set(
		camera.position.x - 5,
		Math.max(camera.position.y - 1, 0),
		camera.position.z - 25,
	);
	jellySwarm.mesh.visible = false;
	scene.add(jellySwarm.mesh);

	// Audio
	let audio: AudioState | null = null;
	try {
		const audioCtx = new AudioContext();
		const masterGain = audioCtx.createGain();
		masterGain.gain.value = 0.4;
		masterGain.connect(audioCtx.destination);
		audio = initAudio(audioCtx, masterGain);
		loadAudioAssets(audio);
	} catch { /* audio unavailable */ }

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
		cityGuidance: [],
		fishSchools,
		coralMeshes,
		coralGeos,
		coralPositions,
		dolphinPod,
		dolphinModeIndex: 0,
		dolphinModeTimer: 5 + Math.random() * 4,
		dolphinPrevMode: "leisurely",
		dolphinSpawnTimer: 2,
		jellySpawnTimer: 5,
		jellySwarm,
		jellyMode: "drifting",
		jellyTimer: 8 + Math.random() * 7,
		startCityModelCity: null,
		startCityX: 0,
		startCityZ: 0,
		startCoralReef: null,
	};

	// ── Find sand position near start for city + corals ──
	// Scan spiral outward from (0, -200) for sand
	let startSandX = 0, startSandZ = -200;
	for (let range = 0; range <= 300; range += 20) {
		for (let angle = 0; angle < Math.PI * 2; angle += 0.4) {
			const bx = Math.round(Math.cos(angle) * range / 10) * 10;
			const bz = Math.round(-200 + Math.sin(angle) * range / 10) * 10;
			if (getBiome(bx, bz) >= 0.50) {
				startSandX = bx; startSandZ = bz;
				range = 999; break;
			}
		}
	}
	const startSandY = getTerrainHeight(startSandX, startSandZ, amplitude, scale);
	stateObj.startCityX = startSandX;
	stateObj.startCityZ = startSandZ;

	// ── Start City (model) on sand ──
	ensureModelLoaded().then(() => {
		const mc = createModelCitySync();
		if (mc) {
			mc.group.position.set(startSandX, startSandY, startSandZ);
			mc.group.visible = true;
			scene.add(mc.group);
			stateObj.startCityModelCity = mc;
		}
	});

	// ── Start Coral Reef (model) — 3 Riffe in unterschiedlichen Entfernungen ──
	stateObj.startCoralReef = new THREE.Group();
	stateObj.startCoralReef.visible = true;
	scene.add(stateObj.startCoralReef);

	const reefPatches = [
		{ label: "nah",    dx: -30, dz: -25, radius: 18, count: [10, 16], scale: [1.0, 2.5] },
		{ label: "mittel", dx: 50,  dz: 10,  radius: 22, count: [12, 18], scale: [1.2, 3.0] },
		{ label: "fern",   dx: -15, dz: 70,  radius: 26, count: [14, 22], scale: [1.5, 3.0] },
	];
	for (const p of reefPatches) {
		const px = startSandX + p.dx;
		const pz = startSandZ + p.dz;
		if (getBiome(px, pz) < 0.50) continue;
		const py = getTerrainHeight(px, pz, amplitude, scale);
		ensureCoralModelLoaded().then(() => {
			const rc = scatterCoralModels({
				count: p.count[0] + Math.floor(Math.random() * (p.count[1] - p.count[0])),
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

	const pitchAmt = delta * 0.8;
	if (s.keys.has("KeyR")) ctx.camera.rotation.x -= pitchAmt;
	if (s.keys.has("KeyF")) ctx.camera.rotation.x += pitchAmt;
	ctx.camera.rotation.x = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, ctx.camera.rotation.x));

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
	const driftDir = new THREE.Vector3(0, 0, -1).applyQuaternion(ctx.camera.quaternion);
	driftDir.y = 0;
	driftDir.normalize();
	pos.add(driftDir.multiplyScalar(s.driftSpeed * delta));

	// ── Collision ──

	const terrainY = getTerrainHeight(pos.x, pos.z, s.terrainAmplitude, s.terrainScale);
	const waterBob = WATER_SURFACE_Y + Math.sin(elapsed * 0.1) * 0.5;
	pos.y = Math.max(terrainY + 1.5, Math.min(waterBob - 0.8, pos.y));

	// ── Terrain Chunks ──

	const gx = Math.round(pos.x / CHUNK_SIZE);
	const gz = Math.round(pos.z / CHUNK_SIZE);
	if (gx !== s.prevGx || gz !== s.prevGz) {
		s.prevGx = gx;
		s.prevGz = gz;

		const keep = new Set<string>();
		for (let dx = -CHUNK_RADIUS; dx <= CHUNK_RADIUS; dx++) {
			for (let dz = -CHUNK_RADIUS; dz <= CHUNK_RADIUS; dz++) {
				keep.add(`${gx + dx},${gz + dz}`);
			}
		}

		for (let i = s.terrainChunks.length - 1; i >= 0; i--) {
			const ch = s.terrainChunks[i];
			if (!keep.has(`${ch.gx},${ch.gz}`)) {
				disposeTerrainChunk(ch, s.scene);
				s.terrainChunks.splice(i, 1);
			}
		}

		for (const key of keep) {
			const [cx, cz] = key.split(",").map(Number);
			if (!s.terrainChunks.some((ch) => ch.gx === cx && ch.gz === cz)) {
				s.pendingChunks.push({ gx: cx, gz: cz });
			}
		}
	}

	if (s.pendingChunks.length > 0) {
		const batch = s.pendingChunks.splice(0, 2);
		const baseColor = new THREE.Color(s.terrainColor);
		for (const p of batch) {
			const chunk = createTerrainChunk(p.gx, p.gz, s.terrainAmplitude, s.terrainScale, baseColor, s.terrainMat);
			s.scene.add(chunk.mesh);
			s.terrainChunks.push(chunk);
		}
	}

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
			if (e.modelCity) disposeModelCity(e.modelCity, s.scene);
			else if (e.city) disposeCity(e.city, s.scene);
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

			const sy = getTerrainHeight(sp.wx, sp.wz, s.terrainAmplitude, s.terrainScale);
			const dune = sp.variant !== "reef" ? (() => {
				const d = createDuneSand();
				d.terrain.position.set(sp.wx, sy, sp.wz);
				s.scene.add(d.terrain);
				return d;
			})() : undefined;

			let meadow: SeagrassMeadow | undefined;
			let city: CityResult | undefined;
			let modelCity: ModelCityResult | undefined;

			if (sp.variant === "seagrass" && sp.seagrassType) {
				meadow = createSeagrassMeadow(sp.seagrassType, (x, z) => getTerrainHeight(x, z, s.terrainAmplitude, s.terrainScale));
				s.scene.add(meadow.group);
			}

			if (sp.variant === "city") {
				// Try model city first, fall back to procedural
				const mc = createModelCitySync();
				if (mc) {
					mc.group.position.set(sp.wx, sy, sp.wz);
					mc.group.visible = true;
					s.scene.add(mc.group);
					modelCity = mc;
				} else if (sp.cityVariant) {
					city = createCity(sp.cityVariant);
					city.group.position.set(sp.wx, sy, sp.wz);
					city.group.visible = true;
					s.scene.add(city.group);
				}
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
				wx: sp.wx, wz: sp.wz,
				variant: sp.variant,
				cityVariant: sp.cityVariant,
				seagrassType: sp.seagrassType,
				reefBiome: sp.reefBiome,
				dune, meadow, city, modelCity, reef, modelCoralReef,
			});
		}
	}

	for (const e of s.sandEntries) {
		if (e.meadow && e.seagrassType) updateSeagrassSway(e.meadow, elapsed, e.seagrassType);
		if (e.modelCity) {
			const sy = getTerrainHeight(e.wx, e.wz, s.terrainAmplitude, s.terrainScale);
			updateModelCityPulse(e.modelCity, elapsed, true, sy);
		} else if (e.city && e.cityVariant) {
			const sy = getTerrainHeight(e.wx, e.wz, s.terrainAmplitude, s.terrainScale);
			updateCityPulse(e.city, elapsed, true, sy);
		}
	}

	// ── City Guidance Paths ──

	const cityKeys = new Set(s.sandEntries.filter((e) => e.city || e.modelCity).map((e) => `${e.wx},${e.wz}`));
	for (let i = s.cityGuidance.length - 1; i >= 0; i--) {
		if (!cityKeys.has(s.cityGuidance[i].key)) {
			s.scene.remove(s.cityGuidance[i].path.group);
			s.cityGuidance[i].path.dispose();
			s.cityGuidance.splice(i, 1);
		}
	}
	for (const e of s.sandEntries) {
		if (!e.city && !e.modelCity) continue;
		const key = `${e.wx},${e.wz}`;
		if (s.cityGuidance.some((g) => g.key === key)) continue;
		const sy = getTerrainHeight(e.wx, e.wz, s.terrainAmplitude, s.terrainScale);
		const dir = new THREE.Vector3(e.wx - pos.x, 0, e.wz - pos.z).normalize();
		const start = new THREE.Vector3(e.wx - dir.x * 120, sy + 12, e.wz - dir.z * 120);
		const mid = new THREE.Vector3(e.wx - dir.x * 40, sy + 24, e.wz - dir.z * 40);
		const end = new THREE.Vector3(e.wx, sy + 3, e.wz);
		const path = createGuidancePath(VARIANT_CONFIGS.city, [start, mid, end]);
		s.scene.add(path.group);
		s.cityGuidance.push({ key, path });
	}
	for (const g of s.cityGuidance) {
		g.path.update(elapsed);
	}

	// ── Coral streaming ──

	const cDummy = new THREE.Object3D();
	const cCol = new THREE.Color();
	const typeCounts = [0, 0, 0, 0, 0];
	for (const cp of s.coralPositions) {
		const dx = cp.wx - pos.x;
		const dz = cp.wz - pos.z;
		if (dx * dx + dz * dz > CORAL_STREAM_RADIUS * CORAL_STREAM_RADIUS) continue;
		const ti = cp.type;
		if (typeCounts[ti] >= CORAL_MAX_PER_TYPE) continue;
		const sy = getTerrainHeight(cp.wx, cp.wz, s.terrainAmplitude, s.terrainScale);
		const size = 0.4 + hash2d(cp.wx * 7, cp.wz * 13) * 1.8;
		const si = typeCounts[ti];
		cDummy.position.set(cp.wx, sy + size * 0.3, cp.wz);
		cDummy.scale.setScalar(size);
		cDummy.rotation.set(0, hash2d(cp.wx * 5, cp.wz * 11) * Math.PI * 2, 0);
		cDummy.updateMatrix();
		s.coralMeshes[ti].setMatrixAt(si, cDummy.matrix);
		cCol.setHex(cp.color);
		s.coralMeshes[ti].setColorAt(si, cCol);
		typeCounts[ti]++;
	}
	for (let ti = 0; ti < 5; ti++) {
		s.coralMeshes[ti].count = typeCounts[ti];
		s.coralMeshes[ti].instanceMatrix.needsUpdate = true;
		s.coralMeshes[ti].instanceColor!.needsUpdate = true;
	}

	// ── Fish ──

	const behindDir = new THREE.Vector3(0, 0, 1).applyQuaternion(ctx.camera.quaternion);
	const fishTerrain = (wx: number, wz: number) => getTerrainHeight(wx, wz, s.terrainAmplitude, s.terrainScale);

	// ── City dome repel centers ──
	const repelCenters: { x: number; z: number; radius: number }[] = [];
	if (s.startCityModelCity) repelCenters.push({ x: s.startCityX, z: s.startCityZ, radius: CITY_DOME_RADIUS });
	for (const e of s.sandEntries) {
		if (e.modelCity || e.city) repelCenters.push({ x: e.wx, z: e.wz, radius: CITY_DOME_RADIUS });
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
		updateFishSchool(school, delta, elapsed, STANDARD_SCHOOL_CONFIGS[fi].swimMode, behind, fishTerrain, repelArg);
		school.material.emissiveIntensity = 0.3 + Math.sin(elapsed * 0.5 + fi) * 0.2;
	}

	// ── Dolphins (staggered spawn + player-follow) ──

	s.dolphinSpawnTimer -= delta;
	if (s.dolphinSpawnTimer > 0) {
		s.dolphinPod.mesh.visible = false;
	} else {
		if (!s.dolphinPod.mesh.visible) {
			s.dolphinPod.mesh.visible = true;
			const dpos = new THREE.Vector3(
				pos.x + behindDir.x * 22,
				Math.max(pos.y - 2, 0),
				pos.z + behindDir.z * 22,
			);
			s.dolphinPod.mesh.position.copy(dpos);
			for (let di = 0; di < 3; di++) {
				const di3 = di * 3;
				s.dolphinPod.positions[di3] = (di - 1) * 6;
				s.dolphinPod.positions[di3 + 2] = -18 - di * 4;
			}
		}
		const dbehind = new THREE.Vector3(
			pos.x + behindDir.x * 20,
			Math.max(pos.y - 2, 0),
			pos.z + behindDir.z * 20,
		);
		s.dolphinPod.mesh.position.copy(dbehind);

		s.dolphinModeTimer -= delta;
		if (s.dolphinModeTimer <= 0) {
			s.dolphinModeIndex = (s.dolphinModeIndex + 1) % 3;
			s.dolphinModeTimer = 8 + Math.random() * 6;
		}
		const dMode = DOLPHIN_MODE_META[s.dolphinModeIndex].id;

		if (dMode !== s.dolphinPrevMode) {
			s.dolphinPrevMode = dMode;
			for (let di = 0; di < 3; di++) {
				const di3 = di * 3;
				s.dolphinPod.velocities[di3] = 0;
				s.dolphinPod.velocities[di3 + 1] = 0;
				s.dolphinPod.velocities[di3 + 2] = 0;
				s.dolphinPod.rotations[di] = 0;
			}
		}

		updateDolphinPod(s.dolphinPod, delta, elapsed, dMode, s.dolphinPod.mesh.position, fishTerrain, repelArg);
	}

	// ── Jellyfish (staggered spawn + player-follow) ──

	s.jellySpawnTimer -= delta;
	if (s.jellySpawnTimer > 0) {
		s.jellySwarm.mesh.visible = false;
	} else {
		if (!s.jellySwarm.mesh.visible) {
			s.jellySwarm.mesh.visible = true;
			const jpos = new THREE.Vector3(
				pos.x + behindDir.x * 25,
				Math.max(pos.y - 1, 0),
				pos.z + behindDir.z * 25,
			);
			s.jellySwarm.mesh.position.copy(jpos);
		}
		const jbehind = new THREE.Vector3(
			pos.x + behindDir.x * 24,
			Math.max(pos.y - 1, 0),
			pos.z + behindDir.z * 24,
		);
		s.jellySwarm.mesh.position.copy(jbehind);

		s.jellyTimer -= delta;
		if (s.jellyTimer <= 0) {
			s.jellyMode = s.jellyMode === "drifting" ? "pulsing" : "drifting";
			s.jellyTimer = 8 + Math.random() * 7;
		}

		updateJellySwarm(s.jellySwarm, delta, elapsed, s.jellyMode, s.jellySwarm.mesh.position, repelArg);
	}

	// ── Start City ──

	if (s.startCityModelCity) {
		const sy = getTerrainHeight(s.startCityX, s.startCityZ, s.terrainAmplitude, s.terrainScale);
		updateModelCityPulse(s.startCityModelCity, elapsed, true, sy);
	}

	// ── Water Surface ──

	s.waterSurface.position.y = WATER_SURFACE_Y + Math.sin(elapsed * 0.1) * 0.5;
	(s.waterSurface.material as THREE.MeshPhysicalMaterial).opacity = 0.3 + Math.sin(elapsed * 0.15) * 0.08;

	// ── Audio ──

	if (s.audio) {
		const a = s.audio;
		if (a.ctx.state === "suspended") a.ctx.resume();

		const targetSurface = THREE.MathUtils.clamp((pos.y - 460) / 30, 0, 1);
		a.surfaceBlend += (targetSurface - a.surfaceBlend) * delta * 2;
		a.surfaceGain.gain.value = a.surfaceBlend * 0.35;

		const duck = 1 - a.surfaceBlend * 0.5;
		a.bgGain.gain.value = 0.14 + duck * 0.1;
	}

	return { state: s };
}

// ── Dispose ──

export function dispose(state: ExperienceState, scene: THREE.Scene): void {
	const s = state as UnderwaterWorldState;

	for (const ch of s.terrainChunks) {
		disposeTerrainChunk(ch, scene);
	}

	const toRemove: THREE.Object3D[] = [];
	scene.traverse((child) => {
		if (child instanceof THREE.AmbientLight || child instanceof THREE.DirectionalLight) {
			toRemove.push(child);
		}
	});
	for (const l of toRemove) scene.remove(l);
	scene.fog = null;

	for (const e of s.sandEntries) {
		if (e.dune) disposeDuneSand(e.dune, scene);
		if (e.meadow) disposeSeagrassMeadow(e.meadow, scene);
		if (e.modelCoralReef) disposeScatterGroup(e.modelCoralReef, scene);
		else if (e.reef) disposeCoralReef(e.reef, scene);
		if (e.modelCity) disposeModelCity(e.modelCity, scene);
		else if (e.city) disposeCity(e.city, scene);
	}

	if (s.startCityModelCity) disposeModelCity(s.startCityModelCity, scene);

	if (s.startCoralReef) disposeScatterGroup(s.startCoralReef, scene);

	for (const g of s.cityGuidance) {
		g.path.dispose();
		scene.remove(g.path.group);
	}

	s.waterSurface.geometry.dispose();
	(s.waterSurface.material as THREE.MeshPhysicalMaterial).dispose();
	scene.remove(s.waterSurface);

	for (const school of s.fishSchools) {
		disposeFishSchool(school, scene);
	}

	disposeDolphinPod(s.dolphinPod, scene);

	disposeJellySwarm(s.jellySwarm, scene);

	for (const mesh of s.coralMeshes) {
		scene.remove(mesh);
		mesh.geometry.dispose();
		(mesh.material as THREE.Material).dispose();
	}
	for (const geo of s.coralGeos) geo.dispose();

	s.terrainMat.dispose();

	if (s.audio) {
		try { s.audio.ctx.close(); } catch { /* ignore */ }
	}
}
