/**
 * manifest.ts – Metadaten & Lifecycle-Hooks für Underwater World V5.
 *
 * Diese Datei beschreibt die Experience für den Catalog:
 *   - Name, Beschreibung, Version
 *   - Parameter (z. B. Drift-Speed)
 *   - Kamera- & Szenen-Einstellungen
 *   - Lifecycle-Hooks: setup, tick, dispose
 *
 * Der WFC-Algorithmus (Wavefunction Collapse) steuert die prozedurale
 * Verteilung von Städten, Riffen, Quallen und Fisch-Zonen.
 */

import type { ExperienceManifest, ParameterDef } from "../types";
import { dispose, setup, tick } from "./scene";
import { applySettings } from "./settings";

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
  id: "underwater-world-v5",
  name: "Underwater World V5 (WFC)",
  description:
    "Prozedurale Tiefsee-Unterwasserwelt mit Wavefunction Collapse (WFC). " +
    "Endloser Sandboden, Seegras, Fischen, Quallen, Städten, Korallenriffen, " +
    "Leitsystem, Scheinwerfer & Biolumineszenz. (WebGPU)",
  version: "0.1.0",
  author: "Anastasia",

  parameters,
  outputs: [],
  interfaces: { orientation: false, speed: false },

  camera: { fov: 75, near: 0.1, far: 80 },
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
  updatePlayer: () => {},
  dispose,
};
