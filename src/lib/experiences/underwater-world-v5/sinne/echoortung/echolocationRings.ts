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
  ringMaxRadius: 30,
  ringSpeed: 5,
  ringInterval: 6,
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

  constructor(scene: THREE.Scene, config?: Partial<EcholocationConfig>) {
    this.scene = scene;
    this.config = { ...DEFAULT_CONFIG, ...config };

    const lifetime = this.config.ringMaxRadius / this.config.ringSpeed;
    this.ringCount = Math.ceil(lifetime / this.config.ringInterval) + 2;
    this.ringBirthTimes = new Array(this.ringCount).fill(-999);

    // Torus-Geometrie für alle Ringe (wird gemeinsam genutzt)
    this.ringGeom = new THREE.TorusGeometry(1, this.config.tubeRadius, 16, 64);

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
    const hitRangeHalf = 1.8;
    const hitRangeSq = hitRangeHalf * hitRangeHalf;

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

      // Kollision: |radius - dist| < hitRangeHalf  ⇔  |radius² - dist²| / (radius + dist)
      // Nutze den Cache für schnelle Vergleiche ohne GC
      for (let t = 0; t < targets.length; t++) {
        const distSq = this._distCache[t];
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
