/**
 * wfcSystem.ts – Wavefunction Collapse (WFC) für die unendliche Unterwasserwelt.
 *
 * Diese Datei implementiert einen prozeduralen WFC-Algorithmus, der on-demand
 * (bei Bedarf) entscheidet, welcher Typ von Chunk an einer bestimmten Position (X, Z)
 * entstehen soll. Dadurch ist die Welt unendlich, aber absolut konsistent.
 *
 * Die möglichen Chunk-Typen (Zustände) sind:
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

/** Gewichtung der einzelnen Typen (je höher, desto häufiger) */
const TILE_WEIGHTS: Record<ChunkType, number> = {
  SAND: 75,   // Sehr häufig, bildet den ruhigen Hintergrund
  RIFF: 10,   // Gelegentliche Riffe zum Erkunden
  QUALLE: 6,  // Quallen-Zonen
  FISCH: 6,   // Fisch-Zonen
  STADT: 3,   // Seltene, majestätische Städte (Kuppeln)
};

/** Alle verfügbaren Chunk-Typen */
const ALL_TYPES: ChunkType[] = ["SAND", "RIFF", "STADT", "QUALLE", "FISCH"];

// ---------------------------------------------------------------------------
// WFC-Klasse
// ---------------------------------------------------------------------------

export class WFCSystem {
  /** Globaler Speicher aller bereits fest kollabierten Chunks */
  private globalGrid: Map<string, ChunkType> = new Map();

  /**
   * Gibt den Typ des Chunks an der Koordinate (cx, cz) zurück.
   * Falls der Chunk noch nicht existiert, wird er und seine Umgebung kollabiert.
   */
  public getChunkType(cx: number, cz: number): ChunkType {
    const key = this._key(cx, cz);
    if (this.globalGrid.has(key)) {
      return this.globalGrid.get(key)!;
    }

    // Falls nicht kollabiert, kollabieren wir ein lokales Gebiet um den Chunk
    this._collapseLocalArea(cx, cz);
    return this.globalGrid.get(key) || "SAND"; // Fallback auf Sand
  }

  /** Erzeugt einen eindeutigen Key für die Map */
  private _key(cx: number, cz: number): string {
    return `${cx},${cz}`;
  }

  /**
   * Kollabiert ein lokales 5x5 Gebiet um die Zielkoordinate.
   * Nutzt den klassischen WFC-Algorithmus mit Entropie-Auswahl und Propagierung.
   */
  private _collapseLocalArea(targetX: number, targetZ: number): void {
    const radius = 3; // 7x7 Bereich für stabile Propagierung
    let attempts = 0;
    const maxAttempts = 10;

    while (attempts < maxAttempts) {
      const localGrid = this._initLocalGrid(targetX, targetZ, radius);
      if (this._runWFC(localGrid)) {
        // Erfolg! Wir speichern alle kollabierten Zellen im globalen Grid
        for (const [key, possibilities] of localGrid.entries()) {
          if (possibilities.length === 1) {
            this.globalGrid.set(key, possibilities[0]);
          }
        }
        return;
      }
      attempts++;
    }

    // Absoluter Fallback bei zu vielen Widersprüchen: Ziel wird Sand
    this.globalGrid.set(this._key(targetX, targetZ), "SAND");
  }

