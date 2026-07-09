import * as THREE from "three";
import { getTerrainHeight, createTerrainChunk, CHUNK_SIZE } from "./terrain";
import type { TerrainChunk } from "./terrain";

const CHUNK_RADIUS = 1;
const STREAM_LOAD_PER_FRAME = 2;
const _dummy = new THREE.Object3D();
const _mat4 = new THREE.Matrix4();
const _color = new THREE.Color();

// ── Terrain Chunks ──

export function queueTerrainChunks(
	terrainChunks: TerrainChunk[],
	terrainChunkQueue: { gx: number; gz: number }[],
	playerX: number,
	playerZ: number,
): TerrainChunk[] {
	const pgx = Math.round(playerX / CHUNK_SIZE);
	const pgz = Math.round(playerZ / CHUNK_SIZE);
	const desired = new Set<string>();
	for (let dx = -CHUNK_RADIUS; dx <= CHUNK_RADIUS; dx++) {
		for (let dz = -CHUNK_RADIUS; dz <= CHUNK_RADIUS; dz++) {
			desired.add(`${pgx + dx},${pgz + dz}`);
		}
	}
	const kept: TerrainChunk[] = [];
	for (const ch of terrainChunks) {
		const key = `${ch.gx},${ch.gz}`;
		if (desired.has(key)) {
			kept.push(ch);
			desired.delete(key);
		} else {
			ch.mesh.parent?.remove(ch.mesh);
			ch.mesh.geometry.dispose();
		}
	}
	terrainChunkQueue.length = 0;
	for (const key of desired) {
		const parts = key.split(",");
		terrainChunkQueue.push({ gx: parseInt(parts[0]), gz: parseInt(parts[1]) });
	}
	return kept;
}

export function processChunkQueue(
	terrainChunks: TerrainChunk[],
	queue: { gx: number; gz: number }[],
	scene: THREE.Scene,
	amplitude: number,
	scale: number,
	mat: THREE.MeshStandardMaterial,
): void {
	if (queue.length === 0) return;
	const batch = queue.splice(0, STREAM_LOAD_PER_FRAME);
	for (const { gx, gz } of batch) {
		const ch = createTerrainChunk(gx, gz, amplitude, scale, mat);
		scene.add(ch.mesh);
		terrainChunks.push(ch);
	}
}

// ── Coral Slot-Tracking ──

export interface CoralField {
	meshes: THREE.InstancedMesh[];
	positions: Float32Array;
	types: Int32Array;
	colors: Float32Array;
	itemToSlot: Int32Array;
	slotToItem: Int32Array;
	totalItems: number;
	loadedCounts: Int32Array;
	capacityPerType: number;
}

export function createCoralField(
	scene: THREE.Scene,
	geos: THREE.BufferGeometry[],
	capacityPerType: number,
	positions: Float32Array,
	types: Int32Array,
	colors: Float32Array,
): CoralField {
	const numTypes = geos.length;
	const totalItems = positions.length / 2;
	const meshes: THREE.InstancedMesh[] = [];
	for (let ti = 0; ti < numTypes; ti++) {
		const mat = new THREE.MeshStandardMaterial({
			vertexColors: true,
			flatShading: true,
			roughness: 0.6,
			metalness: 0.05,
		});
		const mesh = new THREE.InstancedMesh(geos[ti], mat, capacityPerType);
		mesh.frustumCulled = true;
		const colArr = new Float32Array(capacityPerType * 3);
		mesh.instanceColor = new THREE.InstancedBufferAttribute(colArr, 3);
		mesh.count = 0;
		scene.add(mesh);
		meshes.push(mesh);
	}
	const itemToSlot = new Int32Array(totalItems).fill(-1);
	const slotToItem = new Int32Array(totalItems).fill(-1);
	const loadedCounts = new Int32Array(numTypes);
	return { meshes, positions, types, colors, itemToSlot, slotToItem, totalItems, loadedCounts, capacityPerType };
}

