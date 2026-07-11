/**
 * largeCreatureWorld.ts – Delfine und Haie in der Tiefsee-Welt
 *
 * Verwaltet 2 Delfine + 1 Hai pro Territorium (FISCH-Chunk).
 * Die Tiere schwimmen auf großen elliptischen Bahnen um ihr Heimat-Chunk
 * und tauchen so immer wieder im Nebel auf und ab – seltener direkt vor
 * dem Spieler als die kleinen Fische.
 *
 * Integration:
 *   - Wird in scene.ts wie FishWorld instanziiert
 *   - Registriert Territorien via WFC-Callback (FISCH-Chunks)
 *   - Respektiert Exklusionszonen (Stadt-Kuppeln), Boden und Wasseroberfläche
 */

import * as THREE from "three/webgpu";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { ExclusionZone } from "./fishWorld";
import type { EchoTarget } from "../sinne/echoortung/echolocationRings";

// ---------------------------------------------------------------------------
// Konfiguration
// ---------------------------------------------------------------------------

export interface LargeCreatureConfig {
  floorY: number;
  waterY: number;
}

// ---------------------------------------------------------------------------
// Typen für Delfin + Hai
// ---------------------------------------------------------------------------

type CreatureType = "delfin" | "hai";

/** Animations-Zustand eines einzelnen Tiers */
interface CreatureState {
  mesh: THREE.Group;
  type: CreatureType;

  // Heimat-Position (Chunk-Zentrum + Offset)
  homeX: number;
  homeZ: number;

  // Ellipsen-Parameter (pro Tier leicht variiert)
  radiusX: number;
  radiusZ: number;
  speed: number;
  angle: number;

  // Y-Position
  baseY: number;

  // Lerp-Zustand
  currentPitch: number;
  currentRoll: number;
  currentYaw: number;
  currentY: number;

  // Delfin: Porpoising (periodisches Auftauchen)
  porpoiseAmp: number;
  porpoiseFreq: number;

  // Hai: Yaw-Oszillation (lateraler Schwanzschlag)
  yawAmp: number;
  yawFreq: number;

  // Hai: Tiefen-Variation
  depthAmp: number;
  depthFreq: number;

  // Echoortung (Glow beim Treffer)
  glowIntensity: number;
  creatureMesh: THREE.Mesh | null;
  originalEmissive: THREE.Color | null;
  echoTarget: EchoTarget;
}

/** Ein Territorium = alle großen Tiere eines Chunks */
interface CreatureTerritory {
  chunkX: number;
  chunkZ: number;
  centerX: number;
  centerZ: number;
  creatures: CreatureState[];
}

// ---------------------------------------------------------------------------
// Hauptklasse
// ---------------------------------------------------------------------------

export class LargeCreatureWorld {
  private scene: THREE.Scene;
  private config: LargeCreatureConfig;
  private loader: GLTFLoader;

  /** Geladene Modell-Templates (werden in init() geladen) */
  private dolphinTemplate: THREE.Group | null = null;
  private sharkTemplate: THREE.Group | null = null;

  /** Alle Territorien, key = "chunkX,chunkZ" */
  private _territories: Map<string, CreatureTerritory> = new Map();

  /** Exklusionszonen (Stadt-Kuppeln) */
  private _exclusionZones: ExclusionZone[] = [];

  /** Echo-Targets (werden jeden Frame gesammelt und von scene.ts an FishWorld übergeben) */
  private _echoTargets: EchoTarget[] = [];

  /** Glow-Farbe beim Echo-Treffer (wie bei Fischen) */
  private _glowColor = new THREE.Color(0xffaa00);

  /** Wiederverwendbare Farbe für Glow-Berechnung */
  private _tmpColor = new THREE.Color();

  constructor(scene: THREE.Scene, config: LargeCreatureConfig) {
    this.scene = scene;
    this.config = config;
    this.loader = new GLTFLoader();
  }

  // -------------------------------------------------------------------------
  // init – Lädt Delfin- und Hai-Modelle
  // -------------------------------------------------------------------------

