import * as THREE from "three";

export type CoralBiome = "shallow" | "deep";

// ── Procedural Coral Geometries (5 distinct types) ──

function displaceVertices(geo: THREE.BufferGeometry, fn: (x: number, y: number, z: number) => { x: number; y: number; z: number }): void {
	const pos = geo.attributes.position;
	for (let i = 0; i < pos.count; i++) {
		const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
		const r = fn(x, y, z);
		pos.setXYZ(i, r.x, r.y, r.z);
	}
	pos.needsUpdate = true;
	geo.computeVertexNormals();
}

function addWhiteVertexColors(geo: THREE.BufferGeometry): void {
	const count = geo.attributes.position.count;
	const colors = new Float32Array(count * 3).fill(1);
	geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
}

function noise3(x: number, y: number, z: number): number {
	const n = Math.sin(x * 12.9898 + y * 78.233 + z * 45.164) * 43758.5453;
	return n - Math.floor(n);
}

function fbm3(x: number, y: number, z: number, octaves: number): number {
	let val = 0, amp = 0.5, freq = 1;
	for (let i = 0; i < octaves; i++) {
		val += amp * (noise3(x * freq, y * freq, z * freq) - 0.5) * 2;
		freq *= 2;
		amp *= 0.5;
	}
	return val;
}

/** Type 0 — Brain coral (Diploria): hemispherical dome with meandering serpentine grooves */
function createBrainCoralGeometry(): THREE.BufferGeometry {
	const geo = new THREE.IcosahedronGeometry(0.5, 4);
	const pos = geo.attributes.position;
	const tmpV = new THREE.Vector3();
	for (let i = 0; i < pos.count; i++) {
		tmpV.set(pos.getX(i), pos.getY(i), pos.getZ(i));
		const len = tmpV.length();
		if (len < 0.001) continue;
		const nx = tmpV.x / len, ny = tmpV.y / len, nz = tmpV.z / len;
		const up = ny;
		if (up < -0.15) { pos.setXYZ(i, 0, -0.5, 0); continue; }
		const upFactor = Math.max(0, up);
		const angle = Math.atan2(nz, nx);
		const rAngle = Math.atan2(nz * 0.7 + nx * 0.7, nx * 0.7 - nz * 0.7);
		const ridge1 = Math.abs(Math.sin(angle * 4 + rAngle * 3 + up * 2)) * 0.35;
		const ridge2 = Math.abs(Math.sin(angle * 7 - up * 5 + 1.8)) * 0.2;
		const ridge3 = Math.abs(Math.sin(angle * 11 + rAngle * 5 + up * 4 + 0.7)) * 0.12;
		const valley = (1 - Math.abs(Math.sin(angle * 4 + rAngle * 3 + up * 2))) * 0.15;
		const r = 0.5 + ridge1 + ridge2 + ridge3 - valley * 0.5 + upFactor * 0.1;
		pos.setXYZ(i, nx * r, ny * r * 0.7, nz * r);
	}
	pos.needsUpdate = true;
	geo.computeVertexNormals();
	addWhiteVertexColors(geo);
	return geo;
}

