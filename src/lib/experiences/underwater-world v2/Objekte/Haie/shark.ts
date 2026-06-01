import * as THREE from "three";
import { loadGLTF } from "$lib/three/loader";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export type SharkMode = "patrol" | "hunt" | "breach";

export interface SharkPack {
	mesh: THREE.InstancedMesh;
	positions: Float32Array;
	velocities: Float32Array;
	phases: Float32Array;
	scales: Float32Array;
	rotations: Float32Array;
	pitches: Float32Array;
	count: number;
	material: THREE.MeshStandardMaterial;
	dir: number;
	dirTimer: number;
}

export function createProceduralSharkGeometry(): THREE.BufferGeometry {
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

const _sharkUrl = "/models/shark.glb";

export async function loadSharkGeometry(): Promise<THREE.BufferGeometry | null> {
	try {
		const gltf = await loadGLTF(_sharkUrl);
		const meshes: THREE.Mesh[] = [];
		gltf.scene.traverse((child) => {
			if (child instanceof THREE.Mesh) meshes.push(child);
		});
		const m = meshes[0];
		if (m) {
			const geo = m.geometry.clone();
			geo.deleteAttribute("JOINTS_0");
			geo.deleteAttribute("WEIGHTS_0");
			geo.deleteAttribute("TEXCOORD_0");
			geo.rotateY(Math.PI);
			geo.center();
			return geo;
		}
	} catch {
		/* fallback to procedural */
	}
	return null;
}

const SHARK_COLORS: [number, number, number][] = [
	[0.35, 0.45, 0.55],
	[0.40, 0.50, 0.60],
	[0.30, 0.38, 0.48],
];

interface SharkConfig {
	speed: number;
	turnRate: number;
	wanderAmp: number;
	tailFreq: number;
	tailAmp: number;
	verticalAmp: number;
	verticalFreq: number;
	breachY: number;
}

const MODE_CONFIG: Record<SharkMode, SharkConfig> = {
	patrol: {
		speed: 2.5,
		turnRate: 0.6,
		wanderAmp: 0.3,
		tailFreq: 0.5,
		tailAmp: 0.06,
		verticalAmp: 0.5,
		verticalFreq: 0.15,
		breachY: 0,
	},
	hunt: {
		speed: 5,
		turnRate: 2.0,
		wanderAmp: 0.6,
		tailFreq: 1.0,
		tailAmp: 0.12,
		verticalAmp: 1.2,
		verticalFreq: 0.3,
		breachY: 0,
	},
	breach: {
		speed: 4,
		turnRate: 0.8,
		wanderAmp: 0.2,
		tailFreq: 0.6,
		tailAmp: 0.08,
		verticalAmp: 0,
		verticalFreq: 0,
		breachY: 12,
	},
};

export function createSharkPack(
	count: number,
	modelGeo?: THREE.BufferGeometry,
	spread = 10,
	heightRange = 6,
): SharkPack {
	const positions = new Float32Array(count * 3);
	const velocities = new Float32Array(count * 3);
	const phases = new Float32Array(count);
	const scales = new Float32Array(count);
	const rotations = new Float32Array(count);
	const pitches = new Float32Array(count);

	for (let i = 0; i < count; i++) {
		positions[i * 3] = (Math.random() - 0.5) * spread;
		positions[i * 3 + 1] = (Math.random() - 0.5) * heightRange;
		positions[i * 3 + 2] = (Math.random() - 0.5) * spread;
		velocities[i * 3] = (Math.random() - 0.5) * 0.3;
		velocities[i * 3 + 1] = 0;
		velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.3;
		phases[i] = Math.random() * Math.PI * 2;
		scales[i] = 0.8 + Math.random() * 0.4;
		rotations[i] = Math.random() * Math.PI * 2;
		pitches[i] = 0;
	}

	const geo = (modelGeo ?? createProceduralSharkGeometry()).clone();
	const colors = new Float32Array(count * 3);
	for (let i = 0; i < count; i++) {
		const c = SHARK_COLORS[i % SHARK_COLORS.length];
		colors[i * 3] = c[0];
		colors[i * 3 + 1] = c[1];
		colors[i * 3 + 2] = c[2];
	}
	geo.setAttribute("color", new THREE.InstancedBufferAttribute(colors, 3));

	const mat = new THREE.MeshStandardMaterial({
		vertexColors: true,
		roughness: 0.7,
		metalness: 0.2,
	});

	const mesh = new THREE.InstancedMesh(geo, mat, count);
	mesh.frustumCulled = true;

	const dummy = new THREE.Object3D();
	for (let i = 0; i < count; i++) {
		dummy.position.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
		dummy.scale.setScalar(scales[i]);
		dummy.rotation.y = rotations[i];
		dummy.updateMatrix();
		mesh.setMatrixAt(i, dummy.matrix);
	}
	mesh.instanceMatrix.needsUpdate = true;

	return {
		mesh, positions, velocities, phases, scales, rotations, pitches, count, material: mat,
		dir: Math.random() * Math.PI * 2,
		dirTimer: 3 + Math.random() * 5,
	};
}

export function disposeSharkPack(pack: SharkPack, scene: THREE.Scene): void {
	scene.remove(pack.mesh);
	pack.mesh.geometry.dispose();
	pack.material.dispose();
}

function angleDiff(a: number, b: number): number {
	let d = a - b;
	d = d % (Math.PI * 2);
	if (d > Math.PI) d -= Math.PI * 2;
	if (d < -Math.PI) d += Math.PI * 2;
	return d;
}

export function updateSharkPack(
	pack: SharkPack,
	delta: number,
	elapsed: number,
	mode: SharkMode,
): void {
	const count = pack.count;
	const cfg = MODE_CONFIG[mode];
	const dummy = new THREE.Object3D();

	pack.dirTimer -= delta;
	if (pack.dirTimer <= 0) {
		if (mode === "patrol") {
			pack.dir += (Math.random() - 0.5) * Math.PI * 0.6;
		} else if (mode === "hunt") {
			pack.dir += (Math.random() - 0.5) * Math.PI;
		} else {
			pack.dir += (Math.random() - 0.5) * Math.PI * 0.3;
		}
		pack.dir = (pack.dir + Math.PI * 2) % (Math.PI * 2);
		pack.dirTimer = mode === "hunt" ? 1.5 + Math.random() * 2.5
			: mode === "patrol" ? 4 + Math.random() * 4
			: 3 + Math.random() * 4;
	}

	for (let i = 0; i < count; i++) {
		const i3 = i * 3;
		const rot = pack.rotations[i];
		const phase = pack.phases[i];

		// ── Direction ──
		let angVel = 0;
		angVel += angleDiff(pack.dir, rot) * 0.8;
		angVel += Math.sin(elapsed * (mode === "hunt" ? 0.3 : 0.1) + phase) * cfg.wanderAmp;

		pack.rotations[i] += angVel * delta * cfg.turnRate;
		const finalRot = pack.rotations[i];
		const finalFwdX = Math.sin(finalRot);
		const finalFwdZ = -Math.cos(finalRot);

		// ── Velocity ──
		const lerpV = delta * 4;
		pack.velocities[i3] += (finalFwdX * cfg.speed - pack.velocities[i3]) * lerpV;
		pack.velocities[i3 + 2] += (finalFwdZ * cfg.speed - pack.velocities[i3 + 2]) * lerpV;

		// ── Vertical ──
		let yTarget = 0;
		if (mode === "breach") {
			const breathCycle = Math.sin(elapsed * 0.15 + phase * 0.5);
			if (breathCycle > 0.3) {
				yTarget = (breathCycle - 0.3) / 0.7 * cfg.breachY;
			} else if (breathCycle < -0.3) {
				yTarget = (breathCycle + 0.3) / 0.7 * -cfg.breachY;
			}
		} else {
			yTarget = Math.sin(elapsed * cfg.verticalFreq * Math.PI * 2 + phase) * cfg.verticalAmp;
		}
		pack.velocities[i3 + 1] += (yTarget - pack.velocities[i3 + 1]) * delta * 2;
		pack.velocities[i3 + 1] *= 0.98;

		// ── Tail waggle ──
		pack.pitches[i] = Math.sin(elapsed * cfg.tailFreq * Math.PI * 2 + phase) * cfg.tailAmp;

		// ── Move ──
		pack.positions[i3] += pack.velocities[i3] * delta;
		pack.positions[i3 + 1] += pack.velocities[i3 + 1] * delta;
		pack.positions[i3 + 2] += pack.velocities[i3 + 2] * delta;

		// Wrapping
		const BOUNDS = 40;
		for (let a = 0; a < 3; a++) {
			if (pack.positions[i3 + a] > BOUNDS) pack.positions[i3 + a] = -BOUNDS;
			if (pack.positions[i3 + a] < -BOUNDS) pack.positions[i3 + a] = BOUNDS;
		}

		// ── Instance matrix ──
		dummy.position.set(pack.positions[i3], pack.positions[i3 + 1], pack.positions[i3 + 2]);
		dummy.scale.setScalar(pack.scales[i]);
		dummy.rotation.order = "YXZ";
		dummy.rotation.y = finalRot;
		dummy.rotation.x = pack.pitches[i];
		dummy.updateMatrix();
		pack.mesh.setMatrixAt(i, dummy.matrix);
	}

	pack.mesh.instanceMatrix.needsUpdate = true;
}
