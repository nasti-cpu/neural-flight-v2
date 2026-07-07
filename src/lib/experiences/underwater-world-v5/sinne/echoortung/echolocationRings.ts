/**
 * echolocationRings.ts – Echoortungs-Ringe für die Unterwasserwelt.
 *
 * Sendet periodisch expandierende Ringe von einer Quelle (Spieler) aus.
 * Trifft ein Ring ein Ziel-Objekt (z. B. Fisch), wird ein Hit-Callback ausgelöst.
 *
 * Performance-optimiert:
 * - Nutzt distanceToSquared statt distanceTo (vermeidet sqrt)
 * - Cache für Distanz-Quadrate pro Frame (kein GC)
 * - Ring-Pooling (kein Erstellen/Löschen von Meshes)
 */

import * as THREE from "three/webgpu";

// ---------------------------------------------------------------------------
// Typen
// ---------------------------------------------------------------------------

export interface EcholocationConfig {
  ringMaxRadius: number;
  ringSpeed: number;
  ringInterval: number;
  ringColor: THREE.ColorRepresentation;
  hitColor: THREE.ColorRepresentation;
  tubeRadius: number;
}

export interface EchoTarget {
  position: THREE.Vector3;
  onHit: (intensity: number) => void;
}

// ---------------------------------------------------------------------------
// Standard-Konfiguration
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: EcholocationConfig = {
  ringMaxRadius: 80,
  ringSpeed: 8,
  ringInterval: 5,
  ringColor: 0x44ccff,
  hitColor: 0xffcc44,
  tubeRadius: 0.002,
};

// ---------------------------------------------------------------------------
// EcholocationRings
// ---------------------------------------------------------------------------

export class EcholocationRings {
  private scene: THREE.Scene;
  private config: EcholocationConfig;

  private ringMeshes: THREE.Mesh[] = [];
  private ringBirthTimes: number[] = [];
  private nextRingIndex = 0;
  private lastEmitTime = -999;
  private ringCount: number;

  private ringGeom: THREE.TorusGeometry;

  // Cache: pro Frame einmal berechnete Distanz-Quadrate (vermeidet GC)
  private _distCache: Float64Array = new Float64Array(0);

  /**
   * Frame-Zähler für Kollisions-Check.
   * Performance: Kollision nur alle 3 Frames prüfen, weil der Ring sich
   * pro Frame nur ~0.13m bewegt (8 m/s × 16ms). Der HitRange von 3.5m
   * erlaubt uns, jeden 3. Frame zu prüfen, ohne Treffer zu verpassen.
   */
  private _collisionFrame: number = 0;

  constructor(scene: THREE.Scene, config?: Partial<EcholocationConfig>) {
    this.scene = scene;
    this.config = { ...DEFAULT_CONFIG, ...config };

    const lifetime = this.config.ringMaxRadius / this.config.ringSpeed;
    this.ringCount = Math.ceil(lifetime / this.config.ringInterval) + 2;
    this.ringBirthTimes = new Array(this.ringCount).fill(-999);

    // Torus-Geometrie fÃ¼r alle Ringe (wird gemeinsam genutzt)
    // Performance: 32 Segmente statt 64 – bei 0.002 Rohrdicke sieht
    // man den Unterschied nicht, spart aber ~50% Ring-Geometrie
    this.ringGeom = new THREE.TorusGeometry(1, this.config.tubeRadius, 16, 32);

    // Ring-Pool vorab erstellen
    for (let i = 0; i < this.ringCount; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: this.config.ringColor,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const ring = new THREE.Mesh(this.ringGeom, mat);
      ring.rotation.x = -Math.PI / 2;
      ring.visible = false;
      ring.renderOrder = 1;
      this.scene.add(ring);
      this.ringMeshes.push(ring);
    }
  }