/** Type 1 — Tree coral (Dendrogyra): thick vertical branches with multiple fork levels */
function createTreeCoralGeometry(): THREE.BufferGeometry {
	const geos: THREE.BufferGeometry[] = [];
	const segs = 7;
	const trunk = new THREE.CylinderGeometry(0.08, 0.14, 0.6, segs);
	trunk.translate(0, 0.3, 0);
	geos.push(trunk);

	// First-level branches from mid/upper trunk
	const branchDefs = [
		{ y: 0.35, ry: 0, rx: 0.5, len: 0.3, rBase: 0.08, rTip: 0.04 },
		{ y: 0.38, ry: 1.2, rx: 0.7, len: 0.35, rBase: 0.09, rTip: 0.045 },
		{ y: 0.4, ry: 2.5, rx: 0.45, len: 0.25, rBase: 0.07, rTip: 0.035 },
		{ y: 0.42, ry: 3.8, rx: 0.6, len: 0.3, rBase: 0.08, rTip: 0.04 },
		{ y: 0.45, ry: 5.0, rx: 0.55, len: 0.28, rBase: 0.07, rTip: 0.035 },
	];
	for (const b of branchDefs) {
		const g = new THREE.CylinderGeometry(b.rTip, b.rBase, b.len, segs);
		g.translate(0, b.len / 2, 0);
		g.rotateX(b.rx);
		g.rotateY(b.ry);
		g.translate(0, b.y, 0);
		geos.push(g);

		// Sub-branch at tip
		const subLen = b.len * 0.5;
		const sg = new THREE.CylinderGeometry(b.rTip * 0.5, b.rTip * 0.8, subLen, segs);
		sg.translate(0, subLen / 2, 0);
		sg.rotateX(b.rx * 0.3 + 0.3);
		sg.rotateY(b.ry + 0.8);
		const tipX = Math.sin(b.rx) * Math.cos(b.ry) * b.len;
		const tipY = b.y + Math.cos(b.rx) * b.len;
		const tipZ = Math.sin(b.rx) * Math.sin(b.ry) * b.len;
		sg.translate(tipX, tipY, tipZ);
		geos.push(sg);
	}

	const merged = mergeBufferGeometries(geos);
	merged.computeBoundingBox();
	const minY = merged.boundingBox!.min.y;
	merged.translate(0, -minY, 0);
	addWhiteVertexColors(merged);
	return merged;
}

/** Merge any array of BufferGeometries */
function mergeBufferGeometries(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
	const total = geos.reduce((s, g) => s + g.attributes.position.count, 0);
	const pos = new Float32Array(total * 3);
	const nrm = new Float32Array(total * 3);
	let offset = 0;
	for (const g of geos) {
		g.computeVertexNormals();
		const p = g.attributes.position.array as Float32Array;
		const n = g.attributes.normal.array as Float32Array;
		pos.set(p, offset * 3);
		nrm.set(n, offset * 3);
		offset += p.length / 3;
	}
	const out = new THREE.BufferGeometry();
	out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
	out.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
	return out;
}

/** Type 2 — Elkhorn coral (Acropora palmata): broad flat antler branches */
function createElkhornCoralGeometry(): THREE.BufferGeometry {
	const geos: THREE.BufferGeometry[] = [];
	const segs = 6;

	const addAntlerBranch = (x: number, y: number, z: number, w: number, h: number, d: number, ry: number, rx: number) => {
		const g = new THREE.BoxGeometry(w, h, d, 4, 1, 2);
		g.translate(0, h / 2, 0);
		g.rotateX(rx);
		g.rotateY(ry);
		g.translate(x, y, z);
		displaceGeometry(g, 0.08, 3, 4);
		geos.push(g);
	};

	// Central stalk (flattened in Z)
	const stalk = new THREE.BoxGeometry(0.08, 0.5, 0.25, 4, 4, 2);
	displaceGeometry(stalk, 0.04, 2, 3);
	geos.push(stalk);

	// Antler branches spreading outward like elk horns
	addAntlerBranch(0, 0.35, 0, 0.35, 0.3, 0.12, -0.3, 0.4);
	addAntlerBranch(0, 0.35, 0, 0.35, 0.3, 0.12,  0.3, 0.4);
	addAntlerBranch(0, 0.45, 0, 0.25, 0.25, 0.1, -0.8, 0.6);
	addAntlerBranch(0, 0.45, 0, 0.25, 0.25, 0.1,  0.8, 0.6);
	addAntlerBranch(0, 0.5, 0, 0.2, 0.2, 0.08,  -1.6, 0.8);
	addAntlerBranch(0, 0.5, 0, 0.2, 0.2, 0.08,   1.6, 0.8);
	addAntlerBranch(0, 0.55, 0, 0.15, 0.15, 0.06, -2.4, 1.0);
	addAntlerBranch(0, 0.55, 0, 0.15, 0.15, 0.06,  2.4, 1.0);

	const merged = mergeBufferGeometries(geos);
	merged.computeBoundingBox();
	const minY = merged.boundingBox!.min.y;
	merged.translate(0, -minY, 0);
	addWhiteVertexColors(merged);
	return merged;
}

