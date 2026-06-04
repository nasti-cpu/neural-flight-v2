import * as THREE from "three";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";

// ── Types ──

export type DolphinMode = "leisurely" | "fast" | "pod";

export interface DolphinPod {
	mesh: THREE.InstancedMesh;
	positions: Float32Array;
	velocities: Float32Array;
	phases: Float32Array;
	scales: Float32Array;
	rotations: Float32Array;
	pitches: Float32Array;
	heights: Float32Array;
	offsets: Float32Array;
	speedMults: Float32Array;
	count: number;
	material: THREE.MeshStandardMaterial;
	podDir: number;
	podTimer: number;
}

// ── Factory ──

export function createProceduralDolphinGeometry(): THREE.BufferGeometry {
	const shape = new THREE.Shape();
	const s = 0.015;
	// Fusiform body: wide middle, tapered ends
	shape.moveTo(5 * s, 0);
	shape.bezierCurveTo(4.5 * s, 1.8 * s, 2 * s, 2.5 * s, 0, 2.2 * s);
	shape.bezierCurveTo(-1.5 * s, 2.0 * s, -2.5 * s, 1.2 * s, -3 * s, 1.0 * s);
	// Tail fluke
	shape.lineTo(-4.5 * s, 2.8 * s);
	shape.lineTo(-5.5 * s, 2.2 * s);
	shape.lineTo(-4 * s, 0.4 * s);
	shape.lineTo(-5 * s, 0);
	shape.lineTo(-4 * s, -0.4 * s);
	shape.lineTo(-5.5 * s, -2.2 * s);
	shape.lineTo(-4.5 * s, -2.8 * s);
	// Bottom body
	shape.lineTo(-3 * s, -1.0 * s);
	shape.bezierCurveTo(-2.5 * s, -1.2 * s, -1.5 * s, -2.0 * s, 0, -2.2 * s);
	shape.bezierCurveTo(2 * s, -2.5 * s, 4.5 * s, -1.8 * s, 5 * s, 0);

	const extrudeSettings: THREE.ExtrudeGeometryOptions = {
		depth: 1.2 * s,
		bevelEnabled: true,
		bevelThickness: 0.2,
		bevelSize: 0.1,
		bevelSegments: 2,
	};
	const geo = new THREE.ExtrudeGeometry(shape, extrudeSettings);
	geo.rotateY(Math.PI / 2);
	geo.translate(0, -1.5, 0);
	const pos = geo.getAttribute("position") as THREE.BufferAttribute;
	const verts = pos.array as Float32Array;
	// Dorsal fin on top
	for (let i = 0; i < verts.length; i += 3) {
		const vx = verts[i];
		const vy = verts[i + 1];
		const vz = verts[i + 2];
		if (vx > -2 && vx < 2 && vz > 0) {
			const t = (vx + 2) / 4;
			const finHeight = Math.sin(t * Math.PI) * 0.8;
			if (vz > 0 && vz < 0.4) {
				verts[i + 2] += finHeight * (0.4 - Math.abs(vy) * 0.3);
			}
		}
	}
	pos.needsUpdate = true;
	geo.computeVertexNormals();
	return geo;
}

const _objLoader = new OBJLoader();

const _dolphinObjUrl = new URL("./10014_dolphin_v2_max2011_it2.obj", import.meta.url).href;

