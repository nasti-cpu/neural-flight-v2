/**
 * cityWorld.ts – Städte in der Tiefsee-Welt, auf festem Raster.
 *
 * Importiert Konfiguration, Raster und Bauwerke aus
 * animationen/staedte/ und kümmert sich um den Lebenszyklus
 * (Laden, Klonen, Sichtbarkeit, Fade).
 *
 * Lebenszyklus pro Stadt:
 *   pending → ready (bei < 60 m – Modell wird geklont, bereit zum Einblenden)
 *   ready → visible (bei < 22 m – sanftes Fade-In)
 *   visible → ready (bei > 30 m – sanftes Fade-Out, Szene entfernt)
 *   ready → pending (bei > 72 m – Speicher freigegeben)
 */

import * as THREE from "three/webgpu";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
export type { ExclusionZone } from "../animationen/staedte/cityConfig";
import {
  CITY_CONFIGS,
  type CityConfig,
  type ExclusionZone,
  type CitySlotData,
  type CityState,
  CITY_TYPES,
  generateGrid,
  DIST_READY,
  DIST_SHOW,
  DIST_HIDE,
  DIST_UNLOAD,
  DIST_FULL_OPACITY,
} from "../animationen/staedte/cityConfig";
import {
  colorBuildings,
  createDome,
  createCityLights,
  createLandscape,
} from "../animationen/staedte/cityStructures";

// ---------------------------------------------------------------------------
// Interner Stadt-Slot (erweitert CitySlotData um Laufzeit-Zustand)
// ---------------------------------------------------------------------------

interface CitySlot {
  gridX: number;
  gridZ: number;
  worldX: number;
  worldZ: number;
  type: string;
  state: CityState;
  group: THREE.Group | null;
  domeRadius: number;
  height: number;
  opacity: number;
  lights: THREE.PointLight[];
}

// ---------------------------------------------------------------------------
// CityWorld
// ---------------------------------------------------------------------------

export class CityWorld {
  private scene: THREE.Scene;
  private loader: GLTFLoader;
  private floorY: number;

  /** Vorgeladene Modell-Templates (nach Typ) */
  private _templates: Map<string, THREE.Object3D> = new Map();
  /** Bounding-Box-Daten pro Template (für Kuppelradius) */
  private _templateData: Map<
    string,
    { domeRadius: number; height: number }
  > = new Map();

  /** Alle Stadt-Slots (Raster-Positionen + Zustand) */
  private _slots: CitySlot[] = [];

  /** Gecachte Stadt-Positionen */
  private _cachedPositions: THREE.Vector3[] = [];
  /** Gecachte Exklusionszonen */
  private _cachedZones: ExclusionZone[] = [];

  constructor(scene: THREE.Scene, floorY: number = -4) {
    this.scene = scene;
    this.loader = new GLTFLoader();
    this.floorY = floorY;
  }

  // -----------------------------------------------------------------------
  // Initialisierung
  // -----------------------------------------------------------------------

  async init(): Promise<void> {
    const cityKeys = CITY_TYPES;

    for (const key of cityKeys) {
      const config = CITY_CONFIGS[key];

      const model = await this._loadModel(config.path);
      if (!model) {
        console.warn(`⚠️ CityWorld: "${key}" konnte nicht geladen werden`);
        continue;
      }

      model.scale.set(config.scale, config.scale, config.scale);
      colorBuildings(model);

      const box = new THREE.Box3().setFromObject(model);
      const modelWidth = box.max.x - box.min.x;
      const modelDepth = box.max.z - box.min.z;
      const modelHeight = box.max.y - box.min.y;
      const halfExtent = Math.max(modelWidth, modelDepth) / 2;
      const domeRadius = Math.max(halfExtent * 1.25, modelHeight * 1.1);

      this._templates.set(key, model);
      this._templateData.set(key, { domeRadius, height: modelHeight });

      console.log(
        `🏙️ CityWorld: "${key}" geladen (Kuppelradius ${domeRadius.toFixed(1)})`,
      );
    }

    // Raster-Positionen aus dem Modul generieren
    const gridData = generateGrid();
    this._slots = gridData.map((d: CitySlotData) => ({
      ...d,
      state: "pending" as CityState,
      group: null,
      domeRadius: 10,
      height: 10,
      opacity: 0,
      lights: [],
    }));

    this._cachedPositions.length = 0;
    for (const s of this._slots) {
      this._cachedPositions.push(new THREE.Vector3(s.worldX, 0, s.worldZ));
    }
    this._rebuildExclusionZones();

    console.log(`🏙️ CityWorld bereit: ${this._slots.length} Städte im Raster`);
  }

  // -----------------------------------------------------------------------
  // Update
  // -----------------------------------------------------------------------

  update(delta: number, cameraX: number, cameraZ: number): void {
    for (let i = 0; i < this._slots.length; i++) {
      const slot = this._slots[i];
      const dx = slot.worldX - cameraX;
      const dz = slot.worldZ - cameraZ;
      const distSq = dx * dx + dz * dz;
      const dist = Math.sqrt(distSq);

      this._updateSlotState(slot, dist, distSq, delta);
    }
  }

  // -----------------------------------------------------------------------
  // Öffentliche Getter
  // -----------------------------------------------------------------------

  getActiveCityPositions(): THREE.Vector3[] {
    return this._cachedPositions;
  }

  getExclusionZones(): ExclusionZone[] {
    return this._cachedZones;
  }

  // -----------------------------------------------------------------------
  // Aufräumen
  // -----------------------------------------------------------------------

  dispose(): void {
    for (const slot of this._slots) {
      this._removeGroupFromScene(slot);
    }
    this._slots.length = 0;
    this._templates.clear();
    this._templateData.clear();
  }

