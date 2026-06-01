import * as THREE from "three";
import type { ExperienceState, SetupContext, TickContext } from "$lib/experiences/types";
import { loadAllGeometries, createRockGeometry, createProceduralCoralGeometry } from "$lib/experiences/underwater-world v2/Biome/Korallenriff/korallenriff";
import { createSeagrassMeadow, updateSeagrassSway, disposeSeagrassMeadow, type SeagrassMeadow } from "$lib/experiences/underwater-world v2/Objekte/Seegras/seagrass";
import { createFishSchool, updateFishSchool, disposeFishSchool, loadFishGeometry, type FishSchool, type SwimMode, type FlockMode } from "$lib/experiences/underwater-world v2/Objekte/Fische/fish";
import { createSharkPack, updateSharkPack, disposeSharkPack, loadSharkGeometry, type SharkPack, type SharkMode } from "$lib/experiences/underwater-world v2/Objekte/Haie/shark";
import { createDolphinPod, updateDolphinPod, disposeDolphinPod, loadDolphinGeometry, type DolphinPod, type DolphinMode } from "$lib/experiences/underwater-world v2/Objekte/Delfine/dolphin";
import { createJellySwarm, updateJellySwarm, disposeJellySwarm, type JellySwarm, type JellyMode } from "$lib/experiences/underwater-world v2/Objekte/Quallen/jellyfish";
import { createCity, updateCityPulse, disposeCity, type CityResult } from "$lib/experiences/underwater-world v2/Biome/Städte/city";
import { createEchoVariant, type EchoVariantSystem, ECHO_VARIANTS } from "$lib/experiences/underwater-world v2/Sinne/Echoortung/echoortung";

// ── Constants ──

const CHUNK_SIZE = 400;
const CHUNK_SEGMENTS = 48;
const CHUNK_RADIUS = 1;
const WATER_SURFACE_Y = 75;
const TERRAIN_BASE_Y = -3;
const BIOME_FREQ = 0.005;

const STREAM_INIT_RADIUS = 200;
const STREAM_FWD_RADIUS = 400;
const STREAM_BACK_RADIUS = 120;
const CORAL_STREAM_PER_FRAME = 20;
const ROCK_STREAM_PER_FRAME = 5;
const SEAGRASS_STREAM_PER_FRAME = 1;

const FISH_COUNT = 80;
const SHARK_COUNT = 3;
const DOLPHIN_COUNT = 2;
const JELLY_COUNT = 10;

const CITY_ACTIVATE_DSQ = 360000;
const CITY_DEACTIVATE_DSQ = 490000;
const CITY_DOME_RADIUS = 65;

const ECHO_EMIT_INTERVAL = 10;

const CORAL_TYPES = 5;
const CORAL_COLORS = [
	0xff6644, 0xdd8855, 0xdd77aa, 0xff9966, 0xee7766,
	0xffaa44, 0x77ccaa, 0xff8844, 0xee5599, 0x66ddaa,
];

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
	if (biome < 0.55) return { ampMul: 1.0, scaleMul: 1.0, color: new THREE.Color(0x3a5a7a) };
	if (biome < 0.75) return { ampMul: 0.4, scaleMul: 0.7, color: new THREE.Color(0xc4a87a) };
	return { ampMul: 0.3, scaleMul: 0.6, color: new THREE.Color(0x4a4a6a) };
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
	cityGain: GainNode | null;
	citySrc: AudioBufferSourceNode | null;
	cityBlend: number;
	moveBuffer: AudioBuffer | null;
	echoBuffer: AudioBuffer | null;
	wasSpace: boolean;
}

interface CoralDatum {
	wx: number;
	wz: number;
	typeIdx: number;
	color: number;
}

interface SeagrassMeadowDatum {
	wx: number;
	wz: number;
	type: "algae" | "long" | "bushy";
	meadow: SeagrassMeadow;
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
	// Corals (OBJ models from korallenriff.ts)
	coralGeos: (THREE.BufferGeometry | null)[];
	coralData: CoralDatum[];
	coralMeshes: THREE.Mesh[];
	// Rocks
	rockGeo: THREE.BufferGeometry;
	rockPositions: { wx: number; wz: number }[];
	rockMeshes: THREE.Mesh[];
	rockMat: THREE.MeshStandardMaterial;
	// Seagrass meadows (from seagrass.ts)
	seagrassData: SeagrassMeadowDatum[];
	// Creatures
	fishSchool: FishSchool | null;
	sharkPack: SharkPack | null;
	dolphinPod: DolphinPod | null;
	jellySwarm: JellySwarm | null;
	// City
	city: CityResult | null;
	cityActive: boolean;
	cityFound: boolean;
	cityX: number;
	cityZ: number;
	// Echo
	echoSystem: EchoVariantSystem | null;
	echoEnabled: boolean;
	echoTimer: number;
	// Core
	waterSurface: THREE.Mesh;
	audio: AudioState | null;
	keys: Set<string>;
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
	bgGain.gain.value = 0.2;
	bgGain.connect(masterGain);
	const bgSrc = ctx.createBufferSource();
	bgSrc.loop = true;
	bgSrc.connect(bgGain);

