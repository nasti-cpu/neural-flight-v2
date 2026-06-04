import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

// ── Types ──

export type JellyMode = "drifting" | "pulsing" | "bloom";

export interface JellySwarm {
	mesh: THREE.InstancedMesh;
	positions: Float32Array;
	velocities: Float32Array;
	phases: Float32Array;
	scales: Float32Array;
	rotations: Float32Array;
	heights: Float32Array;
	pulsePhase: Float32Array;
	count: number;
	material: THREE.MeshPhysicalMaterial;
	bloomDir: number;
	bloomTimer: number;
}

// ── Geometry ──

export function createJellyGeometry(): THREE.BufferGeometry {
	// Dome bell: lathed half-ellipse profile
	const points: THREE.Vector2[] = [];
	const segs = 16;
	for (let i = 0; i <= segs; i++) {
		const t = i / segs;
		const angle = t * Math.PI * 0.5;
		const r = Math.sin(angle) * 1.2;
		const y = Math.cos(angle) * 0.9;
		points.push(new THREE.Vector2(r, y));
	}
	const bell = new THREE.LatheGeometry(points, 20);
	bell.translate(0, -0.45, 0);
	// Slight ruffled edge
	const pos = bell.getAttribute("position") as THREE.BufferAttribute;
	const verts = pos.array as Float32Array;
	for (let i = 0; i < verts.length; i += 3) {
		const vx = verts[i];
		const vy = verts[i + 1];
		const vz = verts[i + 2];
		const dist = Math.sqrt(vx * vx + vz * vz);
		if (dist > 0.8 && vy < 0.1) {
			const ruffles = Math.sin(Math.atan2(vz, vx) * 4) * 0.06;
			const factor = (dist - 0.8) / 0.4;
			verts[i] *= 1 + ruffles * factor;
			verts[i + 2] *= 1 + ruffles * factor;
		}
	}
	pos.needsUpdate = true;
	bell.computeVertexNormals();

	// Tentacles: wavy strands from center of bell
	const tentCount = 10;
	const startY = -0.45;
	const tentacleGeos: THREE.BufferGeometry[] = [];
	for (let i = 0; i < tentCount; i++) {
		const angle = (i / tentCount) * Math.PI * 2;
		const ringRadius = 0.35 + Math.sin(i * 0.5) * 0.1;
		const length = 1.8 + Math.sin(i * 2.3) * 0.4;
		const waveAmp = 0.08 + Math.sin(i * 1.5) * 0.04;
		const waveFreq = 4 + Math.sin(i * 0.9) * 1;
		const pts: THREE.Vector3[] = [];
		const segs = 10;
		for (let j = 0; j <= segs; j++) {
			const t = j / segs;
			const y = -t * length;
			const r = ringRadius + t * (0.25 + Math.sin(i * 0.5) * 0.1);
			const x = Math.cos(angle) * ringRadius + Math.cos(angle + t * 0.5) * (r - ringRadius) + Math.sin(t * waveFreq) * waveAmp * t;
			const z = Math.sin(angle) * ringRadius + Math.sin(angle + t * 0.5) * (r - ringRadius) + Math.cos(t * waveFreq * 0.7) * waveAmp * t * 0.6;
			pts.push(new THREE.Vector3(x, startY + y, z));
		}
		const curve = new THREE.CatmullRomCurve3(pts);
		const tent = new THREE.TubeGeometry(curve, 10, 0.025, 4, false);
		tent.computeVertexNormals();
		tentacleGeos.push(tent);
	}

	return mergeGeometries([bell, ...tentacleGeos]);
}

// ── Colors ──

const JELLY_COLORS: [number, number, number][] = [
	[0.0, 0.8, 1.0], [0.8, 0.2, 0.9], [0.2, 1.0, 0.7],
	[1.0, 0.4, 0.6], [0.4, 0.6, 1.0],
];

// ── Config ──

interface JellyConfig {
	speed: number;
	turnRate: number;
	pulseFreq: number;
	pulseAmp: number;
	driftAmp: number;
	wanderAmp: number;
	verticalAmp: number;
	verticalFreq: number;
}

export interface JellyModeMeta {
	id: JellyMode;
	label: string;
}

export const JELLY_MODE_META: JellyModeMeta[] = [
	{ id: "drifting", label: "Treibend" },
	{ id: "pulsing", label: "Pulsierend" },
	{ id: "bloom", label: "Blüte" },
];

