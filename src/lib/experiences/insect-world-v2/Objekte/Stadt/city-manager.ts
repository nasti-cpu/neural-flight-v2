/**
 * insect-world-v2 — CityManager.
 * Verwaltet mehrere Städte, die jeweils einen ganzen Chunk belegen.
 *
 * Funktionsweise:
 * - 3 Städte werden auf dem 40m-Chunk-Grid platziert (400–500m Abstand)
 * - Jede Stadt bekommt einen CITY-Tile-Typ → kein Gras/Blumen auf dem Chunk
 * - Das Stadt-Modell wird EINMAL geladen und per Pivot positioniert
 * - In update() wird geprüft ob der City-Chunk aktiv ist → Modell sichtbar/unsichtbar
 * - Große Pheromon-Leitspuren (CityGuidePath) führen zur nächsten Stadt
 *
 * WebGPU-konform.
 */
import * as THREE from "three/webgpu";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { CITY_CONFIG } from "./city";
import { CHUNK_SIZE } from "../../Biome/Wiese/grass-manager";
import type { GrassManager } from "../../Biome/Wiese/grass-manager";
import { TileType } from "../../Biome/Wiese/wfc-tiles";

export interface CityInstance {
  /** Mittelpunkt des Chunks (Weltkoordinaten) */
  position: THREE.Vector3;
  /** Chunk-Koordinaten */
  gx: number;
  gz: number;
  visited: boolean;
  index: number;
  rotation: number;
}

export class CityManager {
  readonly cities: CityInstance[] = [];
  lastVisitedCity: CityInstance | null = null;
  private modelPromise: Promise<THREE.Group | null> | null = null;
  private sharedModel: THREE.Group | null = null;
  private modelPivot: THREE.Group;
  /** Wurde das Modell bereits in die Szene eingehängt? */
  private modelAdded = false;

  constructor() {
    this.modelPivot = new THREE.Group();
    this.modelPivot.visible = false;
  }

  /**
   * Generiert bis zu `count` Stadt-Positionen auf dem Chunk-Grid.
   * Jede Stadt liegt im Zentrum eines Chunks (Vielfache von CHUNK_SIZE).
   * Start-Chunk (0,0) wird ausgeschlossen.
   */
  generatePositions(count: number, minDistance: number, maxDistance: number): THREE.Vector3[] {
    const positions: THREE.Vector3[] = [];
    const used = new Set<string>();
    let attempts = 0;

    while (positions.length < count && attempts < count * 50) {
      attempts++;

      // Zufälligen Chunk im Ring suchen
      const angle = Math.random() * Math.PI * 2;
      const dist = minDistance + Math.random() * (maxDistance - minDistance);
      const wx = Math.cos(angle) * dist;
      const wz = Math.sin(angle) * dist;

      // Auf Chunk-Grid ausrichten
      const gx = Math.round(wx / CHUNK_SIZE);
      const gz = Math.round(wz / CHUNK_SIZE);

      // (0,0) überspringen (Spawn-Chunk)
      if (gx === 0 && gz === 0) continue;

      const key = `${gx},${gz}`;
      if (used.has(key)) continue;
      used.add(key);

      // Prüfen ob weit genug von anderen Städten entfernt
      const wx2 = gx * CHUNK_SIZE + CHUNK_SIZE / 2;
      const wz2 = gz * CHUNK_SIZE + CHUNK_SIZE / 2;
      let tooClose = false;
      for (const pos of positions) {
        const dx = pos.x - wx2;
        const dz = pos.z - wz2;
        if (Math.sqrt(dx * dx + dz * dz) < minDistance) {
          tooClose = true;
          break;
        }
      }

      if (!tooClose) {
        positions.push(new THREE.Vector3(wx2, 0, wz2));
      }
    }

    return positions;
  }

  /**
   * Lädt das Stadt-Modell EINMAL und registriert alle Städte als CITY-Chunks.
   * Das Modell wird im modelPivot positioniert.
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
      if (!this.modelAdded) {
        scene.add(this.modelPivot);
        this.modelAdded = true;
      }
    }

    for (let i = 0; i < positions.length; i++) {
      const pos = positions[i];
      const gx = Math.round(pos.x / CHUNK_SIZE);
      const gz = Math.round(pos.z / CHUNK_SIZE);

      // WFC-Tile auf CITY zwingen → kein Gras, keine Blumen auf diesem Chunk
      grassManager.forceTileType(gx, gz, TileType.CITY);

      this.cities.push({
        position: new THREE.Vector3(pos.x, 0, pos.z),
        gx,
        gz,
        visited: false,
        index: i,
        rotation: Math.random() * Math.PI * 2,
      });
    }
  }

  /**
   * Jeden Frame aufrufen: Prüft ob City-Chunks aktiv sind und positioniert Modell.
   */
  update(grassManager: GrassManager): void {
    const activeCity = this.cities.find(
      (c) => !c.visited && grassManager.hasChunk(c.gx, c.gz),
    );

    if (activeCity) {
      // Modell an die aktive Stadt verschieben
      this.modelPivot.position.copy(activeCity.position);
      this.modelPivot.rotation.y = activeCity.rotation;
      this.modelPivot.visible = true;
    } else {
      // Keine unbesuchte Stadt aktiv → Modell ausblenden
      this.modelPivot.visible = false;
    }
  }

  /**
   * Setzt das Stadt-Modell an eine bestimmte Stadt (für GuidePath-Anzeige).
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
