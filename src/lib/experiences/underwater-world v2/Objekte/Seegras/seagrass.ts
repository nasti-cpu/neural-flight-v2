import * as THREE from "three";

export type SeagrassType = "algae" | "long" | "bushy";

// ── Single blade geometry (ribbon, base at origin) ──

function createBladeGeometry(length: number, width: number, curveAmt: number): THREE.BufferGeometry {
	const segs = 10;
	const positions: number[] = [];
	const indices: number[] = [];
	const uvs: number[] = [];

	for (let i = 0; i <= segs; i++) {
		const t = i / segs;
		const y = t * length;
		const w = width * (1 - t * 0.6);
		const bend = Math.sin(t * Math.PI) * curveAmt;

		positions.push(-w / 2, y, bend, w / 2, y, bend);
		uvs.push(0, t, 1, t);

		if (i < segs) {
			const a = i * 2, b = i * 2 + 1;
			indices.push(a, a + 2, a + 1);
			indices.push(a + 1, a + 2, a + 3);
		}
	}

	const geo = new THREE.BufferGeometry();
	geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
	geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
	geo.setIndex(indices);
	geo.computeVertexNormals();
	return geo;
}

// ── Algae frond geometry (wide, ruffled, irregular) ──

function createAlgaeGeometry(length: number, width: number, ruffles: number): THREE.BufferGeometry {
	const segs = 14;
	const positions: number[] = [];
	const indices: number[] = [];
	const uvs: number[] = [];

	for (let i = 0; i <= segs; i++) {
		const t = i / segs;
		const y = t * length;
		const taper = 1 - t * 0.65;
		const ruffle = 1 + Math.sin(t * Math.PI * 3.7 + ruffles * 4) * 0.2 * taper + Math.sin(t * Math.PI * 7.3) * 0.08;
		const w = width * taper * ruffle;
		const cx = Math.sin(t * Math.PI * 4 + ruffles * 2) * width * 0.12 * taper;
		const bend = Math.sin(t * Math.PI) * (ruffles * 0.3 + 0.2);

		positions.push(-w / 2 + cx, y, bend, w / 2 + cx, y, bend);
		uvs.push(0, t, 1, t);

		if (i < segs) {
			const a = i * 2, b = i * 2 + 1;
			indices.push(a, a + 2, a + 1);
			indices.push(a + 1, a + 2, a + 3);
		}
	}

	const geo = new THREE.BufferGeometry();
	geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
	geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
	geo.setIndex(indices);
	geo.computeVertexNormals();
	return geo;
}

// ── Types ──

interface SeagrassConfig {
	count: number;
	lengthRange: [number, number];
	widthRange: [number, number];
	curveRange: [number, number];
	color: number;
	spread: number;
	density: number;
	speed: number;
}

const CONFIG: Record<SeagrassType, SeagrassConfig> = {
	algae: {
		count: 220,
		lengthRange: [2, 5],
		widthRange: [0.3, 0.7],
		curveRange: [0.2, 0.7],
		color: 0x668844,
		spread: 28,
		density: 0.5,
		speed: 1.4,
	},
	long: {
		count: 200,
		lengthRange: [4, 9],
		widthRange: [0.12, 0.3],
		curveRange: [0.3, 0.9],
		color: 0x338833,
		spread: 32,
		density: 0.3,
		speed: 0.8,
	},
	bushy: {
		count: 180,
		lengthRange: [3, 6],
		widthRange: [0.15, 0.35],
		curveRange: [0.2, 0.6],
		color: 0x44aa44,
		spread: 28,
		density: 0.5,
		speed: 1.0,
	},
};

// ── Per-blade state ──

interface BladeInst {
	mesh: THREE.Mesh;
	origin: THREE.Vector3;
	phase: number;
	amp: number;
	length: number;
}

export interface SeagrassMeadow {
	blades: BladeInst[];
	group: THREE.Group;
}

// ── Create meadow ──