export async function loadDolphinGeometry(): Promise<THREE.BufferGeometry | null> {
	try {
		const obj = await new Promise<THREE.Group>((resolve, reject) => {
			_objLoader.load(_dolphinObjUrl, resolve, undefined, reject);
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
		geo.rotateX(-Math.PI / 2 + 0.35);
		geo.center();
		return geo;
	} catch {
		return null;
	}
}

// ── Colors ──

const DOLPHIN_COLORS: [number, number, number][] = [
	[0.45, 0.55, 0.65], // Bottlenose gray
	[0.35, 0.50, 0.60], // Common dolphin
	[0.55, 0.65, 0.75], // Light gray
	[0.30, 0.40, 0.50], // Dark gray
];

// ── Config ──

interface DolphinConfig {
	speed: number;
	turnRate: number;
	pitchAmp: number;
	pitchFreq: number;
	bobAmp: number;
	leapAmp: number;
	leapFreq: number;
	wanderAmp: number;
	cohStr: number;
	sepStr: number;
	sepRangeSq: number;
}

export interface DolphinModeMeta {
	id: DolphinMode;
	label: string;
	count: number;
}

export const DOLPHIN_MODE_META: DolphinModeMeta[] = [
	{ id: "leisurely", label: "Gemütlich", count: 1 },
	{ id: "fast", label: "Schnell", count: 1 },
	{ id: "pod", label: "Gruppe", count: 3 },
];

const MODE_CONFIG: Record<DolphinMode, DolphinConfig> = {
	leisurely: {
		speed: 4,
		turnRate: 1.5,
		pitchAmp: 0.08,
		pitchFreq: 0.6,
		bobAmp: 0.15,
		leapAmp: 0,
		leapFreq: 0,
		wanderAmp: 0.3,
		cohStr: 0,
		sepStr: 0,
		sepRangeSq: 0,
	},
	fast: {
		speed: 8,
		turnRate: 2.5,
		pitchAmp: 0.12,
		pitchFreq: 0.8,
		bobAmp: 0.25,
		leapAmp: 0.3,
		leapFreq: 0.2,
		wanderAmp: 0.1,
		cohStr: 0,
		sepStr: 0,
		sepRangeSq: 0,
	},
	pod: {
		speed: 5,
		turnRate: 1.2,
		pitchAmp: 0.08,
		pitchFreq: 0.6,
		bobAmp: 0.15,
		leapAmp: 0,
		leapFreq: 0,
		wanderAmp: 0.12,
		cohStr: 0,
		sepStr: 0,
		sepRangeSq: 0,
	},
};

// ── Create ──

export function createDolphinPod(
	count: number,
	modelGeo?: THREE.BufferGeometry,
	spread = 8,
	heightRange = 4,
): DolphinPod {
	const positions = new Float32Array(count * 3);
	const velocities = new Float32Array(count * 3);
	const phases = new Float32Array(count);
	const scales = new Float32Array(count);
	const rotations = new Float32Array(count);
	const pitches = new Float32Array(count);
	const heights = new Float32Array(count);
	const offsets = new Float32Array(count * 2);
	const speedMults = new Float32Array(count);

	for (let i = 0; i < count; i++) {
		// Formation offsets for pod mode (side by side, staggered)
		const sideOffset = (i - (count - 1) / 2) * 2;
		const depthOffset = (i % 2 === 0 ? -0.5 : 0.5);
		offsets[i * 2] = sideOffset;
		offsets[i * 2 + 1] = depthOffset;
		speedMults[i] = 0.97 + i * 0.03;

		positions[i * 3] = sideOffset;
		positions[i * 3 + 1] = (Math.random() - 0.5) * heightRange;
		positions[i * 3 + 2] = depthOffset;
		heights[i] = positions[i * 3 + 1];
		velocities[i * 3] = (Math.random() - 0.5) * 0.2;
		velocities[i * 3 + 1] = 0;
		velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.2;
		phases[i] = i * 2.1;
		scales[i] = 0.7 + Math.random() * 0.6;
		rotations[i] = 0;
		pitches[i] = 0;
	}

	const geo = modelGeo ?? createProceduralDolphinGeometry();
	const colors = new Float32Array(count * 3);
	for (let i = 0; i < count; i++) {
		const c = DOLPHIN_COLORS[i % DOLPHIN_COLORS.length];
		colors[i * 3] = c[0];
		colors[i * 3 + 1] = c[1];
		colors[i * 3 + 2] = c[2];
	}
	geo.setAttribute("color", new THREE.InstancedBufferAttribute(colors, 3));

	const mat = new THREE.MeshStandardMaterial({
		vertexColors: true,
		roughness: 0.4,
		metalness: 0.3,
	});

	const mesh = new THREE.InstancedMesh(geo, mat, count);
	mesh.frustumCulled = true;

	const dummy = new THREE.Object3D();
	for (let i = 0; i < count; i++) {
		dummy.position.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
		dummy.scale.setScalar(scales[i] * 0.03);
		dummy.rotation.y = rotations[i];
		dummy.updateMatrix();
		mesh.setMatrixAt(i, dummy.matrix);
	}
	mesh.instanceMatrix.needsUpdate = true;

	return {
		mesh, positions, velocities, phases, scales, rotations, pitches, heights, offsets, speedMults, count, material: mat,
		podDir: 0,
		podTimer: 3 + Math.random() * 4,
	};
}

export function disposeDolphinPod(pod: DolphinPod, scene: THREE.Scene): void {
	scene.remove(pod.mesh);
	pod.mesh.geometry.dispose();
	pod.material.dispose();
}

// ── Angle helper ──

function angleDiff(a: number, b: number): number {
	let d = a - b;
	d = d % (Math.PI * 2);
	if (d > Math.PI) d -= Math.PI * 2;
	if (d < -Math.PI) d += Math.PI * 2;
	return d;
}

// ── Update ──

export function updateDolphinPod(
	pod: DolphinPod,
	delta: number,
	elapsed: number,
	mode: DolphinMode,
	center: THREE.Vector3,
): void {
	const count = pod.count;
	const cfg = MODE_CONFIG[mode];
	const dummy = new THREE.Object3D();

	// Pod formation: group center
	let avgX = 0, avgZ = 0;
	if (mode === "pod") {
		for (let i = 0; i < count; i++) {
			avgX += pod.positions[i * 3];
			avgZ += pod.positions[i * 3 + 2];
		}
		avgX /= count;
		avgZ /= count;
	}

	// Fast mode: periodic direction changes
	if (mode === "fast") {
		pod.podTimer -= delta;
		if (pod.podTimer <= 0) {
			pod.podDir += (Math.random() - 0.5) * Math.PI;
			pod.podDir = (pod.podDir + Math.PI * 2) % (Math.PI * 2);
			pod.podTimer = 2 + Math.random() * 3;
		}
	}

	// Leisurely: gentle wandering timer
	if (mode === "leisurely") {
		pod.podTimer -= delta;
		if (pod.podTimer <= 0) {
			pod.podDir += (Math.random() - 0.5) * Math.PI * 0.8;
			pod.podDir = (pod.podDir + Math.PI * 2) % (Math.PI * 2);
			pod.podTimer = 3 + Math.random() * 5;
		}
	}

	for (let i = 0; i < count; i++) {
		const i3 = i * 3;
		const rot = pod.rotations[i];
		const phase = pod.phases[i];

		const px = pod.positions[i3];
		const pz = pod.positions[i3 + 2];

		// ── Angular velocity (heading) ──
		let angVel = 0;

		if (mode === "leisurely") {
			angVel += angleDiff(pod.podDir, rot) * 0.6;
			angVel += Math.sin(elapsed * 0.15 + phase) * cfg.wanderAmp;
		} else if (mode === "fast") {
			angVel += angleDiff(pod.podDir, rot) * 1.0;
			angVel += Math.sin(elapsed * 0.3 + phase) * cfg.wanderAmp;
		} else if (mode === "pod") {
			// Straight ahead, all facing the same direction
			angVel += angleDiff(0, rot) * 2.0;
			// Hold formation position relative to group center
			const targetX = avgX + pod.offsets[i * 2];
			const targetZ = avgZ + pod.offsets[i * 2 + 1];
			const dx = targetX - px;
			const dz = targetZ - pz;
			angVel += (dx * (-Math.sin(rot)) + dz * (-Math.cos(rot))) * 0.3;
		}

		// Apply heading rotation
		pod.rotations[i] += angVel * delta * cfg.turnRate;
		const finalRot = pod.rotations[i];
		const finalFwdX = Math.sin(finalRot);
		const finalFwdZ = -Math.cos(finalRot);

		// ── Velocity with per-dolphin speed multiplier ──
		const lerpV = delta * 8;
		pod.velocities[i3] += (finalFwdX * cfg.speed - pod.velocities[i3]) * lerpV;
		pod.velocities[i3 + 2] += (finalFwdZ * cfg.speed - pod.velocities[i3 + 2]) * lerpV;

		// ── Vertical ──
		// Tail beat drives pitch oscillation AND body bob
		const tailOsc = Math.sin(elapsed * cfg.pitchFreq * Math.PI * 2 + phase);
		pod.pitches[i] = tailOsc * cfg.pitchAmp - 0.05;

		let yOffset = Math.sin(elapsed * cfg.pitchFreq * Math.PI * 2 + phase + Math.PI) * cfg.bobAmp;

		// Leaping: additional large-scale vertical arc for fast mode
		if (cfg.leapAmp > 0) {
			const leap = Math.sin(elapsed * cfg.leapFreq * Math.PI * 2 + phase * 0.5);
			if (leap > 0) {
				yOffset += leap * cfg.leapAmp;
			}
		}

		// Slow gentle up/down cruise wave
		const slowWave = mode === "fast"
			? Math.sin(elapsed * 0.2 + phase * 0.4) * 0.4
			: Math.sin(elapsed * 0.15 + phase * 0.3) * 0.3;

		// Depth spring
		const depthPull = (pod.heights[i] - pod.positions[i3 + 1]) * 0.02;
		pod.velocities[i3 + 1] += (yOffset + slowWave + depthPull - pod.velocities[i3 + 1]) * delta * 3;

		// ── Move ──
		pod.positions[i3] += pod.velocities[i3] * delta;
		pod.positions[i3 + 1] += pod.velocities[i3 + 1] * delta;
		pod.positions[i3 + 2] += pod.velocities[i3 + 2] * delta;

		// Pod mode: position spring toward fixed formation slot
		if (mode === "pod") {
			const targetX = avgX + pod.offsets[i * 2];
			const targetZ = avgZ + pod.offsets[i * 2 + 1];
			pod.positions[i3] += (targetX - pod.positions[i3]) * delta * 1.5;
			pod.positions[i3 + 2] += (targetZ - pod.positions[i3 + 2]) * delta * 1.5;
		}

		// Gentle centering pull so they stay in view
		if (mode !== "pod") {
			pod.positions[i3] *= 0.9995;
			pod.positions[i3 + 2] *= 0.9995;
		}

		// Wrapping
		const BOUNDS = 45;
		for (let a = 0; a < 3; a++) {
			if (pod.positions[i3 + a] > BOUNDS) pod.positions[i3 + a] = -BOUNDS;
			if (pod.positions[i3 + a] < -BOUNDS) pod.positions[i3 + a] = BOUNDS;
		}

		// ── Instance matrix ──
		dummy.position.set(pod.positions[i3], pod.positions[i3 + 1], pod.positions[i3 + 2]);
		dummy.scale.setScalar(pod.scales[i] * 0.03);
		dummy.rotation.order = "YXZ";
		dummy.rotation.y = finalRot;
		dummy.rotation.x = pod.pitches[i];
		dummy.updateMatrix();
		pod.mesh.setMatrixAt(i, dummy.matrix);
	}

	pod.mesh.instanceMatrix.needsUpdate = true;
}
