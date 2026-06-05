import * as THREE from "three";

// ── Noise helpers ──

function hash(x: number, y: number): number {
	let h = x * 374761393 + y * 668265263;
	h = (h ^ (h >> 13)) * 1274126177;
	return ((h ^ (h >> 16)) & 0x7fffffff) / 0x7fffffff;
}

function smoothNoise(x: number, z: number): number {
	const ix = Math.floor(x), iz = Math.floor(z);
	const fx = x - ix, fz = z - iz;
	const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
	const n00 = hash(ix, iz);
	const n10 = hash(ix + 1, iz);
	const n01 = hash(ix, iz + 1);
	const n11 = hash(ix + 1, iz + 1);
	const nx0 = n00 + (n10 - n00) * sx;
	const nx1 = n01 + (n11 - n01) * sx;
	return nx0 + (nx1 - nx0) * sz;
}

function fbm(x: number, z: number, octaves: number): number {
	let val = 0, amp = 1, freq = 1, max = 0;
	for (let i = 0; i < octaves; i++) {
		val += smoothNoise(x * freq, z * freq) * amp;
		max += amp;
		amp *= 0.5;
		freq *= 2;
	}
	return val / max;
}

const TERRAIN_COLOR = 0xccaa77;
const TERRAIN_AMP = 1.5;
const NOISE_FREQ = 0.08;
const OCTAVES = 3;

// ── Interface ──

export interface DuneSandResult {
	terrain: THREE.Mesh;
	terrainMaterial: THREE.MeshStandardMaterial;
}

// ── Create ──

export function getSandHeight(x: number, z: number): number {
	const n = fbm(x * NOISE_FREQ, z * NOISE_FREQ, OCTAVES);
	return (n - 0.5) * TERRAIN_AMP;
}

export function createDuneSand(): DuneSandResult {
	const segs = 80;
	const size = 70;
	const geo = new THREE.PlaneGeometry(size, size, segs, segs);
	const pos = geo.attributes.position;

	for (let i = 0; i < pos.count; i++) {
		const x = pos.getX(i);
		const z = pos.getY(i);
		const n = fbm(x * NOISE_FREQ, z * NOISE_FREQ, OCTAVES);
		const h = (n - 0.5) * TERRAIN_AMP;
		pos.setZ(i, isFinite(h) ? h : 0);
	}
	pos.needsUpdate = true;
	geo.computeVertexNormals();

	const mat = new THREE.MeshStandardMaterial({
		color: TERRAIN_COLOR,
		roughness: 0.95,
		metalness: 0.0,
		flatShading: true,
	});

	const mesh = new THREE.Mesh(geo, mat);
	mesh.rotation.x = -Math.PI / 2;
	mesh.position.y = -0.5;

	return { terrain: mesh, terrainMaterial: mat };
}

export function disposeDuneSand(result: DuneSandResult, scene: THREE.Scene): void {
	scene.remove(result.terrain);
	result.terrain.geometry.dispose();
	result.terrainMaterial.dispose();
}
