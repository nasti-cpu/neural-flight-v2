import * as THREE from "three";
import type { UnderwaterWorldState } from "../scene";

export const TERRAIN_BASE_Y = -3;

export function hash2d(x: number, y: number): number {
	const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
	return n - Math.floor(n);
}

export function noise2d(x: number, y: number): number {
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

export function fbm(x: number, y: number, octaves: number): number {
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

const BIOME_FREQ = 0.005;
const BIOME_BLEND = 0.15;

export function getBiome(wx: number, wz: number): number {
	return fbm(wx * BIOME_FREQ, wz * BIOME_FREQ, 2);
}

function lerp(a: number, b: number, t: number): number {
	return a + (b - a) * t;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
	const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
	return t * t * (3 - 2 * t);
}

export function getBiomeParams(biome: number, baseAmp: number, baseScale: number): { amp: number; scale: number; color: THREE.Color } {
	const mountain: { amp: number; scale: number; color: THREE.Color } = {
		amp: baseAmp * 1.0,
		scale: baseScale * 1.0,
		color: new THREE.Color(0x3a5a7a),
	};
	const flat: { amp: number; scale: number; color: THREE.Color } = {
		amp: baseAmp * 0.4,
		scale: baseScale * 0.7,
		color: new THREE.Color(0xc4a87a),
	};
	const city: { amp: number; scale: number; color: THREE.Color } = {
		amp: baseAmp * 0.3,
		scale: baseScale * 0.6,
		color: new THREE.Color(0x4a4a6a),
	};

	if (biome < 0.55 - BIOME_BLEND) return mountain;
	if (biome < 0.55 + BIOME_BLEND) {
		const t = smoothstep(0.55 - BIOME_BLEND, 0.55 + BIOME_BLEND, biome);
		return {
			amp: lerp(mountain.amp, flat.amp, t),
			scale: lerp(mountain.scale, flat.scale, t),
			color: mountain.color.clone().lerp(flat.color, t),
		};
	}
	if (biome < 0.75 - BIOME_BLEND) return flat;
	if (biome < 0.75 + BIOME_BLEND) {
		const t = smoothstep(0.75 - BIOME_BLEND, 0.75 + BIOME_BLEND, biome);
		return {
			amp: lerp(flat.amp, city.amp, t),
			scale: lerp(flat.scale, city.scale, t),
			color: flat.color.clone().lerp(city.color, t),
		};
	}
	return city;
}

export function getTerrainHeight(x: number, z: number, amplitude: number, scale: number): number {
	return (fbm(x * scale, z * scale, 4) - 0.5) * 2 * amplitude + TERRAIN_BASE_Y;
}

export interface TerrainChunk {
	mesh: THREE.Mesh;
	gx: number;
	gz: number;
}

export function fillTerrainGeometry(
	geo: THREE.BufferGeometry,
	centerX: number,
	centerZ: number,
	baseAmp: number,
	baseScale: number,
): void {
	const pos = geo.attributes.position;
	let col = geo.attributes.color as THREE.BufferAttribute;
	if (!col) {
		const arr = new Float32Array(pos.count * 3);
		col = new THREE.BufferAttribute(arr, 3);
		geo.setAttribute("color", col);
	}
	for (let i = 0; i < pos.count; i++) {
		const wx = pos.getX(i) + centerX;
		const wz = pos.getZ(i) + centerZ;
		const biome = getBiome(wx, wz);
		const p = getBiomeParams(biome, baseAmp, baseScale);
		const h = (fbm(wx * p.scale, wz * p.scale, 4) - 0.5) * 2 * p.amp;
		pos.setY(i, h);
		col.setXYZ(i, p.color.r, p.color.g, p.color.b);
	}
	pos.needsUpdate = true;
	col.needsUpdate = true;
	geo.computeVertexNormals();
}

export function createTerrainChunk(gx: number, gz: number, baseAmp: number, baseScale: number, mat: THREE.MeshStandardMaterial, chunkSize: number, chunkSegments: number): TerrainChunk {
	const cx = gx * chunkSize;
	const cz = gz * chunkSize;
	const geo = new THREE.PlaneGeometry(chunkSize, chunkSize, chunkSegments, chunkSegments);
	geo.rotateX(-Math.PI / 2);
	fillTerrainGeometry(geo, cx, cz, baseAmp, baseScale);
	const mesh = new THREE.Mesh(geo, mat);
	mesh.position.set(cx, TERRAIN_BASE_Y, cz);
	mesh.receiveShadow = true;
	mesh.castShadow = true;
	return { mesh, gx, gz };
}

export function smoothChunkEdge(
	geo: THREE.BufferGeometry,
	chunkSize: number,
	blendWidth: number,
): void {
	const pos = geo.attributes.position;
	const edge = chunkSize / 2;
	for (let i = 0; i < pos.count; i++) {
		const x = pos.getX(i);
		const z = pos.getZ(i);
		const distX = Math.abs(x) / edge;
		const distZ = Math.abs(z) / edge;
		const blend = 1 - Math.max(0, Math.max(distX, distZ) - (1 - blendWidth / edge)) / (blendWidth / edge);
		if (blend < 1) {
			pos.setY(i, pos.getY(i) * blend);
		}
	}
	pos.needsUpdate = true;
}