  async init(): Promise<void> {
    const [dolphin, shark] = await Promise.all([
      this._loadModel("/3D Modelle/Dolphin.glb"),
      this._loadModel("/3D Modelle/Shark.glb"),
    ]);

    if (dolphin) {
      this.dolphinTemplate = dolphin;
      // Delfin auf ~10 Einheiten skalieren (wie im Test bestätigt)
      const box = new THREE.Box3().setFromObject(dolphin);
      const size = new THREE.Vector3();
      box.getSize(size);
      const scale = 10 / size.z;
      dolphin.scale.setScalar(scale);
      dolphin.traverse((ch) => {
        if (ch instanceof THREE.Mesh) {
          ch.castShadow = true;
          ch.receiveShadow = true;
        }
      });
      console.log(`🐬 Delfin-Modell geladen, Skalierung: ${scale.toFixed(3)}`);
    } else {
      console.warn("⚠️ Delfin-Modell konnte nicht geladen werden");
    }

    if (shark) {
      this.sharkTemplate = shark;
      // Hai auf ~12 Einheiten skalieren (wie im Test bestätigt)
      const box = new THREE.Box3().setFromObject(shark);
      const size = new THREE.Vector3();
      box.getSize(size);
      const longestAxis = Math.max(size.x, size.y, size.z);
      const scale = 12 / longestAxis;
      shark.scale.setScalar(scale);
      shark.traverse((ch) => {
        if (ch instanceof THREE.Mesh) {
          ch.castShadow = true;
          ch.receiveShadow = true;
        }
      });
      console.log(`🦈 Hai-Modell geladen, Skalierung: ${scale.toFixed(3)}`);
    } else {
      console.warn("⚠️ Hai-Modell konnte nicht geladen werden");
    }
  }

  // -------------------------------------------------------------------------
  // registerTerritory – Wird vom WFC-Callback aufgerufen
  // -------------------------------------------------------------------------

  registerTerritory(cx: number, cz: number): void {
    if (!this.dolphinTemplate || !this.sharkTemplate) return;

    const key = `${cx},${cz}`;
    if (this._territories.has(key)) return;

    const cs = 16;
    const worldX = cx * cs + cs / 2;
    const worldZ = cz * cs + cs / 2;

    // 2 Delfine + 1 Hai
    const creatures: CreatureState[] = [];

    // --- 2 Delfine ---
    for (let i = 0; i < 2; i++) {
      const mesh = this.dolphinTemplate.clone(true);
      const homeX = worldX + (Math.random() - 0.5) * 10;
      const homeZ = worldZ + (Math.random() - 0.5) * 10;
      const baseY = this.config.floorY + 3 + Math.random() * 6;

      const state = this._createDolphinState(mesh, homeX, homeZ, baseY, i);
      mesh.position.set(homeX, baseY, homeZ);
      this.scene.add(mesh);
      creatures.push(state);
    }

    // --- 1 Hai ---
    {
      const mesh = this.sharkTemplate.clone(true);
      const homeX = worldX + (Math.random() - 0.5) * 10;
      const homeZ = worldZ + (Math.random() - 0.5) * 10;
      const baseY = this.config.floorY + 1 + Math.random() * 3; // Hai tiefer

      const state = this._createSharkState(mesh, homeX, homeZ, baseY);
      mesh.position.set(homeX, baseY, homeZ);
      this.scene.add(mesh);
      creatures.push(state);
    }

    this._territories.set(key, {
      chunkX: cx,
      chunkZ: cz,
      centerX: worldX,
      centerZ: worldZ,
      creatures,
    });
  }

  // -------------------------------------------------------------------------
  // update – Jeden Frame von scene.ts aufgerufen
  // -------------------------------------------------------------------------

