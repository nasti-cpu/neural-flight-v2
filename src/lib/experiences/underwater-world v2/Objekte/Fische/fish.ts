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
	spawnTime: number;
	dirChangeTimer: number;
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

export interface StandardSchoolConfig {
	count: number;
	spread: number;
	heightRange: number;
	swimMode: SwimMode;
}

export const STANDARD_SCHOOL_CONFIGS: StandardSchoolConfig[] = [
	{ count: 120, spread: 55, heightRange: 30, swimMode: "schooling" },
	{ count: 80, spread: 80, heightRange: 40, swimMode: "scattered" },
	{ count: 50, spread: 70, heightRange: 25, swimMode: "migrating" },
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
		const r = Math.random() * Math.PI * 2;
		rotations[i] = r;
		velocities[i * 3] = Math.sin(r) * 1;
		velocities[i * 3 + 1] = 0;
		velocities[i * 3 + 2] = -Math.cos(r) * 1;
		phases[i] = Math.random() * Math.PI * 2;
		scales[i] = 0.5 + Math.random() * 0.8;
	}

	const geo = modelGeo ?? createProceduralFishGeometry();
	const colors = new Float32Array(count * 3);
	for (let i = 0; i < count; i++) {
		const c = FISH_COLORS[i % FISH_COLORS.length];
		colors[i * 3] = c[0]; colors[i * 3 + 1] = c[1]; colors[i * 3 + 2] = c[2];
	}
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

	const mat = _cachedFishMat.clone();
	mat.transparent = true;
	mat.opacity = 0;

	const mesh = new THREE.InstancedMesh(geo, mat, count);
	mesh.frustumCulled = true;
	mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);

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
		mesh, positions, velocities, phases, scales, rotations, heights, count, material: mat,
		migrateDir: Math.random() * Math.PI * 2,
		migrateTimer: 3 + Math.random() * 5,
		migrateLastChangeAt: -999,
		spawnTime: -1,
		dirChangeTimer: 2 + Math.random() * 4,
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
	wanderAmp: number;
	cohStr: number;
	aliStr: number;
	dampFactor: number;
	spread: number;
	migrateSpeed: number;
}

const SWIM_CONFIG: Record<SwimMode, SwimConfig> = {
	schooling: {
		speed: 1.5,
		wanderAmp: 1.2,
		cohStr: 0.4,
		aliStr: 0.15,
		dampFactor: 0.03,
		spread: 30,
		migrateSpeed: 0,
	},
	scattered: {
		speed: 0.8,
		wanderAmp: 2.5,
		cohStr: 0.03,
		aliStr: 0.03,
		dampFactor: 0.015,
		spread: 50,
		migrateSpeed: 0,
	},
	migrating: {
		speed: 2,
		wanderAmp: 0.8,
		cohStr: 0,
		aliStr: 0,
		dampFactor: 0.02,
		spread: 40,
		migrateSpeed: 3,
	},
};

// ── Update (v1-style velocity-based physics) ──

export type RepelCenter = { x: number; z: number; radius: number };

