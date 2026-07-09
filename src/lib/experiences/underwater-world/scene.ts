import * as THREE from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { MTLLoader } from "three/examples/jsm/loaders/MTLLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { ExperienceState, SetupContext, TickContext } from "../types";
import { loadGLTF } from "$lib/three/loader";
import { getTerrainHeight, getBiome, hash2d, TERRAIN_BASE_Y } from "./welt/terrain";
import type { TerrainChunk } from "./welt/terrain";
import {
	createInitialTerrainChunks, queueTerrainChunks, processChunkQueue,
	CHUNK_SIZE,
	createStreamedCoralField, createStreamedKelpField, createStreamedRockField,
	updateCoralStreaming, updateKelpStreaming, updateRockStreaming,
} from "./welt/chunks";
import type { StreamedCoralField, StreamedKelpField, StreamedRockField } from "./welt/chunks";
import { createWaterSurface, updateWaterSurface, disposeWaterSurface, WATER_SURFACE_Y } from "./welt/wasser";

// ── State ──

export interface UnderwaterWorldState extends ExperienceState {
	camera: THREE.PerspectiveCamera;
	scene: THREE.Scene;
	terrainChunks: TerrainChunk[];
	terrainChunkQueue: { gx: number; gz: number }[];
	terrainLastGx: number;
	terrainLastGz: number;
	fish: FishSchool;
	fishMat: THREE.MeshStandardMaterial;
	particles: THREE.Points;
	particleMat: THREE.PointsMaterial;
	echoRingPool: EchoRingData[];
	echoBurstQueue: EchoBurst[];
	echoEmitTimer: number;
	echoEnabled: boolean;
	echoKeyWasDown: boolean;
	terrainAmplitude: number;
	terrainScale: number;
	terrainColor: string;
	terrainMat: THREE.MeshStandardMaterial;
	waterSurface: THREE.Mesh;
	driftSpeed: number;
	wasdSpeed: number;
	lightIntensity: number;
	echolocationEnabled: boolean;
	echolocationRange: number;
	coralField: StreamedCoralField;
	kelpField: StreamedKelpField;
	rockField: StreamedRockField;
	jellyfish: JellyfishHerd;
	sharks: LargeFish[];
	dolphins: LargeFish[];
	city: CityInstance;
	audio: AudioState | null;
	moveX: number;
	moveZ: number;
}

// ── Constants ──

const FISH_COUNT = 80;
const CAMERA_Y = 4;
const ROCK_COUNT = 120;

// ── Echo-Ringe ──
const ECHO_RING_POOL_SIZE = 60;
const ECHO_RING_LIFETIME = 12;
const ECHO_RING_EXPAND_SPEED = 14;
const ECHO_EMIT_INTERVAL = 10;
const ECHO_BURST_DELAY = 0.4;
const ECHO_DOLPHIN_RANGE = 6;

// ── Keyboard ──

const keys: Set<string> = new Set();

function handleKey(e: KeyboardEvent, pressed: boolean): void {
	if (pressed) keys.add(e.code);
	else keys.delete(e.code);
}

function getWASD(): { moveX: number; moveZ: number } {
	let mx = 0;
	let mz = 0;
	if (keys.has("KeyW") || keys.has("ArrowUp")) mz += 1;
	if (keys.has("KeyS") || keys.has("ArrowDown")) mz -= 1;
	if (keys.has("KeyA") || keys.has("ArrowLeft")) mx -= 1;
	if (keys.has("KeyD") || keys.has("ArrowRight")) mx += 1;
	if (mx !== 0 && mz !== 0) {
		mx /= Math.SQRT2;
		mz /= Math.SQRT2;
	}
	return { moveX: mx, moveZ: mz };
}

// ── Terrain (moved to welt/) ──

// ── Rocks ──

function createRocksData(count: number): { geo: THREE.BufferGeometry; mat: THREE.MeshStandardMaterial; positions: Float32Array } {
	const colors = [0x2a4a5a, 0x3a5a6a, 0x1a2a3a, 0x4a5a6a];
	const halfRange = 1500;
	const baseGeo = new THREE.IcosahedronGeometry(1, 1);
	const posAttr = baseGeo.attributes.position;
	for (let j = 0; j < posAttr.count; j++) {
		const x = posAttr.getX(j), y = posAttr.getY(j), z = posAttr.getZ(j);
		const bump = 1 + Math.sin(x * 3 + y * 4 + z * 5) * 0.25;
		posAttr.setXYZ(j, x * bump, y * bump, z * bump);
	}
	posAttr.needsUpdate = true;
	baseGeo.computeVertexNormals();
	baseGeo.deleteAttribute("color");

	const mat = new THREE.MeshStandardMaterial({
		color: 0x2a4a5a,
		flatShading: true,
		roughness: 0.9,
		metalness: 0.05,
	});

	const positions = new Float32Array(count * 3);
	const _dummy = new THREE.Object3D();
	const _color = new THREE.Color();
	for (let i = 0; i < count; i++) {
		const gi = i;
		const scale = (0.5 + hash2d(gi * 2, gi * 31) * 1.5) * (2 + hash2d(gi * 7, gi * 13) * 5);
		const angle = hash2d(gi * 17, gi * 23) * Math.PI * 2;
		const dist = 15 + hash2d(gi * 3, gi * 11) * (halfRange - 15);
		_dummy.position.set(Math.cos(angle) * dist, (hash2d(gi * 5, gi * 19) - 0.5) * 6, Math.sin(angle) * dist);
		_dummy.rotation.set(hash2d(gi * 11, gi * 3) * 2, hash2d(gi * 7, gi * 29) * 6, hash2d(gi * 13, gi * 5) * 2);
		_dummy.scale.setScalar(scale);
		_dummy.updateMatrix();
		const i3 = i * 3;
		positions[i3] = _dummy.position.x;
		positions[i3 + 1] = _dummy.position.y;
		positions[i3 + 2] = _dummy.position.z;
	}

	return { geo: baseGeo, mat, positions };
}

// ── Corals ──

const CORAL_RADIUS = 1500;
const CORAL_SPACING = 8;
const CORAL_MAX = 2000;

interface EchoRingData {
	mesh: THREE.Mesh;
	active: boolean;
	timer: number;
}

interface EchoBurst {
	x: number; y: number; z: number;
	remaining: number;
	delay: number;
	timer: number;
}

interface AudioState {
	ctx: AudioContext;
	masterGain: GainNode;
	/** Hintergrund-Atmo (immer leise) */
	bgGain: GainNode;
	bgSrc: AudioBufferSourceNode;
	/** Flachwasser-Atmo (crossfade near surface Y=75) */
	surfaceGain: GainNode;
	surfaceSrc: AudioBufferSourceNode | null;
	surfaceBlend: number;
	/** Stadt-Atmo (crossfade near city) */
	cityGain: GainNode;
	citySrc: AudioBufferSourceNode | null;
	cityBlend: number;
	/** Echo-Ping Sound (deaktiviert) */
	pingBuffer: AudioBuffer | null;
	echoGain: GainNode | null;
	/** Bewegung auf Space */
	moveBuffer: AudioBuffer | null;
	wasSpace: boolean;
}

// ── Kelp / Seefauna ──

const KELP_RADIUS = 1500;
const KELP_SPACING = 8;
const KELP_MAX = 2000;

function createCoralGeometry(): THREE.BufferGeometry {
	const geo = new THREE.IcosahedronGeometry(0.8, 3);
	const pos = geo.attributes.position;
	for (let i = 0; i < pos.count; i++) {
		let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
		const len = Math.sqrt(x * x + y * y + z * z);
		const nx = x / len, ny = y / len, nz = z / len;
		const n1 = Math.sin(x * 6 + y * 7 + z * 5) * 0.35;
		const n2 = Math.sin(x * 13 + y * 15 + z * 10) * 0.2;
		const n3 = Math.sin(x * 3 - y * 4 + z * 8 + 1.5) * 0.25;
		const n4 = Math.sin(x * 20 + y * 18 + z * 22) * 0.1;
		const r = 1 + n1 + n2 + n3 + n4;
		x = nx * r * 0.8;
		y = ny * r * 0.8;
		z = nz * r * 0.8;
		if (ny < -0.3) {
			const t = Math.min(1, (ny + 0.3) / 0.35);
			y = y * (1 - t) + (-0.7) * t;
		}
		pos.setXYZ(i, x, y, z);
	}
	pos.needsUpdate = true;
	geo.computeVertexNormals();
	return geo;
}

function createCoralFieldData(): { positions: Float32Array; colors: Float32Array; gxs: Int32Array; gzs: Int32Array } {
	const positions = new Float32Array(CORAL_MAX * 2);
	const colors = new Float32Array(CORAL_MAX * 3);
	const gxs = new Int32Array(CORAL_MAX);
	const gzs = new Int32Array(CORAL_MAX);
	const coralPalette = [0xff6644, 0xdd8855, 0xdd77aa, 0xcc8866, 0xff9966, 0xee7766];
	const tmpCol = new THREE.Color();
	const half = Math.floor(CORAL_RADIUS / CORAL_SPACING);
	let idx = 0;

	for (let cellIdx = 0; cellIdx < (half * 2 + 1) ** 2 && idx < CORAL_MAX; cellIdx++) {
		const hx = hash2d(cellIdx * 7 + 1, cellIdx * 13 + 3);
		const hz = hash2d(cellIdx * 11 + 5, cellIdx * 17 + 7);
		const gx = Math.floor(hx * (half * 2 + 1)) - half;
		const gz = Math.floor(hz * (half * 2 + 1)) - half;
		const wx = gx * CORAL_SPACING + (hash2d(gx + 100, gz + 200) - 0.5) * 3;
		const wz = gz * CORAL_SPACING + (hash2d(gx + 300, gz + 400) - 0.5) * 3;
		const biome = getBiome(wx, wz);
		if (biome >= 0.55) continue;

		const ci = Math.floor(hash2d(gx + 7, gz + 13) * coralPalette.length);
		tmpCol.setHex(coralPalette[ci]);
		colors[idx * 3] = tmpCol.r;
		colors[idx * 3 + 1] = tmpCol.g;
		colors[idx * 3 + 2] = tmpCol.b;

		positions[idx * 2] = wx;
		positions[idx * 2 + 1] = wz;
		gxs[idx] = gx;
		gzs[idx] = gz;
		idx++;
	}

	return { positions, colors, gxs, gzs };
}

