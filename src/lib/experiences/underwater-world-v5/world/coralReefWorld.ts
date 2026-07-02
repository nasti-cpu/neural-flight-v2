/**
 * coralReefWorld.ts – Korallenriffe in der Tiefsee-Welt, WFC-gesteuert.
 *
 * Riffe werden NICHT mehr zufällig um die Kamera herum gespawnt.
 * Stattdessen fragt der ChunkManager den WFC-Algorithmus,
 * und wenn ein Chunk den Typ "RIFF" bekommt, wird hier ein
 * Riff für diese Position registriert.
 *
 * Importiert die Riff-Erzeugung aus animationen/korallen/coralReef.ts
 * und kümmert sich um den Lebenszyklus (Laden, Sichtbarkeit, Fade).
 *
 * Lebenszyklus pro Riff:
 *   pending → visible (bei < 60 m)
 *   visible → pending (bei > 65 m – sanftes Fade-Out)
 *   pending → gelöscht (bei > 70 m – komplett aus dem Array)
 */

import * as THREE from "three/webgpu";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  CORAL_CONFIGS,
  buildReefGroup,
} from "../animationen/korallen/coralReef";
import type { ExclusionZone } from "../animationen/staedte/cityConfig";

// ---------------------------------------------------------------------------
// Reef-Slot
// ---------------------------------------------------------------------------

type ReefState = "pending" | "visible";

interface ReefSlot {
  id: number;
  /** Chunk-Koordinaten (wo WFC "RIFF" gesagt hat) */
  chunkX: number;
  chunkZ: number;
  worldX: number;
  worldZ: number;
  state: ReefState;
  group: THREE.Group | null;
  opacity: number;
}

// ---------------------------------------------------------------------------
// CoralReefWorld – jetzt WFC-gesteuert
// ---------------------------------------------------------------------------

export class CoralReefWorld {
  private scene: THREE.Scene;
  private loader: GLTFLoader;
  private floorY: number;
  private chunkSize: number;

  /** Vorgeladene Korallen-Modelle (nach Pfad) */
  private _templates: Map<string, THREE.Group> = new Map();

  /** Alle Riffe (pending + visible) */
  private _reefs: ReefSlot[] = [];
  /** Map: chunkKey → Riff-Index */
  private _reefByChunk: Map<string, number> = new Map();

  /** Exklusionszonen (Stadt-Kuppeln) – keine Riffe darin */
  private _exclusionZones: ExclusionZone[] = [];

  /** Nächste ID für Riffe */
  private _nextId: number = 0;

  constructor(scene: THREE.Scene, floorY: number = -4, chunkSize: number = 16) {
    this.scene = scene;
    this.loader = new GLTFLoader();
    this.floorY = floorY;
    this.chunkSize = chunkSize;
  }

  // -----------------------------------------------------------------------
  // Initialisierung
  // -----------------------------------------------------------------------

  async init(): Promise<void> {
    console.log("🪸 CoralReefWorld WFC: Lade Korallenmodelle...");

    for (const config of CORAL_CONFIGS) {
      try {
        const model = await this._loadModel(config.path);
        if (model) {
          this._templates.set(config.path, model);
          console.log(`   🪸 Geladen: ${config.key}`);
        }
      } catch {
        console.warn(`⚠️ Koralle konnte nicht geladen werden: ${config.path}`);
      }
    }

    console.log(
      `🪸 CoralReefWorld WFC bereit: ${this._templates.size} Korallen-Typen – Riffe werden on-demand vom WFC platziert`,
    );
  }

  // -----------------------------------------------------------------------
  // WFC-Callback: Registriert ein neues Riff
  // -----------------------------------------------------------------------

  /**
   * Wird vom ChunkManager aufgerufen, wenn der WFC einen "RIFF"-Chunk
   * kollabiert hat.
   */
  public registerReefAtChunk(cx: number, cz: number): void {
    const key = `${cx},${cz}`;
    if (this._reefByChunk.has(key)) return;

    const worldX = cx * this.chunkSize + this.chunkSize / 2;
    const worldZ = cz * this.chunkSize + this.chunkSize / 2;

    // Nicht in Städte-Exklusionszonen platzieren
    if (this._isInExclusionZone(worldX, worldZ, 12)) return;

    const reef: ReefSlot = {
      id: this._nextId++,
      chunkX: cx,
      chunkZ: cz,
      worldX,
      worldZ,
      state: "pending",
      group: null,
      opacity: 0,
    };

    this._reefByChunk.set(key, this._reefs.length);
    this._reefs.push(reef);
  }

