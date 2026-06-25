/**
 * insect-world-v2 — Player / Steuerung.
 * Verarbeitet Orientation- und Speed-Inputs.
 * Pitch → vorwärts/rückwärts, Roll → Kurve, Accelerate/Brake → Tempo.
 * WebGPU-konform (kein WebGL).
 */
import * as THREE from "three/webgpu";
import type { ExperienceState } from "../types";

export function updatePlayer(
	orientation: { pitch: number; roll: number },
	speed: { accelerate: boolean; brake: boolean },
	state: ExperienceState,
	delta: number,
): void {
	const s = state as Record<string, unknown>;
	const camera = s.camera as THREE.PerspectiveCamera;
	if (!camera) return;

	// Pitch (-30° = vorbeugen) → Bewegung
	const forwardSpeed = -orientation.pitch * 0.05;
	// Roll → Gieren (Kurve)
	const yawSpeed = orientation.roll * 0.02;

	// Speed-Multiplikator
	let speedMult = 1;
	if (speed.accelerate) speedMult = 2.5;
	if (speed.brake) speedMult = 0.3;

	// Gieren anwenden
	camera.rotation.y += yawSpeed * delta * speedMult;

	// Vorwärtsrichtung aus Kamera-Blick (Y-Komponente entfernen)
	const forward = new THREE.Vector3(0, 0, -1);
	forward.applyQuaternion(camera.quaternion);
	forward.y = 0;
	forward.normalize();

	// Position aktualisieren
	camera.position.addScaledVector(forward, forwardSpeed * delta * speedMult);

	// Mindesthöhe (Boden)
	if (camera.position.y < 0.3) {
		camera.position.y = 0.3;
	}
}
