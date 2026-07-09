/**
 * bioParticles.ts – Biolumineszenz-Partikel für die Tiefsee-Experience.
 *
 * Leuchtende Partikel, die um den Spieler herumschweben und eine
 * lebendige Unterwasser-Atmosphäre schaffen.
 *
 * Funktionsweise:
 * - Partikel werden in einer Kugel um (0,0,0) verteilt.
 * - Das Points-Objekt folgt der Kamera (die Partikel sind also immer um den Spieler).
 * - Ein TSL-Shader lässt sie sanft wabern (schweben).
 * - Additive Blending erzeugt einen Glow-Effekt.
 */

import * as THREE from "three/webgpu";
import { PointsNodeMaterial } from "three/webgpu";
import {
  uniform,
  vec3,
  vec4,
  float,
  positionLocal,
  sin,
  cos,
  time,
} from "three/tsl";

// ---------------------------------------------------------------------------
// Konfiguration – abgestimmt auf die Tiefsee-Atmosphäre
// ---------------------------------------------------------------------------

const BIO_CONFIG = {
  /** Anzahl der Partikel */
  count: 50,
  /** Radius der Kugel, in der die Partikel verteilt sind */
  radius: 4.0,
  /** Größe jedes Partikels */
  size: 0.12,
  /** Grundfarbe: leuchtendes Cyan-Grün (typisch für Biolumineszenz) */
  color: new THREE.Color("#44ffcc"),
  /** Deckkraft / Leuchtstärke */
  opacity: 0.75,
};

// ---------------------------------------------------------------------------
// BioParticles
// ---------------------------------------------------------------------------

export class BioParticles {
  private points: THREE.Points;
  private geom: THREE.BufferGeometry;
  private mat: PointsNodeMaterial;

  constructor(scene: THREE.Scene) {
    // --- Partikel-Positionen in einer Kugel verteilen ---
    const count = BIO_CONFIG.count;
    const positions = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      // Kugelkoordinaten für gleichmäßige Verteilung
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = Math.cbrt(Math.random()) * BIO_CONFIG.radius;
      // cbrt = Kubikwurzel – sorgt für gleichmäßige Volumenverteilung

      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.cos(phi);
      positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }

    // Geometrie mit Positionen
    this.geom = new THREE.BufferGeometry();
    this.geom.setAttribute(
      "position",
      new THREE.BufferAttribute(positions, 3),
    );

    // --- Material mit TSL-Shader ---
    const color = uniform(BIO_CONFIG.color);

    this.mat = new PointsNodeMaterial();
    this.mat.transparent = true;
    this.mat.blending = THREE.AdditiveBlending; // Leucht-Effekt
    this.mat.depthWrite = false;

    // Sanftes Wabern in alle Richtungen (wie schwebende Mikroorganismen)
    this.mat.positionNode = vec3(
      positionLocal.x.add(
        sin(time.mul(0.5).add(positionLocal.y.mul(3.0))).mul(0.12),
      ),
      positionLocal.y.add(
        cos(time.mul(0.4).add(positionLocal.x.mul(2.0))).mul(0.12),
      ),
      positionLocal.z.add(
        sin(time.mul(0.45).add(positionLocal.z.mul(2.5))).mul(0.12),
      ),
    );

    // Partikelgröße
    this.mat.sizeNode = float(BIO_CONFIG.size);

    // Farbe: Basis-Farbe × Helligkeits-Faktor (variiert mit Y-Höhe für Tiefe)
    const depthFactor = positionLocal.y.mul(0.15).add(0.6).clamp(0.4, 1.0);
    this.mat.colorNode = vec4(color.mul(depthFactor), BIO_CONFIG.opacity);

    // Points-Objekt erstellen und zur Szene hinzufügen
    this.points = new THREE.Points(this.geom, this.mat);
    scene.add(this.points);
  }

  // -----------------------------------------------------------------------
  // Update – jeden Frame von der Render-Loop aufrufen
  // -----------------------------------------------------------------------

  /**
   * Lässt die Partikel der Kamera folgen.
   *
   * @param cameraPos – Aktuelle Position der Kamera (Spieler)
   */
  update(cameraPos: THREE.Vector3): void {
    // Das gesamte Points-Objekt auf die Kamera-Position setzen
    // → die Partikel (in lokalen Koordinaten) sind immer um den Spieler herum
    this.points.position.copy(cameraPos);
  }

  // -----------------------------------------------------------------------
  // Aufräumen
  // -----------------------------------------------------------------------

  dispose(): void {
    this.points.removeFromParent();
    this.geom.dispose();
    this.mat.dispose();
  }
}
