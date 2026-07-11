/**
 * cityWorld.ts – Städte in der Tiefsee-Welt, WFC-gesteuert.
 *
 * 3 vorberechnete Varianten (Terracotta, Eisblau, Smaragd mit Bäumen)
 * werden beim Start geladen und per Zufall an den WFC-Positionen
 * eingesetzt. Die GLB-Geometrie wird nur 1× geladen, die Dome-Geometrie
 * ebenfalls – alles andere sind Klone.
 *
 * Lebenszyklus pro Stadt:
 *   pending → ready (bei < 65 m – Modell wird geklont, bereit zum Einblenden)
 *   ready → visible (bei < 40 m – sanftes Fade-In über 30 m)
 *   visible → ready (bei > 50 m – sanftes Fade-Out, Szene entfernt)
 *   ready → pending (bei > 80 m – Speicher freigegeben)
 */

import * as THREE from "three/webgpu";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
export type { ExclusionZone } from "../animationen/staedte/cityConfig";
import {
  CITY_CONFIGS,
  type ExclusionZone,
  type CityState,
  DIST_READY,
  DIST_SHOW,
  DIST_HIDE,
  DIST_UNLOAD,
  DIST_FULL_OPACITY,
} from "../animationen/staedte/cityConfig";
import {
  COLOR_THEMES,
  applyTheme,
  createCityLights,
  createLandscape,
} from "../animationen/staedte/cityStructures";

// ---------------------------------------------------------------------------
// 3 Stadt-Varianten
// ---------------------------------------------------------------------------

interface CityVariantDef {
  key: string;
  name: string;
  themeIndex: number;
  hasTrees: boolean;
}

const CITY_VARIANTS: CityVariantDef[] = [
  { key: "blocks-terracotta", name: "Terracotta", themeIndex: 2, hasTrees: false },
  { key: "blocks-eisblau",    name: "Eisblau",    themeIndex: 1, hasTrees: false },
  { key: "blocks-smaragd",    name: "Smaragd",    themeIndex: 4, hasTrees: true  },
];

// ---------------------------------------------------------------------------
// Vorgehaltene Daten pro Variante
// ---------------------------------------------------------------------------

interface CityTemplate {
  model: THREE.Object3D;
  domeRadius: number;
  height: number;
  hasTrees: boolean;
}

// ---------------------------------------------------------------------------
// Interner Stadt-Slot
// ---------------------------------------------------------------------------

interface CitySlot {
  chunkX: number;
  chunkZ: number;
  worldX: number;
  worldZ: number;
  variantKey: string;
  state: CityState;
  group: THREE.Group | null;
  domeRadius: number;
  height: number;
  hasTrees: boolean;
  opacity: number;
  lights: THREE.Object3D[];
  _loading?: boolean;
}

// ---------------------------------------------------------------------------
// CityWorld
// ---------------------------------------------------------------------------

export class CityWorld {
  private scene: THREE.Scene;
  private loader: GLTFLoader;
  private floorY: number;
  private chunkSize: number;

  /** 3 vorberechnete Varianten (key → Template) */
  private _templates: Map<string, CityTemplate> = new Map();

  /** Einmalig erzeugte Dome-Geometrie (wird von allen Städten geteilt) */
  private _sharedDomeGeom: THREE.SphereGeometry | null = null;

  /** Einmalig erzeugte Landschaft (wird von Smaragd-Städten geklont) */
  private _landscapeTemplate: THREE.Group | null = null;

  /** Alle Stadt-Slots */
  private _slots: CitySlot[] = [];
  private _slotByChunk: Map<string, number> = new Map();

  private _pendingReadyQueue: CitySlot[] = [];

  private _cachedPositions: THREE.Vector3[] = [];
  private _cachedZones: ExclusionZone[] = [];

  constructor(scene: THREE.Scene, floorY = -4, chunkSize = 16) {
    this.scene = scene;
    this.loader = new GLTFLoader();
    this.floorY = floorY;
    this.chunkSize = chunkSize;
  }

