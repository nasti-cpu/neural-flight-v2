/**
 * coralReefWorld.ts – Korallenriffe in der Tiefsee-Welt.
 *
 * Importiert die Riff-Erzeugung aus animationen/korallen/coralReef.ts
 * und kümmert sich um den Lebenszyklus (Laden, Sichtbarkeit, Fade).
 *
 * Lebenszyklus pro Riff:
 *   pending → visible (bei < 60 m – target ≈ 0.14, kaum sichtbar im Nebel)
 *   visible → pending (bei > 65 m – sanftes Fade-Out)
 *   pending → gelöscht (bei > 70 m – komplett aus dem Array)
 *
 * Opazität folgt der Distanz:
 *   dist ≤ 30 m → 1.0 (voll sichtbar)
 *   30 m < dist < 65 m → linear von 1.0 auf 0
 *   dist ≥ 65 m → 0 (unsichtbar)
 */

import * as THREE from "three/webgpu";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  CORAL_CONFIGS,
  buildReefGroup,
} from "../animationen/korallen/coralReef";
import type { ExclusionZone } from "../animationen/staedte/cityConfig";

// ---------------------------------------------------------------------------
// Reef-Slot (ein Riff = mehrere Korallen an einer Position)
// ---------------------------------------------------------------------------

type ReefState = "pending" | "visible";

interface ReefSlot {
  id: number;
  worldX: number;
  worldZ: number;
  state: ReefState;
  group: THREE.Group | null;
  opacity: number;
}

// ---------------------------------------------------------------------------
// CoralReefWorld
// ---------------------------------------------------------------------------

export class CoralReefWorld {
  private scene: THREE.Scene;
  private loader: GLTFLoader;
  private floorY: number;

  /** Vorgeladene Korallen-Modelle (nach Pfad) */
  private _templates: Map<string, THREE.Group> = new Map();

  /** Alle Riffe (pending + visible) */
  private _reefs: ReefSlot[] = [];

  /** Exklusionszonen (Stadt-Kuppeln) – keine Riffe darin */
  private _exclusionZones: ExclusionZone[] = [];

  /** Nächste ID für Riffe */
  private _nextId: number = 0;

  /** Letzte Kameraposition – für Bewegungserkennung */
  private _lastCamX: number = 0;
  private _lastCamZ: number = 0;

  constructor(scene: THREE.Scene, floorY: number = -4) {
    this.scene = scene;
    this.loader = new GLTFLoader();
    this.floorY = floorY;
  }

  // -----------------------------------------------------------------------
  // Initialisierung – lädt alle Korallenmodelle vor
  // -----------------------------------------------------------------------

  async init(): Promise<void> {
    console.log("🪸 CoralReefWorld: Lade Korallenmodelle...");

    for (const config of CORAL_CONFIGS) {
      try {
        const model = await this._loadModel(config.path);
        if (model) {
          this._templates.set(config.path, model);
          console.log(`   🪸 Geladen: ${config.key} → ${config.path}`);
        }
      } catch {
        console.warn(`⚠️ Koralle konnte nicht geladen werden: ${config.path}`);
      }
    }

    console.log(
      `🪸 CoralReefWorld bereit: ${this._templates.size}/${CORAL_CONFIGS.length} Korallen-Typen`,
    );
  }

  // -----------------------------------------------------------------------
  // Exklusionszonen setzen (von CityWorld)
  // -----------------------------------------------------------------------

  setExclusionZones(zones: ExclusionZone[]): void {
    this._exclusionZones = zones;
  }

  // -----------------------------------------------------------------------
  // Update – jeden Frame von der Render-Loop aufrufen
  // -----------------------------------------------------------------------

  update(delta: number, cameraX: number, cameraZ: number): void {
    for (let i = this._reefs.length - 1; i >= 0; i--) {
      const reef = this._reefs[i];
      const dx = reef.worldX - cameraX;
      const dz = reef.worldZ - cameraZ;
      const dist = Math.sqrt(dx * dx + dz * dz);

      switch (reef.state) {
        case "pending":
          // Weit draußen aktivieren (60m) – target = ~0.14 → kaum sichtbar im Nebel
          if (dist < 60) {
            this._showReef(reef);
          } else if (dist > 70) {
            this._reefs.splice(i, 1);
          }
          break;

        case "visible":
          if (dist > 65) {
            this._hideReef(reef);
          }
          break;
      }

      if (reef.state === "visible") {
        // Opazität: 0–30m = voll sichtbar, 30–65m = linearer Fade auf 0
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

    const moved =
      Math.abs(cameraX - this._lastCamX) + Math.abs(cameraZ - this._lastCamZ);
    if (moved > 8) {
      this._spawnReefsNear(cameraX, cameraZ);
      this._lastCamX = cameraX;
      this._lastCamZ = cameraZ;
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
    this._templates.clear();
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
          console.error(`❌ CoralReefWorld: Fehler beim Laden: ${path}`, err);
          resolve(null);
        },
      );
    });
  }

  // -----------------------------------------------------------------------
  // Private: Neue Riffe in der Umgebung spawnen
  // -----------------------------------------------------------------------

  private _spawnReefsNear(cx: number, cz: number): void {
    const totalCount = this._reefs.length;
    if (totalCount >= 15) return;

    const spawnCount = Math.min(3, 15 - totalCount);

    for (let i = 0; i < spawnCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = 12 + Math.random() * 15;
      const wx = cx + Math.cos(angle) * dist;
      const wz = cz + Math.sin(angle) * dist;

      if (this._isInExclusionZone(wx, wz)) continue;

      let tooClose = false;
      for (const reef of this._reefs) {
        const dx = wx - reef.worldX;
        const dz = wz - reef.worldZ;
        if (dx * dx + dz * dz < 400) {
          tooClose = true;
          break;
        }
      }
      if (tooClose) continue;

      this._reefs.push({
        id: this._nextId++,
        worldX: wx,
        worldZ: wz,
        state: "pending",
        group: null,
        opacity: 0,
      });
    }
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

    // Alle Materialien transparent machen und auf 0 setzen (Fade-In Start)
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

  // -----------------------------------------------------------------------
  // Private: Riff unsichtbar machen
  // -----------------------------------------------------------------------

  private _hideReef(reef: ReefSlot): void {
    this._removeReefGroup(reef);
    reef.state = "pending";
    reef.group = null;
  }

  // -----------------------------------------------------------------------
  // Private: Gruppe aus Szene entfernen + Speicher freigeben
  // -----------------------------------------------------------------------

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

  // -----------------------------------------------------------------------
  // Private: Opazität auf alle Meshes einer Gruppe anwenden
  // -----------------------------------------------------------------------

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

  // -----------------------------------------------------------------------
  // Private: Prüfen, ob Position in einer Exklusionszone liegt
  // -----------------------------------------------------------------------

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
