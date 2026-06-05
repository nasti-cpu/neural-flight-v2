import * as THREE from "three";
import type { UnderwaterWorldState } from "../scene";
import type { TerrainChunk } from "./terrain";
import { getTerrainHeight, createTerrainChunk, hash2d } from "./terrain";

export const CHUNK_SIZE = 400;
export const CHUNK_SEGMENTS = 48;
const CHUNK_RADIUS = 1;
const CHUNK_RADIUS_INIT = 1;

export const STREAM_INITIAL_RADIUS = 200;
export const STREAM_LOAD_PER_FRAME = 20;

export const VIEW_RADIUS = 200;
export const VIEW_RADIUS_FWD = 280;
export const VIEW_RADIUS_BACK = 100;

const _dummy = new THREE.Object3D();
const _mat4 = new THREE.Matrix4();
const _color = new THREE.Color();

// ── Terrain Chunks ──

export function queueTerrainChunks(
	s: UnderwaterWorldState,
	playerX: number,
	playerZ: number,
): void {
	const pgx = Math.round(playerX / CHUNK_SIZE);
	const pgz = Math.round(playerZ / CHUNK_SIZE);
	const desired = new Set<string>();
	for (let dx = -CHUNK_RADIUS; dx <= CHUNK_RADIUS; dx++) {
		for (let dz = -CHUNK_RADIUS; dz <= CHUNK_RADIUS; dz++) {
			desired.add(`${pgx + dx},${pgz + dz}`);
		}
	}
	const kept: TerrainChunk[] = [];
	for (const ch of s.terrainChunks) {
		const key = `${ch.gx},${ch.gz}`;
		if (desired.has(key)) {
			kept.push(ch);
			desired.delete(key);
		} else {
			s.scene.remove(ch.mesh);
			ch.mesh.geometry.dispose();
		}
	}
	s.terrainChunks = kept;
	s.terrainChunkQueue = [];
	for (const key of desired) {
		const parts = key.split(",");
		s.terrainChunkQueue.push({ gx: parseInt(parts[0]), gz: parseInt(parts[1]) });
	}
}

export function processChunkQueue(s: UnderwaterWorldState, limit: number): void {
	if (s.terrainChunkQueue.length === 0) return;
	const batch = s.terrainChunkQueue.splice(0, limit);
	for (const { gx, gz } of batch) {
		const ch = createTerrainChunk(gx, gz, s.terrainAmplitude, s.terrainScale, s.terrainMat, CHUNK_SIZE, CHUNK_SEGMENTS);
		s.scene.add(ch.mesh);
		s.terrainChunks.push(ch);
	}
}

export function createInitialTerrainChunks(scene: THREE.Scene, baseAmp: number, baseScale: number, mat: THREE.MeshStandardMaterial): TerrainChunk[] {
	const chunks: TerrainChunk[] = [];
	for (let gx = -CHUNK_RADIUS_INIT; gx <= CHUNK_RADIUS_INIT; gx++) {
		for (let gz = -CHUNK_RADIUS_INIT; gz <= CHUNK_RADIUS_INIT; gz++) {
			const ch = createTerrainChunk(gx, gz, baseAmp, baseScale, mat, CHUNK_SIZE, CHUNK_SEGMENTS);
			scene.add(ch.mesh);
			chunks.push(ch);
		}
	}
	return chunks;
}

// ── Slot-Management fŸr InstancedMesh ──