  // -------------------------------------------------------------------------
  // Init: Modell 1× laden → 3 Varianten vorberechnen
  // -------------------------------------------------------------------------

  async init(): Promise<void> {
    const modelPath = CITY_CONFIGS.blocks.path;
    const modelScale = CITY_CONFIGS.blocks.scale;

    // 1. GLB genau 1× laden
    const baseModel = await this._loadModel(modelPath);
    if (!baseModel) {
      console.warn("⚠️ CityWorld: Blocks Skyline konnte nicht geladen werden");
      return;
    }

    // Original-Skalierung aus der Config (4x – bewährt)
    baseModel.scale.set(modelScale, modelScale, modelScale);

    // Bounding-Box der Grund-Geometrie (für Dome-Berechnung)
    const baseBox = new THREE.Box3().setFromObject(baseModel);
    const baseWidth = baseBox.max.x - baseBox.min.x;
    const baseDepth = baseBox.max.z - baseBox.min.z;
    const baseHeight = baseBox.max.y - baseBox.min.y;
    const baseExtent = Math.max(baseWidth, baseDepth) / 2;

    // Gemeinsame Dome-Geometrie (einmalig, wird per .clone() geteilt)
    const domeRadius = Math.max(baseExtent * 1.25, baseHeight * 1.1);
    this._sharedDomeGeom = new THREE.SphereGeometry(
      domeRadius, 64, 32, 0, Math.PI * 2, 0, Math.PI / 2,
    );

    // 2. Für jede Variante: klonen + Theme anwenden + Geometrie mergen
    for (const variant of CITY_VARIANTS) {
      const model = baseModel.clone(true);
      applyTheme(model, COLOR_THEMES[variant.themeIndex]);
      this._mergeModelGeometry(model);

      const box = new THREE.Box3().setFromObject(model);
      const h = box.max.y - box.min.y;

      this._templates.set(variant.key, {
        model,
        domeRadius,
        height: h,
        hasTrees: variant.hasTrees,
      });

      console.log(
        `🏙️ Variante "${variant.name}" geladen (Kuppelradius ${domeRadius.toFixed(1)})`,
      );
    }

    // 3. Landschaft als Template vorbereiten (wird von Smaragd geklont)
    this._landscapeTemplate = createLandscape(domeRadius, this.floorY, baseExtent);

    console.log("🏙️ CityWorld: 3 Varianten bereit – WFC platziert on-demand");
  }

  // -------------------------------------------------------------------------
  // WFC-Callback
  // -------------------------------------------------------------------------

  public registerCityAtChunk(cx: number, cz: number): void {
    const key = `${cx},${cz}`;
    if (this._slotByChunk.has(key)) return;

    const worldX = cx * this.chunkSize + this.chunkSize / 2;
    const worldZ = cz * this.chunkSize + this.chunkSize / 2;

    // Mindestabstand 48m
    const MIN_CITY_DIST_SQ = 48 * 48;
    for (const existing of this._slots) {
      const dx = existing.worldX - worldX;
      const dz = existing.worldZ - worldZ;
      if (dx * dx + dz * dz < MIN_CITY_DIST_SQ) return;
    }

    // Zufällige Variante
    const variant = CITY_VARIANTS[Math.floor(Math.random() * CITY_VARIANTS.length)];

    const slot: CitySlot = {
      chunkX: cx, chunkZ: cz,
      worldX, worldZ,
      variantKey: variant.key,
      state: "pending",
      group: null,
      domeRadius: 10,
      height: 10,
      hasTrees: variant.hasTrees,
      opacity: 0,
      lights: [],
    };

    const idx = this._slots.length;
    this._slots.push(slot);
    this._slotByChunk.set(key, idx);
    this._cachedPositions.push(new THREE.Vector3(worldX, 0, worldZ));
  }

  // -------------------------------------------------------------------------
  // Update
  // -------------------------------------------------------------------------

