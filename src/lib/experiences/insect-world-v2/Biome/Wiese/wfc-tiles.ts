/**
 * insect-world-v2 — WFC Tile System.
 *
 * Definiert die Chunk-Typen (Tiles) für den Wavefunction Collapse Algorithmus.
 * Jeder Chunk-Typ hat:
 *   - Adjazenzregeln: welche Typen nebeneinander platziert werden dürfen
 *   - Gewicht: wie häufig der Typ vorkommen soll
 *   - Inhalt: wieviel Gras und wieviele Blumen im Chunk platziert werden
 *
 * Der Algorithmus ist vom Robert-Heaton-Artikel "The Wavefunction Collapse
 * Algorithm explained very clearly" inspiriert (Even Simpler Tiled Model).
 *
 * WebGPU + TSL (siehe AGENTS.md).
 */

/**
 * Die 6 Chunk-Typen unserer Wiese.
 * Jeder bestimmt, was in einem 30×30m-Chunk wächst.
 */
export enum TileType {
  /** Kahle Fläche (kaum Gras, keine Blumen) */
  EMPTY = "empty",
  /** Normale Wiese mit Gras */
  MEADOW = "meadow",
  /** Wiese mit ein paar Blumen */
  FLOWERS_SPARSE = "flowers_sparse",
  /** Wiese mit vielen Blumen (Blütenwiese) */
  FLOWERS_DENSE = "flowers_dense",
  /** Hohes Gras (keine Blumen) */
  TALL_GRASS = "tall_grass",
  /** Stadt-Chunk – kein Gras, keine Blumen, nur Boden */
  CITY = "city",
}

/**
 * Adjazenzregeln: Welche Tile-Typen nebeneinander platziert werden dürfen.
 *
 * Nach dem Vorbild des WFC-Algorithmus:
 * Jeder Tile-Typ definiert, welche Nachbarn (oben/unten/links/rechts)
 * erlaubt sind. Wenn Tile A neben Tile B liegen darf, muss B auch
 * in A's Erlaubnis-Liste sein (symmetrische Regel).
 */
export const ADJACENCY_RULES: Record<TileType, TileType[]> = {
  [TileType.EMPTY]: [TileType.EMPTY, TileType.TALL_GRASS],
  [TileType.MEADOW]: [
    TileType.MEADOW,
    TileType.FLOWERS_SPARSE,
    TileType.FLOWERS_DENSE,
    TileType.TALL_GRASS,
    TileType.CITY,
  ],
  [TileType.FLOWERS_SPARSE]: [
    TileType.MEADOW,
    TileType.FLOWERS_SPARSE,
    TileType.FLOWERS_DENSE,
  ],
  [TileType.FLOWERS_DENSE]: [TileType.FLOWERS_SPARSE, TileType.FLOWERS_DENSE],
  [TileType.TALL_GRASS]: [TileType.EMPTY, TileType.MEADOW, TileType.TALL_GRASS],
  [TileType.CITY]: [TileType.MEADOW],
};

/**
 * Gewichtung jedes Tile-Typs (Shannon-Entropy).
 *
 * Bestimmt, wie wahrscheinlich ein Typ beim Collapse-Schritt
 * ausgewählt wird. Höheres Gewicht = häufigeres Vorkommen.
 */
export const TILE_WEIGHTS: Record<TileType, number> = {
  [TileType.EMPTY]: 1,
  [TileType.MEADOW]: 6,
  [TileType.FLOWERS_SPARSE]: 7,
  [TileType.FLOWERS_DENSE]: 3,
  [TileType.TALL_GRASS]: 4,
  [TileType.CITY]: 0.1,
};

/**
 * Inhalt eines Chunks (abhängig vom Tile-Typ).
 * Bestimmt, wieviel Gras und Blumen generiert werden.
 */
export interface TileContent {
  /** Anzahl Grashalme im Chunk (0 = kein Gras) */
  grassCount: number;
  /** Anzahl Blumen im Chunk (0 = keine Blumen) */
  flowerCount: number;
  /** Minimale Grashöhe */
  grassMinHeight: number;
  /** Maximale Grashöhe */
  grassMaxHeight: number;
}

/**
 * Konfiguration pro Tile-Typ: Welcher Inhalt generiert wird.
 *
 * FLOWERS_SPARSE → 7 Blumen, weniger Gras (Platz für Blumen)
 * FLOWERS_DENSE → 17 Blumen, noch weniger Gras
 * TALL_GRASS → 15800 Halme, keine Blumen (dichter Bewuchs)
 * EMPTY → 1400 Halme (karge Fläche)
 */
export const TILE_CONTENT: Record<TileType, TileContent> = {
  // Dichte angepasst an 30m-Chunks → gleiche Flächen-Dichte wie 40m-Chunks.
  // ~20% weniger Gras, ~50% weniger Blumen als vorher → bessere Performance.
  [TileType.EMPTY]: {
    grassCount: 1400,
    flowerCount: 0,
    grassMinHeight: 0.3,
    grassMaxHeight: 0.6,
  },
  [TileType.MEADOW]: {
    grassCount: 12400,
    flowerCount: 0,
    grassMinHeight: 0.6,
    grassMaxHeight: 1.8,
  },
  [TileType.FLOWERS_SPARSE]: {
    grassCount: 7900,
    flowerCount: 7,
    grassMinHeight: 0.6,
    grassMaxHeight: 1.8,
  },
  [TileType.FLOWERS_DENSE]: {
    grassCount: 5100,
    flowerCount: 17,
    grassMinHeight: 0.6,
    grassMaxHeight: 1.8,
  },
  [TileType.TALL_GRASS]: {
    grassCount: 15800,
    flowerCount: 0,
    grassMinHeight: 0.6,
    grassMaxHeight: 1.8,
  },
  [TileType.CITY]: {
    grassCount: 0,
    flowerCount: 0,
    grassMinHeight: 0,
    grassMaxHeight: 0,
  },
};

/**
 * Alle Tile-Typen als Array (für Iteration).
 */
export const ALL_TILE_TYPES: TileType[] = Object.values(TileType);

/**
 * Maximale Anzahl Blumen pro Chunk (für Buffer-Allokation).
 * Aktuell max. 17 Blumen (FLOWERS_DENSE).
 */
export const MAX_FLOWERS_PER_CHUNK = Math.max(
  ...Object.values(TILE_CONTENT).map((c) => c.flowerCount),
);