function unloadInstanceSlot(
	mesh: THREE.InstancedMesh,
	slot: number,
	currentCount: number,
): void {
	const last = currentCount - 1;
	if (slot < last) {
		mesh.getMatrixAt(last, _mat4);
		mesh.setMatrixAt(slot, _mat4);
		if (mesh.instanceColor) {
			mesh.getColorAt(last, _color);
			mesh.setColorAt(slot, _color);
		}
	}
	mesh.count = last;
	mesh.instanceMatrix.needsUpdate = true;
	if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

// ── Coral Streaming (Load + Unload) ──

export interface StreamedCoralField {
	mesh: THREE.InstancedMesh;
	positions: Float32Array;
	gxs: Int32Array;
	gzs: Int32Array;
	itemToSlot: Int32Array;
	slotToItem: Int32Array;
	totalItems: number;
	loadedCount: number;
}

export function createStreamedCoralField(
	scene: THREE.Scene,
	geo: THREE.BufferGeometry,
	mat: THREE.MeshStandardMaterial,
	positions: Float32Array,
	instanceColors: Float32Array,
	gxs: Int32Array,
	gzs: Int32Array,
): StreamedCoralField {
	const totalItems = positions.length / 2;
	const mesh = new THREE.InstancedMesh(geo, mat, totalItems);
	mesh.frustumCulled = true;
	const colAttr = new THREE.InstancedBufferAttribute(instanceColors, 3);
	mesh.instanceColor = colAttr;
	scene.add(mesh);

	const itemToSlot = new Int32Array(totalItems).fill(-1);
	const slotToItem = new Int32Array(totalItems).fill(-1);

	mesh.count = 0;
	mesh.instanceMatrix.needsUpdate = true;

	return { mesh, positions, gxs, gzs, itemToSlot, slotToItem, totalItems, loadedCount: 0 };
}

export function updateCoralStreaming(
	field: StreamedCoralField,
	playerX: number,
	playerZ: number,
	fwdX: number,
	fwdZ: number,
	baseAmp: number,
	baseScale: number,
): void {
	const rFwdSq = VIEW_RADIUS_FWD * VIEW_RADIUS_FWD;
	const rBackSq = VIEW_RADIUS_BACK * VIEW_RADIUS_BACK;
	const rUnload = VIEW_RADIUS * VIEW_RADIUS * 1.5; // hysteresis: unload a bit further than we load
	const loaded = field.loadedCount;
	const total = field.totalItems;
	let dirty = false;

	// ── Phase 1: Unload ──
	for (let si = loaded - 1; si >= 0; si--) {
		const ii = field.slotToItem[si];
		if (ii === -1) continue;
		const wx = field.positions[ii * 2];
		const wz = field.positions[ii * 2 + 1];
		const dx = wx - playerX;
		const dz = wz - playerZ;
		if (dx * dx + dz * dz > rUnload) {
			const lastSlot = field.loadedCount - 1;
			if (si !== lastSlot) {
				const lastItem = field.slotToItem[lastSlot];
				field.mesh.getMatrixAt(lastSlot, _mat4);
				field.mesh.setMatrixAt(si, _mat4);
				if (field.mesh.instanceColor) {
					field.mesh.getColorAt(lastSlot, _color);
					field.mesh.setColorAt(si, _color);
				}
				field.itemToSlot[lastItem] = si;
				field.slotToItem[si] = lastItem;
			}
			field.itemToSlot[ii] = -1;
			field.slotToItem[field.loadedCount - 1] = -1;
			field.loadedCount--;
			dirty = true;
		}
	}

	// ── Phase 2: Load ──
	let loadedThisFrame = 0;
	for (let ii = 0; ii < total && loadedThisFrame < STREAM_LOAD_PER_FRAME; ii++) {
		if (field.itemToSlot[ii] !== -1) continue;
		const wx = field.positions[ii * 2];
		const wz = field.positions[ii * 2 + 1];
		const dx = wx - playerX;
		const dz = wz - playerZ;
		const dSq = dx * dx + dz * dz;
		const fwdDot = dx * fwdX + dz * fwdZ;
		const rSq = fwdDot >= 0 ? rFwdSq : rBackSq;
		if (dSq < rSq) {
			const slot = field.loadedCount;
			const h = getTerrainHeight(wx, wz, baseAmp, baseScale);
			const size = 0.8 + hash2d(field.gxs[ii] + 50, field.gzs[ii] + 60) * 2.5;
			_dummy.position.set(wx, h, wz);
			_dummy.scale.setScalar(size);
			_dummy.rotation.set(hash2d(field.gxs[ii], field.gzs[ii]) * 0.5, hash2d(field.gxs[ii] + 10, field.gzs[ii] + 20) * 6, 0);
			_dummy.updateMatrix();
			field.mesh.setMatrixAt(slot, _dummy.matrix);
			field.itemToSlot[ii] = slot;
			field.slotToItem[slot] = ii;
			field.loadedCount++;
			loadedThisFrame++;
			dirty = true;
		}
	}

	if (dirty) {
		field.mesh.count = field.loadedCount;
		field.mesh.instanceMatrix.needsUpdate = true;
	}
}

// ── Kelp Streaming (Load + Unload) ──

export interface StreamedKelpField {
	mesh: THREE.InstancedMesh;
	positions: Float32Array;
	heights: Float32Array;
	scales: Float32Array;
	rotations: Float32Array;
	itemToSlot: Int32Array;
	slotToItem: Int32Array;
	totalItems: number;
	loadedCount: number;
}

export function createStreamedKelpField(
	scene: THREE.Scene,
	geo: THREE.BufferGeometry,
	mat: THREE.MeshStandardMaterial,
	positions: Float32Array,
	heights: Float32Array,
	scales: Float32Array,
	rotations: Float32Array,
): StreamedKelpField {
	const totalItems = positions.length / 2;
	const mesh = new THREE.InstancedMesh(geo, mat, totalItems);
	mesh.frustumCulled = true;
	scene.add(mesh);

	const itemToSlot = new Int32Array(totalItems).fill(-1);
	const slotToItem = new Int32Array(totalItems).fill(-1);

	return { mesh, positions, heights, scales, rotations, itemToSlot, slotToItem, totalItems, loadedCount: 0 };
}

export function updateKelpStreaming(
	field: StreamedKelpField,
	playerX: number,
	playerZ: number,
	fwdX: number,
	fwdZ: number,
	baseAmp: number,
	baseScale: number,
): void {
	const rFwdSq = VIEW_RADIUS_FWD * VIEW_RADIUS_FWD;
	const rBackSq = VIEW_RADIUS_BACK * VIEW_RADIUS_BACK;
	const rUnload = VIEW_RADIUS * VIEW_RADIUS * 1.5;
	const loaded = field.loadedCount;
	const total = field.totalItems;
	let dirty = false;

	for (let si = loaded - 1; si >= 0; si--) {
		const ii = field.slotToItem[si];
		if (ii === -1) continue;
		const wx = field.positions[ii * 2];
		const wz = field.positions[ii * 2 + 1];
		const dx = wx - playerX;
		const dz = wz - playerZ;
		if (dx * dx + dz * dz > rUnload) {
			const lastSlot = field.loadedCount - 1;
			if (si !== lastSlot) {
				const lastItem = field.slotToItem[lastSlot];
				field.mesh.getMatrixAt(lastSlot, _mat4);
				field.mesh.setMatrixAt(si, _mat4);
				field.itemToSlot[lastItem] = si;
				field.slotToItem[si] = lastItem;
			}
			field.itemToSlot[ii] = -1;
			field.slotToItem[field.loadedCount - 1] = -1;
			field.loadedCount--;
			dirty = true;
		}
	}

	let loadedThisFrame = 0;
	for (let ii = 0; ii < total && loadedThisFrame < STREAM_LOAD_PER_FRAME; ii++) {
		if (field.itemToSlot[ii] !== -1) continue;
		const wx = field.positions[ii * 2];
		const wz = field.positions[ii * 2 + 1];
		const dx = wx - playerX;
		const dz = wz - playerZ;
		const dSq = dx * dx + dz * dz;
		const fwdDot = dx * fwdX + dz * fwdZ;
		const rSq = fwdDot >= 0 ? rFwdSq : rBackSq;
		if (dSq < rSq) {
			const slot = field.loadedCount;
			const h = getTerrainHeight(wx, wz, baseAmp, baseScale);
			field.heights[ii] = h;
			_dummy.position.set(wx, h, wz);
			_dummy.scale.setScalar(field.scales[ii]);
			_dummy.rotation.y = field.rotations[ii];
			_dummy.updateMatrix();
			field.mesh.setMatrixAt(slot, _dummy.matrix);
			field.itemToSlot[ii] = slot;
			field.slotToItem[slot] = ii;
			field.loadedCount++;
			loadedThisFrame++;
			dirty = true;
		}
	}

	if (dirty) {
		field.mesh.count = field.loadedCount;
		field.mesh.instanceMatrix.needsUpdate = true;
	}
}

// ── Rock Streaming ──

export interface StreamedRockField {
	mesh: THREE.InstancedMesh;
	positions: Float32Array;
	itemToSlot: Int32Array;
	slotToItem: Int32Array;
	totalItems: number;
	loadedCount: number;
}

export function createStreamedRockField(
	scene: THREE.Scene,
	geo: THREE.BufferGeometry,
	mat: THREE.MeshStandardMaterial,
	positions: Float32Array,
	totalItems: number,
): StreamedRockField {
	const mesh = new THREE.InstancedMesh(geo, mat, totalItems);
	mesh.castShadow = false;
	mesh.receiveShadow = false;
	mesh.frustumCulled = true;
	scene.add(mesh);

	const itemToSlot = new Int32Array(totalItems).fill(-1);
	const slotToItem = new Int32Array(totalItems).fill(-1);

	return { mesh, positions, itemToSlot, slotToItem, totalItems, loadedCount: 0 };
}

export function updateRockStreaming(
	field: StreamedRockField,
	playerX: number,
	playerZ: number,
	baseAmp: number,
	baseScale: number,
): void {
	const rSq = VIEW_RADIUS * VIEW_RADIUS;
	const rUnload = VIEW_RADIUS * VIEW_RADIUS * 1.5;
	const loaded = field.loadedCount;
	const total = field.totalItems;
	let dirty = false;

	for (let si = loaded - 1; si >= 0; si--) {
		const ii = field.slotToItem[si];
		if (ii === -1) continue;
		const wx = field.positions[ii * 3];
		const wz = field.positions[ii * 3 + 2];
		const dx = wx - playerX;
		const dz = wz - playerZ;
		if (dx * dx + dz * dz > rUnload) {
			const lastSlot = field.loadedCount - 1;
			if (si !== lastSlot) {
				const lastItem = field.slotToItem[lastSlot];
				field.mesh.getMatrixAt(lastSlot, _mat4);
				field.mesh.setMatrixAt(si, _mat4);
				if (field.mesh.instanceColor) {
					field.mesh.getColorAt(lastSlot, _color);
					field.mesh.setColorAt(si, _color);
				}
				field.itemToSlot[lastItem] = si;
				field.slotToItem[si] = lastItem;
			}
			field.itemToSlot[ii] = -1;
			field.slotToItem[field.loadedCount - 1] = -1;
			field.loadedCount--;
			dirty = true;
		}
	}

	let loadedThisFrame = 0;
	for (let ii = 0; ii < total && loadedThisFrame < STREAM_LOAD_PER_FRAME; ii++) {
		if (field.itemToSlot[ii] !== -1) continue;
		const wx = field.positions[ii * 3];
		const wz = field.positions[ii * 3 + 2];
		const dx = wx - playerX;
		const dz = wz - playerZ;
		const dSq = dx * dx + dz * dz;
		if (dSq < rSq) {
			const slot = field.loadedCount;
			_dummy.position.set(wx, field.positions[ii * 3 + 1], wz);
			field.mesh.getMatrixAt(ii, _mat4);
			_dummy.updateMatrix();
			field.mesh.setMatrixAt(slot, _dummy.matrix);
			if (field.mesh.instanceColor) {
				field.mesh.getColorAt(ii, _color);
				field.mesh.setColorAt(slot, _color);
			}
			field.itemToSlot[ii] = slot;
			field.slotToItem[slot] = ii;
			field.loadedCount++;
			loadedThisFrame++;
			dirty = true;
		}
	}

	if (dirty) {
		field.mesh.count = field.loadedCount;
		field.mesh.instanceMatrix.needsUpdate = true;
		if (field.mesh.instanceColor) field.mesh.instanceColor.needsUpdate = true;
	}
}
