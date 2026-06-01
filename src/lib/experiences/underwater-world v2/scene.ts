import * as THREE from "three";
import type { ExperienceState, SetupContext, TickContext } from "../types";

// ── Constants ──

const CHUNK_SIZE = 400;
const CHUNK_SEGMENTS = 48;
const CHUNK_RADIUS = 1;
const WATER_SURFACE_Y = 75;
const TERRAIN_BASE_Y = -3;
const BIOME_FREQ = 0.005;
const CORAL_COUNT = 1200;
const SEAGRASS_COUNT = 800;
const CORAL_STREAM_PER_FRAME = 30;
const SEAGRASS_STREAM_PER_FRAME = 20;
const STREAM_INIT_RADIUS = 200;
const STREAM_FWD_RADIUS = 400;
const STREAM_BACK_RADIUS = 120;

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

interface PendingFloraItem {
	wx: number;
	wz: number;
	ty: "coral" | "seagrass";
	variant: number;
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
	coralPositions: { wx: number; wz: number; variant: number }[];
	seagrassPositions: { wx: number; wz: number }[];
	coralMeshes: THREE.Mesh[];
	seagrassMeshes: THREE.Mesh[];
	streamQueue: PendingFloraItem[];
	coralGeo: THREE.BufferGeometry;
	coralColors: THREE.Color[];
	seagrassGeo: THREE.BufferGeometry;
	seagrassMat: THREE.MeshStandardMaterial;
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

// ── Coral Geometry ──

function createCoralGeometry(): THREE.BufferGeometry {
	const geo = new THREE.IcosahedronGeometry(0.5, 2);
	const pos = geo.attributes.position.array as Float32Array;
	for (let i = 0; i < pos.length; i += 3) {
		const x = pos[i];
		const y = pos[i + 1];
		const z = pos[i + 2];
		const len = Math.sqrt(x * x + y * y + z * z);
		const noise = hash2d(x * 10, z * 10) * 0.4 + 0.6;
		const scale = len > 0.3 ? 1 + noise * 0.5 : 0.5;
		pos[i] *= scale;
		pos[i + 1] *= scale;
		pos[i + 2] *= scale;
	}
	geo.computeVertexNormals();
	return geo;
}

const CORAL_VARIANT_COLORS: [number, number][] = [
	[0xff7744, 0xffaa66],
	[0xcc4488, 0xee77aa],
	[0x44bbdd, 0x66ddff],
	[0x88dd44, 0xaaee66],
	[0xdd6644, 0xff8866],
	[0xaa44cc, 0xcc66ee],
];

// ── Seagrass Geometry ──

function createBladeGeometry(length: number, width: number, curve: number): THREE.BufferGeometry {
	const segs = 6;
	const shape = new THREE.Shape();
	shape.moveTo(-width / 2, 0);
	shape.quadraticCurveTo(-width / 2 - curve, length * 0.5, 0, length);
	shape.quadraticCurveTo(width / 2 + curve, length * 0.5, width / 2, 0);
	const geo = new THREE.ShapeGeometry(shape, segs);
	geo.rotateX(-Math.PI / 2);
	return geo;
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

	// Coral positions (hash-based, world-locked)
	const coralPositions: { wx: number; wz: number; variant: number }[] = [];
	let ci = 0;
	while (ci < CORAL_COUNT) {
		const wx = (hash2d(ci * 7 + 13, ci * 3 + 7) - 0.5) * 3000;
		const wz = (hash2d(ci * 11 + 3, ci * 5 + 11) - 0.5) * 3000;
		const biome = getBiome(wx, wz);
		if (biome < 0.55) {
			const variant = Math.floor(hash2d(wx * 100, wz * 100) * CORAL_VARIANT_COLORS.length);
			coralPositions.push({ wx, wz, variant });
			ci++;
		} else {
			ci++;
		}
	}

	// Seagrass positions (world-locked on sand)
	const seagrassPositions: { wx: number; wz: number }[] = [];
	let si = 0;
	while (si < SEAGRASS_COUNT) {
		const wx = (hash2d(si * 17 + 5, si * 23 + 9) - 0.5) * 2500;
		const wz = (hash2d(si * 29 + 7, si * 19 + 3) - 0.5) * 2500;
		const biome = getBiome(wx, wz);
		if (biome >= 0.55 && biome < 0.75 && hash2d(wx * 50, wz * 50) > 0.5) {
			seagrassPositions.push({ wx, wz });
			si++;
		} else {
			si++;
		}
	}

	// Pre-build geometries
	const coralGeo = createCoralGeometry();
	const coralColors = CORAL_VARIANT_COLORS.map(([c1, c2]) => {
		const col = new THREE.Color();
		col.lerpColors(new THREE.Color(c1), new THREE.Color(c2), 0.5);
		return col;
	});

	const seagrassGeo = createBladeGeometry(2 + hash2d(0, 0) * 3, 0.2 + hash2d(0, 1) * 0.2, 0.3);
	const seagrassMat = new THREE.MeshStandardMaterial({
		color: 0x44aa55,
		side: THREE.DoubleSide,
		transparent: true,
		opacity: 0.85,
	});

	// Water surface
	const waterMat = new THREE.MeshPhysicalMaterial({
		color: 0x1a6a9a,
		transparent: true,
		opacity: 0.35,
		roughness: 0.0,
		metalness: 0.0,
		side: THREE.DoubleSide,
	});
	const water = new THREE.Mesh(new THREE.CircleGeometry(600, 64), waterMat);
	water.rotation.x = -Math.PI / 2;
	water.position.y = WATER_SURFACE_Y;
	water.renderOrder = 1;
	scene.add(water);

	// Fog
	scene.fog = new THREE.Fog(0x001020, 10, 180);

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

	return {
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
		coralPositions,
		seagrassPositions,
		coralMeshes: [],
		seagrassMeshes: [],
		streamQueue: [],
		coralGeo,
		coralColors,
		seagrassGeo,
		seagrassMat,
		waterSurface: water,
		audio,
		keys,
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

	const moveZ = s.keys.has("KeyW") ? 1 : s.keys.has("KeyS") ? -1 : 0;
	const moveX = s.keys.has("KeyD") ? 1 : s.keys.has("KeyA") ? -1 : 0;

	if (moveX !== 0 && moveZ !== 0) {
		const inv = 1 / Math.SQRT2;
		ctx.camera.position.x += moveX * s.wasdSpeed * delta * inv;
		ctx.camera.position.z += moveZ * s.wasdSpeed * delta * inv;
	} else {
		ctx.camera.position.x += moveX * s.wasdSpeed * delta;
		ctx.camera.position.z += moveZ * s.wasdSpeed * delta;
	}

	// Yaw
	if (s.keys.has("ArrowLeft") || s.keys.has("KeyA")) ctx.camera.rotation.y += s.wasdSpeed * delta * 0.25;
	if (s.keys.has("ArrowRight") || s.keys.has("KeyD")) ctx.camera.rotation.y -= s.wasdSpeed * delta * 0.25;

	// Pitch
	if (s.keys.has("KeyR")) ctx.camera.rotation.x -= delta * 0.8;
	if (s.keys.has("KeyF")) ctx.camera.rotation.x += delta * 0.8;
	ctx.camera.rotation.x = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, ctx.camera.rotation.x));

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
		s.audio ? (s.audio.wasSpace = false) : null;
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
		const baseColor = new THREE.Color(s.terrainColor);
		for (const p of batch) {
			const chunk = createTerrainChunk(p.gx, p.gz, s.terrainAmplitude, s.terrainScale, baseColor, s.terrainMat);
			s.scene.add(chunk.mesh);
			s.terrainChunks.push(chunk);
		}
	}

	// ── Coral Streaming ──

	const loadedCoral = new Set(s.coralMeshes.map((m) => `${m.userData.wx},${m.userData.wz}`));
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

	let coralLoaded = 0;
	for (const cp of s.coralPositions) {
		if (coralLoaded >= CORAL_STREAM_PER_FRAME) break;
		const key = `${cp.wx},${cp.wz}`;
		if (loadedCoral.has(key)) continue;
		const dx = cp.wx - pos.x;
		const dz = cp.wz - pos.z;
		const dSq = dx * dx + dz * dz;
		const maxR = (dx * driftDir.x + dz * driftDir.z > 0 ? STREAM_FWD_RADIUS : STREAM_BACK_RADIUS);
		if (dSq > maxR * maxR) continue;
		const mat = new THREE.MeshStandardMaterial({
			color: s.coralColors[cp.variant],
			flatShading: true,
			roughness: 0.7,
		});
		const geo = s.coralGeo.clone();
		const mesh = new THREE.Mesh(geo, mat);
		const h = getTerrainHeight(cp.wx, cp.wz, s.terrainAmplitude, s.terrainScale);
		mesh.position.set(cp.wx, h + 0.5 + hash2d(cp.wx, cp.wz) * 2, cp.wz);
		const scl = 0.3 + hash2d(cp.wx * 3, cp.wz * 7) * 0.5;
		mesh.scale.setScalar(scl);
		mesh.rotation.set(0, hash2d(cp.wx * 10, cp.wz * 10) * Math.PI * 2, 0);
		mesh.userData = { wx: cp.wx, wz: cp.wz };
		s.scene.add(mesh);
		s.coralMeshes.push(mesh);
		loadedCoral.add(key);
		coralLoaded++;
	}

	// ── Seagrass Streaming ──

	const loadedSeagrass = new Set(s.seagrassMeshes.map((m) => `${m.userData.wx},${m.userData.wz}`));
	for (let i = s.seagrassMeshes.length - 1; i >= 0; i--) {
		const m = s.seagrassMeshes[i];
		const dx = m.userData.wx - pos.x;
		const dz = m.userData.wz - pos.z;
		if (dx * dx + dz * dz > 400 * 400) {
			s.scene.remove(m);
			m.geometry.dispose();
			s.seagrassMeshes.splice(i, 1);
		}
	}

	let sgLoaded = 0;
	for (const sp of s.seagrassPositions) {
		if (sgLoaded >= SEAGRASS_STREAM_PER_FRAME) break;
		const key = `${sp.wx},${sp.wz}`;
		if (loadedSeagrass.has(key)) continue;
		const dx = sp.wx - pos.x;
		const dz = sp.wz - pos.z;
		const dSq = dx * dx + dz * dz;
		if (dSq > STREAM_INIT_RADIUS * STREAM_INIT_RADIUS) continue;
		const h = getTerrainHeight(sp.wx, sp.wz, s.terrainAmplitude, s.terrainScale);
		const mesh = new THREE.Mesh(s.seagrassGeo.clone(), s.seagrassMat.clone());
		const len = 2 + hash2d(sp.wx * 5, sp.wz * 5) * 3;
		mesh.scale.set(1, 1, len);
		mesh.position.set(sp.wx, h + 0.2, sp.wz);
		mesh.rotation.set(0, hash2d(sp.wx * 10, sp.wz * 10) * Math.PI * 2, 0);
		mesh.userData = { wx: sp.wx, wz: sp.wz };
		s.scene.add(mesh);
		s.seagrassMeshes.push(mesh);
		loadedSeagrass.add(key);
		sgLoaded++;
	}

	// ── Water Surface ──

	s.waterSurface.position.y = WATER_SURFACE_Y + Math.sin(elapsed * 0.1) * 0.5;
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

	for (const m of s.coralMeshes) {
		scene.remove(m);
		m.geometry.dispose();
		(m.material as THREE.MeshStandardMaterial).dispose();
	}

	for (const m of s.seagrassMeshes) {
		scene.remove(m);
		m.geometry.dispose();
		(m.material as THREE.MeshStandardMaterial).dispose();
	}

	s.coralGeo.dispose();
	s.seagrassGeo.dispose();
	s.seagrassMat.dispose();

	s.waterSurface.geometry.dispose();
	(s.waterSurface.material as THREE.MeshPhysicalMaterial).dispose();
	scene.remove(s.waterSurface);

	s.terrainMat.dispose();

	if (s.audio) {
		try { s.audio.ctx.close(); } catch { /* ignore */ }
	}
}