/** Type 3 — Gorgonian/Fan coral (Gorgonia): intricate fan-shaped lattice */
function createFanCoralGeometry(): THREE.BufferGeometry {
	const cols = 14;
	const rows = 12;
	const geo = new THREE.PlaneGeometry(0.9, 0.6, cols, rows);
	const pos = geo.attributes.position;
	for (let i = 0; i < pos.count; i++) {
		const x = pos.getX(i);
		const y = pos.getY(i);
		const u = (x / 0.9 + 0.5);
		const v = (y / 0.6 + 0.5);
		const dist = Math.sqrt(u * u + v * v);
		const mask = Math.max(0, 1 - (dist / 1.1) ** 3);
		const fanShape = 1 - Math.pow(1 - v, 1.5);
		const taper = 1 - (1 - v) * 0.4;
		const spread = fanShape * 0.9 + 0.1;
		const nx = x * spread * taper;
		const ny = y;
		const branchA = Math.sin(u * 15 + v * 12) * 0.08;
		const branchB = Math.sin(u * 22 + v * 18 + 1.3) * 0.05;
		const branchC = Math.sin(u * 10 - v * 8) * 0.06;
		const zOffset = (branchA + branchB + branchC) * mask;
		pos.setXYZ(i, nx, ny, zOffset);
	}
	pos.needsUpdate = true;
	geo.computeVertexNormals();
	geo.rotateX(-Math.PI / 2);
	addWhiteVertexColors(geo);
	return geo;
}

function displaceGeometry(geo: THREE.BufferGeometry, amount: number, freq1: number, freq2: number): void {
	const pos = geo.attributes.position;
	for (let i = 0; i < pos.count; i++) {
		const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
		const d = (Math.sin(x * freq1 + y * freq2) + Math.sin(x * freq2 - y * freq1 + 1.7) + Math.sin(x * freq1 * 1.5 + z * freq2 * 1.3 + 0.9)) * amount;
		const n = Math.sqrt(x * x + y * y + z * z) || 0.001;
		pos.setXYZ(i, x + (x / n) * d, y + (y / n) * d, z + (z / n) * d);
	}
	pos.needsUpdate = true;
}

/** Type 4 — Digitate/Branching coral (Acropora digitifera): multiple thick finger-like branches from a base */
function createDigitateCoralGeometry(): THREE.BufferGeometry {
	const geos: THREE.BufferGeometry[] = [];
	const segs = 7;
	const numBranches = 8 + Math.floor(Math.random() * 4);
	const angles: number[] = [];
	for (let i = 0; i < numBranches; i++) {
		angles.push((i / numBranches) * Math.PI * 2 + (Math.random() - 0.5) * 0.4);
	}
	for (let i = 0; i < numBranches; i++) {
		const angle = angles[i];
		const tilt = 0.2 + Math.random() * 0.5;
		const len = 0.2 + Math.random() * 0.35;
		const rBase = 0.04 + Math.random() * 0.04;
		const rTip = 0.03 + Math.random() * 0.03;
		const yOff = 0.02;
		const g = new THREE.CylinderGeometry(rTip, rBase, len, segs);
		g.translate(0, len / 2, 0);
		g.rotateX(tilt);
		g.rotateY(angle);
		g.translate(0, yOff, 0);
		// Round tip with small sphere
		const tip = new THREE.SphereGeometry(rTip * 1.1, 5, 4);
		const tipX = Math.sin(tilt) * Math.cos(angle) * len;
		const tipY = yOff + Math.cos(tilt) * len;
		const tipZ = Math.sin(tilt) * Math.sin(angle) * len;
		tip.translate(tipX, tipY, tipZ);
		geos.push(g, tip);

		// Occasional small sub-branch
		if (Math.random() < 0.3) {
			const subAngle = angle + (Math.random() - 0.5) * 1.0;
			const subTilt = tilt + 0.2 + Math.random() * 0.3;
			const subLen = len * (0.4 + Math.random() * 0.3);
			const subR = rBase * 0.5;
			const sg = new THREE.CylinderGeometry(subR, subR * 1.2, subLen, 5);
			const midX = Math.sin(tilt) * Math.cos(angle) * len * 0.5;
			const midY = yOff + Math.cos(tilt) * len * 0.5;
			const midZ = Math.sin(tilt) * Math.sin(angle) * len * 0.5;
			sg.translate(0, subLen / 2, 0);
			sg.rotateX(subTilt);
			sg.rotateY(subAngle);
			sg.translate(midX, midY, midZ);
			geos.push(sg);
		}
	}
	// Small base mound
	const base = new THREE.SphereGeometry(0.08, 6, 5, 0, Math.PI * 2, 0, Math.PI / 2);
	base.translate(0, 0.01, 0);
	geos.push(base);

	const merged = mergeBufferGeometries(geos);
	merged.computeBoundingBox();
	const minY = merged.boundingBox!.min.y;
	merged.translate(0, -minY, 0);
	addWhiteVertexColors(merged);
	return merged;
}