export function updateCoralStreaming(
	field: CoralField,
	playerX: number,
	playerZ: number,
	amplitude: number,
	scale: number,
	sightRadius: number,
	sightRadiusSq?: number,
): void {
	const rSq = sightRadiusSq ?? sightRadius * sightRadius;
	const rUnload = rSq * 1.5;
	const loadedCounts = field.loadedCounts;
	const total = field.totalItems;
	let dirty = false;

	// Phase 1: Unload
	for (let si = field.totalItems - 1; si >= 0; si--) {
		const ii = field.slotToItem[si];
		if (ii === -1) continue;
		const wx = field.positions[ii * 2];
		const wz = field.positions[ii * 2 + 1];
		const dx = wx - playerX;
		const dz = wz - playerZ;
		if (dx * dx + dz * dz > rUnload) {
			const ti = field.types[ii];
			const loaded = loadedCounts[ti];
			const lastSlot = loaded - 1;
			if (si !== lastSlot) {
				const lastItem = field.slotToItem[lastSlot];
				field.meshes[ti].getMatrixAt(lastSlot, _mat4);
				field.meshes[ti].setMatrixAt(si, _mat4);
				if (field.meshes[ti].instanceColor) {
					field.meshes[ti].getColorAt(lastSlot, _color);
					field.meshes[ti].setColorAt(si, _color);
				}
				field.itemToSlot[lastItem] = si;
				field.slotToItem[si] = lastItem;
			}
			field.itemToSlot[ii] = -1;
			field.slotToItem[loaded - 1] = -1;
			loadedCounts[ti]--;
			dirty = true;
		}
	}

	// Phase 2: Load
	for (let ii = 0; ii < total; ii++) {
		if (field.itemToSlot[ii] !== -1) continue;
		const wx = field.positions[ii * 2];
		const wz = field.positions[ii * 2 + 1];
		const dx = wx - playerX;
		const dz = wz - playerZ;
		if (dx * dx + dz * dz < rSq) {
			const ti = field.types[ii];
			const slot = loadedCounts[ti];
			if (slot >= field.capacityPerType) continue;
			const h = getTerrainHeight(wx, wz, amplitude, scale);
			const size = 0.4 + ((field.positions[ii * 2] * 7 + field.positions[ii * 2 + 1] * 13) % 1) * 1.8;
			const rot = (field.positions[ii * 2] * 5 + field.positions[ii * 2 + 1] * 11) % (Math.PI * 2);
			_dummy.position.set(wx, h + size * 0.3, wz);
			_dummy.scale.setScalar(size);
			_dummy.rotation.set(0, rot, 0);
			_dummy.updateMatrix();
			field.meshes[ti].setMatrixAt(slot, _dummy.matrix);
			_color.setHex(field.colors[ii]);
			field.meshes[ti].setColorAt(slot, _color);
			field.itemToSlot[ii] = slot;
			field.slotToItem[slot] = ii;
			loadedCounts[ti]++;
			dirty = true;
		}
	}

	if (dirty) {
		for (let ti = 0; ti < field.meshes.length; ti++) {
			const m = field.meshes[ti];
			m.count = loadedCounts[ti];
			m.instanceMatrix.needsUpdate = true;
			if (m.instanceColor) m.instanceColor.needsUpdate = true;
		}
	}
}

// ── Initial Terrain ──

export function createInitialTerrainChunks(
	scene: THREE.Scene,
	amplitude: number,
	scale: number,
	mat: THREE.MeshStandardMaterial,
): TerrainChunk[] {
	const chunks: TerrainChunk[] = [];
	for (let gx = -CHUNK_RADIUS; gx <= CHUNK_RADIUS; gx++) {
		for (let gz = -CHUNK_RADIUS; gz <= CHUNK_RADIUS; gz++) {
			const ch = createTerrainChunk(gx, gz, amplitude, scale, mat);
			scene.add(ch.mesh);
			chunks.push(ch);
		}
	}
	return chunks;
}

export function disposeTerrainChunk(chunk: TerrainChunk, scene: THREE.Scene): void {
	scene.remove(chunk.mesh);
	chunk.mesh.geometry.dispose();
}
