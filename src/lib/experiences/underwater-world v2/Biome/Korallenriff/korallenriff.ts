import * as THREE from "three";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";

export type CoralBiome = "shallow" | "rocky" | "deep";

// ── OBJ URLs (loaded from Objekte/Korallen/) ──

const _objLoader = new OBJLoader();

const _brainUrl = new URL("../../Objekte/Korallen/Brain_Coral_v1_L1.123c952dcd3e-dc3a-41a5-b56e-548475a0de97/20941_Brain_Coral_v1_NEW1.obj", import.meta.url).href;
const _treeUrl = new URL("../../Objekte/Korallen/Tree_Coral_v2_L1.123c1b693a36-df33-4357-8bdb-fa7b5c1c4705/21488_Tree_Coral_v2_NEW.obj", import.meta.url).href;
const _elkhornUrl = new URL("../../Objekte/Korallen/Elkhorn_Coral_v1_L1.123c162a38a6-812c-4bfe-93ca-46d6f6fa2d9b/21485_Elkhorn_Coral_v1.obj", import.meta.url).href;
const _gorgonianUrl = new URL("../../Objekte/Korallen/Gorgonian_Soft_Coral_v1_L1.123cafe08258-2e9d-4e44-8094-0c6c8b63a0a0/21487_Gorgonian_Soft_Coral_v1.obj", import.meta.url).href;
const _genericUrl = new URL("../../Objekte/Korallen/Coral_v1_L3.123c0f57868f-362d-45ca-a546-9c6138fb292d/10010_Coral_v1_L3.obj", import.meta.url).href;

// ── Load helpers ──

async function loadObjGeometry(url: string): Promise<THREE.BufferGeometry | null> {
	try {
		const obj = await new Promise<THREE.Group>((resolve, reject) => {
			_objLoader.load(url, resolve, undefined, reject);
		});
		const meshes: THREE.Mesh[] = [];
		obj.traverse((child) => {
			if (child instanceof THREE.Mesh) meshes.push(child);
		});
		if (meshes.length === 0) return null;
		const geo = meshes[0].geometry.clone();
		geo.deleteAttribute("JOINTS_0");
		geo.deleteAttribute("WEIGHTS_0");
		geo.deleteAttribute("TEXCOORD_0");
		geo.computeBoundingBox();
		if (geo.boundingBox) {
			const minY = geo.boundingBox.min.y;
			const cx = (geo.boundingBox.max.x + geo.boundingBox.min.x) / 2;
			const cz = (geo.boundingBox.max.z + geo.boundingBox.min.z) / 2;
			geo.translate(-cx, -minY, -cz);
		}
		return geo;
	} catch {
		return null;
	}
}

// ── Simple FBM terrain ──

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

function getHeight(x: number, z: number, amp: number): number {
	const n = fbm(x * 0.05, z * 0.05, 3);
	return (n - 0.5) * amp;
}

// ── Procedural coral fallback ──

function createProceduralCoralGeometry(type: number): THREE.BufferGeometry {
	const geo = new THREE.IcosahedronGeometry(0.5, 2);
	const pos = geo.attributes.position;
	for (let i = 0; i < pos.count; i++) {
		let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
		const len = Math.sqrt(x * x + y * y + z * z);
		const nx = x / len, ny = y / len, nz = z / len;
		const s1 = Math.sin(x * 6 + y * 7 + z * 5 + type) * 0.3;
		const s2 = Math.sin(x * 13 + y * 15 + z * 10 + type * 2) * 0.2;
		const r = 1 + s1 + s2;
		x = nx * r * 0.6;
		y = ny * r * 0.6;
		z = nz * r * 0.6;
		if (ny < -0.3) {
			const t = Math.min(1, (ny + 0.3) / 0.35);
			y = y * (1 - t) + (-0.6) * t;
		}
		pos.setXYZ(i, x, y, z);
	}
	pos.needsUpdate = true;
	geo.computeVertexNormals();
	return geo;
}

// ── Rock geometry (jagged boulder) ──