export function createSeagrassMeadow(type: SeagrassType, terrainHeight: (x: number, z: number) => number): SeagrassMeadow {
	const cfg = CONFIG[type];
	const group = new THREE.Group();
	const blades: BladeInst[] = [];

	const mat = new THREE.MeshStandardMaterial({
		color: cfg.color,
		roughness: 0.6,
		metalness: 0.0,
		side: THREE.DoubleSide,
		transparent: true,
		opacity: 0.85,
	});

	const bladeGeos = new Map<string, THREE.BufferGeometry>();

	// Generate cluster centers for natural distribution
	const clusterCount = Math.max(4, Math.floor(cfg.count / 25));
	const clusters: { x: number; z: number; tightness: number }[] = [];
	for (let c = 0; c < clusterCount; c++) {
		clusters.push({
			x: (Math.random() - 0.5) * cfg.spread,
			z: (Math.random() - 0.5) * cfg.spread,
			tightness: 0.3 + Math.random() * 1.2,
		});
	}

	for (let i = 0; i < cfg.count; i++) {
		const len = cfg.lengthRange[0] + Math.random() * (cfg.lengthRange[1] - cfg.lengthRange[0]);
		const w = cfg.widthRange[0] + Math.random() * (cfg.widthRange[1] - cfg.widthRange[0]);
		const curve = cfg.curveRange[0] + Math.random() * (cfg.curveRange[1] - cfg.curveRange[0]);

		const key = `${len.toFixed(1)}_${w.toFixed(2)}_${curve.toFixed(2)}`;
		let geo = bladeGeos.get(key);
		if (!geo) {
			if (type === "algae") {
				geo = createAlgaeGeometry(len, w, curve);
			} else {
				geo = createBladeGeometry(len, w, curve);
			}
			bladeGeos.set(key, geo);
		}

		const mesh = new THREE.Mesh(geo, mat);
		mesh.frustumCulled = true;

		// Cluster-based position: tight = nah am Zentrum, loose = weiter weg
		const ci = Math.floor(Math.random() * clusters.length);
		const cl = clusters[ci];
		const dist = (0.2 + Math.random() * 0.8) * cl.tightness * (cfg.spread / clusterCount);
		const ca = Math.random() * Math.PI * 2;
		const wx = cl.x + Math.cos(ca) * dist;
		const wz = cl.z + Math.sin(ca) * dist;
		const wy = terrainHeight(wx, wz);

		// Random rotation around Y
		const rotY = Math.random() * Math.PI * 2;
		// Slight tilt
		const tiltX = (Math.random() - 0.5) * 0.15;
		const tiltZ = (Math.random() - 0.5) * 0.15;

		mesh.position.set(wx, wy, wz);
		mesh.rotation.set(tiltX, rotY, tiltZ);
		group.add(mesh);

		blades.push({
			mesh,
			origin: new THREE.Vector3(wx, wy, wz),
			phase: Math.random() * Math.PI * 2,
			amp: 0.03 + Math.random() * 0.06,
			length: len,
		});
	}

	return { blades, group };
}

// ── Update sway per frame ──

export function updateSeagrassSway(meadow: SeagrassMeadow, elapsed: number, type: SeagrassType): void {
	const cfg = CONFIG[type];
	for (const b of meadow.blades) {
		const sway = Math.sin(elapsed * cfg.speed + b.phase) * b.amp;
		b.mesh.position.x = b.origin.x + sway;
	}
}

// ── Dispose ──

export function disposeSeagrassMeadow(meadow: SeagrassMeadow, scene: THREE.Scene): void {
	scene.remove(meadow.group);
	const disposed = new Set<string>();
	meadow.group.traverse((child) => {
		if (child instanceof THREE.Mesh) {
			const key = child.geometry.uuid;
			if (!disposed.has(key)) {
				child.geometry.dispose();
				disposed.add(key);
			}
			if (child.material instanceof THREE.Material) child.material.dispose();
		}
	});
}
