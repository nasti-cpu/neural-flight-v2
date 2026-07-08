/**
 * guidanceSystem.ts – Leitsystem für Städte in der Unterwasserwelt.
 *
 * Zeigt eine Kette von leuchtenden Kugeln, die vom Spieler ausgehen
 * und zur nächstgelegenen Stadt führen. Der Spieler kann diesem Pfad
 * folgen, um die Stadt zu finden.
 *
 * Verbesserungen in V5:
 * – Fließ-Animation statt Bobbing + Pulsieren: Kugeln schwingen
 *   entlang der Pfadrichtung → zeigt die Flugrichtung an
 * – Farbverlauf: Kugeln nahe Spieler = Blau, nahe Stadt = Türkis
 * – Pfad maximal 100 m lang (auch wenn Stadt weiter weg ist) –
 *   so bleiben die Kugeln immer dicht genug beieinander
 */

import * as THREE from "three/webgpu";

// ---------------------------------------------------------------------------
// Konfiguration
// ---------------------------------------------------------------------------

const GUIDANCE_CONFIG = {
  /** Anzahl Kugeln zwischen Spieler und Stadt */
  orbCount: 10,
  /** Abstand der Kugeln vom Meeresboden (Y-Höhe) */
  orbHeight: 1.5,
  /** Größe jeder Kugel */
  orbRadius: 0.15,
  /** Basisfarbe (wird durch Farbverlauf überschrieben) */
  orbColor: 0x44ddff,
  /** Geschwindigkeit der Fließ-Welle entlang des Pfads */
  flowSpeed: 0.6,
  /** Maximale Verschiebung der Kugel entlang der Pfadrichtung */
  flowAmplitude: 0.25,
  /** Kugeln anzeigen sobald die Stadt in dieser Distanz ist (groß = immer) */
  showDistance: 500,
  /** Maximale Pfad-Länge – verhindert zu dünn verteilte Kugeln bei fernen Städten */
  maxGuideDistance: 100,
  /** Mindest-Abstand zum Pfad-Neubau (Spieler-Bewegung in Meter) */
  rebuildThreshold: 2.0,
};

// ---------------------------------------------------------------------------
// GuidanceSystem
// ---------------------------------------------------------------------------

export class GuidanceSystem {
  private scene: THREE.Scene;
  private floorY: number;

  /** Alle Pfad-Kugeln (einmal angelegt, werden nur verschoben) */
  private orbs: THREE.Mesh[] = [];

  /** Geometrie für alle Kugeln (wiederverwendet) */
  private orbGeom: THREE.SphereGeometry;

  /** Letzte bekannte Ziel-Stadt (für Änderungserkennung) */
  private lastTarget = new THREE.Vector3();
  /** Letzte bekannte Spieler-Position (für Threshold) */
  private lastPlayerPos = new THREE.Vector3();

  /** Normalisierte Richtung vom Spieler zur Stadt (für Fließ-Animation) */
  private _flowDir = new THREE.Vector3();