	const surfaceGain = ctx.createGain();
	surfaceGain.gain.value = 0;
	surfaceGain.connect(masterGain);

	const cityGain = ctx.createGain();
	cityGain.gain.value = 0;
	cityGain.connect(masterGain);

	return {
		ctx, masterGain,
		bgGain, bgSrc,
		surfaceGain, surfaceSrc: null, surfaceBlend: 0,
		cityGain, citySrc: null, cityBlend: 0,
		moveBuffer: null, echoBuffer: null,
		wasSpace: false,
	};
}

async function loadAudioAssets(audio: AudioState): Promise<void> {
	const ctx = audio.ctx;
	try {
		const r = await fetch("/sounds/dragon-studio-deep-sea-underwater-ambience-472383.mp3");
		audio.bgSrc.buffer = await ctx.decodeAudioData(await r.arrayBuffer());
		audio.bgSrc.start();
	} catch { /* bg silent */ }

	try {
		const r = await fetch("/sounds/dragon-studio-deep-sea-underwater-ambience-482888.mp3");
		const s = ctx.createBufferSource();
		s.loop = true;
		s.buffer = await ctx.decodeAudioData(await r.arrayBuffer());
		s.connect(audio.surfaceGain);
		s.start();
		audio.surfaceSrc = s;
	} catch { /* surface silent */ }

	try {
		const r = await fetch("/sounds/mavopix-underwater-159894.mp3");
		const s = ctx.createBufferSource();
		s.loop = true;
		s.buffer = await ctx.decodeAudioData(await r.arrayBuffer());
		s.connect(audio.cityGain!);
		s.start();
		audio.citySrc = s;
	} catch { /* city silent */ }

	try {
		const r = await fetch("/sounds/freesound_community-underwater-movement-66914.mp3");
		audio.moveBuffer = await ctx.decodeAudioData(await r.arrayBuffer());
	} catch { /* movement silent */ }

	try {
		const r = await fetch("/sounds/dragon-studio-deepsea-sonar-386156.mp3");
		audio.echoBuffer = await ctx.decodeAudioData(await r.arrayBuffer());
	} catch { /* echo silent */ }
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

	// ── Terrain ──

	const terrainMat = new THREE.MeshStandardMaterial({
		vertexColors: true, flatShading: true, roughness: 0.9, metalness: 0.0,
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

	// ── Coral Geos (OBJ from v2) ──

	const coralGeos = await loadAllGeometries();

	// ── World-locked positions: Corals, Rocks, Seagrass ──

	const coralData: CoralDatum[] = [];
	const rockPositions: { wx: number; wz: number }[] = [];
	const seagrassDatum: { wx: number; wz: number; type: "algae" | "long" | "bushy" }[] = [];

	const cTarget = 1200;
	const rTarget = 120;
	let ci = 0, ri = 0, si = 0;
	while (ci < cTarget || ri < rTarget || si < 300) {
		const wx = (hash2d(ci * 7 + 13, ci * 3 + 7) - 0.5) * 3000;
		const wz = (hash2d(ci * 11 + 3, ci * 5 + 11) - 0.5) * 3000;
		const biome = getBiome(wx, wz);

		if (ci < cTarget && biome < 0.55) {
			const typeIdx = Math.floor(hash2d(wx * 100, wz * 100) * CORAL_TYPES);
			const color = CORAL_COLORS[Math.floor(hash2d(wx * 50, wz * 50) * CORAL_COLORS.length)];
			coralData.push({ wx, wz, typeIdx, color });
			ci++;
		} else if (ci < cTarget) {
			ci++;
		}

		if (ri < rTarget && biome < 0.55 && hash2d(wx * 30, wz * 30) > 0.85) {
			rockPositions.push({ wx, wz });
			ri++;
		}

		if (biome >= 0.55 && biome < 0.75 && si < 300 && hash2d(wx * 20, wz * 20) > 0.92) {
			const type: "algae" | "long" | "bushy" =
				hash2d(wx * 7, wz * 11) > 0.66 ? "bushy" :
				hash2d(wx * 13, wz * 17) > 0.5 ? "long" : "algae";
			seagrassDatum.push({ wx, wz, type });
			si++;
		}
	}

	// ── Rock geometry ──

	const rockGeo = createRockGeometry();
	const rockMat = new THREE.MeshStandardMaterial({
		vertexColors: true, roughness: 0.8, flatShading: true,
	});

	// ── Creatures ──

	let fishSchool: FishSchool | null = null;
	let sharkPack: SharkPack | null = null;
	let dolphinPod: DolphinPod | null = null;
	let jellySwarm: JellySwarm | null = null;

	try {
		const fishGeo = await loadFishGeometry();
		fishSchool = createFishSchool(FISH_COUNT, fishGeo ?? undefined);
		scene.add(fishSchool.mesh);
	} catch {
		fishSchool = createFishSchool(FISH_COUNT);
		scene.add(fishSchool.mesh);
	}

	try {
		const sharkGeo = await loadSharkGeometry();
		sharkPack = createSharkPack(SHARK_COUNT, sharkGeo ?? undefined);
		scene.add(sharkPack.mesh);
	} catch {
		sharkPack = createSharkPack(SHARK_COUNT);
		scene.add(sharkPack.mesh);
	}

	try {
		const dolphinGeo = await loadDolphinGeometry();
		dolphinPod = createDolphinPod(DOLPHIN_COUNT, dolphinGeo ?? undefined);
		scene.add(dolphinPod.mesh);
	} catch {
		dolphinPod = createDolphinPod(DOLPHIN_COUNT);
		scene.add(dolphinPod.mesh);
	}

	jellySwarm = createJellySwarm(JELLY_COUNT);
	scene.add(jellySwarm.mesh);

	// ── City ──

	const city = createCity("zentrum");
	scene.add(city.group);

	// ── Echo ──

	const echoSystem = createEchoVariant(ECHO_VARIANTS.scan);
	scene.add(echoSystem.group);

	// ── Water surface ──

	const waterMat = new THREE.MeshPhysicalMaterial({
		color: 0x1a6a9a, transparent: true, opacity: 0.35,
		roughness: 0.0, metalness: 0.0, side: THREE.DoubleSide,
	});
	const water = new THREE.Mesh(new THREE.CircleGeometry(600, 64), waterMat);
	water.rotation.x = -Math.PI / 2;
	water.position.y = WATER_SURFACE_Y;
	water.renderOrder = 1;
	scene.add(water);

	scene.fog = new THREE.Fog(0x001020, 10, 180);

	// ── Audio ──

	let audio: AudioState | null = null;
	try {
		const audioCtx = new AudioContext();
		const masterGain = audioCtx.createGain();
		masterGain.gain.value = 0.4;
		masterGain.connect(audioCtx.destination);
		audio = initAudio(audioCtx, masterGain);
		loadAudioAssets(audio);
	} catch { /* audio unavailable */ }

	// Wire echo to audio
	if (audio && audio.echoBuffer) {
		echoSystem.setAudio(audio.ctx, audio.echoBuffer);
	}

	return {
		camera, scene,
		driftSpeed: 2, wasdSpeed: 6,
		lightIntensity: 1.5, terrainAmplitude: amplitude, terrainScale: scale, terrainColor: "#ffffff",
		terrainChunks, pendingChunks: [], prevGx: 0, prevGz: 0, terrainMat,
		coralGeos, coralData, coralMeshes: [],
		rockGeo, rockPositions, rockMeshes: [], rockMat,
		seagrassData: [],
		fishSchool, sharkPack, dolphinPod, jellySwarm,
		city, cityActive: false, cityFound: false, cityX: 0, cityZ: 0,
		echoSystem, echoEnabled: true, echoTimer: 0,
		waterSurface: water, audio, keys,
	};
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

	// W/S vertical
	if (s.keys.has("KeyW")) pos.y += s.wasdSpeed * delta;
	if (s.keys.has("KeyS")) pos.y -= s.wasdSpeed * delta;

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
		const bc = new THREE.Color(s.terrainColor);
		for (const p of batch) {
			const chunk = createTerrainChunk(p.gx, p.gz, s.terrainAmplitude, s.terrainScale, bc, s.terrainMat);
			s.scene.add(chunk.mesh);
			s.terrainChunks.push(chunk);
		}
	}

	// ── Coral Streaming ──

	const coralLoaded = new Set(s.coralMeshes.map((m) => `${m.userData.wx},${m.userData.wz}`));
	for (let i = s.coralMeshes.length - 1; i >= 0; i--) {
		const m = s.coralMeshes[i];
		const dx = m.userData.wx - pos.x;
		const dz = m.userData.wz - pos.z;
		if (dx * dx + dz * dz > 450 * 450) {
			s.scene.remove(m);
			m.geometry.dispose();
			(m.material as THREE.MeshStandardMaterial).dispose();
			s.coralMeshes.splice(i, 1);
		}
	}

	let cLoaded = 0;
	for (const cd of s.coralData) {
		if (cLoaded >= CORAL_STREAM_PER_FRAME) break;
		const key = `${cd.wx},${cd.wz}`;
		if (coralLoaded.has(key)) continue;
		const dx = cd.wx - pos.x;
		const dz = cd.wz - pos.z;
		const dSq = dx * dx + dz * dz;
		const maxR = (dx * driftDir.x + dz * driftDir.z > 0 ? STREAM_FWD_RADIUS : STREAM_BACK_RADIUS);
		if (dSq > maxR * maxR) continue;
		const srcGeo = s.coralGeos[cd.typeIdx] ?? createProceduralCoralGeometry(cd.typeIdx);
		const geo = srcGeo.clone();
		const mat = new THREE.MeshStandardMaterial({
			color: cd.color, flatShading: true, roughness: 0.7,
		});
		const mesh = new THREE.Mesh(geo, mat);
		const h = getTerrainHeight(cd.wx, cd.wz, s.terrainAmplitude, s.terrainScale);
		mesh.position.set(cd.wx, h + hash2d(cd.wx, cd.wz) * 2, cd.wz);
		const scl = 0.04 + hash2d(cd.wx * 3, cd.wz * 7) * 0.06;
		mesh.scale.setScalar(scl);
		mesh.rotation.set(0, hash2d(cd.wx * 10, cd.wz * 10) * Math.PI * 2, 0);
		mesh.userData = { wx: cd.wx, wz: cd.wz };
		s.scene.add(mesh);
		s.coralMeshes.push(mesh);
		cLoaded++;
	}

	// ── Rock Streaming ──

	const rockLoaded = new Set(s.rockMeshes.map((m) => `${m.userData.wx},${m.userData.wz}`));
	for (let i = s.rockMeshes.length - 1; i >= 0; i--) {
		const m = s.rockMeshes[i];
		const dx = m.userData.wx - pos.x;
		const dz = m.userData.wz - pos.z;
		if (dx * dx + dz * dz > 450 * 450) {
			s.scene.remove(m);
			m.geometry.dispose();
			s.rockMeshes.splice(i, 1);
		}
	}

	let rLoaded = 0;
	for (const rp of s.rockPositions) {
		if (rLoaded >= ROCK_STREAM_PER_FRAME) break;
		const key = `${rp.wx},${rp.wz}`;
		if (rockLoaded.has(key)) continue;
		const dx = rp.wx - pos.x;
		const dz = rp.wz - pos.z;
		if (dx * dx + dz * dz > STREAM_INIT_RADIUS * STREAM_INIT_RADIUS) continue;
		const h = getTerrainHeight(rp.wx, rp.wz, s.terrainAmplitude, s.terrainScale) - 0.5;
		const mesh = new THREE.Mesh(s.rockGeo, s.rockMat);
		const rs = 0.5 + hash2d(rp.wx * 5, rp.wz * 7) * 2;
		mesh.position.set(rp.wx, h + rs * 0.15, rp.wz);
		mesh.scale.set(rs, rs * (0.6 + hash2d(rp.wx * 3, rp.wz * 11) * 0.4), rs);
		mesh.rotation.set(hash2d(rp.wx, rp.wz) * 0.4, hash2d(rp.wx * 10, rp.wz * 10) * Math.PI * 2, hash2d(rp.wx * 7, rp.wz * 13) * 0.2);
		mesh.userData = { wx: rp.wx, wz: rp.wz };
		s.scene.add(mesh);
		s.rockMeshes.push(mesh);
		rLoaded++;
	}

	// ── Seagrass Meadow Streaming ──

	for (let i = s.seagrassData.length - 1; i >= 0; i--) {
		const sd = s.seagrassData[i];
		const dx = sd.wx - pos.x;
		const dz = sd.wz - pos.z;
		if (dx * dx + dz * dz > 400 * 400) {
			disposeSeagrassMeadow(sd.meadow, s.scene);
			s.seagrassData.splice(i, 1);
		}
	}

	if (s.seagrassData.length < 8) {
		const sgTypes: ("algae" | "long" | "bushy")[] = ["algae", "long", "bushy"];
		for (let tryI = 0; tryI < SEAGRASS_STREAM_PER_FRAME && s.seagrassData.length < 12; tryI++) {
			const cx = pos.x + (hash2d(elapsed + tryI * 7, tryI * 13) - 0.5) * 300;
			const cz = pos.z + (hash2d(tryI * 11, elapsed + tryI * 17) - 0.5) * 300;
			const biome = getBiome(cx, cz);
			if (biome >= 0.55 && biome < 0.75) {
				const type = sgTypes[Math.floor(hash2d(cx * 7, cz * 11) * 3)];
				const meadow = createSeagrassMeadow(type, (x: number, z: number) => getTerrainHeight(x, z, s.terrainAmplitude, s.terrainScale));
				s.scene.add(meadow.group);
				s.seagrassData.push({ wx: cx, wz: cz, type, meadow });
			}
		}
	}

	for (const sd of s.seagrassData) {
		updateSeagrassSway(sd.meadow, elapsed, sd.type);
	}

	// ── Fish ──

	if (s.fishSchool) {
		const fishCenter = new THREE.Vector3(pos.x, pos.y + 10, pos.z);
		updateFishSchool(s.fishSchool, delta, elapsed, "schooling", "boids", fishCenter);
		s.fishSchool.mesh.position.set(pos.x, pos.y, pos.z);
	}

	// ── Sharks ──

	if (s.sharkPack) {
		const sharkCenter = new THREE.Vector3(pos.x, pos.y + 5, pos.z);
		updateSharkPack(s.sharkPack, delta, elapsed, "patrol");
		s.sharkPack.mesh.position.set(pos.x, pos.y, pos.z);
	}

	// ── Dolphins ──

	if (s.dolphinPod) {
		const dolphCenter = new THREE.Vector3(pos.x, pos.y + 8, pos.z);
		updateDolphinPod(s.dolphinPod, delta, elapsed, "leisurely", dolphCenter);
		s.dolphinPod.mesh.position.set(pos.x, pos.y, pos.z);
	}

	// ── Jellyfish ──

	if (s.jellySwarm) {
		updateJellySwarm(s.jellySwarm, delta, elapsed, "drifting");
		s.jellySwarm.mesh.position.set(pos.x, pos.y + 15, pos.z);
	}

	// ── City ──

	if (s.city) {
		let nearCityBiome = false;
		const biomeVal = getBiome(pos.x, pos.z);
		if (biomeVal >= 0.75) {
			const h = getTerrainHeight(pos.x, pos.z, s.terrainAmplitude, s.terrainScale);
			let flat = true;
			for (let a = 0; a < 8; a++) {
				const angle = (a / 8) * Math.PI * 2;
				const sx = pos.x + Math.cos(angle) * 40;
				const sz = pos.z + Math.sin(angle) * 40;
				const sh = getTerrainHeight(sx, sz, s.terrainAmplitude, s.terrainScale);
				if (Math.abs(sh - h) > 4) { flat = false; break; }
			}
			nearCityBiome = flat;
		}

		if (!s.cityFound && nearCityBiome) {
			s.cityX = pos.x;
			s.cityZ = pos.z;
			s.cityFound = true;
		}

		if (s.cityFound) {
			const dSq = (pos.x - s.cityX) ** 2 + (pos.z - s.cityZ) ** 2;
			const active = dSq < CITY_ACTIVATE_DSQ;
			const newY = getTerrainHeight(s.cityX, s.cityZ, s.terrainAmplitude, s.terrainScale);
			updateCityPulse(s.city, elapsed, active, newY + 8);
			s.cityActive = active;
		}

		// City audio crossfade
		if (s.audio) {
			const dist = s.cityFound
				? Math.sqrt((pos.x - s.cityX) ** 2 + (pos.z - s.cityZ) ** 2)
				: 9999;
			const targetCity = THREE.MathUtils.clamp(1 - (dist - 100) / 400, 0, s.cityActive ? 1 : 0);
			s.audio.cityBlend += (targetCity - s.audio.cityBlend) * delta * 2;
			if (s.audio.cityGain) s.audio.cityGain.gain.value = s.audio.cityBlend * 0.5;
		}
	}

	// ── Echo Rings ──

	if (s.echoSystem && s.echoEnabled) {
		s.echoTimer += delta;
		if (s.echoTimer >= ECHO_EMIT_INTERVAL) {
			s.echoTimer = 0;
			const sources: [number, number, number][] = [];
			// Fish positions
			if (s.fishSchool) {
				for (let i = 0; i < s.fishSchool.count; i += 10) {
					const i3 = i * 3;
					sources.push([
						s.fishSchool.mesh.position.x + s.fishSchool.positions[i3],
						s.fishSchool.mesh.position.y + s.fishSchool.positions[i3 + 1],
						s.fishSchool.mesh.position.z + s.fishSchool.positions[i3 + 2],
					]);
				}
			}
			// Sharks
			if (s.sharkPack) {
				for (let i = 0; i < s.sharkPack.count; i++) {
					const i3 = i * 3;
					sources.push([
						s.sharkPack.mesh.position.x + s.sharkPack.positions[i3],
						s.sharkPack.mesh.position.y + s.sharkPack.positions[i3 + 1],
						s.sharkPack.mesh.position.z + s.sharkPack.positions[i3 + 2],
					]);
				}
			}
			// Dolphins
			if (s.dolphinPod) {
				for (let i = 0; i < s.dolphinPod.count; i++) {
					const i3 = i * 3;
					sources.push([
						s.dolphinPod.mesh.position.x + s.dolphinPod.positions[i3],
						s.dolphinPod.mesh.position.y + s.dolphinPod.positions[i3 + 1],
						s.dolphinPod.mesh.position.z + s.dolphinPod.positions[i3 + 2],
					]);
				}
			}
			// Jellyfish
			if (s.jellySwarm) {
				for (let i = 0; i < s.jellySwarm.count; i += 2) {
					const i3 = i * 3;
					sources.push([
						s.jellySwarm.mesh.position.x + s.jellySwarm.positions[i3],
						s.jellySwarm.mesh.position.y + s.jellySwarm.positions[i3 + 1],
						s.jellySwarm.mesh.position.z + s.jellySwarm.positions[i3 + 2],
					]);
				}
			}
			// Emit from a random subset
			const shuffled = sources.sort(() => Math.random() - 0.5);
			const emitCount = Math.min(8, shuffled.length);
			for (let i = 0; i < emitCount; i++) {
				const [ex, ey, ez] = shuffled[i];
				s.echoSystem.emit(ex, ey, ez);
			}
		}
		s.echoSystem.update(delta);
	}

	// ── Water Surface ──

	const waveBob = WATER_SURFACE_Y + Math.sin(elapsed * 0.1) * 0.5;
	s.waterSurface.position.y = waveBob;
	(s.waterSurface.material as THREE.MeshPhysicalMaterial).opacity = 0.3 + Math.sin(elapsed * 0.15) * 0.08;

	// ── Audio ──

	if (s.audio) {
		const a = s.audio;
		if (a.ctx.state === "suspended") a.ctx.resume();

		const targetSurface = THREE.MathUtils.clamp((pos.y - 40) / 30, 0, 1);
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
	s.terrainMat.dispose();

	for (const m of s.coralMeshes) {
		scene.remove(m);
		m.geometry.dispose();
		(m.material as THREE.MeshStandardMaterial).dispose();
	}
	for (const geo of s.coralGeos) {
		if (geo) geo.dispose();
	}

	for (const m of s.rockMeshes) {
		scene.remove(m);
	}
	s.rockGeo.dispose();
	s.rockMat.dispose();

	for (const sd of s.seagrassData) {
		disposeSeagrassMeadow(sd.meadow, scene);
	}

	if (s.fishSchool) disposeFishSchool(s.fishSchool, scene);
	if (s.sharkPack) disposeSharkPack(s.sharkPack, scene);
	if (s.dolphinPod) disposeDolphinPod(s.dolphinPod, scene);
	if (s.jellySwarm) disposeJellySwarm(s.jellySwarm, scene);

	if (s.city) disposeCity(s.city, scene);

	if (s.echoSystem) s.echoSystem.dispose();

	s.waterSurface.geometry.dispose();
	(s.waterSurface.material as THREE.MeshPhysicalMaterial).dispose();
	scene.remove(s.waterSurface);

	if (s.audio) {
		try { s.audio.ctx.close(); } catch { /* ignore */ }
	}
}