function createRockGeometry(): THREE.BufferGeometry {
	const geo = new THREE.IcosahedronGeometry(0.5, 2);
	const pos = geo.attributes.position;
	for (let i = 0; i < pos.count; i++) {
		const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
		const len = Math.sqrt(x * x + y * y + z * z);
		const nx = x / len, ny = y / len, nz = z / len;
		const n1 = Math.sin(x * 5 + y * 6 + z * 4) * 0.5;
		const n2 = Math.sin(x * 11 + y * 13 + z * 9) * 0.25;
		const n3 = Math.sin(x * 20 + y * 18 + z * 22 + 1.3) * 0.12;
		const r = 1 + n1 + n2 + n3;
		pos.setXYZ(i, nx * r, ny * r * 0.6, nz * r);
	}
	pos.needsUpdate = true;
	geo.computeVertexNormals();
	return geo;
}

// ── Config per biome variant ──

interface CoralVariantConfig {
	label: string;
	peakCount: number;
	spread: number;
	terrainAmp: number;
	coralSize: [number, number];
	rockMin: number;
	rockMax: number;
	colors: number[];
	typeOrder: number[];
}

const BIOME_CONFIG: Record<CoralBiome, CoralVariantConfig> = {
	shallow: {
		label: "Flachriff",
		peakCount: 20,
		spread: 22,
		terrainAmp: 2.5,
		coralSize: [0.08, 0.2],
		rockMin: 0.3,
		rockMax: 7.0,
		colors: [0xff6644, 0xdd8855, 0xdd77aa, 0xcc8866, 0xff9966, 0xee7766, 0xffaa44, 0x77ccaa],
		typeOrder: [0, 1, 2, 3, 4],
	},
	rocky: {
		label: "Felsriff",
		peakCount: 16,
		spread: 24,
		terrainAmp: 4.5,
		coralSize: [0.12, 0.28],
		rockMin: 0.4,
		rockMax: 10.0,
		colors: [0x886644, 0x775533, 0x996644, 0x887755, 0x664433],
		typeOrder: [0, 2, 4],
	},
	deep: {
		label: "Tiefseeriff",
		peakCount: 14,
		spread: 26,
		terrainAmp: 3.5,
		coralSize: [0.1, 0.25],
		rockMin: 0.3,
		rockMax: 8.0,
		colors: [0x335566, 0x445577, 0x336677, 0x224466, 0x557788],
		typeOrder: [1, 3],
	},
};

// ── Interface ──

export interface CoralReef {
	terrain: THREE.Mesh;
	terrainMaterial: THREE.MeshStandardMaterial;
	rocks: THREE.InstancedMesh;
	rockMaterial: THREE.MeshStandardMaterial;
	coralMeshes: THREE.InstancedMesh[];
	coralMaterials: THREE.MeshStandardMaterial[];
}

// ── Create ──

async function loadAllGeometries(): Promise<(THREE.BufferGeometry | null)[]> {
	return await Promise.all([
		loadObjGeometry(_brainUrl),
		loadObjGeometry(_treeUrl),
		loadObjGeometry(_elkhornUrl),
		loadObjGeometry(_gorgonianUrl),
		loadObjGeometry(_genericUrl),
	]);
}