  /**
   * Aktualisiert alle Ringe und prüft Kollisionen mit Zielen.
   * Performance: Distanzen werden einmal pro Frame gecached, dann per
   * distanceToSquared verglichen (kein sqrt, kein new Vector3).
   */
  update(
    elapsed: number,
    delta: number,
    origin: THREE.Vector3,
    targets: EchoTarget[],
  ): void {
    // Cache-Größe anpassen (nur wenn nötig)
    if (this._distCache.length < targets.length) {
      this._distCache = new Float64Array(targets.length);
    }

    // Distanz-Quadrate einmal pro Frame berechnen (kein GC!)
    for (let t = 0; t < targets.length; t++) {
      const dx = targets[t].position.x - origin.x;
      const dy = targets[t].position.y - origin.y;
      const dz = targets[t].position.z - origin.z;
      this._distCache[t] = dx * dx + dy * dy + dz * dz;
    }

    const lifetime = this.config.ringMaxRadius / this.config.ringSpeed;

    // --- Neuen Ring aussenden ---
    if (elapsed - this.lastEmitTime >= this.config.ringInterval) {
      this.lastEmitTime = elapsed;
      const idx = this.nextRingIndex;
      this.ringBirthTimes[idx] = elapsed;
      this.nextRingIndex = (idx + 1) % this.ringCount;

      const ring = this.ringMeshes[idx];
      ring.visible = true;
      ring.scale.set(0.05, 0.05, 1);
      ring.position.x = origin.x;
      ring.position.y = origin.y;
      ring.position.z = origin.z;
      (ring.material as THREE.MeshBasicMaterial).opacity = 0.6;
    }

    // --- Jeden lebenden Ring animieren ---
    // Performance: Kollisions-Check nur alle 3 Frames.
    // Der Ring bewegt sich pro Frame nur ~0.13m, HitRange ist 3.5m –
    // kein Target wird verpasst.
    const doCollision = this._collisionFrame % 3 === 0;
    this._collisionFrame++;

    const hitRangeHalf = 3.5;

    for (let i = 0; i < this.ringCount; i++) {
      const birthTime = this.ringBirthTimes[i];
      if (birthTime < 0) {
        this.ringMeshes[i].visible = false;
        continue;
      }

      const age = elapsed - birthTime;
      if (age > lifetime) {
        this.ringMeshes[i].visible = false;
        this.ringBirthTimes[i] = -999;
        continue;
      }

      const radius = age * this.config.ringSpeed;
      const radiusSq = radius * radius;

      const ring = this.ringMeshes[i];
      ring.scale.set(radius, radius, 1);
      ring.position.x = origin.x;
      ring.position.y = origin.y;
      ring.position.z = origin.z;

      // Opazität
      const fadeProgress = age / lifetime;
      const opacity =
        fadeProgress < 0.15 ? 0.6 : 0.6 * (1 - (fadeProgress - 0.15) / 0.85);
      (ring.material as THREE.MeshBasicMaterial).opacity = opacity;

      if (!doCollision) continue;

      // ------------------------------------------------
      // Kollisions-Check mit Distanz-Vorfilter
      // Performance: Nur Targets prüfen, deren Distanz
      // innerhalb [radius - hitRange - 1m, radius + hitRange + 1m] liegt
      // Spart ~80% der Checks, weil die meisten Fische
      // außerhalb des aktiven Ringbereichs sind.
      // ------------------------------------------------
      const minDistSq = Math.max(0, radius - hitRangeHalf - 1) ** 2;
      const maxDistSq = (radius + hitRangeHalf + 1) ** 2;

      for (let t = 0; t < targets.length; t++) {
        const distSq = this._distCache[t];

        // Vorfilter: Distanz muss im aktiven Ringbereich liegen
        if (distSq < minDistSq || distSq > maxDistSq) continue;

        const diff = Math.abs(radiusSq - distSq) / (radius + Math.sqrt(distSq));
        if (diff < hitRangeHalf) {
          targets[t].onHit(1.0);
        }
      }
    }
  }

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