export function createProceduralCoralGeometry(type: number): THREE.BufferGeometry {
	switch (type) {
		case 0: return createBrainCoralGeometry();
		case 1: return createTreeCoralGeometry();
		case 2: return createElkhornCoralGeometry();
		case 3: return createFanCoralGeometry();
		case 4: return createDigitateCoralGeometry();
		default: return createBrainCoralGeometry();
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

// ── Rock geometry (jagged boulder) ──

export function createRockGeometry(): THREE.BufferGeometry {
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
	addWhiteVertexColors(geo);
	return geo;
}

// ── Config per biome variant (based on real reef types) ──
//   shallow → Fringing Reef (lagoon / reef flat — warm, diverse, gentle)
//   deep    → Fore Reef (reef slope — deep drop-off, tall/soft corals)

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
	rocksPerPeak: number;
	coralsPerRock: number;
}

	const BIOME_CONFIG: Record<CoralBiome, CoralVariantConfig> = {
	shallow: {
		label: "Saumriff (Fringing Reef)",
		peakCount: 30,
		spread: 32,
		terrainAmp: 1.8,
		coralSize: [0.5, 1.5],
		rockMin: 0.2,
		rockMax: 5.0,
		colors: [0xff4466, 0xff8844, 0xffcc44, 0xee55aa, 0xff6644, 0xdd77aa, 0x44ddaa, 0xffaa44, 0xee5599, 0x66ddaa],
		typeOrder: [0, 1, 2, 3, 4],
		rocksPerPeak: 8,
		coralsPerRock: 4,
	},
	deep: {
		label: "Hangriff (Fore Reef)",
		peakCount: 18,
		spread: 34,
		terrainAmp: 4.0,
		coralSize: [0.6, 2.0],
		rockMin: 0.3,
		rockMax: 9.0,
		colors: [0x4488ff, 0x66ddff, 0xaa88ff, 0x3366cc, 0x44aaff, 0x8866dd],
		typeOrder: [0, 1, 2, 3, 4],
		rocksPerPeak: 8,
		coralsPerRock: 4,
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

export function createCoralReef(biome: CoralBiome): CoralReef {
	const cfg = BIOME_CONFIG[biome];
	const geos = [0, 1, 2, 3, 4].map((t) => createProceduralCoralGeometry(t));
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

	const totalRocks = cfg.peakCount * cfg.rocksPerPeak;
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
		const srcGeo = geos[typeIdx];
		const geo = srcGeo.clone();

		// Distribute corals across rock positions, multiple per rock
		const rocksPerType = Math.max(1, Math.floor(rockPositions.length / typeSet.length));
		const start = ti * rocksPerType;
		const n = rocksPerType * cfg.coralsPerRock;
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
			const rockIdx = start + Math.floor(i / cfg.coralsPerRock);
			const rp = rockPositions[rockIdx];
			const size = cfg.coralSize[0] + Math.random() * (cfg.coralSize[1] - cfg.coralSize[0]);
			const ci = Math.floor(Math.random() * cfg.colors.length);
			tmpCol.setHex(cfg.colors[ci]);
			colors[i * 3] = tmpCol.r;
			colors[i * 3 + 1] = tmpCol.g;
			colors[i * 3 + 2] = tmpCol.b;

			// Coral sits on top of the rock with platform sunk inside the rock body
			const cx = rp.x + (Math.random() - 0.5) * rp.height * 0.5;
			const cz = rp.z + (Math.random() - 0.5) * rp.height * 0.5;
			const cy = rp.y - rp.height * 0.15;

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
