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
  // ── Flight ──────────────────────────────────────────
  {
    id: "baseSpeed",
    label: "Flight Speed",
    group: "Flight",
    min: 1,
    max: 30,
    default: 0.30, // 30% langsamer als vorher (1.4 m/s)
    step: 0.5,
    unit: "m/s",
    icon: "Gauge",
  },
  // ── Atmosphere (FogExp2) ────────────────────────────
  {
    id: "fogDensity",
    label: "Fog Density",
    group: "Atmosphere",
    min: 0.005,
    max: 0.06,
    default: 0.025,
    step: 0.001,
    unit: "",
    icon: "Cloud",
  },
  {
    id: "fogColor",
    label: "Fog Color",
    group: "Atmosphere",
    type: "color",
    min: 0,
    max: 1,
    step: 1,
    default: "#4a90d9",
    icon: "Palette",
  },
];

export const manifest: ExperienceManifest = {
  id: "insect-world-v2",
  name: "Insect World V2",
  description:
    "Unendliche Insektenperspektive-Welt: WFC-generierte Wiese mit dynamischen Blumen, Bienen und Schmetterlingen.",
  version: "0.2.0",
  author: "ICAROS Lab",

  parameters,
  outputs: [
    {
      id: "citiesDiscovered",
      label: "Städte entdeckt",
      type: "number",
    },
  ],
  interfaces: { orientation: true, speed: false },

  camera: { fov: 70, near: 0.1, far: 800 },
  scene: {
    background: "#4a90d9",
    fogNear: 0, // Nebel wird in scene.ts per FogExp2 gesetzt
    fogFar: 0,
    fogColor: "#4a90d9",
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
