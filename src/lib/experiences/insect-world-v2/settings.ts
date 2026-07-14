/**
 * insect-world-v2 — Settings / Parameter.
 * Wendet Parameter-Änderungen auf die Szene an.
 *
 * Patterns:
 * 1. Simple State   → Wert in State speichern, tick()/updatePlayer() liest ihn
 * 2. Visual Update   → scene.fog, Material etc. direkt mutieren
 *
 * WebGPU-konform (siehe AGENTS.md).
 */
import * as THREE from "three";
import type { ExperienceState } from "../types";

export function applySettings(
  id: string,
  value: number | boolean | string,
  state: ExperienceState,
  scene: THREE.Scene,
): void {
  const s = state as Record<string, unknown>;

  switch (id) {
    // ── Flight ──
    case "baseSpeed":
      s.baseSpeed = value as number;
      break;

    // ── Atmosphere (FogExp2) ──
    case "fogDensity":
      if (scene.fog instanceof THREE.FogExp2) {
        scene.fog.density = value as number;
      }
      break;

    case "fogColor":
      if (scene.fog instanceof THREE.FogExp2) {
        scene.fog.color.set(value as string);
      }
      break;
  }
}