  constructor(scene: THREE.Scene, floorY: number = -4) {
    this.scene = scene;
    this.floorY = floorY;

    // Geometrie einmal anlegen (wiederverwendbar für alle Kugeln)
    this.orbGeom = new THREE.SphereGeometry(GUIDANCE_CONFIG.orbRadius, 8, 6);

    // Kugeln vorab erzeugen – jede mit eigener Material-Instanz,
    // damit wir später unterschiedliche Farben setzen können (Farbverlauf).
    for (let i = 0; i < GUIDANCE_CONFIG.orbCount; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: GUIDANCE_CONFIG.orbColor,
        transparent: true,
        opacity: 0.8,
      });
      const orb = new THREE.Mesh(this.orbGeom, mat);
      orb.visible = false;
      this.scene.add(orb);
      this.orbs.push(orb);
    }
  }

  // -----------------------------------------------------------------------
  // Update – jeden Frame von der Render-Loop aufrufen
  // -----------------------------------------------------------------------

  /**
   * Aktualisiert den Pfad vom Spieler zur nächsten Stadt.
   *
   * @param delta         – Zeit seit letztem Frame in Sekunden
   * @param elapsed       – Gesamtzeit seit Start in Sekunden
   * @param playerPos     – Aktuelle Position des Spielers (Kamera)
   * @param cityPositions – Array mit den Positionen aller aktiven Städte
   */
  update(
    delta: number,
    elapsed: number,
    playerPos: THREE.Vector3,
    cityPositions: THREE.Vector3[],
  ): void {
    // --- Nächste Stadt zum Spieler suchen ---
    const target = this._findNearest(playerPos, cityPositions);

    if (!target) {
      this._hideAllOrbs();
      return;
    }

    // ---------------------------------------------------------------
    // ③ Distanz-Prüfung: Orbs nur zeigen, wenn die Stadt nah genug ist
    // ---------------------------------------------------------------
    const distSq = playerPos.distanceToSquared(target);
    if (distSq > GUIDANCE_CONFIG.showDistance * GUIDANCE_CONFIG.showDistance) {
      this._hideAllOrbs();
      return;
    }

    // --- Prüfen, ob der Pfad neu berechnet werden muss ---
    const playerMoved = this._playerMovedSignificantly(playerPos);
    const targetChanged = this._targetChanged(target);

    if (playerMoved || targetChanged) {
      // ④ Fließ-Richtung speichern (für Animation zwischen Rebuilds)
      this._flowDir.copy(target).sub(playerPos).normalize();

      this._placeOrbsAlongPath(playerPos, target);
      this.lastTarget.copy(target);
      this.lastPlayerPos.copy(playerPos);
    }

    // -----------------------------------------------------------------------
    // ① Fließ-Animation (ersetzt Bobbing + Pulsieren – weniger sin-Aufrufe!)
    // -----------------------------------------------------------------------
    // Jede Kugel schwingt entlang der Pfadrichtung.
    // Die Phase (i * 0.8) erzeugt eine Welle, die vom Spieler zur Stadt läuft.
    for (let i = 0; i < this.orbs.length; i++) {
      const orb = this.orbs[i];
      if (!orb.visible) continue;

      const flow =
        Math.sin(elapsed * GUIDANCE_CONFIG.flowSpeed + i * 0.8) *
        GUIDANCE_CONFIG.flowAmplitude;

      // Kugel schwingt entlang der Pfadrichtung → zeigt Flugrichtung
      orb.position.x = (orb.userData.baseX as number) + this._flowDir.x * flow;
      orb.position.y = (orb.userData.baseY as number) + this._flowDir.y * flow;
      orb.position.z = (orb.userData.baseZ as number) + this._flowDir.z * flow;
    }
  }

  // -----------------------------------------------------------------------
  // Pfad berechnen
  // -----------------------------------------------------------------------

  /**
   * Platziert die Kugeln entlang der Linie von playerPos Richtung target.
   * Der Pfad ist maximal maxGuideDistance Meter lang – bei fernen Städten
   * zeigen die letzten Kugeln in die richtige Richtung, ohne dünn verteilt zu sein.
   * Setzt auch den ② Farbverlauf (Spieler-nah = Blau, Stadt-nah = Türkis).
   */
  private _placeOrbsAlongPath(
    playerPos: THREE.Vector3,
    target: THREE.Vector3,
  ): void {
    const count = this.orbs.length;
    const baseY = this.floorY + GUIDANCE_CONFIG.orbHeight;
    const maxDist = GUIDANCE_CONFIG.maxGuideDistance;

    // Richtung + Distanz zur Stadt
    const dx = target.x - playerPos.x;
    const dz = target.z - playerPos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    // Pfad auf maxDist begrenzen, damit Kugeln nie zu weit auseinander sind
    const ratio = dist > 0.001 ? Math.min(dist, maxDist) / dist : 1;
    const endX = playerPos.x + dx * ratio;
    const endZ = playerPos.z + dz * ratio;

    for (let i = 0; i < count; i++) {
      // t läuft von 0.1 (nah am Spieler) bis 0.9 (nah am Endpunkt)
      const t = (i + 0.5) / (count + 0.5);

      const x = playerPos.x + (endX - playerPos.x) * t;
      const z = playerPos.z + (endZ - playerPos.z) * t;

      const orb = this.orbs[i];

      // Basis-Position speichern (für Fließ-Animation in update)
      orb.userData.baseX = x;
      orb.userData.baseY = baseY;
      orb.userData.baseZ = z;
      orb.position.set(x, baseY, z);
      orb.visible = true;

      // ② Farbverlauf: Hue wandert von Blau (0.55) zu Türkis (0.65)
      const hue = 0.55 + t * 0.1;
      const saturation = 0.8;
      const lightness = 0.5 + t * 0.3;
      (orb.material as THREE.MeshBasicMaterial).color.setHSL(
        hue,
        saturation,
        lightness,
      );
    }
  }

  // -----------------------------------------------------------------------
  // Hilfsfunktionen
  // -----------------------------------------------------------------------

  /**
   * Findet die nächstgelegene Stadt-Position zur playerPos.
   * Nutzt distanceToSquared (kein sqrt) für maximale Performance.
   */
  private _findNearest(
    playerPos: THREE.Vector3,
    cityPositions: THREE.Vector3[],
  ): THREE.Vector3 | null {
    if (cityPositions.length === 0) return null;

    let nearest = cityPositions[0];
    let bestDist = playerPos.distanceToSquared(nearest);

    for (let i = 1; i < cityPositions.length; i++) {
      const dist = playerPos.distanceToSquared(cityPositions[i]);
      if (dist < bestDist) {
        bestDist = dist;
        nearest = cityPositions[i];
      }
    }

    return nearest;
  }

  /**
   * Prüft, ob der Spieler sich weit genug bewegt hat, um den Pfad neu zu bauen.
   */
  private _playerMovedSignificantly(playerPos: THREE.Vector3): boolean {
    if (!this.lastPlayerPos) return true;
    return (
      playerPos.distanceToSquared(this.lastPlayerPos) >
      GUIDANCE_CONFIG.rebuildThreshold * GUIDANCE_CONFIG.rebuildThreshold
    );
  }

  /**
   * Prüft, ob sich die Ziel-Stadt geändert hat.
   */
  private _targetChanged(target: THREE.Vector3): boolean {
    if (!this.lastTarget) return true;
    return target.distanceToSquared(this.lastTarget) > 0.01;
  }

  /**
   * Blendet alle Kugeln aus.
   */
  private _hideAllOrbs(): void {
    for (const orb of this.orbs) {
      orb.visible = false;
    }
  }

  // -----------------------------------------------------------------------
  // Aufräumen
  // -----------------------------------------------------------------------

  dispose(): void {
    for (const orb of this.orbs) {
      this.scene.remove(orb);
      const mat = orb.material;
      if (!Array.isArray(mat)) mat.dispose();
    }
    this.orbs.length = 0;
    this.orbGeom.dispose();
  }
}
