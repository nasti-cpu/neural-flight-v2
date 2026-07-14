/**
 * insect-world-v2 — WFC Engine (Wavefunction Collapse).
 *
 * Implementiert den "Even Simpler Tiled Model"-Algorithmus aus
 * Robert Heaton's Artikel für ein 2D-Chunk-Gitter.
 *
 * Kernschritte:
 * 1. Welle (Wavefunction): Jede Zelle hat eine Liste möglicher Tile-Typen.
 * 2. Kollaps (Collapse): Wähle Zelle mit niedrigster Entropie,
 *    weise zufällig einen Tile-Typ zu (gewichtet).
 * 3. Propagation (Propagate): Aktualisiere benachbarte Zellen
 *    basierend auf Adjazenzregeln.
 * 4. Wiederhole bis alle Zellen kollabiert sind oder Widerspruch.
 *
 * Anders als im klassischen WFC arbeiten wir hier mit einem
 * "sliding window": Die Engine hält einen Puffer von Zellen,
 * der größer ist als der sichtbare Bereich. Wenn der Spieler
 * sich bewegt, werden neue Zellen hinzugefügt und alte verworfen.
 *
 * WebGPU + TSL (siehe AGENTS.md).
 */
import {
  ADJACENCY_RULES,
  ALL_TILE_TYPES,
  TILE_WEIGHTS,
  type TileType,
} from "./wfc-tiles";

// ── Hilfsfunktionen ──

/**
 * Gibt die 4 Nachbar-Koordinaten (oben, unten, links, rechts) zurück.
 */
function neighbors(gx: number, gz: number): Array<{ gx: number; gz: number }> {
  return [
    { gx: gx - 1, gz },
    { gx: gx + 1, gz },
    { gx, gz: gz - 1 },
    { gx, gz: gz + 1 },
  ];
}

/**
 * Shannon-Entropie für eine Liste möglicher Tile-Typen.
 * Niedrige Entropie = wenige Möglichkeiten (stark eingeschränkt).
 * Null = keine Möglichkeit (Widerspruch).
 * Negative = bereits kollabiert (nur 1 Möglichkeit).
 */
function shannonEntropy(possibilities: TileType[]): number {
  if (possibilities.length <= 1) return -1; // bereits kollabiert
  const totalWeight = possibilities.reduce(
    (sum, t) => sum + (TILE_WEIGHTS[t] ?? 1),
    0,
  );
  const logTotal = Math.log(totalWeight);
  let sumWeightLog = 0;
  for (const t of possibilities) {
    const w = TILE_WEIGHTS[t] ?? 1;
    if (w > 0) sumWeightLog += w * Math.log(w);
  }
  return logTotal - sumWeightLog / totalWeight;
}

/**
 * Wählt zufällig einen Tile-Typ aus einer Liste (gewichtete Auswahl).
 */
function weightedPick(possibilities: TileType[]): TileType {
  const totalWeight = possibilities.reduce(
    (sum, t) => sum + (TILE_WEIGHTS[t] ?? 1),
    0,
  );
  let r = Math.random() * totalWeight;
  for (const t of possibilities) {
    const w = TILE_WEIGHTS[t] ?? 1;
    r -= w;
    if (r <= 0) return t;
  }
  // Fallback (sollte nie passieren)
  return possibilities[0];
}

// ── WFC Engine ──

export class WFCEngine {
  /**
   * Kollabierte Tile-Typen (key = "gx,gz").
   * Nur Zellen, die bereits einen definitiven Typ haben.
   */
  private collapsed = new Map<string, TileType>();

  /**
   * Wellenfunktion: mögliche Tile-Typen für nicht-kollabierte Zellen.
   * key = "gx,gz", value = Liste möglicher Typen.
   */
  private wave = new Map<string, TileType[]>();

  /**
   * Gibt den Tile-Typ für eine Gitter-Position zurück.
   * Falls die Zelle noch nicht kollabiert ist, wird sie
   * durch den WFC-Algorithmus bestimmt.
   */
  getTileType(gx: number, gz: number): TileType {
    const key = `${gx},${gz}`;

    // Bereits kollabiert?
    const existing = this.collapsed.get(key);
    if (existing !== undefined) return existing;

    // Nicht kollabiert → WFC durchführen
    this.collapseCell(gx, gz);

    // Erneut prüfen (nach Collapse)
    const result = this.collapsed.get(key);
    if (result !== undefined) return result;

    // Fallback (sollte nicht passieren)
    console.warn(`[WFC] Fallback für ${key}`);
    const tile = weightedPick(ALL_TILE_TYPES);
    this.collapsed.set(key, tile);
    return tile;
  }

  /**
   * Entfernt alle Zellen außerhalb eines bestimmten Radius.
   * Vorseeding (z.B. CITY-Tiles für Städte) wird NIEMALS gelöscht,
   * damit Städte nicht im Gras verschwinden.
   */
  cleanup(playerGX: number, playerGZ: number, radius: number): void {
    const radiusSq = radius * radius;
    for (const [key, tileType] of this.collapsed) {
      // Vorseeding (z.B. CITY) niemals löschen
      if (tileType === TileType.CITY) continue;

      const [gxStr, gzStr] = key.split(",");
      const gx = parseInt(gxStr, 10);
      const gz = parseInt(gzStr, 10);
      const dx = gx - playerGX;
      const dz = gz - playerGZ;
      if (dx * dx + dz * dz > radiusSq) {
        this.collapsed.delete(key);
      }
    }
    for (const [key] of this.wave) {
      const [gxStr, gzStr] = key.split(",");
      const gx = parseInt(gxStr, 10);
      const gz = parseInt(gzStr, 10);
      const dx = gx - playerGX;
      const dz = gz - playerGZ;
      if (dx * dx + dz * dz > radiusSq) {
        this.wave.delete(key);
      }
    }
  }

