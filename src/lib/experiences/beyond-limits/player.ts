/**
 * player.ts – ICAROS-Steuerung für beide Welten.
 *
 * Underwater World:     delegiert an underwater-world-v5/scene.ts
 * Insect World (custom): Pitch → vertikale Bewegung (wie UW),
 *                        Roll  → Kurve, baseSpeed + Accel/Brake
 */

import * as THREE from "three/webgpu";
import type { ExperienceState } from "../types";
import { updatePlayer as uwUpdatePlayer } from "../underwater-world-v5/scene";
import { getWorldHeight } from "../insect-world-v2/Biome/Wiese/grass-manager";
import { isKeyDown } from "../../three/keyboard";
import { pollGamepad } from "../../three/gamepad";
import type { FlightPlayer } from "../../three/player";

// ── Keyboard-Steuerung (WASD) ──
const KB_LERP = 0.1;          // Smoothing-Faktor für Tastatur-Input (sanftes Ein-/Ausfliegen)
const KB_PITCH_ANGLE = 30;    // max ° die W/S die Nase kippen
const KB_ROLL_ANGLE = 30;     // max ° die A/D das Roll geben
let _kbPitch = 0;             // aktueller smoothed keyboard pitch offset
let _kbRoll = 0;              // aktueller smoothed keyboard roll offset

// ── Insect-World-Player (Pitch = vertikal, wie Underwater) ──
const INSECT_BASE_SPEED = 1;
const YAW_FACTOR = 0.02;
const CEILING_HEIGHT = 2.8;      // m – max Höhe über dem Boden
const PITCH_LERP = 0.15;        // Smoothing-Faktor (wie Underwater)

const _FWD = new THREE.Vector3();
let _smoothPitch = 0;

function _insectUpdatePlayer(
	orientation: { pitch: number; roll: number },
	speed: { accelerate: boolean; brake: boolean },
	state: ExperienceState,
	delta: number,
): void {
	const s = state as Record<string, unknown>;
	const player = s.player as FlightPlayer;
	if (!player) return;

	const rig = player.rig;

	// Pitch smoothn (wie Underwater) – orientation.pitch ist in Grad
	_smoothPitch += (orientation.pitch - _smoothPitch) * PITCH_LERP;

	// Geschwindigkeit
	let moveSpeed = (s.baseSpeed as number) ?? INSECT_BASE_SPEED;
	if (speed.accelerate) moveSpeed *= 2;
	if (speed.brake) moveSpeed *= 0.3;

	// Roll → Yaw (Kurve)
	rig.rotation.y += orientation.roll * YAW_FACTOR * delta;

	// Horizontaler Forward (ohne Pitch)
	_FWD.set(0, 0, -1).applyQuaternion(rig.quaternion);
	_FWD.y = 0;
	_FWD.normalize();
	rig.position.addScaledVector(_FWD, moveSpeed * delta);

	// Pitch → vertikale Bewegung (smoothed, als Winkel in Grad)
	// positive Pitch = nach unten (wie Underwater)
	const pitchRad = _smoothPitch * THREE.MathUtils.DEG2RAD;
	rig.position.y += -Math.sin(pitchRad) * moveSpeed * delta;

	// Boden-Follow + Höhendecke
	const groundY = getWorldHeight(rig.position.x, rig.position.z);
	const minY = groundY + 0.5;
	const maxY = groundY + CEILING_HEIGHT;
	if (rig.position.y < minY) rig.position.y = minY;
	if (rig.position.y > maxY) rig.position.y = maxY;
}

// ── Delegation ──

export function updatePlayer(
	orientation: { pitch: number; roll: number },
	speed: { accelerate: boolean; brake: boolean },
	state: ExperienceState,
	delta: number,
): void {
	const s = state as Record<string, unknown>;
	const world = s.world as number;
	const stage = s.stage as number;

	if (stage === 2) return; // Transition

	// ── Tastatur-Input (WASD + Pfeiltasten) ──
	const kbTargetPitch = isKeyDown("KeyW") || isKeyDown("ArrowUp")   ? -KB_PITCH_ANGLE
	                    : isKeyDown("KeyS") || isKeyDown("ArrowDown") ?  KB_PITCH_ANGLE : 0;
	const kbTargetRoll  = isKeyDown("KeyA") || isKeyDown("ArrowLeft") ? -KB_ROLL_ANGLE
	                    : isKeyDown("KeyD") || isKeyDown("ArrowRight")?  KB_ROLL_ANGLE : 0;

	// ── Gamepad-Input (linker Stick) ──
	const gp = pollGamepad();
	const gpTargetPitch = gp.pitch * KB_PITCH_ANGLE;
	const gpTargetRoll  = gp.roll  * KB_ROLL_ANGLE;

	// Stärkerer Input gewinnt (Tastatur = ±30°, Gamepad = analog -30..+30)
	const targetPitch = Math.abs(gpTargetPitch) > Math.abs(kbTargetPitch)
	                  ? gpTargetPitch : kbTargetPitch;
	const targetRoll  = Math.abs(gpTargetRoll) > Math.abs(kbTargetRoll)
	                  ? gpTargetRoll : kbTargetRoll;

	_kbPitch += (targetPitch - _kbPitch) * KB_LERP;
	_kbRoll  += (targetRoll  - _kbRoll)  * KB_LERP;

	const mergedPitch = orientation.pitch + _kbPitch;
	const mergedRoll  = orientation.roll  + _kbRoll;

	if (world === 0 && s.underwaterState) {
		return uwUpdatePlayer(
			{ pitch: mergedPitch, roll: mergedRoll },
			speed,
			s.underwaterState as ExperienceState,
			delta,
		);
	}

	if (world === 1 && s.insectState) {
		return _insectUpdatePlayer(
			{ pitch: mergedPitch, roll: -mergedRoll },
			speed,
			s.insectState as ExperienceState,
			delta,
		);
	}
}
