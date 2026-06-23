/**
 * insect-world-v2 — Manifest.
 * Definiert Parameter, Scene-Konfiguration und Lifecycle für die Plattform.
 * WebGPU-konform (kein WebGL).
 */
import type { ExperienceManifest, ParameterDef } from "../types";
import { updatePlayer } from "./player";
import { dispose, setup, tick } from "./scene";
import { applySettings } from "./settings";

const parameters: ParameterDef[] = [
	// ⚡ TODO: Parameter für insect-world-v2 definieren
];

export const manifest: ExperienceManifest = {
	id: "insect-world-v2",
	name: "Insect World V2",
	description: "TODO: Beschreibung der Experience",
	version: "0.1.0",
	author: "TODO: Author",

	parameters,
	outputs: [],
	interfaces: { orientation: true, speed: false },

	camera: { fov: 70, near: 0.1, far: 500 },
	scene: {
		background: "#1a1a2e",
		fogNear: 20,
		fogFar: 150,
		fogColor: "#1a1a2e",
		ambientIntensity: 0.4,
		sunIntensity: 1.5,
		sunColor: "#ffffff",
		sunPosition: { x: 50, y: 80, z: 30 },
	},
	spawn: { position: { x: 0, y: 2, z: 0 } },

	setup,
	tick,
	applySettings,
	updatePlayer,
	dispose,
};
