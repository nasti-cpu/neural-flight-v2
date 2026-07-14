/**
 * manifest.ts – Metadaten & Lifecycle-Hooks für Beyond‑Limits.
 *
 * Parametrisiert beide Welten (Underwater World + Insect World).
 * Die Parameter haben unterschiedliche IDs – Konflikte sind ausgeschlossen.
 */

import type { ExperienceManifest, ParameterDef } from "../types";
import { dispose, setup, tick } from "./scene";
import { updatePlayer } from "./player";
import { applySettings } from "./settings";

const parameters: ParameterDef[] = [
	// ── Underwater World ──
	{
		id: "driftSpeed",
		label: "Drift Speed",
		group: "Underwater",
		min: 0.5,
		max: 20,
		default: 2,
		step: 0.5,
		unit: "m/s",
		icon: "Gauge",
	},
	// ── Insect World ──
	{
		id: "baseSpeed",
		label: "Flight Speed",
		group: "Insect",
		min: 1,
		max: 30,
		default: 0.98,
		step: 0.5,
		unit: "m/s",
		icon: "Gauge",
	},
	{
		id: "fogDensity",
		label: "Fog Density",
		group: "Insect",
		min: 0.005,
		max: 0.06,
		default: 0.04,
		step: 0.001,
		icon: "Cloud",
	},
	{
		id: "fogColor",
		label: "Fog Color",
		group: "Insect",
		type: "color",
		min: 0,
		max: 1,
		step: 1,
		default: "#4a90d9",
		icon: "Palette",
	},
];

export const manifest: ExperienceManifest = {
	id: "beyond-limits",
	name: "Beyond Limits",
	description:
		"Eine Reise durch zwei Welten: 5 Minuten Unterwasser-Welt, " +
		"dann durch ein Space-Time-Rift in die Insekten-Welt. (WebGPU)",
	version: "1.0.0",
	author: "ICAROS Lab",

	parameters,
	outputs: [],
	interfaces: { orientation: true, speed: true },

	camera: { fov: 75, near: 0.1, far: 800 },
	scene: {
		background: "#000814",
		fogNear: 4,
		fogFar: 24,
		fogColor: "#000814",
		ambientIntensity: 0,
		sunIntensity: 0,
		sunColor: "#ffffff",
		sunPosition: { x: 0, y: 0, z: 0 },
	},
	spawn: { position: { x: 0, y: 4, z: 0 } },

	setup,
	tick,
	applySettings,
	updatePlayer,
	dispose,
};
