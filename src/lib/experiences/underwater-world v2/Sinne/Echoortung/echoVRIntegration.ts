import * as THREE from "three";

const POOL_SIZE = 40;
const EXPAND_SPEED = 10;
const LIFETIME = 3.5;
const MAX_OPACITY = 0.7;
const EMIT_INTERVAL = 3;
const ECHO_RANGE = 60;
const FLASH_DURATION = 0.5;
const RING_INNER = 0.96;
const RING_OUTER = 1.0;
const RING_SEGMENTS = 48;

export interface EchoFlashState {
	timer: number;
	duration: number;
}

export interface EchoVRState {
	group: THREE.Group;
	pool: EchoRingData[];
	emitTimer: number;
	enabled: boolean;
	interval: number;
	range: number;
	flashStates: Map<string, EchoFlashState>;
}

interface EchoRingData {
	mesh: THREE.Mesh;
	active: boolean;
	timer: number;
	emitX: number;
	emitZ: number;
}

function createRingMaterial(): THREE.MeshBasicMaterial {
	return new THREE.MeshBasicMaterial({
		color: 0x00e5ff,
		transparent: true,
		opacity: 0,
		blending: THREE.AdditiveBlending,
		depthWrite: false,
		side: THREE.DoubleSide,
	});
}

export function createEchoVR(_scene: THREE.Scene): EchoVRState {
	const group = new THREE.Group();
	const baseGeo = new THREE.RingGeometry(RING_INNER, RING_OUTER, RING_SEGMENTS);
	const pool: EchoRingData[] = [];

	for (let i = 0; i < POOL_SIZE; i++) {
		const mesh = new THREE.Mesh(baseGeo.clone(), createRingMaterial());
		mesh.rotation.x = -Math.PI / 2;
		mesh.visible = false;
		group.add(mesh);
		pool.push({ mesh, active: false, timer: 0, emitX: 0, emitZ: 0 });
	}

	_scene.add(group);

	return {
		group,
		pool,
		emitTimer: 0,
		enabled: true,
		interval: EMIT_INTERVAL,
		range: ECHO_RANGE,
		flashStates: new Map(),
	};
}

function acquireRing(state: EchoVRState): EchoRingData | null {
	for (const r of state.pool) {
		if (!r.active) return r;
	}
	return null;
}

function activateRing(ring: EchoRingData, x: number, z: number, y: number, state: EchoVRState): void {
	ring.active = true;
	ring.timer = LIFETIME;
	ring.emitX = x;
	ring.emitZ = z;
	ring.mesh.visible = true;
	ring.mesh.position.set(x, y, z);
	ring.mesh.scale.setScalar(0.3);
	(ring.mesh.material as THREE.MeshBasicMaterial).opacity = MAX_OPACITY;
}

export function updateEchoVR(
	state: EchoVRState,
	delta: number,
	playerPos: THREE.Vector3,
	targets: { key: string; x: number; z: number }[],
): void {
	if (!state.enabled) return;

	state.emitTimer += delta;
	if (state.emitTimer >= state.interval) {
		state.emitTimer -= state.interval;
		const ring = acquireRing(state);
		if (ring) {
			activateRing(ring, playerPos.x, playerPos.z, playerPos.y - 1.5, state);
		}
	}

	for (const ring of state.pool) {
		if (!ring.active) continue;
		ring.timer -= delta;
		if (ring.timer <= 0) {
			ring.active = false;
			ring.mesh.visible = false;
			continue;
		}
		const age = LIFETIME - ring.timer;
		const scale = Math.max(0.3, age * EXPAND_SPEED) + 0.2;
		ring.mesh.scale.setScalar(scale);
		const fade = ring.timer / LIFETIME;
		(ring.mesh.material as THREE.MeshBasicMaterial).opacity = fade * fade * MAX_OPACITY;
	}

	for (const ring of state.pool) {
		if (!ring.active || !ring.mesh.visible) continue;
		const radius = ring.mesh.scale.x;
		const prevRadius = Math.max(0, radius - EXPAND_SPEED * delta);

		for (const target of targets) {
			const dx = target.x - ring.emitX;
			const dz = target.z - ring.emitZ;
			const dist = Math.sqrt(dx * dx + dz * dz);
			if (dist > state.range) continue;
			if (prevRadius < dist && radius >= dist) {
				const existing = state.flashStates.get(target.key);
				if (existing) {
					existing.timer = FLASH_DURATION;
				} else {
					state.flashStates.set(target.key, { timer: FLASH_DURATION, duration: FLASH_DURATION });
				}
			}
		}
	}

	for (const [key, flash] of state.flashStates) {
		flash.timer -= delta;
		if (flash.timer <= 0) {
			state.flashStates.delete(key);
		}
	}
}

export function disposeEchoVR(state: EchoVRState, scene: THREE.Scene): void {
	scene.remove(state.group);
	for (const ring of state.pool) {
		ring.mesh.geometry.dispose();
		(ring.mesh.material as THREE.MeshBasicMaterial).dispose();
	}
	state.flashStates.clear();
}