// ── Kelp / Seefauna ──

function createKelpGeometry(): THREE.BufferGeometry {
	const shape = new THREE.Shape();
	const s = 0.06;
	const l = 0.35;
	const h = 2.5;

	shape.moveTo(0, 0);
	shape.lineTo(-s, 0.2);
	shape.lineTo(-l * 0.9, 0.4);
	shape.lineTo(-s * 0.8, 0.35);
	shape.lineTo(-s, 0.7);
	shape.lineTo(-l * 1.1, 0.9);
	shape.lineTo(-s * 0.8, 0.85);
	shape.lineTo(-s * 0.9, 1.2);
	shape.lineTo(-l, 1.4);
	shape.lineTo(-s * 0.7, 1.35);
	shape.lineTo(-s * 0.7, 1.7);
	shape.lineTo(-l * 0.8, 1.9);
	shape.lineTo(-s * 0.5, 1.85);
	shape.lineTo(-s * 0.3, 2.2);
	shape.lineTo(-l * 0.4, 2.35);
	shape.lineTo(0, h);

	shape.lineTo(l * 0.4, 2.35);
	shape.lineTo(s * 0.3, 2.2);
	shape.lineTo(s * 0.5, 1.85);
	shape.lineTo(l * 0.8, 1.9);
	shape.lineTo(s * 0.7, 1.7);
	shape.lineTo(s * 0.7, 1.35);
	shape.lineTo(l, 1.4);
	shape.lineTo(s * 0.9, 1.2);
	shape.lineTo(s * 0.8, 0.85);
	shape.lineTo(l * 1.1, 0.9);
	shape.lineTo(s, 0.7);
	shape.lineTo(s * 0.8, 0.35);
	shape.lineTo(l * 0.9, 0.4);
	shape.lineTo(s, 0.2);
	shape.closePath();

	const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.08, bevelEnabled: false });
	geo.translate(0, 0, -0.04);
	geo.computeVertexNormals();
	return geo;
}

function createKelpFieldData(): { positions: Float32Array; heights: Float32Array; scales: Float32Array; rotations: Float32Array } {
	const positions = new Float32Array(KELP_MAX * 2);
	const heights = new Float32Array(KELP_MAX);
	const scales = new Float32Array(KELP_MAX);
	const rotations = new Float32Array(KELP_MAX);

	const half = Math.floor(KELP_RADIUS / KELP_SPACING);
	let idx = 0;

	for (let cellIdx = 0; cellIdx < (half * 2 + 1) ** 2 && idx < KELP_MAX; cellIdx++) {
		const hx = hash2d(cellIdx * 3 + 1, cellIdx * 7 + 3);
		const hz = hash2d(cellIdx * 5 + 2, cellIdx * 11 + 4);
		const gx = Math.floor(hx * (half * 2 + 1)) - half;
		const gz = Math.floor(hz * (half * 2 + 1)) - half;
		const wx = gx * KELP_SPACING + (hash2d(gx * 7, gz * 11) - 0.5) * KELP_SPACING * 0.7;
		const wz = gz * KELP_SPACING + (hash2d(gx * 13, gz * 17) - 0.5) * KELP_SPACING * 0.7;
		const biome = getBiome(wx, wz);

		let density = 0;
		let scaleMin = 0.5;
		let scaleMax = 1.0;
		if (biome < 0.55) { density = 0.25; scaleMin = 1.5; scaleMax = 3.5; }
		else if (biome < 0.75) { density = 0.40; scaleMin = 2.0; scaleMax = 4.5; }
		else { density = 0.08; scaleMin = 0.8; scaleMax = 1.5; }

		if (hash2d(gx * 2, gz * 3) > density) continue;

		const size = scaleMin + hash2d(gx + 3, gz + 5) * (scaleMax - scaleMin);
		const baseRot = hash2d(gx + 19, gz + 23) * Math.PI * 2;

		positions[idx * 2] = wx;
		positions[idx * 2 + 1] = wz;
		scales[idx] = size;
		rotations[idx] = baseRot;
		idx++;
	}

	return { positions, heights, scales, rotations };
}


const JELLY_COUNT = 10;

interface JellyfishHerd {
	mesh: THREE.InstancedMesh;
	mat: THREE.MeshPhysicalMaterial;
	positions: Float32Array;
	phases: Float32Array;
	scales: Float32Array;
	basePositions: Float32Array;
	bellVertexCount: number;
}