  /** Setzt die Engine zurück (für Experience-Wechsel). */
  reset(): void {
    this.collapsed.clear();
    this.wave.clear();
  }

  /**
   * Legt einen Tile-Typ manuell fest, BEVOR der WFC-Algorithmus läuft.
   *
   * Normalerweise bestimmt WFC den Chunk-Typ zufällig (gewichtet).
   * Mit preSeed() können wir sagen: "Dieser eine Chunk soll GARANTIERT
   * dieser Typ sein". Die Nachbar-Chunks passen sich dann automatisch
   * an (Propagation).
   *
   * Beispiel: preSeed(0, 0, FLOWERS_DENSE) → Spawn-Chunk hat immer Blumen.
   */
  preSeed(gx: number, gz: number, tile: TileType): void {
    this.collapsed.set(`${gx},${gz}`, tile);
  }

  // ── Private WFC-Logik ──

  /**
   * Kollabiert eine Zelle und propagiert die Konsequenzen.
   *
   * 1. Starte mit allen Tile-Typen als Möglichkeiten.
   * 2. Schränke ein basierend auf bereits kollabierten Nachbarn.
   * 3. Wähle zufällig einen Typ (gewichtete Auswahl).
   * 4. Propagiere zu Nachbarn.
   */
  private collapseCell(gx: number, gz: number): void {
    const key = `${gx},${gz}`;

    // Mögliche Typen bestimmen (basierend auf Nachbarn)
    let possibilities = this.getPossibilities(gx, gz);

    if (possibilities.length === 0) {
      // Widerspruch! Alle Typen als Fallback erlauben.
      possibilities = [...ALL_TILE_TYPES];
    }

    // Kollabieren (gewichtete Zufallsauswahl)
    const chosen = weightedPick(possibilities);
    this.collapsed.set(key, chosen);
    this.wave.delete(key);

    // Propagation zu Nachbarn
    this.propagate(gx, gz);
  }

  /**
   * Bestimmt die möglichen Tile-Typen für eine Zelle,
   * basierend auf den Adjazenzregeln der Nachbarn.
   */
  private getPossibilities(gx: number, gz: number): TileType[] {
    const key = `${gx},${gz}`;

    // Bereits in der Welle? Dann zurückgeben
    const wavePoss = this.wave.get(key);
    if (wavePoss && wavePoss.length > 0) return wavePoss;

    // Starte mit allen Typen
    let poss = new Set(ALL_TILE_TYPES);

    // Schränke durch kollabierte Nachbarn ein
    for (const n of neighbors(gx, gz)) {
      const nKey = `${n.gx},${n.gz}`;
      const nType = this.collapsed.get(nKey);
      if (nType === undefined) continue; // Nachbar nicht kollabiert

      // Welche Typen sind neben nType erlaubt?
      const allowed = ADJACENCY_RULES[nType] ?? ALL_TILE_TYPES;
      const allowedSet = new Set(allowed);

      // Schnittmenge: behalte nur, was auch neben nType erlaubt ist
      poss = new Set([...poss].filter((t) => allowedSet.has(t)));
    }

    const result = [...poss];
    this.wave.set(key, result);
    return result;
  }

  /**
   * Propagiert die Kollaps-Information zu benachbarten Zellen.
   * Aktualisiert deren Wellenfunktion und kollabiert sie,
   * wenn nur noch eine Möglichkeit übrig ist.
   */
  private propagate(fromGX: number, fromGZ: number): void {
    const queue: Array<{ gx: number; gz: number }> = [
      { gx: fromGX, gz: fromGZ },
    ];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const current = queue.shift()!;
      const cKey = `${current.gx},${current.gz}`;
      if (visited.has(cKey)) continue;
      visited.add(cKey);

      for (const n of neighbors(current.gx, current.gz)) {
        const nKey = `${n.gx},${n.gz}`;

        // Bereits kollabiert? Überspringen.
        if (this.collapsed.has(nKey)) continue;

        // Mögliche Typen für Nachbarn neu berechnen
        const oldPoss = this.wave.get(nKey);
        const newPoss = this.getPossibilities(n.gx, n.gz);

        // Haben sich die Möglichkeiten geändert?
        if (oldPoss && oldPoss.length === newPoss.length) {
          // Prüfe, ob die Listen identisch sind
          const same =
            oldPoss.length === newPoss.length &&
            oldPoss.every((t) => newPoss.includes(t));
          if (same) continue;
        }

        if (newPoss.length === 0) {
          // Widerspruch — alle Typen wieder erlauben
          this.wave.set(nKey, [...ALL_TILE_TYPES]);
          continue;
        }

        if (newPoss.length === 1) {
          // Nur eine Möglichkeit → sofort kollabieren
          this.collapsed.set(nKey, newPoss[0]);
          this.wave.delete(nKey);
          queue.push(n);
        } else {
          this.wave.set(nKey, newPoss);
        }
      }
    }
  }
}
