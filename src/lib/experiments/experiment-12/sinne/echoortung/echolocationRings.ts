/**
 * echolocationRings.ts – Echoortungs-Ringe für die Unterwasserwelt.
 *
 * Sendet periodisch expandierende Ringe von einer Quelle (Spieler) aus.
 * Trifft ein Ring ein Ziel-Objekt (z. B. Fisch), wird ein Hit-Callback ausgelöst.
 *
 * Extrahiert aus echolocation.ts – für Wiederverwendung in der Welt.
 * Nutzt Ringe (Modus 1) aus dem Echoortungs-Experiment.
 */

import * as THREE from "three/webgpu";

// ---------------------------------------------------------------------------
// Typen
// ---------------------------------------------------------------------------

/**
 * Konfiguration der Echoortungs-Ringe.
 */
export interface EcholocationConfig {
  /** Maximale Reichweite eines Rings (in Einheiten) */
  ringMaxRadius: number;
  /** Expandier-Geschwindigkeit (Einheiten/Sekunde) */
  ringSpeed: number;
  /** Alle wie viel Sekunden ein neuer Ring ausgesendet wird */
  ringInterval: number;
  /** Farbe der Ringe im Normalzustand */
  ringColor: THREE.ColorRepresentation;
  /** Farbe der Ringe bei einem Treffer (aktuell nur Fisch-Glow, Ring bleibt blau) */
  hitColor: THREE.ColorRepresentation;
  /** Dicke des Ring-Torus */
  tubeRadius: number;
}

/** Ein Ziel für die Echoortung: Position + Callback bei Treffer */
export interface EchoTarget {
  position: THREE.Vector3;
  onHit: (intensity: number) => void;
}

// ---------------------------------------------------------------------------
// Standard-Konfiguration
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: EcholocationConfig = {
  ringMaxRadius: 30,
  ringSpeed: 5,
  ringInterval: 6,
  ringColor: 0x44ccff,
  hitColor: 0xffcc44,
  tubeRadius: 0.002, // Sehr dünn – der Ring bleibt schmal
};

// ---------------------------------------------------------------------------
// EcholocationRings
// ---------------------------------------------------------------------------

/**
 * Verwaltet expandierende Ringe für die Echoortung.
 *
 * - Ringe werden in einem Pool vorgehalten (Round-Robin).
 * - Jeder Ring expandiert, wird dünner und verblasst mit der Zeit.
 * - Trifft ein Ring ein Ziel, feuert der onHit-Callback.
 */
export class EcholocationRings {
  private scene: THREE.Scene;
  private config: EcholocationConfig;

  private ringMeshes: THREE.Mesh[] = [];
  private ringBirthTimes: number[] = [];
  private nextRingIndex = 0;
  private lastEmitTime = -999;
  private ringCount: number;

  private ringGeom: THREE.TorusGeometry;

  constructor(scene: THREE.Scene, config?: Partial<EcholocationConfig>) {
    this.scene = scene;
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Anzahl Ringe im Pool berechnen: Lebensdauer / Intervall + Puffer
    const lifetime = this.config.ringMaxRadius / this.config.ringSpeed;
    this.ringCount = Math.ceil(lifetime / this.config.ringInterval) + 2;
    this.ringBirthTimes = new Array(this.ringCount).fill(-999);

    // Torus-Geometrie für alle Ringe (wiederverwendet)
    this.ringGeom = new THREE.TorusGeometry(1, this.config.tubeRadius, 16, 64);

    // Ring-Pool erstellen
    for (let i = 0; i < this.ringCount; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: this.config.ringColor,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const ring = new THREE.Mesh(this.ringGeom, mat);
      ring.rotation.x = -Math.PI / 2; // Flach in XZ-Ebene
      ring.visible = false;
      ring.renderOrder = 1;
      this.scene.add(ring);
      this.ringMeshes.push(ring);
    }
  }

  /**
   * Aktualisiert alle Ringe und prüft Kollisionen mit Zielen.
   *
   * @param elapsed  – Vergangene Gesamtzeit in Sekunden
   * @param delta    – Zeit seit letztem Frame in Sekunden
   * @param origin   – Position der Schallquelle (Spieler/Kamera)
   * @param targets  – Array von Zielen mit Position und Hit-Callback
   */
  update(
    elapsed: number,
    delta: number,
    origin: THREE.Vector3,
    targets: EchoTarget[],
  ): void {
    const lifetime = this.config.ringMaxRadius / this.config.ringSpeed;

    // --- Neuen Ring aussenden, wenn Intervall abgelaufen ---
    if (elapsed - this.lastEmitTime >= this.config.ringInterval) {
      this.lastEmitTime = elapsed;

      const idx = this.nextRingIndex;
      this.ringBirthTimes[idx] = elapsed;
      this.nextRingIndex = (idx + 1) % this.ringCount;

      const ring = this.ringMeshes[idx];
      ring.visible = true;
      ring.scale.set(0.05, 0.05, 1); // Start: ganz klein, tube bleibt dünn
      ring.position.copy(origin);
      (ring.material as THREE.MeshBasicMaterial).opacity = 0.6;
      (ring.material as THREE.MeshBasicMaterial).color.set(
        this.config.ringColor,
      );
    }

    // --- Jeden lebenden Ring animieren und auf Kollision prüfen ---
    for (let i = 0; i < this.ringCount; i++) {
      const ring = this.ringMeshes[i];
      const birthTime = this.ringBirthTimes[i];

      if (birthTime < 0) {
        ring.visible = false;
        continue;
      }

      const age = elapsed - birthTime;

      if (age > lifetime) {
        ring.visible = false;
        this.ringBirthTimes[i] = -999;
        continue;
      }

      const radius = age * this.config.ringSpeed;
      // Nur XZ skalieren, Y (tube) bleibt dünn
      ring.scale.set(radius, radius, 1);
      ring.position.copy(origin); // Folgt der Quelle

      // Opazität: zuerst konstant, dann linear ausblenden
      const fadeProgress = age / lifetime;
      let opacity: number;
      if (fadeProgress < 0.15) {
        opacity = 0.6;
      } else {
        const t = (fadeProgress - 0.15) / 0.85;
        opacity = 0.6 * (1 - t);
      }

      // Kollision mit Zielen prüfen – nur onHit feuern, Ring bleibt blau
      for (const target of targets) {
        const dist = target.position.distanceTo(origin);
        if (Math.abs(radius - dist) < 1.8) {
          target.onHit(1.0);
        }
      }

      (ring.material as THREE.MeshBasicMaterial).opacity = opacity;
    }
  }

  /** Räumt alle Ressourcen frei */
  dispose(): void {
    for (const ring of this.ringMeshes) {
      this.scene.remove(ring);
      ring.geometry.dispose();
      (ring.material as THREE.MeshBasicMaterial).dispose();
    }
    this.ringMeshes.length = 0;
    this.ringGeom.dispose();
  }
}
