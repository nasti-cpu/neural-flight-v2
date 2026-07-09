/**
 * guidanceSystem.ts – Leitsystem für Städte in der Unterwasserwelt.
 *
 * Zeigt eine Kette von leuchtenden Kugeln, die vom Spieler ausgehen
 * und zur nächstgelegenen Stadt führen. Der Spieler kann diesem Pfad
 * folgen, um die Stadt zu finden.
 *
 * Funktionsweise:
 * - Jeden Frame wird die nächstgelegene Stadt zur Kameraposition gesucht.
 * - Eine Linie aus Kugeln führt vom Spieler zur Stadt.
 * - Die Kugeln schweben sanft auf und ab und pulsieren.
 * - Bewegt sich der Spieler, wandert der Pfad dynamisch mit.
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
  /** Farbe der Kugeln (leuchtendes Blau-Grün) */
  orbColor: 0x44ddff,
  /** Geschwindigkeit der Auf-und-Ab-Bewegung */
  bobSpeed: 0.8,
  /** Maximale Höhenänderung durch Bobbing */
  bobAmplitude: 0.3,
  /** Pulsier-Geschwindigkeit (Skalierung) */
  pulseSpeed: 1.2,
  /** Maximale Skalierungs-Änderung durch Pulsieren */
  pulseAmplitude: 0.2,
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

  /** Geometrie und Material für alle Kugeln (wiederverwendet) */
  private orbGeom: THREE.SphereGeometry;
  private orbMat: THREE.MeshBasicMaterial;

  /** Letzte bekannte Ziel-Stadt (für Änderungserkennung) */
  private lastTarget: THREE.Vector3 | null = null;
  /** Letzte bekannte Spieler-Position (für Threshold) */
  private lastPlayerPos: THREE.Vector3 | null = null;

  constructor(scene: THREE.Scene, floorY: number = -4) {
    this.scene = scene;
    this.floorY = floorY;

    // Geometrie und Material einmal anlegen (wiederverwendbar)
    this.orbGeom = new THREE.SphereGeometry(GUIDANCE_CONFIG.orbRadius, 8, 6);
    this.orbMat = new THREE.MeshBasicMaterial({
      color: GUIDANCE_CONFIG.orbColor,
      transparent: true,
      opacity: 0.8,
    });

    // Kugeln vorab erzeugen (Pool – werden nur ein-/ausgeblendet)
    for (let i = 0; i < GUIDANCE_CONFIG.orbCount; i++) {
      const orb = new THREE.Mesh(this.orbGeom, this.orbMat);
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
      // Keine Stadt vorhanden → alle Kugeln ausblenden
      this._hideAllOrbs();
      this.lastTarget = null;
      this.lastPlayerPos = null;
      return;
    }

    // --- Prüfen, ob der Pfad neu berechnet werden muss ---
    const playerMoved = this._playerMovedSignificantly(playerPos);
    const targetChanged = this._targetChanged(target);

    if (playerMoved || targetChanged) {
      this._placeOrbsAlongPath(playerPos, target);
      this.lastTarget = target.clone();
      this.lastPlayerPos = playerPos.clone();
    }

    // --- Kugeln animieren (sanftes Bobbing + Pulsieren) ---
    for (let i = 0; i < this.orbs.length; i++) {
      const orb = this.orbs[i];
      if (!orb.visible) continue;

      const phase = i * 0.5;

      // Auf und Ab schweben
      const bob = Math.sin(elapsed * GUIDANCE_CONFIG.bobSpeed + phase)
        * GUIDANCE_CONFIG.bobAmplitude;
      orb.position.y = (orb.userData.baseY as number) + bob;

      // Pulsieren (Skalierung)
      const pulse = 1.0
        + Math.sin(elapsed * GUIDANCE_CONFIG.pulseSpeed + phase * 1.3)
          * GUIDANCE_CONFIG.pulseAmplitude;
      orb.scale.setScalar(pulse);
    }
  }

  // -----------------------------------------------------------------------
  // Pfad berechnen
  // -----------------------------------------------------------------------

  /**
   * Platziert die Kugeln entlang der Linie von playerPos zu target.
   * Die erste Kugel beginnt etwas vor dem Spieler, die letzte kurz vor der Stadt.
   */
  private _placeOrbsAlongPath(
    playerPos: THREE.Vector3,
    target: THREE.Vector3,
  ): void {
    const count = this.orbs.length;
    const baseY = this.floorY + GUIDANCE_CONFIG.orbHeight;

    for (let i = 0; i < count; i++) {
      // t läuft von 0.1 (nah am Spieler) bis 0.9 (nah an der Stadt)
      const t = (i + 0.5) / (count + 0.5);

      const x = playerPos.x + (target.x - playerPos.x) * t;
      const z = playerPos.z + (target.z - playerPos.z) * t;

      const orb = this.orbs[i];
      orb.position.set(x, baseY, z);
      orb.userData.baseY = baseY;
      orb.visible = true;
    }
  }

  // -----------------------------------------------------------------------
  // Hilfsfunktionen
  // -----------------------------------------------------------------------

  /**
   * Findet die nächstgelegene Stadt-Position zur playerPos.
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
    return playerPos.distanceToSquared(this.lastPlayerPos)
      > GUIDANCE_CONFIG.rebuildThreshold * GUIDANCE_CONFIG.rebuildThreshold;
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
    }
    this.orbs.length = 0;
    this.orbGeom.dispose();
    this.orbMat.dispose();
    this.lastTarget = null;
    this.lastPlayerPos = null;
  }
}
