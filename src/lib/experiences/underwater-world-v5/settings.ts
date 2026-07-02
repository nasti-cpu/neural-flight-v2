/**
 * settings.ts – Einstellungen für die Underwater World V5 Experience.
 *
 * Aktuell werden die Einstellungen direkt in scene.ts verwendet.
 * applySettings wird aufgerufen, wenn der Benutzer im Catalog
 * den Drift-Speed-Regler verstellt.
 */

import type { ExperienceState } from "../types";

/**
 * Wendet die Einstellungen auf die Experience an.
 * (Aktuell wird nur baseSpeed vom FlightPlayer über den Catalog gesteuert.)
 */
export function applySettings(
  settings: { driftSpeed?: number },
  state: ExperienceState,
): void {
  // Die Geschwindigkeit wird vom Catalog-Loader direkt am Player gesetzt.
  // Diese Funktion dient als Hook für zukünftige Einstellungen.
  if (settings.driftSpeed !== undefined) {
    // Wird vom Loader über updatePlayer gesteuert
  }
}