const MODE_CONFIG: Record<JellyMode, JellyConfig> = {
	drifting: {
		speed: 0.6,
		turnRate: 0.8,
		pulseFreq: 0.15,
		pulseAmp: 0.08,
		driftAmp: 0.5,
		wanderAmp: 0.4,
		verticalAmp: 0.3,
		verticalFreq: 0.15,
	},
	pulsing: {
		speed: 1.2,
		turnRate: 1.0,
		pulseFreq: 0.35,
		pulseAmp: 0.18,
		driftAmp: 0,
		wanderAmp: 0.15,
		verticalAmp: 0.8,
		verticalFreq: 0.4,
	},
	bloom: {
		speed: 0.8,
		turnRate: 0.6,
		pulseFreq: 0.2,
		pulseAmp: 0.12,
		driftAmp: 0.3,
		wanderAmp: 0.2,
		verticalAmp: 0.4,
		verticalFreq: 0.2,
	},
};

// ── Create ──

export function createJellySwarm(
	count: number,
	spread = 6,
	heightRange = 4,
): JellySwarm {
	const positions = new Float32Array(count * 3);
	const velocities = new Float32Array(count * 3);
	const phases = new Float32Array(count);
	const scales = new Float32Array(count);
	const rotations = new Float32Array(count);
	const heights = new Float32Array(count);
	const pulsePhase = new Float32Array(count);

	for (let i = 0; i < count; i++) {
		positions[i * 3] = (Math.random() - 0.5) * spread;
		positions[i * 3 + 1] = (Math.random() - 0.5) * heightRange;
		positions[i * 3 + 2] = (Math.random() - 0.5) * spread;
		heights[i] = positions[i * 3 + 1];
		velocities[i * 3] = (Math.random() - 0.5) * 0.3;
		velocities[i * 3 + 1] = 0;
		velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.3;
		phases[i] = Math.random() * Math.PI * 2;
		pulsePhase[i] = i * 0.8;
		scales[i] = 0.7 + Math.random() * 0.6;
		rotations[i] = Math.random() * Math.PI * 2;
	}

	const geo = createJellyGeometry();
	const colors = new Float32Array(count * 3);
	for (let i = 0; i < count; i++) {
		const c = JELLY_COLORS[i % JELLY_COLORS.length];
		colors[i * 3] = c[0];
		colors[i * 3 + 1] = c[1];
		colors[i * 3 + 2] = c[2];
	}
	geo.setAttribute("color", new THREE.InstancedBufferAttribute(colors, 3));

	const mat = new THREE.MeshPhysicalMaterial({
		vertexColors: true,
		transparent: true,
		opacity: 0.7,
		roughness: 0.2,
		metalness: 0.0,
		clearcoat: 0.3,
		clearcoatRoughness: 0.2,
		side: THREE.DoubleSide,
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
		mesh, positions, velocities, phases, scales, rotations, heights, pulsePhase, count, material: mat,
		bloomDir: Math.random() * Math.PI * 2,
		bloomTimer: 3 + Math.random() * 5,
	};
}

export function disposeJellySwarm(swarm: JellySwarm, scene: THREE.Scene): void {
	scene.remove(swarm.mesh);
	swarm.mesh.geometry.dispose();
	swarm.material.dispose();
}

// ── Helper ──

function angleDiff(a: number, b: number): number {
	let d = a - b;
	d = d % (Math.PI * 2);
	if (d > Math.PI) d -= Math.PI * 2;
	if (d < -Math.PI) d += Math.PI * 2;
	return d;
}

// ── Update ──

export function updateJellySwarm(
	swarm: JellySwarm,
	delta: number,
	elapsed: number,
	mode: JellyMode,
): void {
	const count = swarm.count;
	const cfg = MODE_CONFIG[mode];
	const dummy = new THREE.Object3D();

	// Bloom mode: gentle group direction changes
	if (mode === "bloom") {
		swarm.bloomTimer -= delta;
		if (swarm.bloomTimer <= 0) {
			swarm.bloomDir += (Math.random() - 0.5) * Math.PI * 0.8;
			swarm.bloomDir = (swarm.bloomDir + Math.PI * 2) % (Math.PI * 2);
			swarm.bloomTimer = 5 + Math.random() * 8;
		}
	}

	for (let i = 0; i < count; i++) {
		const i3 = i * 3;
		const rot = swarm.rotations[i];
		const phase = swarm.phases[i];

		const px = swarm.positions[i3];
		const pz = swarm.positions[i3 + 2];

		// ── Direction ──
		let angVel = 0;

		if (mode === "drifting") {
			angVel += Math.sin(elapsed * 0.1 + phase) * cfg.wanderAmp;
		} else if (mode === "pulsing") {
			angVel += Math.sin(elapsed * 0.2 + phase) * cfg.wanderAmp;
		} else if (mode === "bloom") {
			angVel += angleDiff(swarm.bloomDir, rot) * 0.5;
			angVel += Math.sin(elapsed * 0.08 + phase) * cfg.wanderAmp;
		}

		swarm.rotations[i] += angVel * delta * cfg.turnRate;
		const finalRot = swarm.rotations[i];
		const finalFwdX = Math.sin(finalRot);
		const finalFwdZ = -Math.cos(finalRot);

		// ── Velocity ──
		const lerpV = delta * 5;
		swarm.velocities[i3] += (finalFwdX * cfg.speed - swarm.velocities[i3]) * lerpV;
		swarm.velocities[i3 + 2] += (finalFwdZ * cfg.speed - swarm.velocities[i3 + 2]) * lerpV;

		// ── Vertical: gentle up/down drift ──
		const vertWave = Math.sin(elapsed * cfg.verticalFreq * Math.PI * 2 + phase) * cfg.verticalAmp;
		const depthPull = (swarm.heights[i] - swarm.positions[i3 + 1]) * 0.01;
		swarm.velocities[i3 + 1] += (vertWave + depthPull - swarm.velocities[i3 + 1]) * delta * 2;

		// ── Move ──
		swarm.positions[i3] += swarm.velocities[i3] * delta;
		swarm.positions[i3 + 1] += swarm.velocities[i3 + 1] * delta;
		swarm.positions[i3 + 2] += swarm.velocities[i3 + 2] * delta;

		// ── Separation: avoid overlapping ──
		const sepRadius = 1.8;
		const sepForce = 2.0;
		for (let j = i + 1; j < count; j++) {
			const j3 = j * 3;
			const dx = swarm.positions[i3] - swarm.positions[j3];
			const dy = swarm.positions[i3 + 1] - swarm.positions[j3 + 1];
			const dz = swarm.positions[i3 + 2] - swarm.positions[j3 + 2];
			const distSq = dx * dx + dy * dy + dz * dz;
			if (distSq > 0 && distSq < sepRadius * sepRadius) {
				const dist = Math.sqrt(distSq);
				const strength = (sepRadius - dist) / sepRadius * sepForce;
				const nx = dx / dist, ny = dy / dist, nz = dz / dist;
				swarm.velocities[i3] += nx * strength * delta;
				swarm.velocities[i3 + 1] += ny * strength * delta;
				swarm.velocities[i3 + 2] += nz * strength * delta;
				swarm.velocities[j3] -= nx * strength * delta;
				swarm.velocities[j3 + 1] -= ny * strength * delta;
				swarm.velocities[j3 + 2] -= nz * strength * delta;
			}
		}

		// Wrapping
		const BOUNDS = 30;
		for (let a = 0; a < 3; a++) {
			if (swarm.positions[i3 + a] > BOUNDS) swarm.positions[i3 + a] = -BOUNDS;
			if (swarm.positions[i3 + a] < -BOUNDS) swarm.positions[i3 + a] = BOUNDS;
		}

		// ── Pulse: bell contracts (Y squash) and expands (X/Z widen) ──
		const pulseRaw = Math.sin(elapsed * cfg.pulseFreq * Math.PI * 2 + swarm.pulsePhase[i]);
		const pulseVal = pulseRaw * cfg.pulseAmp;
		const s = swarm.scales[i];

		// ── Instance matrix ──
		dummy.position.set(swarm.positions[i3], swarm.positions[i3 + 1], swarm.positions[i3 + 2]);
		dummy.scale.set(s * (1 + pulseVal * 0.3), s * (1 - pulseVal), s * (1 + pulseVal * 0.3));
		dummy.rotation.y = finalRot;
		dummy.updateMatrix();
		swarm.mesh.setMatrixAt(i, dummy.matrix);
	}

	swarm.mesh.instanceMatrix.needsUpdate = true;
}