function createJellyfishGeometry(): THREE.BufferGeometry {
	const bell = new THREE.SphereGeometry(0.5, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
	const bellPos = bell.attributes.position;
	for (let i = 0; i < bellPos.count; i++) {
		const y = bellPos.getY(i);
		bellPos.setY(i, y * 0.7);
	}
	bellPos.needsUpdate = true;
	bell.computeVertexNormals();

	const tentacleGeos: THREE.BufferGeometry[] = [];
	for (let i = 0; i < 8; i++) {
		const angle = (i / 8) * Math.PI * 2;
		const r = 0.35 + Math.sin(i * 2.7) * 0.1;
		const tx = Math.cos(angle) * r;
		const tz = Math.sin(angle) * r;
		const tent = new THREE.CylinderGeometry(0.01, 0.025, 1.0 + Math.sin(i * 1.3) * 0.3, 4, 3);
		tent.translate(tx, -0.4 - Math.sin(i * 0.7) * 0.1, tz);
		tent.computeVertexNormals();
		tentacleGeos.push(tent);
	}

	return mergeGeometries([bell, ...tentacleGeos]);
}

function createJellyfishHerd(scene: THREE.Scene): JellyfishHerd {
	const geo = createJellyfishGeometry();
	const posAttr = geo.attributes.position as THREE.BufferAttribute;
	const basePositions = new Float32Array(posAttr.array);
	const bellVertexCount = (12 + 1) * (8 / 2 + 1); // SphereGeometry(0.5, 12, 8, 0, 2PI, 0, PI/2)
	const mat = new THREE.MeshPhysicalMaterial({
		color: 0x88ddff,
		emissive: 0x44ddff,
		emissiveIntensity: 0.9,
		transparent: true,
		opacity: 0.8,
		roughness: 0.05,
		metalness: 0.0,
		clearcoat: 0.8,
		side: THREE.DoubleSide,
	});
	const mesh = new THREE.InstancedMesh(geo, mat, JELLY_COUNT);
	mesh.frustumCulled = true;
	scene.add(mesh);

	const positions = new Float32Array(JELLY_COUNT * 3);
	const phases = new Float32Array(JELLY_COUNT);
	const scales = new Float32Array(JELLY_COUNT);

	const dummy = new THREE.Object3D();
	for (let i = 0; i < JELLY_COUNT; i++) {
		const angle = Math.random() * Math.PI * 2;
		const dist = 10 + Math.random() * 80;
		positions[i * 3] = Math.cos(angle) * dist;
		positions[i * 3 + 1] = 5 + Math.random() * 25;
		positions[i * 3 + 2] = Math.sin(angle) * dist;
		phases[i] = Math.random() * Math.PI * 2;
		scales[i] = 0.6 + Math.random() * 0.8;
		dummy.position.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
		dummy.scale.setScalar(scales[i]);
		dummy.updateMatrix();
		mesh.setMatrixAt(i, dummy.matrix);
	}
	mesh.instanceMatrix.needsUpdate = true;

	return { mesh, mat, positions, phases, scales, basePositions, bellVertexCount };
}

function updateJellyfishHerd(herd: JellyfishHerd, elapsed: number, playerPos: THREE.Vector3): void {
	// ── Geometrie-Pulsieren (Glocke rundet sich) ──
	const pulse = 0.5 + Math.sin(elapsed * 2) * 0.5;
	const posAttr = herd.mesh.geometry.attributes.position as THREE.BufferAttribute;
	const arr = posAttr.array as Float32Array;
	const base = herd.basePositions;
	const bellEnd = herd.bellVertexCount * 3;
	const yMax = 0.35;
	for (let i = 0; i < bellEnd; i += 3) {
		const infl = Math.max(0, base[i + 1] / yMax);
		const yFactor = 1 + pulse * 0.35 * infl;
		const xzFactor = 1 + pulse * 0.1 * infl;
		arr[i] = base[i] * xzFactor;
		arr[i + 1] = base[i + 1] * yFactor;
		arr[i + 2] = base[i + 2] * xzFactor;
	}
	for (let i = bellEnd; i < arr.length; i++) {
		arr[i] = base[i];
	}
	posAttr.needsUpdate = true;
	herd.mesh.geometry.computeVertexNormals();

	// ── Instanz-Position / Drift ──
	for (let i = 0; i < JELLY_COUNT; i++) {
		const i3 = i * 3;
		const phase = herd.phases[i];
		const bob = Math.sin(elapsed * 0.4 + phase) * 1.5;
		const driftX = Math.sin(elapsed * 0.1 + phase * 0.5) * 2;
		const driftZ = Math.cos(elapsed * 0.1 + phase * 0.7) * 2;

		herd.positions[i3] += driftX * 0.01;
		herd.positions[i3 + 2] += driftZ * 0.01;
		const dx = herd.positions[i3] - playerPos.x;
		const dz = herd.positions[i3 + 2] - playerPos.z;
		const dist = Math.sqrt(dx * dx + dz * dz);
		if (dist > 100) {
			herd.positions[i3] = playerPos.x + (dx / dist) * 60;
			herd.positions[i3 + 2] = playerPos.z + (dz / dist) * 60;
		}
		_dummy.position.set(herd.positions[i3], herd.positions[i3 + 1] + bob, herd.positions[i3 + 2]);
		_dummy.scale.setScalar(herd.scales[i]);
		const sway = Math.sin(elapsed * 0.6 + phase * 1.1) * 0.15;
		_dummy.rotation.y = Math.atan2(driftZ * 0.01, driftX * 0.01) + sway;
		_dummy.rotation.x = Math.sin(elapsed * 0.3 + phase) * 0.1;
		_dummy.updateMatrix();
		herd.mesh.setMatrixAt(i, _dummy.matrix);
	}
	herd.mesh.instanceMatrix.needsUpdate = true;
	herd.mat.emissiveIntensity = 0.6 + Math.sin(elapsed * 0.4) * 0.4;
}

// ── Large Fish (Sharks / Dolphins) ──

const SHARK_COUNT = 3;
const DOLPHIN_COUNT = 2;

interface LargeFish {
	mesh: THREE.Mesh;
	velocity: THREE.Vector3;
	turnTimer: number;
	minY: number;
	maxY: number;
}

function createSharkGeometry(): THREE.BufferGeometry {
	const body = new THREE.CylinderGeometry(0.35, 0.12, 2.6, 8, 4);
	const bPos = body.attributes.position;
	for (let i = 0; i < bPos.count; i++) {
		bPos.setX(i, bPos.getX(i) * 1.2);
		bPos.setY(i, bPos.getY(i) * 0.55);
	}
	bPos.needsUpdate = true;
	body.computeVertexNormals();
	body.rotateX(Math.PI / 2);

	const snout = new THREE.ConeGeometry(0.1, 0.4, 6);
	snout.rotateX(-Math.PI / 2);
	snout.translate(0, 0, -1.55);

	const dorsalFin = new THREE.ConeGeometry(0.28, 0.4, 3);
	const dPos = dorsalFin.attributes.position;
	for (let i = 0; i < dPos.count; i++) dPos.setZ(i, dPos.getZ(i) * 0.08);
	dPos.needsUpdate = true;
	dorsalFin.computeVertexNormals();
	dorsalFin.translate(0, 0.28, -0.3);

	const tailFin = new THREE.ConeGeometry(0.35, 0.5, 3);
	tailFin.rotateX(Math.PI / 2);
	const tPos = tailFin.attributes.position;
	for (let i = 0; i < tPos.count; i++) tPos.setZ(i, tPos.getZ(i) * 0.12);
	tPos.needsUpdate = true;
	tailFin.computeVertexNormals();
	tailFin.translate(0, 0, 1.35);

	const pFin = new THREE.ConeGeometry(0.2, 0.2, 3);
	const pPos = pFin.attributes.position;
	for (let i = 0; i < pPos.count; i++) pPos.setZ(i, pPos.getZ(i) * 0.05);
	pPos.needsUpdate = true;
	pFin.computeVertexNormals();
	const pFinL = pFin.clone(); pFinL.rotateZ(0.4); pFinL.translate(-0.28, -0.05, -0.5);
	const pFinR = pFin.clone(); pFinR.rotateZ(-0.4); pFinR.translate(0.28, -0.05, -0.5);

	return mergeGeometries([body, snout, dorsalFin, tailFin, pFinL, pFinR]);
}

function createDolphinGeometry(): THREE.BufferGeometry {
	const body = new THREE.CylinderGeometry(0.28, 0.1, 2.4, 8, 4);
	const bPos = body.attributes.position;
	for (let i = 0; i < bPos.count; i++) {
		const x = bPos.getX(i), y = bPos.getY(i);
		const t = (y + 1.2) / 2.4;
		const bend = Math.sin(t * Math.PI * 0.6) * 0.12;
		bPos.setX(i, x * 0.9 + bend);
		bPos.setY(i, y * 0.5);
	}
	bPos.needsUpdate = true;
	body.computeVertexNormals();
	body.rotateX(Math.PI / 2);

	const melon = new THREE.SphereGeometry(0.15, 6, 4);
	melon.scale(1, 0.6, 0.7);
	melon.translate(0, 0.04, -1.25);

	const beak = new THREE.ConeGeometry(0.08, 0.35, 5);
	beak.rotateX(-Math.PI / 2);
	beak.translate(0, 0.02, -1.55);

	const dorsal = new THREE.ConeGeometry(0.2, 0.3, 3);
	const dPos = dorsal.attributes.position;
	for (let i = 0; i < dPos.count; i++) dPos.setZ(i, dPos.getZ(i) * 0.06);
	dPos.needsUpdate = true;
	dorsal.computeVertexNormals();
	dorsal.rotateX(-0.2);
	dorsal.translate(0.02, 0.25, -0.2);

	const fluke = new THREE.ConeGeometry(0.35, 0.4, 3);
	fluke.rotateX(Math.PI / 2);
	const fPos = fluke.attributes.position;
	for (let i = 0; i < fPos.count; i++) fPos.setZ(i, fPos.getZ(i) * 0.1);
	fPos.needsUpdate = true;
	fluke.computeVertexNormals();
	fluke.translate(0, 0, 1.3);

	const pFin = new THREE.ConeGeometry(0.18, 0.16, 3);
	const pPos = pFin.attributes.position;
	for (let i = 0; i < pPos.count; i++) pPos.setZ(i, pPos.getZ(i) * 0.04);
	pPos.needsUpdate = true;
	pFin.computeVertexNormals();
	pFin.rotateZ(0.3);
	const pFinL = pFin.clone(); pFinL.translate(-0.22, -0.04, -0.4);
	const pFinR = pFin.clone(); pFinR.rotateZ(-0.6); pFinR.translate(0.22, -0.04, -0.4);

	return mergeGeometries([body, melon, beak, dorsal, fluke, pFinL, pFinR]);
}

function createLargeFish(
	geo: THREE.BufferGeometry,
	mat: THREE.MeshStandardMaterial,
	playerPos: THREE.Vector3,
): LargeFish {
	const mesh = new THREE.Mesh(geo, mat);
	mesh.castShadow = true;

	const angle = Math.random() * Math.PI * 2;
	const dist = 30 + Math.random() * 60;
	mesh.position.set(
		playerPos.x + Math.cos(angle) * dist,
		8 + Math.random() * 20,
		playerPos.z + Math.sin(angle) * dist,
	);

	const vel = new THREE.Vector3(
		(Math.random() - 0.5) * 2,
		(Math.random() - 0.5) * 0.3,
		(Math.random() - 0.5) * 2,
	);

	return {
		mesh,
		velocity: vel,
		turnTimer: Math.random() * 5,
		minY: 3,
		maxY: 30,
	};
}

function updateLargeFish(
	fish: LargeFish,
	delta: number,
	elapsed: number,
	playerPos: THREE.Vector3,
): void {
	fish.turnTimer -= delta;
	if (fish.turnTimer <= 0) {
		const dx = playerPos.x - fish.mesh.position.x;
		const dz = playerPos.z - fish.mesh.position.z;
		const toPlayer = Math.sqrt(dx * dx + dz * dz);
		if (toPlayer > 50) {
			fish.velocity.x += (dx / toPlayer) * delta * 0.5;
			fish.velocity.z += (dz / toPlayer) * delta * 0.5;
		} else {
			fish.velocity.x += (Math.random() - 0.5) * delta * 2;
			fish.velocity.z += (Math.random() - 0.5) * delta * 2;
		}

		if (fish.mesh.position.y > fish.maxY) fish.velocity.y -= delta * 0.3;
		else if (fish.mesh.position.y < fish.minY) fish.velocity.y += delta * 0.3;
		else fish.velocity.y += (Math.random() - 0.5) * delta * 0.2;

		const maxSpeed = 3 + (fish.mesh.material as THREE.MeshStandardMaterial).color.getHex() === 0x88aacc ? 4 : 3;
		const spd = Math.sqrt(
			fish.velocity.x * fish.velocity.x + fish.velocity.z * fish.velocity.z,
		);
		if (spd > maxSpeed) {
			fish.velocity.x = (fish.velocity.x / spd) * maxSpeed;
			fish.velocity.z = (fish.velocity.z / spd) * maxSpeed;
		}
		fish.velocity.y = Math.max(-1, Math.min(1, fish.velocity.y));
		fish.turnTimer = 2 + Math.random() * 3;
	}

	fish.mesh.position.x += fish.velocity.x * delta;
	fish.mesh.position.y += fish.velocity.y * delta;
	fish.mesh.position.z += fish.velocity.z * delta;

	fish.mesh.position.y = Math.max(fish.minY, Math.min(fish.maxY, fish.mesh.position.y));

	_lookTarget.set(
		fish.mesh.position.x + fish.velocity.x,
		fish.mesh.position.y + fish.velocity.y,
		fish.mesh.position.z + fish.velocity.z,
	);
	fish.mesh.lookAt(_lookTarget);
	fish.mesh.rotation.z = Math.sin(elapsed * 0.3 + fish.turnTimer) * 0.1;
}

function updateDolphin(dolphin: LargeFish, delta: number, elapsed: number, playerPos: THREE.Vector3, terrainAmp: number, terrainScale: number): void {
	const maxSpeed = 18;

	dolphin.velocity.x += Math.sin(elapsed * 1.1) * delta * 0.5;
	dolphin.velocity.z += Math.cos(elapsed * 0.9) * delta * 0.5;

	const dx = playerPos.x - dolphin.mesh.position.x;
	const dz = playerPos.z - dolphin.mesh.position.z;
	const toPlayer = Math.sqrt(dx * dx + dz * dz);
	if (toPlayer < 8) {
		// Leicht wegdrücken wenn Spieler zu nah
		dolphin.velocity.x -= (dx / toPlayer) * delta * 2;
		dolphin.velocity.z -= (dz / toPlayer) * delta * 2;
	}

	const targetY = 10 + Math.sin(elapsed * 1.8) * 0.8;
	dolphin.velocity.y += (targetY - dolphin.mesh.position.y) * delta * 0.6;
	dolphin.velocity.y += Math.sin(elapsed * 3.5) * delta * 0.3;

	const spd = Math.sqrt(dolphin.velocity.x * dolphin.velocity.x + dolphin.velocity.z * dolphin.velocity.z);
	if (spd > maxSpeed) {
		dolphin.velocity.x = (dolphin.velocity.x / spd) * maxSpeed;
		dolphin.velocity.z = (dolphin.velocity.z / spd) * maxSpeed;
	}
	dolphin.velocity.y = Math.max(-0.8, Math.min(0.8, dolphin.velocity.y));

	dolphin.mesh.position.x += dolphin.velocity.x * delta;
	dolphin.mesh.position.y += dolphin.velocity.y * delta;
	dolphin.mesh.position.z += dolphin.velocity.z * delta;

	const terrainY = getTerrainHeight(dolphin.mesh.position.x, dolphin.mesh.position.z, terrainAmp, terrainScale);
	dolphin.mesh.position.y = Math.max(terrainY + 1.5, Math.min(25, dolphin.mesh.position.y));

	// Lokaler Flossenschlag (Modell-Oszillation)
	const swim = elapsed * 4.2;
	dolphin.mesh.position.y += Math.sin(swim) * 0.2;

	const dist = Math.sqrt(
		(playerPos.x - dolphin.mesh.position.x) ** 2 + (playerPos.z - dolphin.mesh.position.z) ** 2,
	);
	if (dist > 250) {
		const angle = Math.random() * Math.PI * 2;
		dolphin.mesh.position.set(
			playerPos.x + Math.cos(angle) * 40,
			8 + Math.random() * 10,
			playerPos.z + Math.sin(angle) * 40,
		);
		dolphin.velocity.set((Math.random() - 0.5) * 4, (Math.random() - 0.5) * 1, (Math.random() - 0.5) * 4);
	}

	const vx = dolphin.velocity.x;
	const vy = dolphin.velocity.y;
	const vz = dolphin.velocity.z;
	const speed = Math.sqrt(vx * vx + vz * vz);

	dolphin.mesh.rotation.order = "YXZ";
	dolphin.mesh.rotation.y = Math.atan2(vx, vz);
	dolphin.mesh.rotation.x = Math.atan2(vy, speed) * 0.3;
	dolphin.mesh.rotation.z = Math.sin(swim + 0.5) * 0.05;
}

function isTerrainFlat(wx: number, wz: number, baseAmp: number, baseScale: number, radius: number, maxDiff: number): boolean {
	const _samples = 8;
	let minY = Infinity, maxY = -Infinity;
	for (let i = 0; i < _samples; i++) {
		const angle = (i / _samples) * Math.PI * 2;
		const h = getTerrainHeight(wx + Math.cos(angle) * radius, wz + Math.sin(angle) * radius, baseAmp, baseScale);
		if (h < minY) minY = h;
		if (h > maxY) maxY = h;
	}
	return maxY - minY <= maxDiff;
}

// ── City ──

const CITY_GRID = 180;
const CITY_DOME_RADIUS = 65;
const CITY_Y_OFFSET = 8;

interface CityInstance {
	group: THREE.Group;
	structureGroup: THREE.Group;
	worldX: number;
	worldZ: number;
	active: boolean;
	domeMat?: THREE.MeshPhysicalMaterial;
	glowHalo: THREE.Mesh;
	glowHaloMat: THREE.MeshBasicMaterial;
	pointLight: THREE.PointLight;
	modelVariants: (THREE.Group | null)[];
	currentVariant: number;
}

function prepareCityModel(modelGroup: THREE.Group): void {
	modelGroup.scale.setScalar(0.5);
	modelGroup.position.y = 0;
	modelGroup.traverse((child) => {
		if (child instanceof THREE.Mesh) {
			if (child.name === "pPlane1") {
				child.visible = false;
				return;
			}
			child.receiveShadow = true;
			child.castShadow = true;
			const mat = child.material;
			if (child.name === "Dome") {
				if (mat) {
					(mat as THREE.MeshStandardMaterial).transparent = true;
					(mat as THREE.MeshStandardMaterial).opacity = 0.25;
					(mat as THREE.MeshStandardMaterial).roughness = 0.05;
					(mat as THREE.MeshStandardMaterial).metalness = 0.0;
				}
				return;
			}
			if (mat && "emissive" in mat) {
				(mat as THREE.MeshStandardMaterial).emissive = new THREE.Color(0x445522);
				(mat as THREE.MeshStandardMaterial).emissiveIntensity = 0.4;
			}
		}
	});
}

function setCityVariant(city: CityInstance, index: number): void {
	while (city.structureGroup.children.length > 0) {
		const child = city.structureGroup.children[0];
		if (child instanceof THREE.Mesh) {
			child.geometry?.dispose();
			if (child.material instanceof THREE.Material) child.material.dispose();
		}
		city.structureGroup.remove(child);
	}

	city.currentVariant = index;
	city.domeMat = undefined;

	if (index >= 0 && index < city.modelVariants.length && city.modelVariants[index]) {
		const variant = city.modelVariants[index]!.clone();
		prepareCityModel(variant);
		city.structureGroup.add(variant);
	} else {
		city.domeMat = addProceduralCity(city.structureGroup);
	}
}

function addProceduralCity(parent: THREE.Group): THREE.MeshPhysicalMaterial | undefined {
	const domeMat = new THREE.MeshPhysicalMaterial({
		color: 0x88ccff,
		emissive: 0x664422,
		emissiveIntensity: 0.15,
		transparent: true,
		opacity: 0.4,
		roughness: 0.05,
		metalness: 0.0,
		side: THREE.DoubleSide,
		envMapIntensity: 0.3,
		clearcoat: 0.8,
	});
	const dome = new THREE.Mesh(new THREE.SphereGeometry(CITY_DOME_RADIUS, 32, 24, 0, Math.PI * 2, 0, Math.PI / 2), domeMat);
	dome.receiveShadow = false;
	dome.castShadow = false;
	parent.add(dome);

	// ── Buildings: InstancedMesh (1 draw call) ──
	const bldgMat = new THREE.MeshStandardMaterial({
		color: 0x6a8a7a,
		emissive: 0x445522,
		emissiveIntensity: 0.7,
		flatShading: true,
	});
	const unitBox = new THREE.BoxGeometry(1, 1, 1);
	const bldgMesh = new THREE.InstancedMesh(unitBox, bldgMat, 80);
	bldgMesh.castShadow = false;
	bldgMesh.receiveShadow = false;
	bldgMesh.frustumCulled = true;

	// ── Windows: Merged BufferGeometry (1 draw call) ──
	const windowMat = new THREE.MeshBasicMaterial({ color: 0xffee88 });
	const windowGeos: THREE.BufferGeometry[] = [];
	const _mat4 = new THREE.Matrix4();
	const _pos = new THREE.Vector3();
	const _quat = new THREE.Quaternion();
	const _scale = new THREE.Vector3(1, 1, 1);

	for (let i = 0; i < 80; i++) {
		const w = 4 + Math.random() * 7;
		const d = 4 + Math.random() * 7;
		const h = 12 + Math.random() * 52;
		const angle = Math.random() * Math.PI * 2;
		const dist = 3 + Math.random() * (CITY_DOME_RADIUS - 5);
		const bx = Math.cos(angle) * dist;
		const bz = Math.sin(angle) * dist;
		_dummy.position.set(bx, h / 2, bz);
		_dummy.rotation.y = Math.random() * Math.PI * 2;
		_dummy.scale.set(w, h, d);
		_dummy.updateMatrix();
		bldgMesh.setMatrixAt(i, _dummy.matrix);

		const cols = 2 + Math.floor(Math.random() * 2);
		const rows = Math.max(2, Math.floor(h / 4));
		const winSize = 0.3 + Math.random() * 0.3;
		for (let ri = 0; ri < rows; ri++) {
			for (let ci = 0; ci < cols; ci++) {
				const wy = (ri + 0.5) * (h / rows);
				const wo = 0.02;
				const wc = (ci - (cols - 1) / 2) * 0.7;
				const face = ri % 4;
				let wx2 = 0, wz2 = 0, wry = 0;
				if (face === 0) { wx2 = w / 2 + wo; wz2 = wc * d * 0.3; wry = Math.PI / 2; }
				else if (face === 1) { wx2 = -w / 2 - wo; wz2 = wc * d * 0.3; wry = -Math.PI / 2; }
				else if (face === 2) { wx2 = wc * w * 0.3; wz2 = d / 2 + wo; }
				else { wx2 = wc * w * 0.3; wz2 = -d / 2 - wo; }
				// Window in world space
				const cosA = Math.cos(angle), sinA = Math.sin(angle);
				_pos.set(bx + wx2 * cosA - wz2 * sinA, wy, bz + wx2 * sinA + wz2 * cosA);
				_quat.setFromEuler(new THREE.Euler(0, angle + wry, 0));
				_mat4.compose(_pos, _quat, _scale);
				const winGeo = new THREE.PlaneGeometry(winSize, winSize);
				winGeo.applyMatrix4(_mat4);
				windowGeos.push(winGeo);
			}
		}
	}
	bldgMesh.instanceMatrix.needsUpdate = true;
	parent.add(bldgMesh);

	const mergedWinGeo = mergeGeometries(windowGeos);
	const windowMesh = new THREE.Mesh(mergedWinGeo, windowMat);
	parent.add(windowMesh);

	return domeMat;
}

function createCityGroup(variants: (THREE.Group | null)[]): CityInstance {
	const group = new THREE.Group();
	const structureGroup = new THREE.Group();
	group.add(structureGroup);

	// ── Base platform ──
	const baseGeo = new THREE.CylinderGeometry(CITY_DOME_RADIUS + 2, CITY_DOME_RADIUS + 4, 1.5, 32);
	const baseMat = new THREE.MeshStandardMaterial({ color: 0x2a3a4a, flatShading: true });
	const base = new THREE.Mesh(baseGeo, baseMat);
	base.position.y = -0.75;
	base.receiveShadow = true;
	group.add(base);

	// ── Point Light ──
	const pointLight = new THREE.PointLight(0xffcc44, 8, 800);
	pointLight.position.set(0, 30, 0);
	group.add(pointLight);

	// ── Glow Halo ──
	const glowHaloMat = new THREE.MeshBasicMaterial({
		color: 0xffcc44,
		transparent: true,
		opacity: 0.15,
		blending: THREE.AdditiveBlending,
		depthWrite: false,
		side: THREE.BackSide,
	});
	const glowHalo = new THREE.Mesh(new THREE.SphereGeometry(110, 48, 30), glowHaloMat);
	glowHalo.renderOrder = -1;
	group.add(glowHalo);

	const instance: CityInstance = {
		group,
		structureGroup,
		worldX: 0,
		worldZ: 0,
		active: false,
		domeMat: undefined,
		glowHalo,
		glowHaloMat,
		pointLight,
		modelVariants: variants,
		currentVariant: -1,
	};

	// Start with procedural fallback, then replace if variant available
	addProceduralCity(structureGroup);
	const firstModelIdx = variants.findIndex((v) => v !== null);
	if (firstModelIdx >= 0) setCityVariant(instance, firstModelIdx);

	group.visible = false;
	return instance;
}

function findNearestCity(playerX: number, playerZ: number, range = 1, baseAmp?: number, baseScale?: number, minDistSq = 0): { x: number; z: number } | null {
	const gx = Math.round(playerX / CITY_GRID);
	const gz = Math.round(playerZ / CITY_GRID);
	for (let dx = -range; dx <= range; dx++) {
		for (let dz = -range; dz <= range; dz++) {
			const cx = (gx + dx) * CITY_GRID;
			const cz = (gz + dz) * CITY_GRID;
			const dSq = (cx - playerX) * (cx - playerX) + (cz - playerZ) * (cz - playerZ);
			if (dSq < minDistSq) continue;
			const biome = getBiome(cx, cz);
			if (biome >= 0.65 && hash2d(gx + dx + 50, gz + dz + 50) > 0.35) {
				if (baseAmp !== undefined && baseScale !== undefined) {
					if (!isTerrainFlat(cx, cz, baseAmp, baseScale, 40, 4)) continue;
				}
				return { x: cx, z: cz };
			}
		}
	}
	return null;
}

function updateCity(
	city: CityInstance,
	playerX: number,
	playerZ: number,
	baseAmp: number,
	baseScale: number,
	elapsed: number,
): void {
	const dx = playerX - city.worldX;
	const dz = playerZ - city.worldZ;
	const distSq = dx * dx + dz * dz;

	if (city.active) {
		if (distSq > 490000) {
			// >700m: deaktivieren
			city.group.visible = false;
			city.active = false;
			return;
		}
		const h = getTerrainHeight(city.worldX, city.worldZ, baseAmp, baseScale) + CITY_Y_OFFSET;
		city.group.position.set(city.worldX, h, city.worldZ);
		const pulse = 0.4 + Math.sin(elapsed * 0.3) * 0.08;
		if (city.domeMat) city.domeMat.opacity = pulse;
		city.glowHaloMat.opacity = 0.10 + Math.sin(elapsed * 0.25) * 0.05;
		const haloScale = 1 + Math.sin(elapsed * 0.2) * 0.10;
		city.glowHalo.scale.set(haloScale, haloScale, haloScale);
		city.pointLight.intensity = 6 + Math.sin(elapsed * 0.3) * 2;
		return;
	}

	// Keine Stadt bekannt → neue suchen
	if (city.worldX === 0 && city.worldZ === 0) {
		const target = findNearestCity(playerX, playerZ, 3, baseAmp, baseScale);
		if (target) {
			city.worldX = target.x;
			city.worldZ = target.z;
		}
	}

	const ddx = playerX - city.worldX;
	const ddz = playerZ - city.worldZ;
	const dSq = ddx * ddx + ddz * ddz;

	if (dSq > 0 && dSq < 360000) {
		// <600m: aktivieren
		const h = getTerrainHeight(city.worldX, city.worldZ, baseAmp, baseScale) + CITY_Y_OFFSET;
		city.group.position.set(city.worldX, h, city.worldZ);
		const loadedCount = city.modelVariants.filter((v) => v !== null).length;
		if (loadedCount > 0) {
			const newIdx = Math.floor(Math.random() * city.modelVariants.length);
			setCityVariant(city, newIdx);
		}
		city.active = true;
		city.group.visible = true;
		const pulse = 0.4 + Math.sin(elapsed * 0.3) * 0.08;
		if (city.domeMat) city.domeMat.opacity = pulse;
		city.glowHaloMat.opacity = 0.10 + Math.sin(elapsed * 0.25) * 0.05;
		const haloScale = 1 + Math.sin(elapsed * 0.2) * 0.10;
		city.glowHalo.scale.set(haloScale, haloScale, haloScale);
		city.pointLight.intensity = 6 + Math.sin(elapsed * 0.3) * 2;
		return;
	}

	city.group.visible = false;
}

// ── Fish School ──

interface FishSchool {
	mesh: THREE.InstancedMesh;
	positions: Float32Array;
	velocities: Float32Array;
	phases: Float32Array;
	scales: Float32Array;
}

function createFishGeometry(): THREE.BufferGeometry {
	const shape = new THREE.Shape();
	const s = 0.4;

	shape.moveTo(3.5 * s, 0);
	shape.bezierCurveTo(3.0 * s, 1.0 * s, 2.0 * s, 2.2 * s, 0.5 * s, 2.4 * s);
	shape.bezierCurveTo(-0.5 * s, 2.5 * s, -1.5 * s, 1.8 * s, -2.5 * s, 1.2 * s);
	shape.lineTo(-3.5 * s, 3.0 * s);
	shape.lineTo(-4.0 * s, 1.0 * s);
	shape.lineTo(-4.5 * s, 0);
	shape.lineTo(-4.0 * s, -1.0 * s);
	shape.lineTo(-3.5 * s, -3.0 * s);
	shape.lineTo(-2.5 * s, -1.2 * s);
	shape.bezierCurveTo(-1.5 * s, -1.8 * s, -0.5 * s, -2.5 * s, 0.5 * s, -2.4 * s);
	shape.bezierCurveTo(2.0 * s, -2.2 * s, 3.0 * s, -1.0 * s, 3.5 * s, 0);

	const extrudeSettings: THREE.ExtrudeGeometryOptions = {
		depth: 0.5,
		bevelEnabled: true,
		bevelThickness: 0.15,
		bevelSize: 0.1,
		bevelSegments: 1,
	};

	const geo = new THREE.ExtrudeGeometry(shape, extrudeSettings);
	geo.rotateY(Math.PI / 2);
	geo.translate(0, 0.5, 0);
	return geo;
}

function createFishSchool(count: number, modelGeo?: THREE.BufferGeometry): { school: FishSchool; material: THREE.MeshStandardMaterial } {
	const positions = new Float32Array(count * 3);
	const velocities = new Float32Array(count * 3);
	const phases = new Float32Array(count);

	for (let i = 0; i < count; i++) {
		positions[i * 3] = (Math.random() - 0.5) * 60;
		positions[i * 3 + 1] = (Math.random() - 0.5) * 20;
		positions[i * 3 + 2] = (Math.random() - 0.5) * 60;
		velocities[i * 3] = (Math.random() - 0.5) * 1;
		velocities[i * 3 + 1] = (Math.random() - 0.5) * 0.5;
		velocities[i * 3 + 2] = (Math.random() - 0.5) * 1;
		phases[i] = Math.random() * Math.PI * 2;
	}

	const scales = new Float32Array(count);
	for (let i = 0; i < count; i++) {
		scales[i] = 0.5 + Math.random() * 0.8;
	}

	const geo = modelGeo ?? createFishGeometry();
	const colors = new Float32Array(count * 3);
	const fishColors = [
		[0.0, 1.0, 1.0], [1.0, 0.6, 0.2], [1.0, 0.2, 0.8],
		[0.2, 1.0, 0.6], [1.0, 1.0, 0.2], [0.6, 0.2, 1.0],
		[1.0, 0.4, 0.4], [0.2, 0.8, 1.0],
	];
	for (let i = 0; i < count; i++) {
		const c = fishColors[i % fishColors.length];
		colors[i * 3] = c[0]; colors[i * 3 + 1] = c[1]; colors[i * 3 + 2] = c[2];
	}
	geo.setAttribute("color", new THREE.InstancedBufferAttribute(colors, 3));

	const mat = new THREE.MeshStandardMaterial({
		vertexColors: true,
		flatShading: true,
		roughness: 0.3,
		metalness: 0.1,
		emissive: new THREE.Color(0x00e5ff),
		emissiveIntensity: 0.6,
	});

	const mesh = new THREE.InstancedMesh(geo, mat, count);
	mesh.frustumCulled = true;

	const dummy = new THREE.Object3D();
	for (let i = 0; i < count; i++) {
		dummy.position.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
		dummy.scale.setScalar(scales[i]);
		dummy.rotation.set(0, Math.random() * Math.PI * 2, 0);
		dummy.updateMatrix();
		mesh.setMatrixAt(i, dummy.matrix);
	}
	mesh.instanceMatrix.needsUpdate = true;

	return { school: { mesh, positions, velocities, phases, scales }, material: mat };
}

function updateFishSchool(school: FishSchool, delta: number, elapsed: number, playerPos: THREE.Vector3, terrainAmp: number, terrainScale: number): void {
	const spread = 20;
	const count = school.positions.length / 3;

	let centerX = 0, centerY = 0, centerZ = 0;
	let avgVx = 0, avgVy = 0, avgVz = 0;
	for (let i = 0; i < count; i++) {
		const i3 = i * 3;
		centerX += school.positions[i3];
		centerY += school.positions[i3 + 1];
		centerZ += school.positions[i3 + 2];
		avgVx += school.velocities[i3];
		avgVy += school.velocities[i3 + 1];
		avgVz += school.velocities[i3 + 2];
	}
	centerX /= count; centerY /= count; centerZ /= count;
	const aLen = Math.sqrt(avgVx * avgVx + avgVy * avgVy + avgVz * avgVz);
	if (aLen > 0.01) { avgVx /= aLen; avgVy /= aLen; avgVz /= aLen; }

	for (let i = 0; i < count; i++) {
		const i3 = i * 3;
		const phase = school.phases[i];

		const rx = Math.sin(elapsed * 0.3 + phase) * 0.8;
		const ry = Math.sin(elapsed * 0.5 + phase * 1.5) * 0.4;
		const rz = Math.cos(elapsed * 0.2 + phase) * 0.8;

		const toCX = (centerX - school.positions[i3]) * 0.5;
		const toCY = (centerY - school.positions[i3 + 1]) * 0.5;
		const toCZ = (centerZ - school.positions[i3 + 2]) * 0.5;

		school.velocities[i3] += (rx * 0.4 + toCX * 0.3 + avgVx * 0.2 - school.velocities[i3] * 0.04) * delta;
		school.velocities[i3 + 1] += (ry * 0.4 + toCY * 0.3 + avgVy * 0.2 - school.velocities[i3 + 1] * 0.04) * delta;
		school.velocities[i3 + 2] += (rz * 0.4 + toCZ * 0.3 + avgVz * 0.2 - school.velocities[i3 + 2] * 0.04) * delta;

		school.positions[i3] += school.velocities[i3] * delta;
		school.positions[i3 + 1] += school.velocities[i3 + 1] * delta;
		school.positions[i3 + 2] += school.velocities[i3 + 2] * delta;

		const dx = school.positions[i3] - playerPos.x;
		const dz = school.positions[i3 + 2] - playerPos.z;
		const dist = Math.sqrt(dx * dx + dz * dz);
		if (dist > 200) {
			school.positions[i3] = playerPos.x + (Math.random() - 0.5) * 40;
			school.positions[i3 + 1] = playerPos.y + (Math.random() - 0.5) * 10;
			school.positions[i3 + 2] = playerPos.z + (Math.random() - 0.5) * 40;
			school.velocities[i3] = (Math.random() - 0.5) * 1;
			school.velocities[i3 + 1] = (Math.random() - 0.5) * 0.5;
			school.velocities[i3 + 2] = (Math.random() - 0.5) * 1;
		} else if (dist > spread) {
			school.velocities[i3] -= (dx / dist) * delta * 3;
			school.velocities[i3 + 2] -= (dz / dist) * delta * 3;
		}
		const terrainY = getTerrainHeight(school.positions[i3], school.positions[i3 + 2], terrainAmp, terrainScale);
		school.positions[i3 + 1] = Math.max(terrainY + 1.5, Math.min(25, school.positions[i3 + 1]));

		const vx = school.velocities[i3];
		const vy = school.velocities[i3 + 1];
		const vz = school.velocities[i3 + 2];
		const speed = Math.sqrt(vx * vx + vz * vz);

		_dummy.position.set(school.positions[i3], school.positions[i3 + 1], school.positions[i3 + 2]);
		_dummy.scale.setScalar(school.scales[i]);
		_dummy.rotation.order = "YXZ";
		_dummy.rotation.y = Math.atan2(vx, vz);
		_dummy.rotation.x = Math.atan2(vy, speed) * 0.3;
		_dummy.rotation.z = 0;
		_dummy.updateMatrix();
		school.mesh.setMatrixAt(i, _dummy.matrix);
	}
	school.mesh.instanceMatrix.needsUpdate = true;
}

// ── Particles ──

function createBioluminescentParticles(count: number, spread: number): { points: THREE.Points; material: THREE.PointsMaterial } {
	const positions = new Float32Array(count * 3);
	const sizes = new Float32Array(count);
	const phases = new Float32Array(count);
	const colors = new Float32Array(count * 3);

	for (let i = 0; i < count; i++) {
		positions[i * 3] = (Math.random() - 0.5) * spread;
		positions[i * 3 + 1] = (Math.random() - 0.5) * spread * 0.5;
		positions[i * 3 + 2] = (Math.random() - 0.5) * spread;
		sizes[i] = 0.05 + Math.random() * 0.15;
		phases[i] = Math.random() * Math.PI * 2;
		const t = Math.random();
		if (t < 0.34) {
			colors[i * 3] = 0.0; colors[i * 3 + 1] = 0.9; colors[i * 3 + 2] = 1.0;
		} else if (t < 0.67) {
			colors[i * 3] = 0.0; colors[i * 3 + 1] = 0.7; colors[i * 3 + 2] = 0.85;
		} else {
			colors[i * 3] = 0.4; colors[i * 3 + 1] = 0.0; colors[i * 3 + 2] = 0.8;
		}
	}

	const geo = new THREE.BufferGeometry();
	geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
	geo.setAttribute("size", new THREE.BufferAttribute(sizes, 1));
	geo.setAttribute("phase", new THREE.BufferAttribute(phases, 1));
	geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));

	const mat = new THREE.PointsMaterial({
		size: 0.5,
		transparent: true,
		opacity: 0.8,
		blending: THREE.AdditiveBlending,
		depthWrite: false,
		vertexColors: true,
	});

	return { points: new THREE.Points(geo, mat), material: mat };
}

