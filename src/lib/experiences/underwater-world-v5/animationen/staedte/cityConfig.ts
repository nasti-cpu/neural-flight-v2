/**
 * cityConfig.ts – Stadt-Konfiguration + Raster-Generierung
 *
 * Enthält die Typen und Konfiguration für alle Stadt-Modelle
 * sowie die Logik zum Erzeugen des Raster-Grids.
 *
 * Keine Three.js-Abhängigkeit – reine Datenstrukturen.
 */

// ---------------------------------------------------------------------------
// Konfiguration pro Stadtmodell
// ---------------------------------------------------------------------------

export interface CityConfig {
  path: string;
  scale: number;
  sinkDepth: number;
}

export const CITY_CONFIGS: Record<string, CityConfig> = {
  blocks: {
    path: "/3D%20Modelle/city/Blocks%20Skyline.glb",
    scale: 4,
    sinkDepth: 0.3,
  },
};

// ---------------------------------------------------------------------------
// Raster-Konfiguration
// ---------------------------------------------------------------------------

export const GRID_SPACING = 120;
export const MAX_OFFSET = 20;
export const GRID_EXTENT = 400;

// ---------------------------------------------------------------------------
// Distanzen für den Lebenszyklus
// ---------------------------------------------------------------------------

export const DIST_READY = 65;
export const DIST_SHOW = 40;
export const DIST_HIDE = 50;
export const DIST_UNLOAD = 80;
export const DIST_FULL_OPACITY = 25;

// ---------------------------------------------------------------------------
// Exklusionszone (auch von FishWorld/Korallen genutzt)
// ---------------------------------------------------------------------------

export interface ExclusionZone {
  centerX: number;
  centerZ: number;
  radius: number;
}

// ---------------------------------------------------------------------------
// Stadt-Slot (wird in cityWorld.ts verwendet)
// ---------------------------------------------------------------------------

export type CityState = "pending" | "ready" | "visible";

export const CITY_TYPES = Object.keys(CITY_CONFIGS);

// ---------------------------------------------------------------------------
// Raster-Positionen generieren
// ---------------------------------------------------------------------------

export interface CitySlotData {
  gridX: number;
  gridZ: number;
  worldX: number;
  worldZ: number;
  type: string;
}

/**
 * Erzeugt alle Stadt-Positionen auf einem gleichmäßigen Raster.
 * Jede Position bekommt einen kleinen Zufalls-Offset
 * und einen zufälligen Stadt-Typ.
 */
export function generateGrid(): CitySlotData[] {
  const types = CITY_TYPES;
  if (types.length === 0) return [];

  const steps = Math.floor(GRID_EXTENT / GRID_SPACING);
  const slots: CitySlotData[] = [];

  for (let gx = -steps; gx <= steps; gx++) {
    for (let gz = -steps; gz <= steps; gz++) {
      // Keine Stadt direkt am Ursprung – Spieler startet dort
      if (gx === 0 && gz === 0) continue;

      const offsetX = (Math.random() - 0.5) * MAX_OFFSET * 2;
      const offsetZ = (Math.random() - 0.5) * MAX_OFFSET * 2;
      const worldX = gx * GRID_SPACING + offsetX;
      const worldZ = gz * GRID_SPACING + offsetZ;
      const type = types[Math.floor(Math.random() * types.length)];
      slots.push({ gridX: gx, gridZ: gz, worldX, worldZ, type });
    }
  }
  return slots;
}
