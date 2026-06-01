import * as THREE from "three";
import { loadGLTF } from "$lib/three/loader";

// ── Types ──

export type SwimMode = "schooling" | "scattered" | "migrating";
export type FlockMode = "solo" | "boids" | "swarm";

export interface FishSchool {
	mesh: THREE.InstancedMesh;
	positions: Float32Array;
	velocities: Float32Array;
	phases: Float32Array;
	scales: Float32Array;
	rotations: Float32Array;
	heights: Float32Array;
	count: number;
	material: THREE.MeshStandardMaterial;
	migrateDir: number;
	migrateTimer: number;
	migrateLastChangeAt: number;
}

// ── Factory ──

export function createProceduralFishGeometry(): THREE.BufferGeometry {
	const shape = new THREE.Shape();
	const s = 0.4;
	shape.moveTo(3.5 * s, 0);
	shape.bezierCurveTo(3.0 * s, 1.0 * s, 2.0 * s, 2.2 * s, 0.5 * s, 2.4 * s);
	shape.bezierCurveTo(-0.5 * s, 2.5 * s, -1.5 * s, 1.8 * s, -2.5 * s, 1.2 * s);
	shape.lineTo(-3.5 * s, 3.0 * s);
	shape.lineTo(-4.0 * s, 1.0 * s);
	shape.lineTo(-4.5 * s, 0);
	shape.lineTo(-4.0 * s, -1.0 * s);
	shape.lineTo(-3.5 * s, -3.0 * s);
	shape.lineTo(-2.5 * s, -1.2 * s);
	shape.bezierCurveTo(-1.5 * s, -1.8 * s, -0.5 * s, -2.5 * s, 0.5 * s, -2.4 * s);
	shape.bezierCurveTo(2.0 * s, -2.2 * s, 3.0 * s, -1.0 * s, 3.5 * s, 0);
	const extrudeSettings: THREE.ExtrudeGeometryOptions = {
		depth: 0.5,
		bevelEnabled: true,
		bevelThickness: 0.15,
		bevelSize: 0.1,
		bevelSegments: 1,
	};
	const geo = new THREE.ExtrudeGeometry(shape, extrudeSettings);
	geo.rotateY(Math.PI / 2);
	geo.translate(0, 0.5, 0);
	return geo;
}

export async function loadFishGeometry(): Promise<THREE.BufferGeometry | null> {
	try {
		const gltf = await loadGLTF("/models/animated_low_poly_fish_gltf/scene.gltf");
		const src = gltf.scene;
		const meshes: THREE.Mesh[] = [];
		src.traverse((child) => {
			if (child instanceof THREE.Mesh) meshes.push(child);
		});
		const foundMesh = meshes[0];
		if (foundMesh) {
			const geo = foundMesh.geometry.clone();
			geo.deleteAttribute("JOINTS_0");
			geo.deleteAttribute("WEIGHTS_0");
			geo.deleteAttribute("TEXCOORD_0");
			geo.center();
			return geo;
		}
	} catch { /* fallback to procedural */ }
	return null;
}

const FISH_COLORS: [number, number, number][] = [
	[0.0, 1.0, 1.0], [1.0, 0.6, 0.2], [1.0, 0.2, 0.8],
	[0.2, 1.0, 0.6], [1.0, 1.0, 0.2], [0.6, 0.2, 1.0],
	[1.0, 0.4, 0.4], [0.2, 0.8, 1.0],
];

