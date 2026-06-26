/**
 * coralReefWorld.ts – Korallenriffe in der Tiefsee-Welt.
 *
 * Funktionsweise:
 *   - Lädt die 4 Korallenmodelle aus modelle/korallenriff/ vor
 *   - Erzeugt Riffe an zufälligen Positionen AUSSERHALB des Sichtfelds
 *   - Riffe erscheinen nie in Stadt-Kuppeln (ExclusionZones)
 *   - Werden wieder entfernt, wenn der Spieler sich entfernt
 *
 * Lebenszyklus pro Riff:
 *   pending → visible (bei < 20 m – Gruppe wird der Szene hinzugefügt)
 *   visible → pending (bei > 30 m – Gruppe wird entfernt)
 *   pending → gelöscht (bei > 50 m – komplett aus dem Array)
 *
 * Jedes Riff besteht aus 4–11 zufälligen Korallen,
 * zufällig positioniert und skaliert.
 */

import * as THREE from "three/webgpu";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { ExclusionZone } from "./cityWorld";

// ---------------------------------------------------------------------------
// Korallen-Konfiguration (identisch zu modelle/korallenriff/coralUtils.ts)
// ---------------------------------------------------------------------------

interface CoralConfig {
  key: string;
  path: string;
  baseSize: number;
  sizeVariance: number;
  verticalOffset: number;
  minCount: number;
  maxCount: number;
}

const CORAL_CONFIGS: CoralConfig[] = [
  {
    key: "coral1",
    path: "/3D Modelle/korallen/Coral.glb",
    baseSize: 1.5,
    sizeVariance: 0.5,
    verticalOffset: 0.0,
    minCount: 1,
    maxCount: 4,
  },
  {
    key: "coral2",
    path: "/3D Modelle/korallen/Coral(1).glb",
    baseSize: 0.055,
    sizeVariance: 0.02,
    verticalOffset: 0.0,
    minCount: 1,
    maxCount: 4,
  },
  {
    key: "enviro",
    path: "/3D Modelle/korallen/underwater_enviro_coral.glb",
    baseSize: 1.2,
    sizeVariance: 0.4,
    verticalOffset: 0.0,
    minCount: 1,
    maxCount: 3,
  },
  {
    key: "anemone",
    path: "/3D Modelle/korallen/Sea anemone.glb",
    baseSize: 0.002,
    sizeVariance: 0.0007,
    verticalOffset: 0.1,
    minCount: 0,
    maxCount: 2,
  },
];

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
  // Initialisierung – lädt alle 4 Korallenmodelle vor
  // -----------------------------------------------------------------------

  async init(): Promise<void> {
    console.log("🪸 CoralReefWorld: Lade Korallenmodelle...");

    // Alle Korallen-Modelle nacheinander laden
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
    // 1. Zustand aller Riffe prüfen
    for (let i = this._reefs.length - 1; i >= 0; i--) {
      const reef = this._reefs[i];
      const dx = reef.worldX - cameraX;
      const dz = reef.worldZ - cameraZ;
      const dist = Math.sqrt(dx * dx + dz * dz);

      switch (reef.state) {
        case "pending":
          if (dist < 20) {
            // Riff ist nah genug → sichtbar machen
            this._showReef(reef);
          } else if (dist > 50) {
            // Zu weit weg → komplett entfernen
            this._reefs.splice(i, 1);
          }
          break;

        case "visible":
          if (dist > 30) {
            // Riff ist zu weit weg → unsichtbar machen
            this._hideReef(reef);
          }
          break;
      }

      // Fade-In für sichtbare Riffe
      if (reef.state === "visible" && reef.opacity < 1) {
        reef.opacity += (1 - reef.opacity) * Math.min(1, delta * 3);
        if (reef.group) {
          this._applyOpacity(reef.group, reef.opacity);
        }
      }
    }

    // 2. Neue Riffe spawnen, wenn die Kamera sich bewegt hat
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

    // Performance-Limit: maximal 15 Riffe gleichzeitig
    if (totalCount >= 15) return;

    // 1–3 neue Riffe spawnen (je nachdem, wie viele fehlen)
    const spawnCount = Math.min(3, 15 - totalCount);

    for (let i = 0; i < spawnCount; i++) {
      // Zufällige Position in 12–27 m Entfernung (außerhalb Sichtfeld)
      const angle = Math.random() * Math.PI * 2;
      const dist = 12 + Math.random() * 15;
      const wx = cx + Math.cos(angle) * dist;
      const wz = cz + Math.sin(angle) * dist;

      // Nicht in Stadt-Kuppeln spawnen
      if (this._isInExclusionZone(wx, wz)) continue;

      // Nicht zu nah an anderen Riffen (min. 20 m Abstand)
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

      // Riff als "pending" anlegen (noch unsichtbar)
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
    // Keine Modelle geladen? Dann nichts zu tun
    if (this._templates.size === 0) return;

    const group = new THREE.Group();
    group.position.set(reef.worldX, this.floorY, reef.worldZ);

    // 4–11 Korallen pro Riff (wie in coralUtils.ts, aber etwas kleiner)
    const coralCount = 4 + Math.floor(Math.random() * 8);

    // Positionen merken – keine Überlappungen
    const placedPositions: Array<{ x: number; z: number }> = [];

    for (let i = 0; i < coralCount; i++) {
      // Zufälligen Korallentyp wählen (ALLE Varianten möglich)
      const config =
        CORAL_CONFIGS[Math.floor(Math.random() * CORAL_CONFIGS.length)];

      const template = this._templates.get(config.path);
      if (!template) continue;

      // Zufällige Position innerhalb des Riffs (Radius 1–6 m)
      let x: number = 0;
      let z: number = 0;
      let attempts = 0;
      let valid = false;
      const minDist = 1.5;

      do {
        const a = Math.random() * Math.PI * 2;
        const d = 1 + Math.random() * 5;
        x = Math.cos(a) * d;
        z = Math.sin(a) * d;
        valid = placedPositions.every((p) => {
          const dx = x - p.x;
          const dz = z - p.z;
          return Math.sqrt(dx * dx + dz * dz) >= minDist;
        });
        attempts++;
      } while (!valid && attempts < 20);

      placedPositions.push({ x, z });

      // Modell klonen, skalieren und positionieren
      const clone = template.clone(true);

      const scaleVariation = (Math.random() - 0.5) * config.sizeVariance * 2;
      const finalScale = Math.max(0.01, config.baseSize + scaleVariation);
      clone.scale.setScalar(finalScale);

      clone.position.set(x, config.verticalOffset, z);
      clone.rotation.y = Math.random() * Math.PI * 2;

      // Bounding Box: Modell so verschieben, dass es auf dem Boden sitzt
      clone.updateWorldMatrix(true, false);
      const bbox = new THREE.Box3().setFromObject(clone);
      clone.position.y -= bbox.min.y;

      group.add(clone);
    }

    // Alle Materialien transparent machen und auf 0 setzen (Fade-In Start)
    group.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material) {
        const mats = Array.isArray(child.material) ? child.material : [child.material];
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

  /**
   * Wendet eine Opazität auf alle Meshes einer Gruppe an.
   * Die originale Opazität jedes Materials wird in userData.baseOpacity
   * gespeichert (wird in _showReef gesetzt) und dann als Basis genutzt.
   */
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

  private _isInExclusionZone(x: number, z: number, margin: number = 5): boolean {
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
