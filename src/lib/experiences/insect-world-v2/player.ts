/**
 * insect-world-v2 — Player / Steuerung.
 * Verarbeitet Orientation- und Speed-Inputs.
 * Pitch → leichte Temporegelung, Roll → Kurve, Accelerate/Brake → Tempo.
 * Konstante Grundgeschwindigkeit für entspanntes Floaten.
 * WebGPU-konform (kein WebGL).
 */
import * as THREE from "three/webgpu";
import type { ExperienceState } from "../types";

const BASE_SPEED = 2;
const PITCH_SPEED_FACTOR = 0.03;
const YAW_FACTOR = 0.02;

export function updatePlayer(
	orientation: { pitch: number; roll: number },
	speed: { accelerate: boolean; brake: boolean },
	state: ExperienceState,
	delta: number,
): void {
	const s = state as Record<string, unknown>;
	const camera = s.camera as THREE.PerspectiveCamera;
	if (!camera) return;

	// Geschwindigkeit: Basis + Pitch-Einfluss
	const pitchFactor = -orientation.pitch * PITCH_SPEED_FACTOR;
	let moveSpeed = BASE_SPEED + pitchFactor;
	if (speed.accelerate) moveSpeed *= 2;
	if (speed.brake) moveSpeed *= 0.3;

	// Roll → Gieren (Kurve)
	const yawSpeed = orientation.roll * YAW_FACTOR;
	camera.rotation.y += yawSpeed * delta;

	// Vorwärtsrichtung horizontal halten
	const forward = new THREE.Vector3(0, 0, -1);
	forward.applyQuaternion(camera.quaternion);
	forward.y = 0;
	forward.normalize();

	camera.position.addScaledVector(forward, moveSpeed * delta);

	// Höhe über Grund halten (~6m Vogelperspektive)
	camera.position.y += (6 - camera.position.y) * 0.5 * delta;
	if (camera.position.y < 1) camera.position.y = 1;
}
