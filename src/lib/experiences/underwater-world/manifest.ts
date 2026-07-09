import type { ExperienceManifest, ParameterDef } from "../types";
import { updatePlayer } from "./player";
import { dispose, setup, tick } from "./scene";
import { applySettings } from "./settings";

const parameters: ParameterDef[] = [
	// ── Movement ────────────────────────────────────
	{
		id: "driftSpeed",
		label: "Drift Speed",
		group: "Movement",
		min: 0.5,
		max: 20,
		default: 8,
		step: 0.5,
		unit: "m/s",
		icon: "Gauge",
	},
	{
		id: "wasdSpeed",
		label: "Steig-/Drehrate",
		group: "Movement",
		min: 1,
		max: 20,
		default: 6,
		step: 0.5,
		unit: "m/s",
		icon: "ArrowUpDown",
	},

	// ── Echolocation ────────────────────────────────
	{
		id: "echolocationEnabled",
		label: "Echolocation",
		group: "Echolocation",
		type: "boolean",
		min: 0,
		max: 1,
		default: true,
		step: 1,
		icon: "Radar",
	},
	{
		id: "echolocationRange",
		label: "Reichweite",
		group: "Echolocation",
		min: 20,
		max: 120,
		default: 60,
		step: 5,
		unit: "m",
		icon: "Expand",
	},

	// ── Atmosphere ──────────────────────────────────
	{
		id: "fogDensity",
		label: "Fog Density",
		group: "Atmosphere",
		min: 0.01,
		max: 0.1,
		default: 0.035,
		step: 0.005,
		icon: "Cloud",
	},
	{
		id: "lightIntensity",
		label: "Bioluminescence",
		group: "Atmosphere",
		min: 0.2,
		max: 3,
		default: 1.5,
		step: 0.1,
		icon: "Lightbulb",
	},

	// ── Terrain ─────────────────────────────────────
	{
		id: "terrainAmplitude",
		label: "Berg Höhe",
		group: "Terrain",
		min: 10,
		max: 70,
		default: 50,
		step: 2,
		unit: "m",
		icon: "Mountain",
	},
	{
		id: "terrainScale",
		label: "Berg Frequenz",
		group: "Terrain",
		min: 0.004,
		max: 0.04,
		default: 0.012,
		step: 0.002,
		icon: "Waves",
	},
	{
		id: "terrainColor",
		label: "Farbe Tönung",
		group: "Terrain",
		type: "color",
		min: 0,
		max: 1,
		default: "#ffffff",
		step: 1,
		icon: "Palette",
	},

	// ── Fish ────────────────────────────────────────
	{
		id: "fishCount",
		label: "Fish Count",
		group: "Fish",
		min: 5,
		max: 80,
		default: 20,
		step: 10,
		icon: "Fish",
	},
];

export const manifest: ExperienceManifest = {
	id: "underwater-world",
	name: "Underwater World",
	description:
		"Swim through a low-poly underwater mountain landscape with valleys, rock formations, and schooling fish. Navigate using echolocation sonar pulses in a bioluminescent deep ocean.",
	version: "0.5.0",
	author: "Anastasia",

	parameters,
	outputs: [],
	interfaces: { orientation: true, speed: false },

	camera: { fov: 75, near: 0.1, far: 600 },
	scene: {
		background: "#001830",
		fogNear: 10,
		fogFar: 180,
		fogColor: "#001020",
		ambientIntensity: 0.5,
		sunIntensity: 0.8,
		sunColor: "#2288bb",
		sunPosition: { x: 0, y: 80, z: -50 },
	},
	spawn: { position: { x: 0, y: 4, z: 0 } },

	setup,
	tick,
	applySettings,
	updatePlayer,
	dispose,
};