// ── GLTF-Hilfe ──

function loadModelGeometry(url: string): Promise<THREE.BufferGeometry | undefined> {
	return loadGLTF(url).then((gltf) => {
		const srcMesh = gltf.scene.getObjectByProperty("isMesh", true) as THREE.Mesh | null;
		if (!srcMesh) return undefined;
		const geo = srcMesh.geometry.clone();
		geo.deleteAttribute("JOINTS_0");
		geo.deleteAttribute("WEIGHTS_0");
		geo.deleteAttribute("TEXCOORD_0");
		geo.computeBoundingBox();
		if (geo.boundingBox) {
			const c = new THREE.Vector3();
			geo.boundingBox.getCenter(c);
			geo.translate(-c.x, -c.y, -c.z);
		}
		geo.computeVertexNormals();
		return geo;
	});
}

// ── Setup ──

export async function setup(ctx: SetupContext): Promise<UnderwaterWorldState> {
	ctx.camera.position.set(0, CAMERA_Y, 0);

	const onKeyDown = (e: KeyboardEvent): void => handleKey(e, true);
	const onKeyUp = (e: KeyboardEvent): void => handleKey(e, false);
	window.addEventListener("keydown", onKeyDown);
	window.addEventListener("keyup", onKeyUp);

	const terrainMat = new THREE.MeshStandardMaterial({
		color: 0xffffff,
		vertexColors: true,
		flatShading: true,
		roughness: 0.9,
		metalness: 0.0,
	});

	const terrainChunks = createInitialTerrainChunks(ctx.scene, 35, 0.012, terrainMat);
	const terrainChunkQueue: { gx: number; gz: number }[] = [];

	const rockData = createRocksData(ROCK_COUNT);
	const rockField = createStreamedRockField(ctx.scene, rockData.geo, rockData.mat, rockData.positions, ROCK_COUNT);

	// ── Fish (geladenes 3D-Modell) ──
	let fishGeo: THREE.BufferGeometry | undefined;
	try { fishGeo = await loadModelGeometry("/models/animated_low_poly_fish_gltf/scene.gltf"); }
	catch { console.warn("Fish model load failed, using procedural fallback"); }
	const { school: fish, material: fishMat } = createFishSchool(FISH_COUNT, fishGeo);
	ctx.scene.add(fish.mesh);

	const biolum = createBioluminescentParticles(500, 300);
	ctx.scene.add(biolum.points);

	// ── Echo-Ring-Pool (dünne, leuchtende Ringe) ──
	const ringGeo = new THREE.RingGeometry(0.9, 1.0, 48);
	ringGeo.rotateX(-Math.PI / 2);
	const ringMat = new THREE.MeshBasicMaterial({
		color: 0x00e5ff,
		transparent: true,
		opacity: 0,
		blending: THREE.AdditiveBlending,
		depthWrite: false,
		side: THREE.DoubleSide,
	});
	const echoRingPool: EchoRingData[] = [];
	for (let i = 0; i < ECHO_RING_POOL_SIZE; i++) {
		const m = new THREE.Mesh(ringGeo.clone(), ringMat.clone());
		m.visible = false;
		m.frustumCulled = false;
		m.renderOrder = 2;
		ctx.scene.add(m);
		echoRingPool.push({ mesh: m, active: false, timer: 0 });
	}
	const echoBurstQueue: EchoBurst[] = [];
	let echoEmitTimer = 0;
	let echoEnabled = false;

	// ── Audio: 4 Ambient-Tracks + Space-Movement ──
	let audio: AudioState | null = null;
	try {
		const actx = new AudioContext();
		const masterGain = actx.createGain();
		masterGain.gain.value = 0.4;
		masterGain.connect(actx.destination);

		// Alle Sounddateien parallel laden
		const loadBuf = async (path: string): Promise<AudioBuffer | null> => {
			try {
				const resp = await fetch(path);
				if (!resp.ok) { console.warn("Sound not found:", path); return null; }
				return actx.decodeAudioData(await resp.arrayBuffer());
			} catch (e) { console.warn("Sound load failed:", path, e); return null; }
		};
		const [
			bgBuf, surfaceBuf, cityBuf, moveBuf
		] = await Promise.all([
			loadBuf("/sounds/dragon-studio-deep-sea-underwater-ambience-472383.mp3"),
			loadBuf("/sounds/dragon-studio-deep-sea-underwater-ambience-482888.mp3"),
			loadBuf("/sounds/mavopix-underwater-159894.mp3"),
			loadBuf("/sounds/freesound_community-underwater-movement-66914.mp3"),
		]);

		// ── BG-Atmo (immer leise) ──
		const bgGain = actx.createGain();
		bgGain.gain.value = 0.25;
		bgGain.connect(masterGain);
		const bgSrc = actx.createBufferSource();
		bgSrc.buffer = bgBuf;
		bgSrc.loop = true;
		bgSrc.connect(bgGain);
		bgSrc.start();

		// ── Surface-Atmo (crossfade near Y=75) ──
		const surfaceGain = actx.createGain();
		surfaceGain.gain.value = 0;
		surfaceGain.connect(masterGain);
		let surfaceSrc: AudioBufferSourceNode | null = null;
		if (surfaceBuf) {
			surfaceSrc = actx.createBufferSource();
			surfaceSrc.buffer = surfaceBuf;
			surfaceSrc.loop = true;
			surfaceSrc.connect(surfaceGain);
			surfaceSrc.start();
		}

		// ── City-Atmo (crossfade near city) ──
		const cityGain = actx.createGain();
		cityGain.gain.value = 0;
		cityGain.connect(masterGain);
		let citySrc: AudioBufferSourceNode | null = null;
		if (cityBuf) {
			citySrc = actx.createBufferSource();
			citySrc.buffer = cityBuf;
			citySrc.loop = true;
			citySrc.connect(cityGain);
			citySrc.start();
		}

		audio = {
			ctx: actx, masterGain,
			bgGain, bgSrc,
			surfaceGain, surfaceSrc, surfaceBlend: 0,
			cityGain, citySrc, cityBlend: 0,
			pingBuffer: null, echoGain: null as unknown as GainNode,
			moveBuffer: moveBuf, wasSpace: false,
		};
	} catch { console.warn("AudioContext not available"); }

	const coralGeo = createCoralGeometry();
	const coralMat = new THREE.MeshStandardMaterial({
		color: 0xff8866,
		flatShading: true,
		roughness: 0.7,
		metalness: 0.05,
	});
	const coralData = createCoralFieldData();
	const coralField = createStreamedCoralField(ctx.scene, coralGeo, coralMat, coralData.positions, coralData.colors, coralData.gxs, coralData.gzs);

	const kelpGeo = createKelpGeometry();
	const kelpMat = new THREE.MeshStandardMaterial({
		color: 0x4a8a4a,
		flatShading: true,
		roughness: 0.8,
		metalness: 0.0,
		side: THREE.DoubleSide,
	});
	const kelpData = createKelpFieldData();
	const kelpField = createStreamedKelpField(ctx.scene, kelpGeo, kelpMat, kelpData.positions, kelpData.heights, kelpData.scales, kelpData.rotations);

	const jellyfish = createJellyfishHerd(ctx.scene);

	// ── Sharks ──
	let sharkGeo: THREE.BufferGeometry;
	try {
		const loaded = await loadModelGeometry("/models/shark.glb");
		if (loaded) { loaded.rotateX(Math.PI); sharkGeo = loaded; }
		else { sharkGeo = createSharkGeometry(); }
	} catch { sharkGeo = createSharkGeometry(); }
	const sharkMat = new THREE.MeshStandardMaterial({
		color: 0x6a7a8a,
		emissive: 0x226688,
		emissiveIntensity: 0.5,
		flatShading: true,
		roughness: 0.7,
		metalness: 0.2,
	});
	const sharks: LargeFish[] = [];
	for (let i = 0; i < SHARK_COUNT; i++) {
		const s = createLargeFish(sharkGeo, sharkMat, ctx.camera.position);
		s.mesh.scale.setScalar(0.8 + Math.random() * 0.4);
		ctx.scene.add(s.mesh);
		sharks.push(s);
	}

	let dolphinGeo: THREE.BufferGeometry;
	let dolphinMat: THREE.MeshStandardMaterial;
	try {
		const mtlLoader = new MTLLoader();
		mtlLoader.setPath("/models/delfin/");
		const mtl = await mtlLoader.loadAsync("10014_dolphin_v2_max2011_it2.mtl");
		mtl.preload();
		const objLoader = new OBJLoader();
		objLoader.setMaterials(mtl);
		const obj = await objLoader.loadAsync("/models/delfin/10014_dolphin_v2_max2011_it2.obj");
		const meshes: THREE.Mesh[] = [];
		obj.traverse((child) => { if (child instanceof THREE.Mesh) meshes.push(child); });
		if (meshes.length > 0) {
			const geos: THREE.BufferGeometry[] = [];
			let srcMat: THREE.Material | null = null;
			for (const m of meshes) {
				const g = m.geometry.clone();
				g.applyMatrix4(m.matrixWorld);
				geos.push(g);
				if (!srcMat) srcMat = Array.isArray(m.material) ? m.material[0] : m.material;
			}
			dolphinGeo = mergeGeometries(geos);
			dolphinGeo.computeVertexNormals();
			// Zentrieren
			dolphinGeo.computeBoundingBox();
			if (dolphinGeo.boundingBox) {
				const c = new THREE.Vector3();
				dolphinGeo.boundingBox.getCenter(c);
				dolphinGeo.translate(-c.x, -c.y, -c.z);
			}
			// Von OBJ-Konvention (Y-up) zu Three.js (Kopf bei -Z) konvertieren
			dolphinGeo.rotateX(-Math.PI / 2);
			dolphinGeo.scale(0.08, 0.08, 0.08);
			dolphinGeo.computeVertexNormals();
			dolphinMat = new THREE.MeshStandardMaterial({
				color: srcMat instanceof THREE.MeshStandardMaterial ? (srcMat as THREE.MeshStandardMaterial).color : 0x88aacc,
				emissive: 0x44aaff,
				emissiveIntensity: 0.6,
				flatShading: true,
				roughness: 0.5,
				metalness: 0.1,
			});
		} else {
			throw new Error("No meshes in OBJ");
		}
	} catch {
		console.warn("Dolphin OBJ load failed, using procedural fallback");
		dolphinGeo = createDolphinGeometry();
		dolphinMat = new THREE.MeshStandardMaterial({
			color: 0x88aacc,
			emissive: 0x4488aa,
			emissiveIntensity: 0.5,
			flatShading: true,
			roughness: 0.5,
			metalness: 0.1,
		});
	}
	const dolphins: LargeFish[] = [];
	for (let i = 0; i < DOLPHIN_COUNT; i++) {
		const d = createLargeFish(dolphinGeo, dolphinMat, ctx.camera.position);
		d.mesh.scale.setScalar(0.8 + Math.random() * 0.4);
		ctx.scene.add(d.mesh);
		dolphins.push(d);
	}

	let cityModel: THREE.Group | null = null;
	try {
		const gltf = await loadGLTF("/models/cityfbx.glb");
		cityModel = gltf.scene;
	} catch {
		console.warn("cityfbx.glb load failed");
	}
	const city = createCityGroup(cityModel ? [cityModel] : []);
	ctx.scene.add(city.group);

	// ── Start-Stadt entfernt — keine vorplatzierte Stadt mehr ──

	const waterSurface = createWaterSurface(ctx.scene);

	return {
		camera: ctx.camera,
		scene: ctx.scene,
		terrainChunks,
		terrainChunkQueue,
		terrainLastGx: 0,
		terrainLastGz: 0,
		terrainAmplitude: 35,
		terrainScale: 0.012,
		terrainColor: "#1a3a5a",
		terrainMat,
		waterSurface,
		rockField,
		fish,
		fishMat,
		particles: biolum.points,
		particleMat: biolum.material,
		echoRingPool,
		echoBurstQueue,
		echoEmitTimer,
		echoEnabled,
		echoKeyWasDown: false,
		driftSpeed: 2,
		wasdSpeed: 6,
		lightIntensity: 1.5,
		echolocationEnabled: false,
		echolocationRange: 60,
		coralField,
		kelpField,
		jellyfish,
		sharks,
		dolphins,
		city,
		audio,
		moveX: 0,
		moveZ: 0,
	};
}

