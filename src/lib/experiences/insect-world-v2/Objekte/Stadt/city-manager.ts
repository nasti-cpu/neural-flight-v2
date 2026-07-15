/**
 * insect-world-v2 — CityManager.
 * Verwaltet mehrere prozedural gespawnte Städte:
 * - Generiert zufällige Positionen mit Mindestabstand
 * - Lädt das Stadt-Modell einmal und klont es an jede Position
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
  group: THREE.Group;
  visited: boolean;
  index: number;
}

export class CityManager {
  readonly cities: CityInstance[] = [];
  lastVisitedCity: CityInstance | null = null;
  private modelPromise: Promise<THREE.Group | null> | null = null;

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
   * Lädt das Stadt-Modell und platziert es an den generierten Positionen.
   * Registriert kreisförmige Clear-Regionen im GrassManager.
   * Wenn das Modell nicht geladen werden kann, werden nur die Positionen
   * und Clear-Regionen registriert (Guide-Path funktioniert trotzdem).
   */
  async loadCities(
    positions: THREE.Vector3[],
    scene: THREE.Scene,
    grassManager: GrassManager,
  ): Promise<void> {
    const model = await this.loadModel();

    for (let i = 0; i < positions.length; i++) {
      const pos = positions[i];

      const group = new THREE.Group();

      if (model) {
        const clone = model.clone(true);
        clone.rotation.y = Math.random() * Math.PI * 2;
        group.add(clone);
      }

      const groundY = getWorldHeight(pos.x, pos.z);
      group.position.set(pos.x, groundY, pos.z);

      scene.add(group);

      grassManager.addCircleClearRegion(
        pos.x,
        pos.z,
        CITY_CONFIG.CLEAR_RADIUS,
      );

      this.cities.push({
        position: new THREE.Vector3(pos.x, groundY, pos.z),
        group,
        visited: false,
        index: i,
      });
    }
  }

  update(_grassManager: GrassManager, _playerPos: THREE.Vector3): void {
    // no-op – cities are permanently visible
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
      scene.remove(city.group);
      city.group.traverse((child) => {
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