  update(delta: number, cameraX: number, cameraZ: number): void {
    for (const slot of this._slots) {
      const dx = slot.worldX - cameraX;
      const dz = slot.worldZ - cameraZ;
      this._updateSlotState(slot, dx * dx + dz * dz, delta);
    }
  }

  public processNextHeavyOp(): boolean {
    return this._processPendingReadyQueue(1) > 0;
  }

  // -------------------------------------------------------------------------
  // Getter
  // -------------------------------------------------------------------------

  getActiveCityPositions(): THREE.Vector3[] {
    return this._cachedPositions;
  }

  getExclusionZones(): ExclusionZone[] {
    return this._cachedZones;
  }

  // -------------------------------------------------------------------------
  // Dispose
  // -------------------------------------------------------------------------

  dispose(): void {
    for (const slot of this._slots) {
      this._removeGroupFromScene(slot);
    }
    this._slots.length = 0;
    this._slotByChunk.clear();
    this._cachedPositions.length = 0;
    this._cachedZones.length = 0;
    this._templates.clear();
    this._pendingReadyQueue.length = 0;
    this._sharedDomeGeom?.dispose();
    this._sharedDomeGeom = null;
    this._landscapeTemplate = null;
  }

  // -------------------------------------------------------------------------
  // Private: Exklusionszonen
  // -------------------------------------------------------------------------

