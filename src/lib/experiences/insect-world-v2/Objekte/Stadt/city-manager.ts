/**
 * insect-world-v2 — CityManager.
 * Verwaltet mehrere Städte mit je eigenem Modell.
 *
 * Funktionsweise:
 * - Städte werden auf dem Chunk-Grid platziert (konfigurierbar)
 * - Jede Stadt bekommt einen CITY-Tile-Typ → kein Gras/Blumen
 * - GLB wird EINMAL geladen, pro Stadt ein Klon → eigenes Modell
 * - Alle Modelle sind permanent in der Szene (kein Hin- und Herschalten)
 * - Pheromon-Leitspuren (CityGuidePath) führen zur nächsten Stadt
 *
 * WebGPU-konform.
 */
import * as THREE from "three/webgpu";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { CITY_CONFIG } from "./city";
import { CHUNK_SIZE } from "../../Biome/Wiese/grass-manager";
import type { GrassManager } from "../../Biome/Wiese/grass-manager";
import { TileType } from "../../Biome/Wiese/wfc-tiles";
import { getWorldHeight } from "../../Biome/Wiese/grass-manager";

export interface CityInstance {
  /** Mittelpunkt des Chunks (Weltkoordinaten) */
  position: THREE.Vector3;
  /** Chunk-Koordinaten */
  gx: number;
  gz: number;
  visited: boolean;
  index: number;
  rotation: number;
  /** Das eigenständige Modell dieser Stadt */
  model: THREE.Group | null;
}

export class CityManager {
  readonly cities: CityInstance[] = [];
  lastVisitedCity: CityInstance | null = null;
  private modelPromise: Promise<THREE.Group | null> | null = null;
  /** Das GLB-Skeleton (wird pro Stadt geklont) */
  private templateModel: THREE.Group | null = null;

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

      const angle = Math.random() * Math.PI * 2;
      const dist = minDistance + Math.random() * (maxDistance - minDistance);
      const wx = Math.cos(angle) * dist;
      const wz = Math.sin(angle) * dist;

      const gx = Math.floor(wx / CHUNK_SIZE);
      const gz = Math.floor(wz / CHUNK_SIZE);

      if (gx === 0 && gz === 0) continue;

      const key = `${gx},${gz}`;
      if (used.has(key)) continue;
      used.add(key);

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
        positions.push(new THREE.Vector3(wx2, getWorldHeight(wx2, wz2), wz2));
      }
    }

    return positions;
  }

  /**
   * Lädt das GLB-EINMAL und erstellt pro Stadt einen Klon.
   * Jedes Modell ist permanent in der Szene platziert.
   */
  async loadCities(
    positions: THREE.Vector3[],
    scene: THREE.Scene,
    grassManager: GrassManager,
  ): Promise<void> {
    const template = await this.loadModel();
    this.templateModel = template;

    for (let i = 0; i < positions.length; i++) {
      const pos = positions[i];
      const gx = Math.floor(pos.x / CHUNK_SIZE);
      const gz = Math.floor(pos.z / CHUNK_SIZE);

      grassManager.forceTileType(gx, gz, TileType.CITY);

      const rotY = Math.random() * Math.PI * 2;

      // Klon erzeugen und permanent in die Szene stellen
      let modelClone: THREE.Group | null = null;
      if (template) {
        modelClone = template.clone(true);
        modelClone.position.set(pos.x, getWorldHeight(pos.x, pos.z), pos.z);
        modelClone.rotation.y = rotY;
        scene.add(modelClone);
      }

      this.cities.push({
        position: new THREE.Vector3(pos.x, getWorldHeight(pos.x, pos.z), pos.z),
        gx,
        gz,
        visited: false,
        index: i,
        rotation: rotY,
        model: modelClone,
      });
    }
  }

  /**
   * Jeden Frame aufrufen – currently no-op da Modelle permanent sind.
   * Kann für Sichtbarkeits-Optimierung (LOD) verwendet werden.
   */
  update(_grassManager: GrassManager, _playerPos: THREE.Vector3): void {
    // Modelle sind permanent – keine Aktualisierung nötig
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
    for (const city of this.cities) {
      if (city.model) {
        scene.remove(city.model);
        city.model.traverse((child) => {
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
            model.position.set(-center.x, -box.min.y, -center.z);

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