export async function createCoralReef(biome: CoralBiome, geoOverride?: THREE.BufferGeometry[]): Promise<CoralReef> {
	const cfg = BIOME_CONFIG[biome];
	const geos = geoOverride ?? (await loadAllGeometries());
	const tmpCol = new THREE.Color();

	// ── Terrain (mountainous seabed) ──
	const terrainSegs = 60;
	const terrainSize = 70;
	const terrainGeo = new THREE.PlaneGeometry(terrainSize, terrainSize, terrainSegs, terrainSegs);
	const tPos = terrainGeo.attributes.position;
	for (let i = 0; i < tPos.count; i++) {
		const x = tPos.getX(i);
		const z = tPos.getY(i);
		const h = getHeight(x, z, cfg.terrainAmp);
		const jagged = Math.sin(x * 0.3 + z * 0.2) * 0.3 + Math.sin(x * 0.7 + z * 0.5) * 0.15;
		tPos.setZ(i, h + jagged);
	}
	tPos.needsUpdate = true;
	terrainGeo.computeVertexNormals();
	const terrainMat = new THREE.MeshStandardMaterial({
		color: 0x1a2a3a,
		roughness: 0.9,
		flatShading: true,
	});
	const terrain = new THREE.Mesh(terrainGeo, terrainMat);
	terrain.rotation.x = -Math.PI / 2;
	terrain.position.y = -0.5;

	// ── Rock formations (mountain peaks) ──
	// Tall peaks rise from high terrain, smaller rocks cluster around them
	const rockGeo = createRockGeometry();
	const rockMat = new THREE.MeshStandardMaterial({
		vertexColors: true,
		roughness: 0.8,
		flatShading: true,
	});
	const rockColors = [0x445555, 0x3a4a4a, 0x556666, 0x334444, 0x2a3a3a, 0x4a5a5a];

	// Gather rock positions so corals can reference them
	const rockPositions: { x: number; y: number; z: number; height: number }[] = [];

	const totalRocks = cfg.peakCount * 5;
	const rockMesh = new THREE.InstancedMesh(rockGeo, rockMat, totalRocks);
	rockMesh.frustumCulled = true;
	const rockColorsAttr = new Float32Array(totalRocks * 3);
	const rDummy = new THREE.Object3D();
	let ri = 0;

	for (let p = 0; p < cfg.peakCount && ri < totalRocks; p++) {
		const pAngle = Math.random() * Math.PI * 2;
		const pDist = 2 + Math.random() * (cfg.spread - 2);
		const px = Math.cos(pAngle) * pDist;
		const pz = Math.sin(pAngle) * pDist;
		const ph = getHeight(px, pz, cfg.terrainAmp) - 0.5;

		// Peak height: terrain height drives rock size, power distribution creates a few giants
		const t = Math.random();
		const heightFactor = t * t * t * 0.7 + t * 0.3;
		const peakSize = cfg.rockMin + heightFactor * (cfg.rockMax - cfg.rockMin);

		// Main peak
		{
			const rs = peakSize;
			rDummy.position.set(px, ph + rs * 0.15, pz);
			rDummy.scale.set(rs, rs * (0.6 + Math.random() * 0.4), rs);
			rDummy.rotation.set(Math.random() * 0.4, Math.random() * Math.PI * 2, Math.random() * 0.2);
			rDummy.updateMatrix();
			rockMesh.setMatrixAt(ri, rDummy.matrix);
			const ci = Math.floor(Math.random() * rockColors.length);
			tmpCol.setHex(rockColors[ci]);
			rockColorsAttr[ri * 3] = tmpCol.r;
			rockColorsAttr[ri * 3 + 1] = tmpCol.g;
			rockColorsAttr[ri * 3 + 2] = tmpCol.b;
			rockPositions.push({ x: px, y: ph + rs * 0.7, z: pz, height: rs });
			ri++;
		}

		// Smaller rocks clustered around the peak
		const subCount = 2 + Math.floor(Math.random() * 3);
		for (let s = 0; s < subCount && ri < totalRocks; s++) {
			const sAngle = Math.random() * Math.PI * 2;
			const sDist = 1 + Math.random() * peakSize * 0.8;
			const sx = px + Math.cos(sAngle) * sDist;
			const sz = pz + Math.sin(sAngle) * sDist;
			const sh = getHeight(sx, sz, cfg.terrainAmp) - 0.5;
			// Sub rocks scale with peak size, with random variation
			const ss = peakSize * (0.15 + Math.random() * 0.4);
			rDummy.position.set(sx, sh + ss * 0.15, sz);
			rDummy.scale.set(ss, ss * (0.4 + Math.random() * 0.4), ss);
			rDummy.rotation.set(Math.random() * 0.5, Math.random() * Math.PI * 2, Math.random() * 0.3);
			rDummy.updateMatrix();
			rockMesh.setMatrixAt(ri, rDummy.matrix);
			const ci = Math.floor(Math.random() * rockColors.length);
			tmpCol.setHex(rockColors[ci]);
			rockColorsAttr[ri * 3] = tmpCol.r;
			rockColorsAttr[ri * 3 + 1] = tmpCol.g;
			rockColorsAttr[ri * 3 + 2] = tmpCol.b;
			rockPositions.push({ x: sx, y: sh + ss * 0.6, z: sz, height: ss });
			ri++;
		}
	}
	rockMesh.count = ri;
	rockMesh.instanceMatrix.needsUpdate = true;
	const rockColAttr = new THREE.InstancedBufferAttribute(rockColorsAttr, 3);
	rockMesh.instanceColor = rockColAttr;

	// ── Corals (sprouting from rock tops) ──
	const typeSet = cfg.typeOrder;
	const coralMeshes: THREE.InstancedMesh[] = [];
	const coralMaterials: THREE.MeshStandardMaterial[] = [];

	for (let ti = 0; ti < typeSet.length; ti++) {
		const typeIdx = typeSet[ti];
		const srcGeo = geos[typeIdx] ?? createProceduralCoralGeometry(typeIdx);
		const geo = srcGeo.clone();

		// Distribute corals across rock positions
		const coralsOnRock = Math.max(1, Math.floor(rockPositions.length / typeSet.length));
		const start = ti * coralsOnRock;
		const end = Math.min(start + coralsOnRock, rockPositions.length);
		const n = end - start;
		if (n <= 0) break;

		const mat = new THREE.MeshStandardMaterial({
			vertexColors: true,
			flatShading: true,
			roughness: 0.7,
			metalness: 0.05,
		});
		coralMaterials.push(mat);

		const mesh = new THREE.InstancedMesh(geo, mat, n);
		mesh.frustumCulled = true;
		const colors = new Float32Array(n * 3);
		const dummy = new THREE.Object3D();

		for (let i = 0; i < n; i++) {
			const rp = rockPositions[start + i];
			const size = cfg.coralSize[0] + Math.random() * (cfg.coralSize[1] - cfg.coralSize[0]);
			const ci = Math.floor(Math.random() * cfg.colors.length);
			tmpCol.setHex(cfg.colors[ci]);
			colors[i * 3] = tmpCol.r;
			colors[i * 3 + 1] = tmpCol.g;
			colors[i * 3 + 2] = tmpCol.b;

			// Coral sits on top of the rock
			const cx = rp.x + (Math.random() - 0.5) * rp.height * 0.3;
			const cz = rp.z + (Math.random() - 0.5) * rp.height * 0.3;
			const cy = rp.y + 0.05;

			dummy.position.set(cx, cy, cz);
			dummy.scale.setScalar(size);
			dummy.rotation.set(0, Math.random() * Math.PI * 2, 0);
			dummy.updateMatrix();
			mesh.setMatrixAt(i, dummy.matrix);
		}
		mesh.instanceMatrix.needsUpdate = true;
		const colAttr = new THREE.InstancedBufferAttribute(colors, 3);
		mesh.instanceColor = colAttr;

		coralMeshes.push(mesh);
	}

	return {
		terrain, terrainMaterial: terrainMat,
		rocks: rockMesh, rockMaterial: rockMat,
		coralMeshes, coralMaterials,
	};
}

export function disposeCoralReef(reef: CoralReef, scene: THREE.Scene): void {
	scene.remove(reef.terrain);
	reef.terrain.geometry.dispose();
	reef.terrainMaterial.dispose();

	scene.remove(reef.rocks);
	reef.rocks.geometry.dispose();
	reef.rockMaterial.dispose();

	for (const m of reef.coralMeshes) {
		scene.remove(m);
		m.geometry.dispose();
	}
	for (const mat of reef.coralMaterials) {
		mat.dispose();
	}
}
