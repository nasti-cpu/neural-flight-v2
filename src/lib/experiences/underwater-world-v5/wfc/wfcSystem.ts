/**
 * wfcSystem.ts – Wavefunction Collapse (WFC) für die unendliche Unterwasserwelt.
 *
 * OPTIMIERTE VERSION: Statt für jeden Chunk einen kompletten WFC-Durchlauf zu machen,
 * nutzen wir eine schnelle, deterministische Hash-basierte Typ-Bestimmung mit
 * nachträglichem Nachbarschafts-Check. Das vermeidet teure Grid-Propagierung
 * und ist O(1) pro Chunk.
 *
 * Chunk-Typen:
 * - "SAND": Sandboden mit Seegras (Standard)
 * - "RIFF": Ein wunderschönes Korallenriff
 * - "STADT": Eine futuristische Unterwasser-Stadtkuppel
 * - "QUALLE": Ein leuchtendes Quallennest
 * - "FISCH": Ein großer Fischschwarm-Bereich
 */

// ---------------------------------------------------------------------------
// Typen & Konfiguration
// ---------------------------------------------------------------------------

export type ChunkType = "SAND" | "RIFF" | "STADT" | "QUALLE" | "FISCH";

/** Gewichtung der Typen (je höher, desto häufiger) */
const TILE_WEIGHTS: Record<ChunkType, number> = {
  SAND: 75,
  RIFF: 10,
  QUALLE: 6,
  FISCH: 20,
  STADT: 3,
};

/**
 * Kumulative Gewichtung für schnelle Zufallsauswahl.
 * [SAND-Bereich, SAND+RIFF-Bereich, SAND+RIFF+STADT-Bereich, ...]
 */
const CUMULATIVE_WEIGHTS: number[] = (() => {
  const types: ChunkType[] = ["SAND", "RIFF", "STADT", "QUALLE", "FISCH"];
  const cum: number[] = [];
  let sum = 0;
  for (const t of types) {
    sum += TILE_WEIGHTS[t];
    cum.push(sum);
  }
  return cum;
})();

const TOTAL_WEIGHT = CUMULATIVE_WEIGHTS[CUMULATIVE_WEIGHTS.length - 1];
const ALL_TYPES: ChunkType[] = ["SAND", "RIFF", "STADT", "QUALLE", "FISCH"];

// ---------------------------------------------------------------------------
// WFC-Klasse
// ---------------------------------------------------------------------------

export class WFCSystem {
  private globalGrid: Map<string, ChunkType> = new Map();

  /**
   * Gibt den Typ des Chunks an (cx, cz) zurück. O(1) – kein kompletter
   * WFC-Durchlauf mehr, sondern deterministischer Hash + Nachbarschafts-Check.
   */
  public getChunkType(cx: number, cz: number): ChunkType {
    const key = this._key(cx, cz);
    if (this.globalGrid.has(key)) {
      return this.globalGrid.get(key)!;
    }

    // Deterministic Hash-Wert für diesen Chunk
    const hash = this._hash(cx, cz);
    const type = this._determineType(cx, cz, hash);
    this.globalGrid.set(key, type);
    return type;
  }

  /** WFC-konformer Hash für stabile Positionierung */
  private _hash(cx: number, cz: number): number {
    let h = cx * 374761393 + cz * 668265263;
    h = (h ^ (h >>> 13)) * 1274126177;
    h = h ^ (h >>> 16);
    return Math.abs(h);
  }

  /** Bestimmt den Typ mit WFC-Nachbarschafts-Regeln */
  private _determineType(cx: number, cz: number, hash: number): ChunkType {
    // 1. Prüfe, welche Nachbarn bereits existieren
    const neighbors = this._getNeighbors(cx, cz);

    // 2. Filtere verbotene Typen basierend auf Nachbarschafts-Regeln
    const allowed = this._getAllowedTypes(neighbors);

    // 3. Wähle zufällig (aber deterministisch) aus den erlaubten Typen
    return this._weightedSelect(allowed, hash);
  }

  /** Sammelt die Typen aller bereits kollabierten Nachbar-Chunks */
  private _getNeighbors(cx: number, cz: number): ChunkType[] {
    const result: ChunkType[] = [];
    const offsets = [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
    ];
    for (const [dx, dz] of offsets) {
      const key = this._key(cx + dx, cz + dz);
      const type = this.globalGrid.get(key);
      if (type) result.push(type);
    }
    return result;
  }

  /** Filtert die erlaubten Typen basierend auf den WFC-Regeln */
  private _getAllowedTypes(neighbors: ChunkType[]): ChunkType[] {
    if (neighbors.length === 0) return [...ALL_TYPES];

    const forbidden = new Set<ChunkType>();

    for (const nType of neighbors) {
      if (nType === "STADT") {
        // Stadt blockiert: keine weitere Stadt, kein Riff, keine Qualle daneben
        forbidden.add("STADT");
        forbidden.add("RIFF");
        forbidden.add("QUALLE");
      }
      if (nType === "RIFF") {
        // Riff blockiert: keine weitere Stadt, kein weiteres Riff daneben
        forbidden.add("STADT");
        forbidden.add("RIFF");
      }
      if (nType === "QUALLE") {
        // Quallen meiden Städte (aber das ist schon oben abgedeckt)
        forbidden.add("STADT");
      }
    }

    return ALL_TYPES.filter((t) => !forbidden.has(t));
  }

  /** Gewichtete, deterministische Auswahl aus erlaubten Typen */
  private _weightedSelect(allowed: ChunkType[], hash: number): ChunkType {
    // Berechne die Gesamt-Gewichtung der erlaubten Typen
    let allowedWeight = 0;
    for (const t of allowed) {
      allowedWeight += TILE_WEIGHTS[t];
    }

    // Deterministische Auswahl (modulo der Gesamt-Gewichtung)
    const pick = hash % allowedWeight;
    let cumulative = 0;
    for (const t of allowed) {
      cumulative += TILE_WEIGHTS[t];
      if (pick < cumulative) return t;
    }

    return allowed[allowed.length - 1];
  }

  private _key(cx: number, cz: number): string {
    return `${cx},${cz}`;
  }
}
