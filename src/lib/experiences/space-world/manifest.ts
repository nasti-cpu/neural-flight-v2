import type { ExperienceManifest, ParameterDef } from "../types";
import { updatePlayer } from "./player";
import { dispose, setup, tick } from "./scene";
import { applySettings } from "./settings";

const parameters: ParameterDef[] = [
  // ── Flight ──────────────────────────────────────────
  {
    id: "flightSpeed",
    label: "Flight Speed",
    group: "Flight",
    min: 1,
    max: 50,
    default: 15,
    step: 1,
    unit: "m/s",
    icon: "Gauge",
  },
  {
    id: "smoothing",
    label: "Smoothing",
    group: "Flight",
    min: 0.02,
    max: 0.3,
    default: 0.08,
    step: 0.01,
    icon: "Activity",
  },
  {
    id: "turnSensitivity",
    label: "Turn Sensitivity",
    group: "Flight",
    min: 0.3,
    max: 3.0,
    default: 1.2,
    step: 0.1,
    icon: "RotateCcw",
  },
  {
    id: "boostEnabled",
    label: "Boost Mode",
    group: "Flight",
    type: "boolean",
    min: 0,
    max: 1,
    default: true,
    step: 1,
    icon: "Zap",
  },

  // ── Visual ──────────────────────────────────────────
  {
    id: "starDensity",
    label: "Star Density",
    group: "Visual",
    min: 0.2,
    max: 2.0,
    default: 1.0,
    step: 0.1,
    icon: "Sparkles",
  },
  {
    id: "bloomIntensity",
    label: "Bloom Intensity",
    group: "Visual",
    min: 0.0,
    max: 3.0,
    default: 1.2,
    step: 0.1,
    icon: "Sun",
  },
  {
    id: "grainIntensity",
    label: "Film Grain",
    group: "Visual",
    min: 0.0,
    max: 0.2,
    default: 0.04,
    step: 0.01,
    icon: "Grain",
  },
  {
    id: "vignetteIntensity",
    label: "Vignette",
    group: "Visual",
    min: 0.0,
    max: 0.5,
    default: 0.15,
    step: 0.05,
    icon: "Aperture",
  },

  // ── Galaxy ──────────────────────────────────────────
  {
    id: "galaxyVariant",
    label: "Galaxy Type",
    group: "Galaxy",
    type: "number",
    min: 0,
    max: 2,
    default: 0,
    step: 1,
    icon: "Orbit",
  },
  {
    id: "starVariant",
    label: "Star Type",
    group: "Stars",
    type: "number",
    min: 0,
    max: 2,
    default: 1,
    step: 1,
    icon: "Star",
  },
];

export const manifest: ExperienceManifest = {
  id: "space-world",
  name: "Space World",
  description:
    "Immersive deep-space experience with procedural galaxies, starfields, and nebula clouds — WebGPU-powered for maximum visual fidelity on Quest 3.",
  version: "1.0.0",
  author: "ICAROS VR",
  rendererMode: "webgpu",

  parameters,
  outputs: [],
  interfaces: {
    orientation: true,
    speed: true,
  },

  camera: {
    fov: 90,
    near: 0.1,
    far: 10000,
  },

  scene: {
    background: "#000005",
    fogNear: 0,
    fogFar: 0,
    fogColor: "#000000",
    ambientIntensity: 0.1,
    sunIntensity: 0.0,
    sunColor: "#ffffff",
    sunPosition: { x: 0, y: 1000, z: 0 },
  },

  spawn: {
    position: { x: 0, y: 0, z: 0 },
  },

  setup,
  tick,
  applySettings,
  updatePlayer,
  dispose,
};