  private _rebuildExclusionZones(): void {
    this._cachedZones.length = 0;
    for (const s of this._slots) {
      if (s.state === "visible" || s.state === "ready") {
        this._cachedZones.push({
          centerX: s.worldX,
          centerZ: s.worldZ,
          radius: s.domeRadius * 1.8,
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // Private: Slot-State
  // -------------------------------------------------------------------------

  private _updateSlotState(slot: CitySlot, distSq: number, delta: number): void {
    switch (slot.state) {
      case "pending":
        if (distSq < DIST_READY * DIST_READY) {
          this._enqueueReady(slot);
        }
        break;
      case "ready":
        if (distSq < DIST_SHOW * DIST_SHOW && !slot._loading) {
          slot._loading = true;
          requestAnimationFrame(() => {
            this._showCity(slot);
            slot._loading = false;
          });
        } else if (distSq > DIST_UNLOAD * DIST_UNLOAD) {
          this._backToPending(slot);
        }
        break;
      case "visible": {
        const dist = Math.sqrt(distSq);
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

  private _animateOpacity(slot: CitySlot, target: number, delta: number): void {
    target = Math.max(0, Math.min(1, target));
    if (Math.abs(slot.opacity - target) < 0.01) {
      slot.opacity = target;
      return;
    }
    const lerpFactor = 1 - Math.exp(-2.5 * delta);
    slot.opacity += (target - slot.opacity) * lerpFactor;
    if (slot.group) {
      this._applyOpacity(slot.group, slot.opacity);
    }
  }

  // -------------------------------------------------------------------------
  // Private: Lebenszyklus
  // -------------------------------------------------------------------------

  private _enqueueReady(slot: CitySlot): void {
    if (slot._loading) return;
    slot._loading = true;
    this._pendingReadyQueue.push(slot);
  }

  private _processPendingReadyQueue(maxCount: number): number {
    const count = Math.min(maxCount, this._pendingReadyQueue.length);
    for (let i = 0; i < count; i++) {
      const slot = this._pendingReadyQueue.shift();
      if (!slot) continue;
      this._makeReady(slot);
    }
    return count;
  }

  private _makeReady(slot: CitySlot): void {
    const tmpl = this._templates.get(slot.variantKey);
    if (!tmpl) return;

    slot.domeRadius = tmpl.domeRadius;
    slot.height = tmpl.height;
    slot.hasTrees = tmpl.hasTrees;
    this._buildCityGroup(slot);

    slot.state = "ready";
    slot._loading = false;
    this._rebuildExclusionZones();
  }

  /**
   * Baut die Stadt-Gruppe aus Template + Shared-Geometrien.
   * Läuft im ready-Zustand (~65m), weit vor der Sichtbarkeit.
   */
  private _buildCityGroup(slot: CitySlot): void {
    const tmpl = this._templates.get(slot.variantKey);
    if (!tmpl) return;

    const config = CITY_CONFIGS.blocks;
    const groundY = this.floorY;

    const group = new THREE.Group();
    group.position.set(slot.worldX, 0, slot.worldZ);

    // Modell klonen (jede Stadt braucht eigene Geometrie zum Disposen)
    const modelClone = tmpl.model.clone(true);
    const box = new THREE.Box3().setFromObject(modelClone);
    modelClone.position.set(
      -(box.min.x + box.max.x) / 2,
      groundY - box.min.y - config.sinkDepth,
      -(box.min.z + box.max.z) / 2,
    );
    group.add(modelClone);

    // Kuppel (wie im Original – Position groundY + 0.1)
    if (this._sharedDomeGeom) {
      const domeGeom = this._sharedDomeGeom.clone();
      const domeMat = new THREE.MeshPhysicalMaterial({
        color: 0x88ccff,
        transparent: true,
        opacity: 0.12,
        roughness: 0.1,
        metalness: 0.0,
        clearcoat: 0.3,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const dome = new THREE.Mesh(domeGeom, domeMat);
      dome.position.y = groundY + 0.1;
      group.add(dome);

      // Basis-Ring
      const ringGeom = new THREE.TorusGeometry(tmpl.domeRadius, 0.3, 8, 64);
      const ringMat = new THREE.MeshPhysicalMaterial({
        color: 0x66aadd,
        roughness: 0.4,
        metalness: 0.3,
      });
      const ring = new THREE.Mesh(ringGeom, ringMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = groundY + 0.05;
      group.add(ring);
    }

    // Landschaft (nur Smaragd-Variante) – vom Template klonen
    if (slot.hasTrees && this._landscapeTemplate) {
      const landscapeClone = this._landscapeTemplate.clone(true);
      group.add(landscapeClone);
    }

    // Lichter (nur 1 zentrales Licht + Glow – 5 Lichter pro Stadt kosten zu viel GPU)
    const allLights = createCityLights(groundY, tmpl.domeRadius, tmpl.height);
    const lights: THREE.Object3D[] = [];
    if (allLights.length >= 2) {
      group.add(allLights[0]); // Punktlicht
      group.add(allLights[1]); // Glow-Sprite
      lights.push(allLights[0], allLights[1]);
    }

    this._applyOpacity(group, 0);
    slot.group = group;
    slot.lights = lights;
    slot.opacity = 0;
  }
  private _showCity(slot: CitySlot): void {
    if (!slot.group) {
      this._buildCityGroup(slot);
    }
    this.scene.add(slot.group!);
    this._applyOpacity(slot.group!, 0);

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
    slot._loading = false;
    this._rebuildExclusionZones();
  }

  // -------------------------------------------------------------------------
  // Private: Hilfsfunktionen
  // -------------------------------------------------------------------------

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
      if (child instanceof THREE.Sprite) {
        child.material?.dispose();
        if ((child.material as THREE.SpriteMaterial)?.map) {
          (child.material as THREE.SpriteMaterial).map!.dispose();
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
          if (!m.transparent) m.transparent = true;
          if (m.userData.baseOpacity === undefined) {
            m.userData.baseOpacity = m.opacity;
          }
          m.opacity = (m.userData.baseOpacity as number) * opacity;
        }
      }
      if (child instanceof THREE.Sprite && child.material) {
        if (child.material.userData.baseOpacity === undefined) {
          child.material.userData.baseOpacity = child.material.opacity;
        }
        child.material.opacity =
          (child.material.userData.baseOpacity as number) * opacity;
      }
    });
  }

  /**
   * Merged alle Meshes eines Varianten-Modells in 1–2 Meshes:
   *   - Nicht-emissive Meshes → 1 Mesh mit Vertex Colors
   *   - Emissive Meshes (Fenster) → 1 separater Mesh
   * Das reduziert Draw Calls von 50+ auf 2 pro Stadt.
   */
  private _mergeModelGeometry(model: THREE.Object3D): void {
    // Matrizen berechnen (Scale 4 muss in matrixWorld stecken)
    model.updateWorldMatrix(true, true);

    const emissiveMeshes: THREE.Mesh[] = [];
    const nonEmissiveMeshes: THREE.Mesh[] = [];

    model.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const mat = child.material as THREE.MeshStandardMaterial;
        if (mat.emissive.getHex() !== 0x000000 && mat.emissiveIntensity > 0) {
          emissiveMeshes.push(child);
        } else {
          nonEmissiveMeshes.push(child);
        }
      }
    });

    // Alte Meshes entfernen
    for (const mesh of [...emissiveMeshes, ...nonEmissiveMeshes]) {
      mesh.removeFromParent();
    }

    // ── Nicht-emissive: in Model-Local-Space mergen + Vertex Colors ──
    if (nonEmissiveMeshes.length > 0) {
      const geoms: THREE.BufferGeometry[] = [];
      const invMatrix = new THREE.Matrix4().copy(model.matrixWorld).invert();
      const tempMat = new THREE.Matrix4();

      for (const mesh of nonEmissiveMeshes) {
        const geom = mesh.geometry.clone();
        // World-Space → Model-Local-Space (damit model.scale nicht doppelt wirkt)
        tempMat.copy(invMatrix).multiply(mesh.matrixWorld);
        geom.applyMatrix4(tempMat);

        // Vertex Color aus der Material-Farbe
        const color = (mesh.material as THREE.MeshStandardMaterial).color;
        const posCount = geom.getAttribute("position").count;
        const colors = new Float32Array(posCount * 3);
        for (let i = 0; i < posCount; i++) {
          colors[i * 3] = color.r;
          colors[i * 3 + 1] = color.g;
          colors[i * 3 + 2] = color.b;
        }
        geom.setAttribute("color", new THREE.BufferAttribute(colors, 3));
        geoms.push(geom);

        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      }

      const merged = mergeGeometries(geoms, false);
      if (merged) {
        const mat = new THREE.MeshStandardMaterial({
          vertexColors: true,
          roughness: 0.5,
          metalness: 0.05,
        });
        const mergedMesh = new THREE.Mesh(merged, mat);
        model.add(mergedMesh);
      }
    }

    // ── Emissive (Fenster): in einen Mesh mergen ──
    if (emissiveMeshes.length > 0) {
      const geoms: THREE.BufferGeometry[] = [];
      const invMatrix = new THREE.Matrix4().copy(model.matrixWorld).invert();
      const tempMat = new THREE.Matrix4();
      let avgEmissive = new THREE.Color();
      let emissiveIntensity = 0;

      for (const mesh of emissiveMeshes) {
        const geom = mesh.geometry.clone();
        // World-Space → Model-Local-Space
        tempMat.copy(invMatrix).multiply(mesh.matrixWorld);
        geom.applyMatrix4(tempMat);
        geoms.push(geom);

        const mat = mesh.material as THREE.MeshStandardMaterial;
        avgEmissive.lerp(mat.emissive, 0.5);
        emissiveIntensity = Math.max(emissiveIntensity, mat.emissiveIntensity);

        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      }

      const merged = mergeGeometries(geoms, false);
      if (merged) {
        const mat = new THREE.MeshStandardMaterial({
          color: 0x222233,
          emissive: avgEmissive,
          emissiveIntensity: emissiveIntensity,
          roughness: 0.5,
          metalness: 0.1,
        });
        const mergedMesh = new THREE.Mesh(merged, mat);
        model.add(mergedMesh);
      }
    }
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
