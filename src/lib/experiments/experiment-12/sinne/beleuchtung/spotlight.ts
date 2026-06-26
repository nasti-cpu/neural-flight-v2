/**
 * spotlight.ts – Unterwasser-Scheinwerfer für die Tiefsee-Experience.
 *
 * Ein SpotLight, das der Kamera folgt und einen Lichtkegel
 * in Blickrichtung wirft – wie ein Bootsscheinwerfer unter Wasser.
 *
 * Funktionsweise:
 * - Das SpotLight wird relativ zur Kamera positioniert.
 * - Ein Ziel-Objekt liegt immer 10 Einheiten vor der Kamera.
 * - So wandert der Lichtkegel mit der Blickrichtung mit.
 */

import * as THREE from "three/webgpu";

// ---------------------------------------------------------------------------
// Konfiguration – abgestimmt auf die Tiefsee-Atmosphäre
// ---------------------------------------------------------------------------

const SPOT_CONFIG = {
  /** Lichtfarbe: kaltes Blau-Weiss (typisch für Unterwasser-LED) */
  color: 0x88ddff,
  /** Helligkeit */
  intensity: 28,
  /** Maximale Reichweite des Lichts (in Einheiten) */
  distance: 18,
  /** Kegelwinkel in Radiant (~31°) – relativ eng für "Scheinwerfer"-Look */
  angle: 0.55,
  /** Weichheit des Lichtkegel-Rands (0 = hart, 1 = sehr weich) */
  penumbra: 0.4,
  /** Abfall des Lichts mit der Entfernung (1 = realistisch, 2 = dramatisch) */
  decay: 1.5,
};

// ---------------------------------------------------------------------------
// SubmarineSpotlight
// ---------------------------------------------------------------------------

export class SubmarineSpotlight {
  private light: THREE.SpotLight;
  private target: THREE.Object3D;

  /** Wiederverwendbare Vektoren für Update (spart GC) */
  private _pos: THREE.Vector3 = new THREE.Vector3();
  private _dir: THREE.Vector3 = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    // SpotLight mit Konfiguration erstellen
    this.light = new THREE.SpotLight(
      SPOT_CONFIG.color,
      SPOT_CONFIG.intensity,
      SPOT_CONFIG.distance,
      SPOT_CONFIG.angle,
      SPOT_CONFIG.penumbra,
      SPOT_CONFIG.decay,
    );

    // Das Licht positionieren wir in update() relativ zur Kamera
    this.light.position.set(0, 0, 0);

    // Ziel-Objekt: Der SpotLight schaut immer auf dieses Objekt.
    // WICHTIG: Das Target NIEMALS als Kind des Lights hinzufügen!
    // Sonst wird seine Position relativ zum Light interpretiert,
    // und der Lichtkegel wandert nicht mit der Blickrichtung mit.
    this.target = new THREE.Object3D();
    this.target.position.set(0, 0, -1);
    this.light.target = this.target;

    // Target gehört zur Szene, nicht zum Light → Weltkoordinaten bleiben erhalten
    scene.add(this.target);
    scene.add(this.light);
  }

  // -----------------------------------------------------------------------
  // Update – jeden Frame von der Render-Loop aufrufen
  // -----------------------------------------------------------------------

  /**
   * Positioniert das SpotLight an der Kamera und richtet es in Blickrichtung.
   *
   * @param camera – Die aktive Kamera (der Spieler)
   */
  update(camera: THREE.Camera): void {
    // Licht an Kameraposition setzen
    camera.getWorldPosition(this._pos);
    this.light.position.copy(this._pos);

    // Ziel 10 Einheiten vor der Kamera platzieren
    camera.getWorldDirection(this._dir);
    this.target.position
      .copy(this._pos)
      .add(this._dir.multiplyScalar(10));
  }

  // -----------------------------------------------------------------------
  // Aufräumen
  // -----------------------------------------------------------------------

  dispose(): void {
    this.light.removeFromParent();
    this.target.removeFromParent();
    this.light.dispose();
  }
}
