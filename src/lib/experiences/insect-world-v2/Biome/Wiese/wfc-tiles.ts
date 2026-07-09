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
 * Die 5 Chunk-Typen unserer Wiese.
 * Jeder bestimmt, was in einem 80×80m-Chunk wächst.
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
  [TileType.EMPTY]: [TileType.EMPTY, TileType.MEADOW, TileType.TALL_GRASS],
  [TileType.MEADOW]: [
    TileType.EMPTY,
    TileType.MEADOW,
    TileType.FLOWERS_SPARSE,
    TileType.TALL_GRASS,
  ],
  [TileType.FLOWERS_SPARSE]: [
    TileType.MEADOW,
    TileType.FLOWERS_SPARSE,
    TileType.FLOWERS_DENSE,
  ],
  [TileType.FLOWERS_DENSE]: [TileType.FLOWERS_SPARSE, TileType.FLOWERS_DENSE],
  [TileType.TALL_GRASS]: [TileType.EMPTY, TileType.MEADOW, TileType.TALL_GRASS],
};

/**
 * Gewichtung jedes Tile-Typs (Shannon-Entropy).
 *
 * Bestimmt, wie wahrscheinlich ein Typ beim Collapse-Schritt
 * ausgewählt wird. Höheres Gewicht = häufigeres Vorkommen.
 */
export const TILE_WEIGHTS: Record<TileType, number> = {
  [TileType.EMPTY]: 2,
  [TileType.MEADOW]: 8,
  [TileType.FLOWERS_SPARSE]: 5,
  [TileType.FLOWERS_DENSE]: 2,
  [TileType.TALL_GRASS]: 4,
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
 * FLOWERS_SPARSE → 4 Blumen, weniger Gras (Platz für Blumen)
 * FLOWERS_DENSE → 12 Blumen, noch weniger Gras
 * TALL_GRASS → 8000 Halme, keine Blumen (dichter Bewuchs)
 * EMPTY → fast nichts (Sand/Stein)
 */
export const TILE_CONTENT: Record<TileType, TileContent> = {
  // Gras-Zahlen stark reduziert (~60% weniger):
  // Aus ~40k/Chunk → ~14k/Chunk. Optisch kein Unterschied
  // (Nebel + Insektenperspektive), aber ~60% weniger GPU-Last.
  [TileType.EMPTY]: {
    grassCount: 1800,
    flowerCount: 0,
    grassMinHeight: 0.1,
    grassMaxHeight: 0.3,
  },
  [TileType.MEADOW]: {
    grassCount: 15000,
    flowerCount: 0,
    grassMinHeight: 0.6,
    grassMaxHeight: 1.8,
  },
  [TileType.FLOWERS_SPARSE]: {
    grassCount: 10000,
    flowerCount: 12,
    grassMinHeight: 0.6,
    grassMaxHeight: 1.8,
  },
  [TileType.FLOWERS_DENSE]: {
    grassCount: 6500,
    flowerCount: 30,
    grassMinHeight: 0.6,
    grassMaxHeight: 1.8,
  },
  [TileType.TALL_GRASS]: {
    grassCount: 18000,
    flowerCount: 0,
    grassMinHeight: 1.2,
    grassMaxHeight: 2.5,
  },
};

/**
 * Alle Tile-Typen als Array (für Iteration).
 */
export const ALL_TILE_TYPES: TileType[] = Object.values(TileType);

/**
 * Maximale Anzahl Blumen pro Chunk (für Buffer-Allokation).
 */
export const MAX_FLOWERS_PER_CHUNK = Math.max(
  ...Object.values(TILE_CONTENT).map((c) => c.flowerCount),
);
