/**
 * manifest.ts – Parameter + Metadaten für Experiment 12.
 *
 * Die Licht- und Nebelwerte hier werden vom Loader gesetzt (applySceneDefaults),
 * aber auf minimale Intensität gestellt, weil createWorldState() eigene
 * Tiefsee-Beleuchtung erzeugt.
 */

import type { ExperienceManifest, ParameterDef } from "../types";
import { dispose, setup, tick, updatePlayer } from "./scene";

const parameters: ParameterDef[] = [
  {
    id: "driftSpeed",
    label: "Drift Speed",
    group: "Movement",
    min: 0.5,
    max: 20,
    default: 2,
    step: 0.5,
    unit: "m/s",
    icon: "Gauge",
  },
];

export const manifest: ExperienceManifest = {
  id: "experiment-12",
  name: "Experiment 12 — Tiefsee-Unterwasserwelt",
  description:
    "Endlose Tiefsee mit Sandboden, Seegras, Fischen, Quallen, Städten, Korallenriffen, Leitsystem, Scheinwerfer & Biolumineszenz.",
  version: "0.1.0",
  author: "Anastasia",

  parameters,
  outputs: [],
  interfaces: { orientation: true, speed: true },

  // Kamera stimmt mit WORLD_CONFIG überein
  camera: { fov: 65, near: 0.1, far: 80 },
  // Loader-Lichter auf 0 gesetzt – createWorldState() erzeugt eigene Tiefsee-Lichter
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
  spawn: { position: { x: 0, y: 0, z: -4 } },

  setup,
  tick,
  applySettings: () => {},
  updatePlayer,
  dispose,
};
