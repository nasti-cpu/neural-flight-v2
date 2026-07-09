import * as THREE from "three";

export const CHUNK_SIZE = 400;
export const CHUNK_SEGMENTS = 32;
export const TERRAIN_BASE_Y = -3;
export const BIOME_FREQ = 0.0025;
export const BIOME_BLEND = 0.08;

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

interface BiomeParams {
	ampMul: number;
	scaleMul: number;
	color: THREE.Color;
}

const MOUNTAIN: BiomeParams = { ampMul: 1.0, scaleMul: 1.0, color: new THREE.Color(0x3a5a7a) };
const FLAT: BiomeParams = { ampMul: 0.7, scaleMul: 0.8, color: new THREE.Color(0x3a7a5a) };
const SAND: BiomeParams = { ampMul: 0.4, scaleMul: 0.7, color: new THREE.Color(0xc4a87a) };

export function getBiomeParams(biome: number): BiomeParams {
	if (biome < 0.25 - BIOME_BLEND) return MOUNTAIN;
	if (biome < 0.25 + BIOME_BLEND) {
		const t = smoothstep(0.25 - BIOME_BLEND, 0.25 + BIOME_BLEND, biome);
		return {
			ampMul: lerp(MOUNTAIN.ampMul, FLAT.ampMul, t),
			scaleMul: lerp(MOUNTAIN.scaleMul, FLAT.scaleMul, t),
			color: MOUNTAIN.color.clone().lerp(FLAT.color, t),
		};
	}
	if (biome < 0.50 - BIOME_BLEND) return FLAT;
	if (biome < 0.50 + BIOME_BLEND) {
		const t = smoothstep(0.50 - BIOME_BLEND, 0.50 + BIOME_BLEND, biome);
		return {
			ampMul: lerp(FLAT.ampMul, SAND.ampMul, t),
			scaleMul: lerp(FLAT.scaleMul, SAND.scaleMul, t),
			color: FLAT.color.clone().lerp(SAND.color, t),
		};
	}
	return SAND;
}

export function getTerrainHeight(x: number, z: number, amplitude: number, scale: number): number {
	const biome = getBiome(x, z);
	const p = getBiomeParams(biome);
	return (fbm(x * scale * p.scaleMul, z * scale * p.scaleMul, 4) - 0.5) * 2 * amplitude * p.ampMul + TERRAIN_BASE_Y;
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
	amplitude: number,
	scale: number,
	baseColor?: THREE.Color,
): void {
	const pos = geo.attributes.position;
	let col = geo.attributes.color as THREE.BufferAttribute;
	if (!col) {
		col = new THREE.BufferAttribute(new Float32Array(pos.count * 3), 3);
		geo.setAttribute("color", col);
	}
	const bc = baseColor ?? new THREE.Color(0xffffff);
	for (let i = 0; i < pos.count; i++) {
		const wx = pos.getX(i) + centerX;
		const wz = pos.getZ(i) + centerZ;
		const biome = getBiome(wx, wz);
		const p = getBiomeParams(biome);
		let h = (fbm(wx * scale * p.scaleMul, wz * scale * p.scaleMul, 4) - 0.5) * 2 * amplitude * p.ampMul;
		if (!isFinite(h)) h = 0;
		pos.setY(i, h);
		const c = p.color.clone().multiply(bc);
		col.setXYZ(i, c.r, c.g, c.b);
	}
	pos.needsUpdate = true;
	col.needsUpdate = true;
	geo.computeVertexNormals();
}

export function createTerrainChunk(
	gx: number, gz: number,
	amplitude: number, scale: number,
	mat: THREE.MeshStandardMaterial,
	chunkSize: number = CHUNK_SIZE,
	chunkSegments: number = CHUNK_SEGMENTS,
	baseColor?: THREE.Color,
): TerrainChunk {
	const cx = gx * chunkSize;
	const cz = gz * chunkSize;
	const geo = new THREE.PlaneGeometry(chunkSize, chunkSize, chunkSegments, chunkSegments);
	geo.rotateX(-Math.PI / 2);
	fillTerrainGeometry(geo, cx, cz, amplitude, scale, baseColor);
	const mesh = new THREE.Mesh(geo, mat);
	mesh.position.set(cx, TERRAIN_BASE_Y, cz);
	mesh.receiveShadow = true;
	mesh.castShadow = true;
	return { mesh, gx, gz };
}
