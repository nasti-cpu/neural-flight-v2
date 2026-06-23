/**
 * insect-world-v2 — Settings / Parameter.
 * Wendet Parameter-Änderungen auf die Szene an.
 * WebGPU-konform.
 */
import type * as THREE from "three";
import type { ExperienceState } from "../types";

export function applySettings(
	id: string,
	value: number | boolean | string,
	state: ExperienceState,
	scene: THREE.Scene,
): void {
	// TODO: Parameter-ID auf Szene-Änderung mappen
}