  // -----------------------------------------------------------------------
  // Private: Exklusionszonen-Cache
  // -----------------------------------------------------------------------

  private _rebuildExclusionZones(): void {
    this._cachedZones.length = 0;
    for (const s of this._slots) {
      if (s.state === "visible" || s.state === "ready") {
        this._cachedZones.push({
          centerX: s.worldX,
          centerZ: s.worldZ,
          radius: s.domeRadius * 1.2,
        });
      }
    }
  }

  // -----------------------------------------------------------------------
  // Private: Slot-State verwalten
  // -----------------------------------------------------------------------

  private _updateSlotState(
    slot: CitySlot,
    dist: number,
    _distSq: number,
    delta: number,
  ): void {
    switch (slot.state) {
      case "pending":
        if (dist < DIST_READY) {
          this._makeReady(slot);
        }
        break;

      case "ready":
        if (dist < DIST_SHOW) {
          this._showCity(slot);
        } else if (dist > DIST_UNLOAD) {
          this._backToPending(slot);
        }
        break;

      case "visible": {
        let target = 1.0;
        if (dist > DIST_HIDE) {
          target = 0;
        } else if (dist > DIST_FULL_OPACITY) {
          const fadeRange = DIST_HIDE - DIST_FULL_OPACITY;
          target = 1.0 - (dist - DIST_FULL_OPACITY) / fadeRange;
        }

        this._animateOpacity(slot, target, delta);

        if (target === 0 && slot.opacity < 0.01) {
          this._hideCity(slot);
        }
        break;
      }
    }
  }

  // -----------------------------------------------------------------------
  // Private: Opazitäts-Animation
  // -----------------------------------------------------------------------

  private _animateOpacity(
    slot: CitySlot,
    target: number,
    delta: number,
  ): void {
    target = Math.max(0, Math.min(1, target));

    if (Math.abs(slot.opacity - target) < 0.01) {
      slot.opacity = target;
      return;
    }

    const lerpFactor = 1 - Math.exp(-5.0 * delta);
    slot.opacity += (target - slot.opacity) * lerpFactor;

    if (slot.group) {
      this._applyOpacity(slot.group, slot.opacity);
    }
  }

  // -----------------------------------------------------------------------
  // Private: Lebenszyklus
  // -----------------------------------------------------------------------

  private _makeReady(slot: CitySlot): void {
    const template = this._templates.get(slot.type);
    const data = this._templateData.get(slot.type);
    if (!template || !data) return;

    slot.domeRadius = data.domeRadius;
    slot.height = data.height;
    slot.state = "ready";
    this._rebuildExclusionZones();
  }

  private _showCity(slot: CitySlot): void {
    const template = this._templates.get(slot.type);
    const data = this._templateData.get(slot.type);
    if (!template || !data) return;

    const config = CITY_CONFIGS[slot.type];
    const groundY = this.floorY;

    const group = new THREE.Group();
    group.position.set(slot.worldX, 0, slot.worldZ);

    // Modell klonen
    const modelClone = template.clone(true);
    const box = new THREE.Box3().setFromObject(modelClone);
    modelClone.position.set(
      -(box.min.x + box.max.x) / 2,
      groundY - box.min.y - config.sinkDepth,
      -(box.min.z + box.max.z) / 2,
    );
    group.add(modelClone);

    // Kuppel
    const domeGroup = createDome(data.domeRadius, this.floorY);
    group.add(domeGroup);

    // Landschaft (nur Pittsburgh)
    if (slot.type === "pittsburgh") {
      const halfExtent = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2;
      const landscape = createLandscape(data.domeRadius, groundY, halfExtent);
      group.add(landscape);
    }

    // Lichter
    const lights = createCityLights(groundY, data.domeRadius, data.height);
    for (const light of lights) {
      group.add(light);
    }

    this._applyOpacity(group, 0);
    this.scene.add(group);

    slot.group = group;
    slot.lights = lights;
    slot.opacity = 0;
    slot.state = "visible";
    this._rebuildExclusionZones();
  }

  private _hideCity(slot: CitySlot): void {
    this._removeGroupFromScene(slot);
    slot.state = "ready";
    slot.opacity = 0;
    this._rebuildExclusionZones();
  }

  private _backToPending(slot: CitySlot): void {
    if (slot.group) {
      this._removeGroupFromScene(slot);
    }
    slot.state = "pending";
    slot.group = null;
    slot.lights = [];
    slot.opacity = 0;
    this._rebuildExclusionZones();
  }

  // -----------------------------------------------------------------------
  // Private: Hilfsfunktionen
  // -----------------------------------------------------------------------

  private _removeGroupFromScene(slot: CitySlot): void {
    if (!slot.group) return;

    this.scene.remove(slot.group);

    slot.group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry?.dispose();
        if (child.material) {
          const mats = Array.isArray(child.material)
            ? child.material
            : [child.material];
          for (const m of mats) m.dispose();
        }
      }
    });

    slot.group = null;
  }

  private _applyOpacity(group: THREE.Group, opacity: number): void {
    group.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material) {
        const mats = Array.isArray(child.material)
          ? child.material
          : [child.material];
        for (const m of mats) {
          if (!m.transparent) {
            m.transparent = true;
          }
          if (m.userData.baseOpacity === undefined) {
            m.userData.baseOpacity = m.opacity;
          }
          m.opacity = (m.userData.baseOpacity as number) * opacity;
        }
      }
    });
  }

  private _loadModel(path: string): Promise<THREE.Group | null> {
    return new Promise((resolve) => {
      this.loader.load(
        path,
        (gltf) => resolve(gltf.scene),
        undefined,
        (err) => {
          console.error(`❌ CityWorld: Fehler beim Laden: ${path}`, err);
          resolve(null);
        },
      );
    });
  }
}