export function createFishSchool(
	count: number,
	modelGeo?: THREE.BufferGeometry,
	spread = 40,
	heightRange = 15,
): FishSchool {
	const positions = new Float32Array(count * 3);
	const velocities = new Float32Array(count * 3);
	const phases = new Float32Array(count);
	const scales = new Float32Array(count);
	const rotations = new Float32Array(count);
	const heights = new Float32Array(count);

	for (let i = 0; i < count; i++) {
		const x = (Math.random() - 0.5) * spread;
		const y = (Math.random() - 0.5) * heightRange;
		const z = (Math.random() - 0.5) * spread;
		positions[i * 3] = x;
		positions[i * 3 + 1] = y;
		positions[i * 3 + 2] = z;
		heights[i] = y;
		velocities[i * 3] = (Math.random() - 0.5) * 2;
		velocities[i * 3 + 1] = 0;
		velocities[i * 3 + 2] = (Math.random() - 0.5) * 2;
		phases[i] = Math.random() * Math.PI * 2;
		scales[i] = 0.5 + Math.random() * 0.8;
		rotations[i] = Math.random() * Math.PI * 2;
	}

	const geo = modelGeo ?? createProceduralFishGeometry();
	const colors = new Float32Array(count * 3);
	for (let i = 0; i < count; i++) {
		const c = FISH_COLORS[i % FISH_COLORS.length];
		colors[i * 3] = c[0]; colors[i * 3 + 1] = c[1]; colors[i * 3 + 2] = c[2];
	}
	geo.setAttribute("color", new THREE.InstancedBufferAttribute(colors, 3));

	if (!_cachedFishMat) {
		_cachedFishMat = new THREE.MeshStandardMaterial({
			vertexColors: true,
			flatShading: true,
			roughness: 0.3,
			metalness: 0.1,
			emissive: new THREE.Color(0x00e5ff),
			emissiveIntensity: 0.6,
		});
	}

	const mesh = new THREE.InstancedMesh(geo, _cachedFishMat, count);
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
		mesh, positions, velocities, phases, scales, rotations, heights, count, material: _cachedFishMat,
		migrateDir: Math.random() * Math.PI * 2,
		migrateTimer: 3 + Math.random() * 5,
		migrateLastChangeAt: -999,
	};
}

let _cachedFishMat: THREE.MeshStandardMaterial | null = null;

export function disposeFishSchool(school: FishSchool, scene: THREE.Scene): void {
	scene.remove(school.mesh);
	school.mesh.geometry.dispose();
	school.material.dispose();
}

// ── Swim-mode config ──

interface SwimConfig {
	speed: number;
	turnRate: number;
	bobAmp: number;
	cohStr: number;
	aliStr: number;
	sepStr: number;
	wanderAmp: number;
	sepRangeSq: number;
	tailFreq: number;
	tailAmp: number;
}

const SWIM_CONFIG: Record<SwimMode, SwimConfig> = {
	schooling: {
		speed: 3,
		turnRate: 4.0,
		bobAmp: 0.08,
		cohStr: 0.08,
		aliStr: 0.4,
		sepStr: 1.5,
		wanderAmp: 0.2,
		sepRangeSq: 25,
		tailFreq: 3.0,
		tailAmp: 0.05,
	},
	scattered: {
		speed: 1.8,
		turnRate: 1.5,
		bobAmp: 0.25,
		cohStr: 0,
		aliStr: 0,
		sepStr: 0,
		wanderAmp: 0.7,
		sepRangeSq: 0,
		tailFreq: 3.0,
		tailAmp: 0.05,
	},
	migrating: {
		speed: 8,
		turnRate: 3.0,
		bobAmp: 0.03,
		cohStr: 0,
		aliStr: 0,
		sepStr: 0,
		wanderAmp: 0,
		sepRangeSq: 0,
		tailFreq: 4.0,
		tailAmp: 0.06,
	},
};

// ── Angle helper ──

function angleDiff(a: number, b: number): number {
	let d = a - b;
	d = d % (Math.PI * 2);
	if (d > Math.PI) d -= Math.PI * 2;
	if (d < -Math.PI) d += Math.PI * 2;
	return d;
}

// ── Update ──