  update(
    delta: number,
    elapsed: number,
    cameraPos: THREE.Vector3,
  ): void {
    const dt = Math.min(delta, 0.05);

    // Echo-Targets sammeln + Glow-Decay anwenden
    this._echoTargets.length = 0;
    const glowDecay = Math.exp(-3.0 * delta);

    for (const [, territory] of this._territories) {
      for (const creature of territory.creatures) {
        this._updateCreature(creature, dt, elapsed);

        // Echo-Target-Position aktualisieren
        creature.echoTarget.position.copy(creature.mesh.position);
        this._echoTargets.push(creature.echoTarget);

        // Glow-Decay
        this._applyGlowDecay(creature, glowDecay);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Exklusionszonen
  // -------------------------------------------------------------------------

  setExclusionZones(zones: ExclusionZone[]): void {
    this._exclusionZones = zones;
  }

  // -------------------------------------------------------------------------
  // Echo-Targets für die Echoortung (wird von scene.ts an FishWorld übergeben)
  // -------------------------------------------------------------------------

  getEchoTargets(): EchoTarget[] {
    return this._echoTargets;
  }

  // -------------------------------------------------------------------------
  // dispose
  // -------------------------------------------------------------------------

  dispose(): void {
    for (const [, territory] of this._territories) {
      for (const creature of territory.creatures) {
        this.scene.remove(creature.mesh);
        creature.mesh.traverse((ch) => {
          if (ch instanceof THREE.Mesh) {
            ch.geometry?.dispose();
            if (ch.material) {
              const mats = Array.isArray(ch.material)
                ? ch.material
                : [ch.material];
              for (const m of mats) m.dispose();
            }
          }
        });
      }
    }
    this._territories.clear();
    this.dolphinTemplate = null;
    this.sharkTemplate = null;
  }

  // -------------------------------------------------------------------------
  // Private: Modell laden
  // -------------------------------------------------------------------------

  private _loadModel(path: string): Promise<THREE.Group | null> {
    return new Promise((resolve) => {
      this.loader.load(
        path,
        (gltf) => resolve(gltf.scene),
        undefined,
        (err) => {
          console.error(`❌ Fehler beim Laden von ${path}:`, err);
          resolve(null);
        },
      );
    });
  }

  // -------------------------------------------------------------------------
  // Private: Delfin-Zustand erzeugen
  // -------------------------------------------------------------------------

  private _createDolphinState(
    mesh: THREE.Group,
    homeX: number,
    homeZ: number,
    baseY: number,
    index: number,
  ): CreatureState {
    const echoTarget: EchoTarget = {
      position: new THREE.Vector3(),
      onHit: () => {},
    };
    echoTarget.onHit = (intensity: number) => {
      creatureRef.glowIntensity = intensity;
    };

    // Erstes Mesh für Glow-Effekt suchen
    let creatureMesh: THREE.Mesh | null = null;
    let originalEmissive: THREE.Color | null = null;
    mesh.traverse((ch) => {
      if (ch instanceof THREE.Mesh && !creatureMesh) {
        creatureMesh = ch;
        const mat = ch.material as THREE.MeshStandardMaterial;
        originalEmissive = mat.emissive
          ? mat.emissive.clone()
          : new THREE.Color(0x000000);
      }
    });

    // Referenz für Callback (wird nach return gesetzt)
    const creatureRef: CreatureState = {
      mesh,
      type: "delfin",
      homeX,
      homeZ,

      radiusX: 25 + Math.random() * 20,
      radiusZ: 20 + Math.random() * 15,
      speed: 0.2 + Math.random() * 0.1,
      angle: index * Math.PI + Math.random() * 0.5,

      baseY,

      currentPitch: 0,
      currentRoll: 0,
      currentYaw: 0,
      currentY: baseY,

      porpoiseAmp: 3 + Math.random() * 2,
      porpoiseFreq: 0.1 + Math.random() * 0.04,

      yawAmp: 0,
      yawFreq: 0,
      depthAmp: 0,
      depthFreq: 0,

      glowIntensity: 0,
      creatureMesh,
      originalEmissive,
      echoTarget,
    };
    return creatureRef;
  }

  // -------------------------------------------------------------------------
  // Private: Hai-Zustand erzeugen
  // -------------------------------------------------------------------------

  private _createSharkState(
    mesh: THREE.Group,
    homeX: number,
    homeZ: number,
    baseY: number,
  ): CreatureState {
    const echoTarget: EchoTarget = {
      position: new THREE.Vector3(),
      onHit: () => {},
    };
    echoTarget.onHit = (intensity: number) => {
      creatureRef.glowIntensity = intensity;
    };

    let creatureMesh: THREE.Mesh | null = null;
    let originalEmissive: THREE.Color | null = null;
    mesh.traverse((ch) => {
      if (ch instanceof THREE.Mesh && !creatureMesh) {
        creatureMesh = ch;
        const mat = ch.material as THREE.MeshStandardMaterial;
        originalEmissive = mat.emissive
          ? mat.emissive.clone()
          : new THREE.Color(0x000000);
      }
    });

    const creatureRef: CreatureState = {
      mesh,
      type: "hai",
      homeX,
      homeZ,

      radiusX: 30 + Math.random() * 25,
      radiusZ: 25 + Math.random() * 20,
      speed: 0.12 + Math.random() * 0.08,
      angle: Math.random() * Math.PI * 2,

      baseY,

      currentPitch: 0,
      currentRoll: 0,
      currentYaw: 0,
      currentY: baseY,

      porpoiseAmp: 0,
      porpoiseFreq: 0,

      yawAmp: 0.08 + Math.random() * 0.04,
      yawFreq: 0.4 + Math.random() * 0.1,
      depthAmp: 4 + Math.random() * 3,
      depthFreq: 0.06 + Math.random() * 0.04,

      glowIntensity: 0,
      creatureMesh,
      originalEmissive,
      echoTarget,
    };
    return creatureRef;
  }

  // -------------------------------------------------------------------------
  // Private: Glow-Effekt nach Echo-Treffer (abklingend)
  // -------------------------------------------------------------------------

  private _applyGlowDecay(creature: CreatureState, decay: number): void {
    if (!creature.creatureMesh || !creature.originalEmissive) return;
    creature.glowIntensity *= decay;
    const mat = creature.creatureMesh.material as THREE.MeshStandardMaterial;
    if (creature.glowIntensity > 0.01) {
      this._tmpColor
        .copy(creature.originalEmissive)
        .lerp(this._glowColor, creature.glowIntensity);
      mat.emissive.copy(this._tmpColor);
      mat.emissiveIntensity = 0.2 + creature.glowIntensity * 1.8;
    } else {
      mat.emissive.copy(creature.originalEmissive);
      mat.emissiveIntensity = 0;
    }
  }

  // -------------------------------------------------------------------------
  // Private: Ein Creature pro Frame aktualisieren
  // -------------------------------------------------------------------------

  private _updateCreature(creature: CreatureState, dt: number, elapsed: number): void {
    const { mesh, type, homeX, homeZ, radiusX, radiusZ, speed, baseY } = creature;

    // ═══ Winkel auf der Ellipse erhöhen ═══
    creature.angle += speed * dt;

    // ═══ Position auf der Ellipse ═══
    let px = homeX + Math.cos(creature.angle) * radiusX;
    let pz = homeZ + Math.sin(creature.angle) * radiusZ;

    // ═══ Exklusionszonen (Städte) – sanft wegdrücken ═══
    if (this._exclusionZones.length > 0) {
      for (const zone of this._exclusionZones) {
        const dx = px - zone.centerX;
        const dz = pz - zone.centerZ;
        const distSq = dx * dx + dz * dz;
        const effectRadius = zone.radius + 25;
        if (distSq < effectRadius * effectRadius && distSq > 0.01) {
          const dist = Math.sqrt(distSq);
          const overlap = 1 - dist / effectRadius;
          const push = overlap * overlap * 8;
          px += (dx / dist) * push;
          pz += (dz / dist) * push;
        }
      }
    }

    // ═══ Y berechnen (tier-spezifisch) ═══
    const lerpSpeed = 3.5;
    const lerp = 1 - Math.exp(-lerpSpeed * dt);

    if (type === "delfin") {
      // Porpoising: nur positive Halbwelle (Delfin springt nach oben)
      const porpoisePhase = elapsed * creature.porpoiseFreq * Math.PI * 2;
      const porpoiseRaw = Math.sin(porpoisePhase);
      const porpoiseY = porpoiseRaw > 0 ? porpoiseRaw * creature.porpoiseAmp : 0;
      const targetY = baseY + porpoiseY;

      // Pitch (dorsoventrale Undulation)
      const targetPitch = Math.sin(elapsed * 0.6 * Math.PI * 2) * 0.06;

      // Roll (leichte Seitenneigung)
      const targetRoll = Math.cos(creature.angle) * Math.sin(elapsed * 0.5) * 0.06;

      creature.currentPitch += (targetPitch - creature.currentPitch) * lerp;
      creature.currentRoll += (targetRoll - creature.currentRoll) * lerp;
      creature.currentY += (targetY - creature.currentY) * lerp;
    } else {
      // Hai: Tiefen-Variation (langsame Y-Änderung)
      const depthOffset =
        Math.sin(elapsed * creature.depthFreq * Math.PI * 2) * creature.depthAmp;
      const targetY = baseY + depthOffset;

      // Yaw (lateraler Schwanzschlag)
      const targetYaw =
        Math.sin(elapsed * creature.yawFreq * Math.PI * 2) * creature.yawAmp;

      // Pitch (sehr dezente vertikale Bewegung)
      const targetPitch =
        Math.sin(elapsed * 0.2 * Math.PI * 2) * 0.03;

      // Roll
      const targetRoll =
        Math.cos(creature.angle) * Math.sin(elapsed * 0.4) * 0.1;

      creature.currentYaw += (targetYaw - creature.currentYaw) * lerp;
      creature.currentPitch += (targetPitch - creature.currentPitch) * lerp;
      creature.currentRoll += (targetRoll - creature.currentRoll) * lerp;
      creature.currentY += (targetY - creature.currentY) * lerp;
    }

    // ═══ Y-Begrenzung (nicht unter Boden, nicht über Wasser) ═══
    const clampedY = Math.max(
      this.config.floorY + 0.5,
      Math.min(this.config.waterY - 0.3, creature.currentY),
    );
    creature.currentY = clampedY;

    // ═══ Yaw aus Tangenten-Richtung ═══
    const tangentX = -Math.sin(creature.angle) * radiusX;
    const tangentZ = Math.cos(creature.angle) * radiusZ;
    const baseYaw = Math.atan2(tangentX, tangentZ);

    // ═══ Position setzen ═══
    mesh.position.set(px, creature.currentY, pz);

    // ═══ Rotation anwenden ═══
    mesh.rotation.set(0, 0, 0);
    mesh.rotateY(baseYaw + creature.currentYaw);
    mesh.rotateX(creature.currentPitch);
    mesh.rotateZ(creature.currentRoll);
  }
}