  // -----------------------------------------------------------------------
  // Exklusionszonen setzen (von CityWorld)
  // -----------------------------------------------------------------------

  setExclusionZones(zones: ExclusionZone[]): void {
    this._exclusionZones = zones;
  }

  // -----------------------------------------------------------------------
  // Update
  // -----------------------------------------------------------------------

  update(delta: number, cameraX: number, cameraZ: number): void {
    for (let i = this._reefs.length - 1; i >= 0; i--) {
      const reef = this._reefs[i];
      const dx = reef.worldX - cameraX;
      const dz = reef.worldZ - cameraZ;
      const dist = Math.sqrt(dx * dx + dz * dz);

      switch (reef.state) {
        case "pending":
          if (dist < 60) {
            this._showReef(reef);
          } else if (dist > 70) {
            this._removeReefByIndex(i);
          }
          break;

        case "visible":
          if (dist > 65) {
            this._hideReef(reef);
          }
          break;
      }

      if (reef.state === "visible") {
        const fullOpacityDist = 30;
        const hideDist = 65;
        let target = 1.0;
        if (dist > fullOpacityDist) {
          const fadeRange = hideDist - fullOpacityDist;
          target = 1.0 - (dist - fullOpacityDist) / fadeRange;
        }
        target = Math.max(0, Math.min(1, target));

        reef.opacity += (target - reef.opacity) * Math.min(1, delta * 2.5);
        if (reef.opacity < 0.01 && target === 0) {
          this._hideReef(reef);
        } else if (reef.group) {
          this._applyOpacity(reef.group, reef.opacity);
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // Aufräumen
  // -----------------------------------------------------------------------

  dispose(): void {
    for (const reef of this._reefs) {
      this._removeReefGroup(reef);
    }
    this._reefs.length = 0;
    this._reefByChunk.clear();
    this._templates.clear();
  }

  // -----------------------------------------------------------------------
  // Private: Index-basierte Entfernung (Map-konsistent)
  // -----------------------------------------------------------------------

  private _removeReefByIndex(index: number): void {
    const reef = this._reefs[index];
    if (!reef) return;
    this._removeReefGroup(reef);
    this._reefs.splice(index, 1);

    // Map neu aufbauen (weil sich Indizes verschoben haben)
    this._reefByChunk.clear();
    for (let i = 0; i < this._reefs.length; i++) {
      const r = this._reefs[i];
      this._reefByChunk.set(`${r.chunkX},${r.chunkZ}`, i);
    }
  }

  // -----------------------------------------------------------------------
  // Private: Modell laden
  // -----------------------------------------------------------------------

  private _loadModel(path: string): Promise<THREE.Group | null> {
    return new Promise((resolve) => {
      this.loader.load(
        path,
        (gltf) => resolve(gltf.scene),
        undefined,
        (err) => {
          console.error(`❌ CoralReefWorld: Fehler: ${path}`, err);
          resolve(null);
        },
      );
    });
  }

  // -----------------------------------------------------------------------
  // Private: Riff sichtbar machen
  // -----------------------------------------------------------------------

  private _showReef(reef: ReefSlot): void {
    const group = buildReefGroup(
      this._templates,
      reef.worldX,
      reef.worldZ,
      this.floorY,
    );
    if (!group) return;

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
          m.opacity = 0;
        }
      }
    });

    this.scene.add(group);
    reef.group = group;
    reef.opacity = 0;
    reef.state = "visible";
  }

  private _hideReef(reef: ReefSlot): void {
    this._removeReefGroup(reef);
    reef.state = "pending";
    reef.group = null;
  }

  private _removeReefGroup(reef: ReefSlot): void {
    if (!reef.group) return;
    this.scene.remove(reef.group);
    reef.group.traverse((child) => {
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
  }

  private _applyOpacity(group: THREE.Group, opacity: number): void {
    group.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material) {
        const mats = Array.isArray(child.material)
          ? child.material
          : [child.material];
        for (const m of mats) {
          const base = m.userData.baseOpacity as number | undefined;
          m.opacity = (base ?? 1) * opacity;
        }
      }
    });
  }

  private _isInExclusionZone(
    x: number,
    z: number,
    margin: number = 5,
  ): boolean {
    for (const zone of this._exclusionZones) {
      const dx = x - zone.centerX;
      const dz = z - zone.centerZ;
      const effectiveRadius = zone.radius + margin;
      if (dx * dx + dz * dz < effectiveRadius * effectiveRadius) {
        return true;
      }
    }
    return false;
  }
}