  /** Initialisiert das lokale Grid mit bereits bekannten oder allen Möglichkeiten */
  private _initLocalGrid(centerX: number, centerZ: number, radius: number): Map<string, ChunkType[]> {
    const grid = new Map<string, ChunkType[]>();
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        const cx = centerX + dx;
        const cz = centerZ + dz;
        const key = this._key(cx, cz);

        if (this.globalGrid.has(key)) {
          grid.set(key, [this.globalGrid.get(key)!]);
        } else {
          grid.set(key, [...ALL_TYPES]);
        }
      }
    }
    return grid;
  }

  /** Führt den WFC-Loop auf dem lokalen Grid aus */
  private _runWFC(grid: Map<string, ChunkType[]>): boolean {
    while (true) {
      const nextCell = this._findLowestEntropyCell(grid);
      if (!nextCell) return true; // Alle Zellen kollabiert!

      const [key, possibilities] = nextCell;
      const chosen = this._selectRandomWeighted(possibilities);
      grid.set(key, [chosen]);

      // Propagiere die Einschränkung auf die Nachbarn
      if (!this._propagate(grid, key)) {
        return false; // Widerspruch gefunden!
      }
    }
  }

  /** Findet die Zelle mit der geringsten Entropie (wenigste Möglichkeiten > 1) */
  private _findLowestEntropyCell(grid: Map<string, ChunkType[]>): [string, ChunkType[]] | null {
    let minEntropy = Infinity;
    let selected: [string, ChunkType[]] | null = null;

    for (const [key, possibilities] of grid.entries()) {
      const len = possibilities.length;
      if (len > 1 && len < minEntropy) {
        minEntropy = len;
        selected = [key, possibilities];
      }
    }
    return selected;
  }

  /** Wählt zufällig eine Möglichkeit basierend auf den TILE_WEIGHTS */
  private _selectRandomWeighted(possibilities: ChunkType[]): ChunkType {
    let totalWeight = 0;
    for (const type of possibilities) {
      totalWeight += TILE_WEIGHTS[type];
    }

    let rand = Math.random() * totalWeight;
    for (const type of possibilities) {
      const w = TILE_WEIGHTS[type];
      if (rand < w) return type;
      rand -= w;
    }
    return possibilities[0];
  }

  /** Propagiert die Regeln wellenartig durch das lokale Grid */
  private _propagate(grid: Map<string, ChunkType[]>, startKey: string): boolean {
    const queue: string[] = [startKey];
    const visited = new Set<string>([startKey]);

    while (queue.length > 0) {
      const currentKey = queue.shift()!;
      const [cx, cz] = currentKey.split(",").map(Number);

      // Nachbarn prüfen (oben, unten, links, rechts)
      const neighbors = [
        [cx, cz - 1], [cx, cz + 1], [cx - 1, cz], [cx + 1, cz]
      ];

      for (const [nx, nz] of neighbors) {
        const nKey = this._key(nx, nz);
        if (!grid.has(nKey)) continue;

        const changed = this._constrainNeighbor(grid, currentKey, nKey, cx - nx, cz - nz);
        if (changed) {
          if (grid.get(nKey)!.length === 0) {
            return false; // Widerspruch! Eine Zelle hat 0 Möglichkeiten
          }
          if (!visited.has(nKey)) {
            queue.push(nKey);
            visited.add(nKey);
          }
        }
      }
    }
    return true;
  }

  /** Schränkt die Möglichkeiten eines Nachbarn basierend auf den Regeln ein */
  private _constrainNeighbor(
    grid: Map<string, ChunkType[]>,
    currentKey: string,
    neighborKey: string,
    dx: number,
    dz: number
  ): boolean {
    const currentPossibilities = grid.get(currentKey)!;
    const neighborPossibilities = grid.get(neighborKey)!;
    const originalLen = neighborPossibilities.length;

    // Filtere Nachbar-Möglichkeiten basierend auf unseren Regeln
    const filtered = neighborPossibilities.filter(nType => {
      // Prüfe, ob es MINDESTENS einen Typ in currentPossibilities gibt,
      // der neben nType liegen darf.
      return currentPossibilities.some(cType => this._areAllowedNeighbors(cType, nType, dx, dz));
    });

    if (filtered.length !== originalLen) {
      grid.set(neighborKey, filtered);
      return true; // Es gab eine Änderung!
    }
    return false;
  }

  /**
   * Definiert die Nachbarschaftsregeln des Spiels.
   * Hier legen wir fest, welche Chunks nebeneinander existieren dürfen.
   */
  private _areAllowedNeighbors(cType: ChunkType, nType: ChunkType, dx: number, dz: number): boolean {
    // Regel 1: Städte ("STADT") dürfen niemals direkt nebeneinander liegen (Abstand halten)
    if (cType === "STADT" && nType === "STADT") {
      return false;
    }

    // Regel 2: Städte ("STADT") und Riffe ("RIFF") dürfen nicht nebeneinander liegen (Clipping-Schutz)
    if ((cType === "STADT" && nType === "RIFF") || (cType === "RIFF" && nType === "STADT")) {
      return false;
    }

    // Regel 3: Riffe ("RIFF") dürfen nicht direkt nebeneinander liegen (damit sie besonders bleiben)
    if (cType === "RIFF" && nType === "RIFF") {
      return false;
    }

    // Regel 4: Quallen ("QUALLE") nisten sich gerne in der Nähe von Riffen oder Sand ein, aber nicht in Städten
    if ((cType === "STADT" && nType === "QUALLE") || (cType === "QUALLE" && nType === "STADT")) {
      return false;
    }

    // Standardmäßig ist alles andere erlaubt!
    return true;
  }
}