// ── Echo-Ring-Emission ──

function emitEchoRing(pool: EchoRingData[], x: number, y: number, z: number): void {
	for (const ring of pool) {
		if (!ring.active) {
			ring.active = true;
			ring.timer = ECHO_RING_LIFETIME;
			ring.mesh.position.set(x, y, z);
			ring.mesh.scale.setScalar(0.5);
			ring.mesh.visible = true;
			(ring.mesh.material as THREE.MeshBasicMaterial).opacity = 0.5;
			break;
		}
	}
}

function addEchoBurst(
	pool: EchoRingData[],
	bursts: EchoBurst[],
	x: number, y: number, z: number,
	count: number, delay: number,
): void {
	emitEchoRing(pool, x, y, z);
	if (count > 1) {
		bursts.push({ x, y, z, remaining: count - 1, delay, timer: delay });
	}
}

// ── Tick ──

const _driftDir = new THREE.Vector3();
const _dummy = new THREE.Object3D();
const _lookTarget = new THREE.Vector3();


export function tick(
	state: ExperienceState,
	ctx: TickContext,
): { state: ExperienceState; outputs?: Record<string, number> } {
	const s = state as UnderwaterWorldState;
	const delta = ctx.delta;
	const pos = ctx.camera.position;

	// ── WASD: A/D yaw, W hoch, S runter ──
	const wasd = getWASD();
	if (wasd.moveX !== 0) {
		ctx.camera.rotation.y -= wasd.moveX * s.wasdSpeed * delta * 0.25;
	}
	if (wasd.moveZ !== 0) {
		pos.y += wasd.moveZ * s.wasdSpeed * delta;
	}

	// ── R/F: nach oben/unten schauen ──
	if (keys.has("KeyR")) ctx.camera.rotation.x -= delta * 0.8;
	if (keys.has("KeyF")) ctx.camera.rotation.x += delta * 0.8;

	// ── Pitch-Clamping ──
	ctx.camera.rotation.x = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, ctx.camera.rotation.x));

	// ── Space: Speed-Boost + Movement-Sound ──
	const spaceNow = keys.has("Space");
	if (spaceNow) {
		s.driftSpeed = Math.min(20, s.driftSpeed + delta * 20);
		if (s.audio && !s.audio.wasSpace && s.audio.moveBuffer) {
			const src = s.audio.ctx.createBufferSource();
			src.buffer = s.audio.moveBuffer;
			const g = s.audio.ctx.createGain();
			g.gain.value = 0.7;
			src.connect(g);
			g.connect(s.audio.masterGain);
			src.start();
		}
	} else {
		s.driftSpeed = Math.max(1.5, s.driftSpeed - delta * 10);
	}
	if (s.audio) s.audio.wasSpace = spaceNow;

	// ── Q: Echo-Toggle ──
	const qDown = keys.has("KeyQ");
	if (qDown && !s.echoKeyWasDown) {
		s.echoEnabled = !s.echoEnabled;
	}
	s.echoKeyWasDown = qDown;

	// ── Auto-drift in Blickrichtung ──
	_driftDir.set(0, 0, -1).applyQuaternion(ctx.camera.quaternion);
	_driftDir.y = 0; _driftDir.normalize();
	const fwdX = _driftDir.x, fwdZ = _driftDir.z;
	pos.add(_driftDir.multiplyScalar(s.driftSpeed * delta));

	// ── Y-Clamping: nie über Wasser, nie unter Boden ──
	const terrainY = getTerrainHeight(pos.x, pos.z, s.terrainAmplitude, s.terrainScale);
	const waterY = WATER_SURFACE_Y + Math.sin(ctx.elapsed * 0.1) * 0.5;
	pos.y = Math.max(terrainY + 1.5, Math.min(waterY - 0.8, pos.y));

	// ── Terrain Chunks (gradual loading, max 2 per frame) ──
	const pgx = Math.round(pos.x / CHUNK_SIZE);
	const pgz = Math.round(pos.z / CHUNK_SIZE);
	if (pgx !== s.terrainLastGx || pgz !== s.terrainLastGz) {
		s.terrainLastGx = pgx;
		s.terrainLastGz = pgz;
		queueTerrainChunks(s, pos.x, pos.z);
	}
	processChunkQueue(s, 2);

	// ── Streaming (Flora + Rocks laden/entladen richtungsabhängig) ──
	updateCoralStreaming(s.coralField, pos.x, pos.z, fwdX, fwdZ, s.terrainAmplitude, s.terrainScale);
	updateKelpStreaming(s.kelpField, pos.x, pos.z, fwdX, fwdZ, s.terrainAmplitude, s.terrainScale);
	updateRockStreaming(s.rockField, pos.x, pos.z, s.terrainAmplitude, s.terrainScale);
	// ── Fish ──
	updateFishSchool(s.fish, delta, ctx.elapsed, pos, s.terrainAmplitude, s.terrainScale);

	// ── City ──
	updateCity(s.city, pos.x, pos.z, s.terrainAmplitude, s.terrainScale, ctx.elapsed);

	// ── Audio Crossfades ──
	if (s.audio) {
		// Surface: blend in bei Annäherung an Y=75
		const targetSurface = THREE.MathUtils.clamp((pos.y - 40) / 30, 0, 1);
		s.audio.surfaceBlend += (targetSurface - s.audio.surfaceBlend) * delta * 2;
		s.audio.surfaceGain.gain.value = s.audio.surfaceBlend * 0.35;

		// City: blend in nur im City-Biome (≥0.75)
		const playerBiome = getBiome(pos.x, pos.z);
		const targetCity = playerBiome >= 0.75 ? 1 : 0;
		s.audio.cityBlend += (targetCity - s.audio.cityBlend) * delta * 2;
		s.audio.cityGain.gain.value = s.audio.cityBlend * 0.5;

		// BG ducking: leiser machen wenn andere Tracks aktiv sind
		const duck = 1 - (s.audio.surfaceBlend * 0.5 + s.audio.cityBlend * 0.5);
		s.audio.bgGain.gain.value = 0.14 + duck * 0.1;

	}

	// ── Jellyfish ──
	updateJellyfishHerd(s.jellyfish, ctx.elapsed, pos);

	// ── Large Fish (Sharks / Dolphins) ──
	for (const shark of s.sharks) updateLargeFish(shark, delta, ctx.elapsed, pos);
	for (const dolphin of s.dolphins) updateDolphin(dolphin, delta, ctx.elapsed, pos, s.terrainAmplitude, s.terrainScale);

	// ── Delfin-Nähe → Echo automatisch aktivieren ──
	if (!s.echoEnabled) {
		for (const d of s.dolphins) {
			const dx = d.mesh.position.x - pos.x;
			const dz = d.mesh.position.z - pos.z;
			const dy = d.mesh.position.y - pos.y;
			if (dx * dx + dy * dy + dz * dz < ECHO_DOLPHIN_RANGE * ECHO_DOLPHIN_RANGE) {
				s.echoEnabled = true;
				break;
			}
		}
	}

	updateWaterSurface(s.waterSurface, ctx.elapsed);

	// ── Particles (Biolumineszenz + Drift zur Stadt) ──
	const pPos = s.particles.geometry.attributes.position;
	const phases = s.particles.geometry.attributes.phase as THREE.BufferAttribute;
	for (let i = 0; i < pPos.count; i++) {
		const phase = phases.getX(i);
		const bob = Math.sin(ctx.elapsed * 0.5 + phase) * delta * 0.5;
		const y = pPos.getY(i) + bob * s.lightIntensity;
		pPos.setY(i, y > WATER_SURFACE_Y + 20 ? -(WATER_SURFACE_Y + 20) : y < -(WATER_SURFACE_Y + 20) ? WATER_SURFACE_Y + 20 : y);
	}
	pPos.needsUpdate = true;
	s.particleMat.size = 0.35 + Math.sin(ctx.elapsed * 0.3) * 0.05;
	s.particleMat.opacity = 0.4 + s.lightIntensity * 0.15;

	// ── Echo-Ringe: Emission ──
	if (s.echoEnabled) {
		s.echoEmitTimer += delta;
		if (s.echoEmitTimer >= ECHO_EMIT_INTERVAL) {
			s.echoEmitTimer -= ECHO_EMIT_INTERVAL;

			// Alle Fische aufleuchten lassen
			for (let fi = 0; fi < FISH_COUNT; fi++) {
				const fi3 = fi * 3;
				emitEchoRing(s.echoRingPool, s.fish.positions[fi3], s.fish.positions[fi3 + 1], s.fish.positions[fi3 + 2]);
			}

			for (const shark of s.sharks) {
				emitEchoRing(s.echoRingPool, shark.mesh.position.x, shark.mesh.position.y, shark.mesh.position.z);
			}
			for (const dolphin of s.dolphins) {
				emitEchoRing(s.echoRingPool, dolphin.mesh.position.x, dolphin.mesh.position.y, dolphin.mesh.position.z);
			}

			const ji3 = Math.floor(Math.random() * JELLY_COUNT) * 3;
			emitEchoRing(s.echoRingPool, s.jellyfish.positions[ji3], s.jellyfish.positions[ji3 + 1], s.jellyfish.positions[ji3 + 2]);

			if (ROCK_COUNT > 0) {
				const ri = Math.floor(Math.random() * ROCK_COUNT);
				addEchoBurst(s.echoRingPool, s.echoBurstQueue, s.rockField.positions[ri * 3], s.rockField.positions[ri * 3 + 1], s.rockField.positions[ri * 3 + 2], 2, ECHO_BURST_DELAY);
			}
			if (s.coralField.totalItems > 0) {
				const ci = Math.floor(Math.random() * s.coralField.totalItems);
				const cx = s.coralField.positions[ci * 2];
				const cz = s.coralField.positions[ci * 2 + 1];
				const cy = getTerrainHeight(cx, cz, s.terrainAmplitude, s.terrainScale);
				addEchoBurst(s.echoRingPool, s.echoBurstQueue, cx, cy, cz, 2, ECHO_BURST_DELAY);
			}
			if (s.kelpField.totalItems > 0) {
				const ki = Math.floor(Math.random() * s.kelpField.totalItems);
				const kx = s.kelpField.positions[ki * 2];
				const kz = s.kelpField.positions[ki * 2 + 1];
				const ky = getTerrainHeight(kx, kz, s.terrainAmplitude, s.terrainScale);
				addEchoBurst(s.echoRingPool, s.echoBurstQueue, kx, ky, kz, 2, ECHO_BURST_DELAY);
			}
			if (s.city.active) {
				const cy = getTerrainHeight(s.city.worldX, s.city.worldZ, s.terrainAmplitude, s.terrainScale) + CITY_Y_OFFSET + 10;
				addEchoBurst(s.echoRingPool, s.echoBurstQueue, s.city.worldX, cy, s.city.worldZ, 3, ECHO_BURST_DELAY);
			}
		}

		// ── Burst-Queue abarbeiten ──
		for (let bi = s.echoBurstQueue.length - 1; bi >= 0; bi--) {
			const b = s.echoBurstQueue[bi];
			b.timer -= delta;
			if (b.timer <= 0) {
				emitEchoRing(s.echoRingPool, b.x, b.y, b.z);
				b.remaining--;
				if (b.remaining <= 0) {
					s.echoBurstQueue.splice(bi, 1);
				} else {
					b.timer = b.delay;
				}
			}
		}

		// ── Ring-Updates (expandieren + ausfaden) ──
		for (const ring of s.echoRingPool) {
			if (!ring.active) continue;
			ring.timer -= delta;
			if (ring.timer <= 0) {
				ring.active = false;
				ring.mesh.visible = false;
			} else {
				const age = ECHO_RING_LIFETIME - ring.timer;
				const r = Math.max(0.5, age * ECHO_RING_EXPAND_SPEED);
				ring.mesh.scale.setScalar(r);
				const mat = ring.mesh.material as THREE.MeshBasicMaterial;
				mat.opacity = (ring.timer / ECHO_RING_LIFETIME) * 0.5;
			}
		}
	}

	// ── Fish glow pulse ──
	s.fishMat.emissiveIntensity = 0.4 + Math.sin(ctx.elapsed * 0.5) * 0.2;

	// ── Dolphin glow ──
	const dolphinMat = s.dolphins[0].mesh.material as THREE.MeshStandardMaterial;
	dolphinMat.emissiveIntensity = 0.5 + Math.sin(ctx.elapsed * 0.7) * 0.3;

	return { state: s };
}