export function updateFishSchool(
	school: FishSchool,
	delta: number,
	elapsed: number,
	swimMode: SwimMode,
	flockMode: FlockMode,
	center: THREE.Vector3,
): void {
	const count = school.count;
	const dummy = new THREE.Object3D();
	const cfg = SWIM_CONFIG[swimMode];

	// ── Migration: global direction change timer ──
	if (swimMode === "migrating") {
		school.migrateTimer -= delta;
		if (school.migrateTimer <= 0) {
			const change = (Math.random() - 0.5) * Math.PI * 1.5;
			school.migrateDir = (school.migrateDir + change + Math.PI * 2) % (Math.PI * 2);
			school.migrateLastChangeAt = elapsed;
			school.migrateTimer = 3 + Math.random() * 5;
		}
	}

	// School centroid + average forward direction (only for social modes)
	let avgX = 0, avgZ = 0, avgFwdX = 0, avgFwdZ = 0;

	if (flockMode !== "solo" && swimMode !== "migrating") {
		for (let i = 0; i < count; i++) {
			const i3 = i * 3;
			avgX += school.positions[i3];
			avgZ += school.positions[i3 + 2];
			const r = school.rotations[i];
			avgFwdX += Math.sin(r);
			avgFwdZ += -Math.cos(r);
		}
		avgX /= count;
		avgZ /= count;
		const avgLen = Math.sqrt(avgFwdX * avgFwdX + avgFwdZ * avgFwdZ);
		if (avgLen > 0.01) { avgFwdX /= avgLen; avgFwdZ /= avgLen; }
	}

	for (let i = 0; i < count; i++) {
		const i3 = i * 3;
		const rot = school.rotations[i];
		const phase = school.phases[i];

		const px = school.positions[i3];
		const py = school.positions[i3 + 1];
		const pz = school.positions[i3 + 2];

		// ── Angular velocity (rad/s) — only turns, never reverses ──
		let angVel = 0;

		if (swimMode === "migrating") {
			// Ripple: per-fish delay based on phase creates a turning wave
			const sinceChange = elapsed - school.migrateLastChangeAt;
			const delay = (Math.sin(phase) * 0.5 + 0.5) * 0.4;
			if (sinceChange >= delay) {
				angVel += angleDiff(school.migrateDir, rot) * 1.5;
			}
		}

		// Gentle individual meandering (always present)
		angVel += Math.sin(elapsed * 0.2 + phase) * cfg.wanderAmp;

		if (swimMode !== "migrating") switch (flockMode) {
			case "boids": {
				// Cohesion: turn toward school centroid
				const cohAngle = Math.atan2(avgX - px, -(avgZ - pz));
				angVel += angleDiff(cohAngle, rot) * cfg.cohStr;

				// Alignment: match average direction
				const avgRot = Math.atan2(avgFwdX, -avgFwdZ);
				angVel += angleDiff(avgRot, rot) * cfg.aliStr;

				// Separation: turn away from close neighbors
				for (let j = 0; j < count; j++) {
					if (j === i) continue;
					const j3 = j * 3;
					const dx = px - school.positions[j3];
					const dz = pz - school.positions[j3 + 2];
					const distSq = dx * dx + dz * dz;
					if (distSq < cfg.sepRangeSq && distSq > 0.01) {
						const awayAngle = Math.atan2(dx, -dz);
						angVel += angleDiff(awayAngle, rot) * cfg.sepStr * (0.2 / (distSq + 0.1));
					}
				}
				break;
			}
			case "swarm": {
				const orbitR = 3 + school.scales[i] * 2;
				const tx = center.x + Math.sin(phase + elapsed * 0.15) * orbitR;
				const tz = center.z + Math.cos(phase + elapsed * 0.15) * orbitR;
				const targetAngle = Math.atan2(tx - px, -(tz - pz));
				angVel += angleDiff(targetAngle, rot) * 0.6;
				break;
			}
		}

		// Rotate
		school.rotations[i] += angVel * delta * cfg.turnRate;

		const finalRot = school.rotations[i];
		const finalFwdX = Math.sin(finalRot);
		const finalFwdZ = -Math.cos(finalRot);

		// ── Velocity is always forward — NEVER backward or sideways ──
		const lerpV = delta * 10;
		school.velocities[i3] += (finalFwdX * cfg.speed - school.velocities[i3]) * lerpV;
		school.velocities[i3 + 2] += (finalFwdZ * cfg.speed - school.velocities[i3 + 2]) * lerpV;

		// Vertical: spring toward initial depth + gentle bob
		const depthPull = (school.heights[i] - py) * 0.1;
		const yBob = Math.sin(elapsed * 0.15 + phase) * cfg.bobAmp;
		school.velocities[i3 + 1] += (yBob + depthPull - school.velocities[i3 + 1]) * delta * 5;

		// Move
		school.positions[i3] += school.velocities[i3] * delta;
		school.positions[i3 + 1] += school.velocities[i3 + 1] * delta;
		school.positions[i3 + 2] += school.velocities[i3 + 2] * delta;

		// Wrapping
		const BOUNDS = 30;
		for (let a = 0; a < 3; a++) {
			if (school.positions[i3 + a] > BOUNDS) school.positions[i3 + a] = -BOUNDS;
			if (school.positions[i3 + a] < -BOUNDS) school.positions[i3 + a] = BOUNDS;
		}

		// ── Instance matrix ──
		const tilt = Math.min(0.3, Math.max(-0.3, school.velocities[i3 + 1] * 0.06));
		const tailWag = Math.sin(elapsed * cfg.tailFreq + phase) * cfg.tailAmp;
		dummy.position.set(school.positions[i3], school.positions[i3 + 1], school.positions[i3 + 2]);
		dummy.scale.setScalar(school.scales[i]);
		dummy.rotation.set(tilt, finalRot + tailWag, 0);
		dummy.updateMatrix();
		school.mesh.setMatrixAt(i, dummy.matrix);
	}

	school.mesh.instanceMatrix.needsUpdate = true;
}
