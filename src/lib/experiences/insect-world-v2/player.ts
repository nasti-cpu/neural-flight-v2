/**
 * insect-world-v2 — Player / Steuerung.
 * Verarbeitet Orientation- und Speed-Inputs.
 * WebGPU-konform (kein WebGL).
 */
import type { ExperienceState } from "../types";

export function updatePlayer(
	orientation: { pitch: number; roll: number },
	speed: { accelerate: boolean; brake: boolean },
	state: ExperienceState,
	delta: number,
): void {
	// TODO: Spieler-Bewegung basierend auf Orientation + Speed
}
