/**
 * insect-world-v2 — CityManager.
 * Verwaltet mehrere prozedural gespawnte Städte:
 * - Generiert zufällige Positionen mit Mindestabstand (200–300m)
 * - Lädt das Stadt-Modell EINMAL und platziert es per Pivot an der aktiven Stadt
 *   (KEIN clone(true) – spart ~80% GPU-Speicher und Draw Calls)
 * - Registriert kreisförmige Clear-Regionen im GrassManager
 * - Trackt welche Städte bereits entdeckt wurden
 *
 * WebGPU-konform.
 */
import * as THREE from "three/webgpu";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { CITY_CONFIG } from "./city";
import { getWorldHeight } from "../../Biome/Wiese/grass-manager";
import type { GrassManager } from "../../Biome/Wiese/grass-manager";

export interface CityInstance {
  position: THREE.Vector3;
  visited: boolean;
  index: number;
  /** Zufällige Y-Rotation für diese Stadt */
  rotation: number;
}

export class CityManager {
  readonly cities: CityInstance[] = [];
  private modelPromise: Promise<THREE.Group | null> | null = null;
  /** Einmal geladenes, zentriertes, skaliertes Stadt-Modell (wird nicht geklont) */
  private sharedModel: THREE.Group | null = null;
  /** Pivot-Gruppe in der Szene – wird an die aktive Stadt-Position verschoben */
  private modelPivot: THREE.Group;

  constructor() {
    /**
     * Pivot-Gruppe, die das einmal geladene Modell hält.
     * Wird an die Position + Rotation der aktiven Stadt verschoben.
     * Standardmäßig unsichtbar – setActiveCity() schaltet sie ein.
     */
    this.modelPivot = new THREE.Group();
    this.modelPivot.visible = false;
  }

  /**
   * Generiert N zufällige Positionen mit Mindestabstand.
   */
  generatePositions(
    count: number,
    minDistance: number,
    maxDistance: number,
  ): THREE.Vector3[] {
    const positions: THREE.Vector3[] = [];
    let attempts = 0;
    const maxAttempts = count * 100;

    while (positions.length < count && attempts < maxAttempts) {
      attempts++;

      // Zufällige Position im Kreis um den Ursprung
      const angle = Math.random() * Math.PI * 2;
      const dist = minDistance + Math.random() * (maxDistance - minDistance);
      const x = Math.cos(angle) * dist;
      const z = Math.sin(angle) * dist;

      // Prüfen ob weit genug von anderen Städten entfernt
      let tooClose = false;
      for (const pos of positions) {
        const d = Math.sqrt(
          (pos.x - x) * (pos.x - x) + (pos.z - z) * (pos.z - z),
        );
        if (d < minDistance) {
          tooClose = true;
          break;
        }
      }

      if (!tooClose) {
        positions.push(new THREE.Vector3(x, 0, z));
      }
    }

    return positions;
  }

  /**
   * Lädt das Stadt-Modell EINMAL und registriert alle Städte als Datenpunkte.
   * Das Modell wird NICHT geklont – es hängt im modelPivot und wird
   * per setActiveCity() an die aktuelle Ziel-Stadt verschoben.
   * Spart ~80% GPU-Speicher und Draw Calls (5× Klone → 1× Modell).
   *
   * Registriert ausserdem Clear-Regionen im GrassManager pro Stadt.
   * Wenn das Modell nicht geladen werden kann, funktionieren Guide-Path
   * und City-Logik trotzdem (nur die 3D-Ansicht fehlt).
   */
  async loadCities(
    positions: THREE.Vector3[],
    scene: THREE.Scene,
    grassManager: GrassManager,
  ): Promise<void> {
    // Modell laden (einmalig – wird im modelPivot referenziert)
    const model = await this.loadModel();
    this.sharedModel = model;

    if (model) {
      // Zentriertes + skaliertes Modell in den Pivot hängen
      this.modelPivot.add(model);
      // Pivot in die Szene (wird per setActiveCity positioniert)
      scene.add(this.modelPivot);
    }

    for (let i = 0; i < positions.length; i++) {
      const pos = positions[i];

      // Position auf Geländehöhe setzen
      const groundY = getWorldHeight(pos.x, pos.z);

      // Clear-Region registrieren (Kreis) – auch ohne Modell
      grassManager.addCircleClearRegion(
        pos.x,
        pos.z,
        CITY_CONFIG.CLEAR_RADIUS,
      );

      this.cities.push({
        position: new THREE.Vector3(pos.x, groundY, pos.z),
        visited: false,
        index: i,
        /** Jede Stadt bekommt eine eigene Rotation für Abwechslung */
        rotation: Math.random() * Math.PI * 2,
      });
    }
  }

  /**
   * Verschiebt den modelPivot (und damit das gesamte Stadt-Modell)
   * an die Position + Rotation der angegebenen Stadt.
   * Nur 1 Stadt-Mesh in der Szene statt 5 – das ist der Performance-Gewinn.
   */
  setActiveCity(city: CityInstance | null): void {
    if (!this.sharedModel) return;

    if (city) {
      this.modelPivot.position.copy(city.position);
      this.modelPivot.rotation.y = city.rotation;
      this.modelPivot.visible = true;
    } else {
      this.modelPivot.visible = false;
    }
  }

  /** Gibt die nächste unbesuchte Stadt zurück (oder null). */
  getNearestUndiscovered(from: THREE.Vector3): CityInstance | null {
    let nearest: CityInstance | null = null;
    let nearestDist = Infinity;

    for (const city of this.cities) {
      if (city.visited) continue;
      const dist = from.distanceTo(city.position);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = city;
      }
    }

    return nearest;
  }

  /** Markiert eine Stadt als besucht. */
  markVisited(city: CityInstance): void {
    city.visited = true;
  }

  /** Anzahl der entdeckten Städte. */
  get discoveredCount(): number {
    return this.cities.filter((c) => c.visited).length;
  }

  /** Gibt alle Ressourcen frei. */
  dispose(scene: THREE.Scene): void {
    // modelPivot aus Szene entfernen
    scene.remove(this.modelPivot);

    // Einmal geladenes Modell aufräumen (Geometrien + Materialien)
    if (this.sharedModel) {
      this.sharedModel.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) {
            child.material.forEach((m) => m.dispose());
          } else {
            child.material.dispose();
          }
        }
      });
    }

    this.cities.length = 0;
  }

  /**
   * Lädt das GLB einmalig, zentriert es und skaliert es.
   * Das Ergebnis wird in sharedModel gespeichert und NICHT geklont.
   */
  private loadModel(): Promise<THREE.Group | null> {
    if (!this.modelPromise) {
      this.modelPromise = new Promise((resolve) => {
        new GLTFLoader().load(
          CITY_CONFIG.MODEL,
          (gltf) => {
            const model = gltf.scene;

            // Einmalig skalieren (früher pro clone)
            model.scale.setScalar(CITY_CONFIG.SCALE);

            // Einmalig zentrieren (GLB-internen Offset ausgleichen)
            const box = new THREE.Box3().setFromObject(model);
            const center = new THREE.Vector3();
            box.getCenter(center);
            model.position.set(-center.x, 0, -center.z);

            resolve(model);
          },
          undefined,
          () => {
            console.warn("[CityManager] GLB-Fehler:", CITY_CONFIG.MODEL);
            resolve(null);
          },
        );
      });
    }
    return this.modelPromise;
  }
}