export function updateFishSchool(
	school: FishSchool,
	delta: number,
	elapsed: number,
	swimMode: SwimMode,
	playerPos: THREE.Vector3,
	terrainFn?: (wx: number, wz: number) => number,
	repelCenters?: RepelCenter[],
): void {
	if (school.spawnTime < 0) school.spawnTime = elapsed;
	const fadeElapsed = elapsed - school.spawnTime;
	const fadeIn = Math.min(1, fadeElapsed / 2);
	school.material.opacity = fadeIn;

	const count = school.count;
	const dummy = new THREE.Object3D();
	const cfg = SWIM_CONFIG[swimMode];

	// Direction change timer (all modes — fish randomly shift direction)
	school.dirChangeTimer -= delta;
	let dirChangeX = 0, dirChangeZ = 0;
	if (school.dirChangeTimer <= 0) {
		const angle = Math.random() * Math.PI * 2;
		const strength = 1 + Math.random() * 3;
		dirChangeX = Math.sin(angle) * strength;
		dirChangeZ = -Math.cos(angle) * strength;
		school.dirChangeTimer = 2 + Math.random() * 5;
		if (swimMode === "scattered") school.dirChangeTimer *= 0.6;
	}

	// Migration direction changes
	if (swimMode === "migrating") {
		school.migrateTimer -= delta;
		if (school.migrateTimer <= 0) {
			const change = (Math.random() - 0.5) * Math.PI * 1.5;
			school.migrateDir = (school.migrateDir + change + Math.PI * 2) % (Math.PI * 2);
			school.migrateLastChangeAt = elapsed;
			school.migrateTimer = 3 + Math.random() * 5;
		}
	}

	// Migration velocity offset
	let migVx = 0, migVz = 0;
	if (swimMode === "migrating") {
		migVx = Math.sin(school.migrateDir) * cfg.migrateSpeed;
		migVz = -Math.cos(school.migrateDir) * cfg.migrateSpeed;
	}

	// Centroid + average velocity
	let avgX = 0, avgY = 0, avgZ = 0, avgVx = 0, avgVy = 0, avgVz = 0;
	for (let i = 0; i < count; i++) {
		const i3 = i * 3;
		avgX += school.positions[i3];
		avgY += school.positions[i3 + 1];
		avgZ += school.positions[i3 + 2];
		avgVx += school.velocities[i3];
		avgVy += school.velocities[i3 + 1];
		avgVz += school.velocities[i3 + 2];
	}
	avgX /= count;
	avgY /= count;
	avgZ /= count;
	const aLen = Math.sqrt(avgVx * avgVx + avgVy * avgVy + avgVz * avgVz);
	if (aLen > 0.01) { avgVx /= aLen; avgVy /= aLen; avgVz /= aLen; }

	for (let i = 0; i < count; i++) {
		const i3 = i * 3;
		const phase = school.phases[i];

		const px = school.positions[i3];
		const py = school.positions[i3 + 1];
		const pz = school.positions[i3 + 2];

		// Sine wandering per axis (v1-style)
		const wanderX = Math.sin(elapsed * 0.3 + phase) * cfg.wanderAmp;
		const wanderY = Math.sin(elapsed * 0.5 + phase * 1.5) * cfg.wanderAmp * 0.5;
		const wanderZ = Math.cos(elapsed * 0.2 + phase) * cfg.wanderAmp;

		// Cohesion toward centroid
		const toCX = (avgX - px) * cfg.cohStr;
		const toCY = (avgY - py) * cfg.cohStr;
		const toCZ = (avgZ - pz) * cfg.cohStr;

		// Alignment
		const aliX = avgVx * cfg.aliStr;
		const aliY = avgVy * cfg.aliStr;
		const aliZ = avgVz * cfg.aliStr;

		// Velocity update (v1 formula: wander * 0.4 + cohesion * 0.3 + alignment * 0.2 - damp * 0.04)
		school.velocities[i3] += (wanderX * 0.4 + toCX * 0.3 + aliX - school.velocities[i3] * cfg.dampFactor + migVx + dirChangeX) * delta;
		school.velocities[i3 + 1] += (wanderY * 0.4 + toCY * 0.3 + aliY - school.velocities[i3 + 1] * cfg.dampFactor) * delta;
		school.velocities[i3 + 2] += (wanderZ * 0.4 + toCZ * 0.3 + aliZ - school.velocities[i3 + 2] * cfg.dampFactor + migVz + dirChangeZ) * delta;

		// Position update
		school.positions[i3] += school.velocities[i3] * delta;
		school.positions[i3 + 1] += school.velocities[i3 + 1] * delta;
		school.positions[i3 + 2] += school.velocities[i3 + 2] * delta;

		// Player spread control (v1-style: pull back within spread, teleport if >200m)
		const dx = school.positions[i3];
		const dy = school.positions[i3 + 1];
		const dz = school.positions[i3 + 2];
		const dist2 = Math.sqrt(dx * dx + dz * dz);
		if (dist2 > 300) {
			school.positions[i3] = (Math.random() - 0.5) * 40;
			school.positions[i3 + 1] = (Math.random() - 0.5) * 10;
			school.positions[i3 + 2] = (Math.random() - 0.5) * 40;
			school.velocities[i3] = (Math.random() - 0.5) * 1;
			school.velocities[i3 + 1] = (Math.random() - 0.5) * 0.5;
			school.velocities[i3 + 2] = (Math.random() - 0.5) * 1;
		} else if (dist2 > cfg.spread) {
			school.velocities[i3] -= (dx / dist2) * delta * 3 * (swimMode === "scattered" ? 0.5 : 1);
			school.velocities[i3 + 2] -= (dz / dist2) * delta * 3 * (swimMode === "scattered" ? 0.5 : 1);
		}

		// Terrain floor — smooth spring force, no hard teleport
		if (terrainFn) {
			const wx = school.mesh.position.x + school.positions[i3];
			const wz = school.mesh.position.z + school.positions[i3 + 2];
			const terrainY = terrainFn(wx, wz);
			const floorY = terrainY + 1.5;
			const distAbove = school.positions[i3 + 1] - floorY;
			if (distAbove < 4) {
				const t = 1 - distAbove / 4;
				const strength = t * t * 5;
				school.velocities[i3 + 1] += strength * delta;
			}
			if (distAbove < 0) {
				school.velocities[i3 + 1] = 1 + Math.abs(school.velocities[i3 + 1]) * 0.3;
			}
		}
		school.positions[i3 + 1] = Math.max(-50, Math.min(200, school.positions[i3 + 1]));

		// ── Dome repulsion ──
		if (repelCenters) {
			const wx = school.mesh.position.x + school.positions[i3];
			const wz = school.mesh.position.z + school.positions[i3 + 2];
			for (const c of repelCenters) {
				const dx = wx - c.x;
				const dz = wz - c.z;
				const dist = Math.sqrt(dx * dx + dz * dz);
				const minDist = c.radius + 5;
				if (dist < minDist && dist > 0.01) {
					const strength = (minDist - dist) * 2 * delta;
					school.velocities[i3] += (dx / dist) * strength;
					school.velocities[i3 + 2] += (dz / dist) * strength;
				}
			}
		}

		// Rotation from velocity direction (v1-style, YXZ order)
		const vx = school.velocities[i3];
		const vy = school.velocities[i3 + 1];
		const vz = school.velocities[i3 + 2];
		const speed = Math.sqrt(vx * vx + vz * vz);
		dummy.position.set(school.positions[i3], school.positions[i3 + 1], school.positions[i3 + 2]);
		dummy.scale.setScalar(school.scales[i]);
		dummy.rotation.order = "YXZ";
		dummy.rotation.y = Math.atan2(vx, vz);
		dummy.rotation.x = Math.atan2(vy, speed) * 0.3;
		dummy.rotation.z = 0;
		dummy.updateMatrix();
		school.mesh.setMatrixAt(i, dummy.matrix);
	}

	school.mesh.instanceMatrix.needsUpdate = true;
}
