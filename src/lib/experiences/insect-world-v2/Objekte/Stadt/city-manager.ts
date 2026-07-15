/**
 * insect-world-v2 — CityManager.
 * Verwaltet mehrere prozedural gespawnte Städte:
 * - Generiert zufällige Positionen mit Mindestabstand (250–400m)
 * - Lädt das Stadt-Modell EINMAL und platziert es per Pivot an der aktiven Stadt
 *   (KEIN clone(true) – spart ~80% GPU-Speicher und Draw Calls)
 * - Registriert kreisförmige Clear-Regionen im GrassManager
 * - Erzwingt MEADOW-Tile für den Chunk unter der Stadt (kein EMPTY)
 * - Trackt welche Städte bereits entdeckt wurden
 *
 * WebGPU-konform.
 */
import * as THREE from "three/webgpu";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { CITY_CONFIG } from "./city";
import { getWorldHeight, CHUNK_SIZE } from "../../Biome/Wiese/grass-manager";
import type { GrassManager } from "../../Biome/Wiese/grass-manager";
import { TileType } from "../../Biome/Wiese/wfc-tiles";

export interface CityInstance {
  position: THREE.Vector3;
  visited: boolean;
  index: number;
  /** Zufällige Y-Rotation für diese Stadt */
  rotation: number;
}

export class CityManager {
  readonly cities: CityInstance[] = [];
  /** Zuletzt besuchte Stadt – das Modell bleibt dort sichtbar, bis die nächste erreicht wird */
  lastVisitedCity: CityInstance | null = null;
  private modelPromise: Promise<THREE.Group | null> | null = null;
  /** Einmal geladenes, zentriertes, skaliertes Stadt-Modell (wird nicht geklont) */
  private sharedModel: THREE.Group | null = null;
  /** Pivot-Gruppe in der Szene – wird an die aktive Stadt-Position verschoben */
  private modelPivot: THREE.Group;

  constructor() {
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

      const angle = Math.random() * Math.PI * 2;
      const dist = minDistance + Math.random() * (maxDistance - minDistance);
      const x = Math.cos(angle) * dist;
      const z = Math.sin(angle) * dist;

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
   *
   * Registriert ausserdem Clear-Regionen im GrassManager pro Stadt
   * (Kreis 8m) und erzwingt MEADOW-Tile für den Chunk unter der Stadt
   * (kein EMPTY direkt neben der Stadt).
   */
  async loadCities(
    positions: THREE.Vector3[],
    scene: THREE.Scene,
    grassManager: GrassManager,
  ): Promise<void> {
    const model = await this.loadModel();
    this.sharedModel = model;

    if (model) {
      this.modelPivot.add(model);
      scene.add(this.modelPivot);
    }

    for (let i = 0; i < positions.length; i++) {
      const pos = positions[i];

      const groundY = getWorldHeight(pos.x, pos.z);

      // Kreis-Clear-Region (8m Radius) – kein Gras/Blumen um die Stadt
      grassManager.addCircleClearRegion(
        pos.x,
        pos.z,
        CITY_CONFIG.CLEAR_RADIUS,
      );

      // Chunk unter der Stadt auf MEADOW erzwingen (kein EMPTY)
      const chunkGX = Math.floor(pos.x / CHUNK_SIZE);
      const chunkGZ = Math.floor(pos.z / CHUNK_SIZE);
      grassManager.forceTileType(chunkGX, chunkGZ, TileType.MEADOW);

      this.cities.push({
        position: new THREE.Vector3(pos.x, groundY, pos.z),
        visited: false,
        index: i,
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

  markVisited(city: CityInstance): void {
    city.visited = true;
    this.lastVisitedCity = city;
  }

  get discoveredCount(): number {
    return this.cities.filter((c) => c.visited).length;
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.modelPivot);

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

  private loadModel(): Promise<THREE.Group | null> {
    if (!this.modelPromise) {
      this.modelPromise = new Promise((resolve) => {
        new GLTFLoader().load(
          CITY_CONFIG.MODEL,
          (gltf) => {
            const model = gltf.scene;
            model.scale.setScalar(CITY_CONFIG.SCALE);

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