// ── Dispose ──

export function dispose(state: ExperienceState, scene: THREE.Scene): void {
	const s = state as UnderwaterWorldState;

	for (const ch of s.terrainChunks) {
		scene.remove(ch.mesh);
		ch.mesh.geometry.dispose();
	}
	if (s.terrainMat) s.terrainMat.dispose();

	scene.remove(s.rockField.mesh);
	s.rockField.mesh.geometry.dispose();
	(s.rockField.mesh.material as THREE.Material).dispose();

	s.fish.mesh.geometry.dispose();
	(s.fish.mesh.material as THREE.Material).dispose();
	scene.remove(s.fish.mesh);

	s.particles.geometry.dispose();
	s.particleMat.dispose();
	scene.remove(s.particles);

	scene.remove(s.coralField.mesh);
	s.coralField.mesh.geometry.dispose();
	(s.coralField.mesh.material as THREE.Material).dispose();

	scene.remove(s.kelpField.mesh);
	s.kelpField.mesh.geometry.dispose();
	(s.kelpField.mesh.material as THREE.Material).dispose();

	// City
	s.city.group.traverse((child) => {
		if (child instanceof THREE.Mesh) {
			child.geometry.dispose();
			if (child.material instanceof THREE.Material) child.material.dispose();
		}
	});
	scene.remove(s.city.group);
	// Model-Variant-Quellen aufräumen (geklonte Varianten sind bereits in group.traverse)
	for (const v of s.city.modelVariants) {
		if (v) {
			v.traverse((child) => {
				if (child instanceof THREE.Mesh) {
					child.geometry.dispose();
					if (child.material instanceof THREE.Material) child.material.dispose();
				}
			});
		}
	}

	// ── Echo-Ringe ──
	for (const ring of s.echoRingPool) {
		ring.mesh.geometry.dispose();
		(ring.mesh.material as THREE.Material).dispose();
		scene.remove(ring.mesh);
	}

	disposeWaterSurface(s.waterSurface, scene);

	s.jellyfish.mesh.geometry.dispose();
	s.jellyfish.mat.dispose();
	scene.remove(s.jellyfish.mesh);

	for (const shark of s.sharks) {
		shark.mesh.geometry.dispose();
		(shark.mesh.material as THREE.Material).dispose();
		scene.remove(shark.mesh);
	}
	for (const dolphin of s.dolphins) {
		dolphin.mesh.geometry.dispose();
		(dolphin.mesh.material as THREE.Material).dispose();
		scene.remove(dolphin.mesh);
	}

	s.audio?.ctx.close();
}
