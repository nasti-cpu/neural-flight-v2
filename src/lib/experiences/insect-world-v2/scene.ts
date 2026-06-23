/**
 * insect-world-v2 — Scene Lifecycle.
 * setup, tick, dispose — ausschließlich WebGPU + TSL.
 * Separation of Concerns: Diese Datei ruft nur Sub-Module auf.
 */
import type * as THREE from "three";
import type { ColorValue, ExperienceState, SetupContext, TickContext } from "../types";

export async function setup(ctx: SetupContext): Promise<ExperienceState> {
	// ctx.renderer ist WebGPURenderer (siehe AGENTS.md)
	// TODO: Szene aufbauen — Biome, Objekte, Sinne
	return {};
}

export function tick(
	state: ExperienceState,
	ctx: TickContext,
): { state: ExperienceState; outputs?: Record<string, number | ColorValue> } {
	// TODO: Animationen und Physik pro Frame
	return { state };
}

export function dispose(state: ExperienceState, scene: THREE.Scene): void {
	// TODO: Geometrien, Materialien, Texturen aufräumen
}
