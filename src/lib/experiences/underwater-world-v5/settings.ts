/**
 * settings.ts – Einstellungen für die Underwater World V5 Experience.
 *
 * applySettings wird aufgerufen, wenn der Benutzer im Catalog
 * einen Parameter (z. B. Drift-Speed) verstellt.
 */

import type { ExperienceState } from "../types";
import * as THREE from "three";
import type { UnderwaterWorldV5State } from "./scene";

/**
 * Wendet eine Parameter-Änderung auf die Experience an.
 * Der Loader ruft diese Funktion mit der Parameter-ID und dem
 * bereits in Real-World-Werte umgerechneten Wert auf.
 */
export function applySettings(
  id: string,
  value: string | number | boolean,
  state: ExperienceState,
  _scene: THREE.Scene,
): void {
  if (id === "driftSpeed") {
    const s = state as UnderwaterWorldV5State;
    s.player.baseSpeed = value as number;
  }
}
