/**
 * fishWorld.ts â€“ Fisch-Integration fÃ¼r die Tiefsee-Unterwasserwelt
 *
 * Importiert die reine Bewegungs-Mathematik aus animationen/fische/ und
 * kÃ¼mmert sich um Three.js-Rendering, Exklusionszonen und Echoortung.
 *
 * Modularer Aufbau:
 *   - orbitSwimming.ts  â†’ Solo-Fisch-Animation (Carangiform + Burst)
 *   - schoolFormation.ts â†’ Schwarm-Formation (V-Formation, Ellipsen-Bahn)
 *   - fishWorld.ts       â†’ World-Management + Three.js-Integration
 */

import * as THREE from "three/webgpu";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  EcholocationRings,
  type EchoTarget,
  type EcholocationConfig,
} from "../sinne/echoortung/echolocationRings";
import {
  type SwimParams,
  type SwimState,
  createSwimParams,
  createSwimState,
  computeOrbitPosition,
  computeOrbitTangent,
  updateSwimState,
  computeTargetY,
} from "../animationen/fische/orbitSwimming";
import {
  type FormationOffset,
  type SchoolFrameFish,
  generateVFormation,
  computeSchoolFrame,
} from "../animationen/fische/schoolFormation";

/**
 * Lokaler Typ fÃ¼r eine Ausschlusszone (z.â€¯B. um eine Stadtkuppel).
 * StÃ¤dte werden in diesen Zonen platziert â€“ Fische sollen sie meiden.
 */
export interface ExclusionZone {
  centerX: number;
  centerZ: number;
  radius: number;
}

// ---------------------------------------------------------------------------
// Konfiguration
// ---------------------------------------------------------------------------

/**
 * Einstellungen fÃ¼r das Fisch-System in der Welt.
 * Alle Werte sind auf die Tiefsee-Unterwasserwelt abgestimmt.
 */
export interface FishWorldConfig {
  /** Y-Bereich: Boden (Fische schwimmen oberhalb) */
  floorY: number;
  /** Y-Bereich: WasseroberflÃ¤che (Fische bleiben darunter) */
  waterY: number;
  /** Welt-GrÃ¶ÃŸe (XZ-Bereich fÃ¼r zufÃ¤llige Positionen) */
  worldRadius: number;
  /** Anzahl Einzelfische, die dauerhaft herumschwimmen */
  soloCount: number;
  /** Minimale Fisch-GrÃ¶ÃŸe in Einheiten */
  fishMinSize: number;
  /** Maximale Fisch-GrÃ¶ÃŸe in Einheiten */
  fishMaxSize: number;
  /** Schwarm erscheint alle â€¦ Sekunden (Intervall, zufÃ¤llig) */
  schoolIntervalMin: number;
  schoolIntervalMax: number;
  /** Schwarm bleibt â€¦ Sekunden sichtbar */
  schoolDurationMin: number;
  schoolDurationMax: number;
  /** Anzahl Fische pro Schwarm */
  schoolSize: number;
  /** Echoortung aktivieren? (Ringe + Aufleuchten bei Treffer) */
  echolocationEnabled: boolean;
  /** Echoortungs-Konfiguration (optional) */
  echolocationConfig?: Partial<EcholocationConfig>;
}

/** Standard-Werte â€“ passend zur Tiefsee-Welt */
const DEFAULT_FISH_CONFIG: FishWorldConfig = {
  floorY: -4,
  waterY: 15,
  worldRadius: 50,
  soloCount: 12,
  fishMinSize: 1.2,
  fishMaxSize: 2.5,
  schoolIntervalMin: 20,
  schoolIntervalMax: 40,
  schoolDurationMin: 12,
  schoolDurationMax: 20,
  schoolSize: 20,
  echolocationEnabled: true,
};

// ---------------------------------------------------------------------------
// Einzelfisch (Orbit-Parameter)
// ---------------------------------------------------------------------------

/**
 * Nur die Orbit-spezifischen Felder â€“ die Schwimm-Animation (Yaw/Pitch/Roll
 * etc.) ist in SwimParams (orbitSwimming.ts) ausgelagert.
 */
interface SoloFishParams {
  radiusX: number;
  radiusZ: number;
  speed: number;
  startAngle: number;
  baseY: number;
  centerX: number;
  centerZ: number;
  swim: SwimParams;
}

function createSoloParams(config: FishWorldConfig): SoloFishParams {
  const rand = Math.random;
  return {
    radiusX: 2 + rand() * 4,
    radiusZ: 2 + rand() * 3,
    speed: 0.08 + rand() * 0.15,
    startAngle: rand() * Math.PI * 2,
    baseY: config.floorY + 1.5 + rand() * (config.waterY - config.floorY - 2.5),
    centerX: (rand() - 0.5) * 16,
    centerZ: (rand() - 0.5) * 16,
    swim: createSwimParams(),
  };
}

// ---------------------------------------------------------------------------
// Einzelfisch-Halter (Rendering + Zustand)
// ---------------------------------------------------------------------------

interface SoloFish {
  mesh: THREE.Group;
  params: SoloFishParams;
  /** Animations-Zustand (Yaw, Pitch, Roll, curY, Burst-Glättung) */
  state: SwimState;

  // --- Glow (Echoortung) ---
  glowIntensity: number;
  fishMesh: THREE.Mesh | null;
  originalEmissive: THREE.Color | null;

  /** Cooldown in Sekunden: verhindert wiederholtes Wegschubsen an Kuppeln */
  repelCooldown: number;

  /** Vorab erstelltes EchoTarget – vermeidet Closure+Object-Allokation pro Frame */
  _echoTarget: EchoTarget;
}

// ---------------------------------------------------------------------------
// FischSchwarm â€“ VergÃ¤nglicher Formations-Schwarm
// ---------------------------------------------------------------------------

interface FishSchool {
  instances: THREE.InstancedMesh;
  fadeStartedAt: number;
  spawnAt: number;
  fadeDuration: number;
  fishScale: number;

  // --- Glow (Echoortung) ---
  glowIntensity: number;
  originalEmissive: THREE.Color;

  // --- Formation-Daten (aus schoolFormation.ts) ---
  formation: FormationOffset[];

  // --- Ellipsenbahn des Schwarm-Zentrums ---
  centerX: number;
  centerZ: number;
  baseY: number;
  startAngle: number;
  swimRadiusX: number;
  swimRadiusZ: number;
  speed: number;
  depthAmp: number;
  depthFreq: number;

  /** Vorab erstelltes EchoTarget – vermeidet Closure+Object-Allokation pro Frame */
  _echoTarget: EchoTarget;
}

// ---------------------------------------------------------------------------
// Hauptklasse: FishWorld
// ---------------------------------------------------------------------------

export class FishWorld {
  private scene: THREE.Scene;
  private config: FishWorldConfig;
  private loader: GLTFLoader;

  // --- Einzelfische ---
  private soloFishes: SoloFish[] = [];
  private fishModelTemplate: THREE.Group | null = null;
  private soloScale: number = 1.0;

  // --- SchwÃ¤rme ---
  private activeSchools: FishSchool[] = [];
  private nextSchoolTime: number = 0;
  private schoolFishMesh: THREE.Mesh | null = null;
  private schoolFishScale: number = 1.0;

  /**
   * School-Pool: 2 vorab erstellte InstancedMeshes, die wiederverwendet werden.
   * spawnSchool() nimmt ein Pool-Mesh, setzt die Matrizen neu und macht es
   * sichtbar. Kein new InstancedMesh mehr im Tick!
   */
  private _schoolPool: THREE.InstancedMesh[] = [];

  // --- Exklusionszonen (Kuppeln, die Fische meiden) ---
  private _exclusionZones: ExclusionZone[] = [];

  // --- Echoortung ---
  private echolocation: EcholocationRings | null = null;
  private _echoTargets: EchoTarget[] = [];

  /** Gecachte V-Formation (einmal erzeugt, für alle Schwärme geteilt) */
  private _defaultFormation: FormationOffset[] = [];

  /**
   * Wiederverwendbare SchoolFrameFish-Puffer (einer pro Pool-Mesh).
   * Verhindert Array+Object-Allokationen in computeSchoolFrame.
   */
  private _schoolFrameBuffers: SchoolFrameFish[][] = [];

  /**
   * Warteschlange für School-Spawns (gestaffelt via processNextHeavyOp).
   * scene.ts verarbeitet max 1 pro Frame.
   */
  private _pendingSpawnQueue: Array<{ cameraX: number; cameraZ: number }> = [];

  // --- Wiederverwendbare Objekte (Performance: kein "new" im Loop) ---
  private _tmpVec3 = new THREE.Vector3();
  private _tmpQuat = new THREE.Quaternion();
  private _tmpQuatA = new THREE.Quaternion();
  private _tmpQuatB = new THREE.Quaternion();
  private _up = new THREE.Vector3(0, 1, 0);
  private _axisPitch = new THREE.Vector3(1, 0, 0);
  private _axisRoll = new THREE.Vector3(0, 0, 1);
  private _tmpMatrix = new THREE.Matrix4();
  private _tmpScale = new THREE.Vector3();
  private _tmpColor = new THREE.Color();
  private _glowColor = new THREE.Color(0xffaa00);
  private _echoOrigin = new THREE.Vector3();
  private _tmpDistVec = new THREE.Vector3();

  constructor(scene: THREE.Scene, config?: Partial<FishWorldConfig>) {
    this.scene = scene;
    this.config = { ...DEFAULT_FISH_CONFIG, ...config };
    this.loader = new GLTFLoader();

    // Echoortung initialisieren (Ringe, die vom Spieler ausgehen)
    if (this.config.echolocationEnabled) {
      this.echolocation = new EcholocationRings(
        scene,
        this.config.echolocationConfig,
      );
    }
  }

  // -----------------------------------------------------------------------
  // Initialisierung (async â€“ lÃ¤dt das Fisch-Modell)
  // -----------------------------------------------------------------------

  async init(cameraPos?: THREE.Vector3): Promise<void> {
    console.log("ðŸŸ FishWorld: Lade Fisch-Modell...");

    this.fishModelTemplate = await this._loadFishModel(
      "/3D Modelle/fish/Fish(3).glb",
    );

    if (!this.fishModelTemplate) {
      console.warn(
        "âš ï¸ FishWorld: Fisch-Modell konnte nicht geladen werden!",
      );
      return;
    }

    // Skalierung berechnen
    const box = new THREE.Box3().setFromObject(this.fishModelTemplate);
    const size = new THREE.Vector3();
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z);
    this.soloScale = 1.8 / maxDim;
    this.schoolFishScale = 1.2 / maxDim;

    // Einzelfische erstellen
    const spawnPos = cameraPos ?? new THREE.Vector3(0, 0, 0);
    for (let i = 0; i < this.config.soloCount; i++) {
      const params = createSoloParams(this.config);
      const fish = this._createSoloFish(params);
      this._positionFishAt(fish, spawnPos);
      this.soloFishes.push(fish);
    }

    // Schwarm-Mesh fÃ¼r InstancedMesh extrahieren
    const clone = this.fishModelTemplate.clone(true);
    this.scene.add(clone);
    let foundMesh: THREE.Mesh | null = null;
    clone.traverse((ch) => {
      if (ch instanceof THREE.Mesh && !foundMesh) foundMesh = ch;
    });
    this.scene.remove(clone);

    if (foundMesh) {
      this.schoolFishMesh = foundMesh;
    }

    // School-Pool vorbereiten: 2 InstancedMeshes, die wiederverwendet werden
    if (this.schoolFishMesh) {
      const mat = (
        this.schoolFishMesh.material as THREE.MeshStandardMaterial
      ).clone();
      mat.transparent = true;
      mat.opacity = 0;
      for (let i = 0; i < 2; i++) {
        const poolMesh = new THREE.InstancedMesh(
          this.schoolFishMesh.geometry,
          mat.clone(),
          this.config.schoolSize,
        );
        poolMesh.castShadow = true;
        poolMesh.receiveShadow = true;
        poolMesh.frustumCulled = false;
        poolMesh.visible = false;
        this.scene.add(poolMesh);
        this._schoolPool.push(poolMesh);

        // ✅ Frame-Puffer für dieses Pool-Mesh vorab allozieren
        const buf: SchoolFrameFish[] = [];
        for (let j = 0; j < this.config.schoolSize; j++) {
          buf.push({ fx: 0, fy: 0, fz: 0, yawVariation: 0, pitch: 0, roll: 0 });
        }
        this._schoolFrameBuffers.push(buf);
      }
    }

    // ✅ V-Formation einmal vorberechnen (wiederverwendet für alle Schwärme)
    this._defaultFormation = generateVFormation(this.config.schoolSize);

    this._scheduleNextSchool();

    console.log(
      `ðŸŸ FishWorld bereit: ${this.config.soloCount} Einzelfische, ` +
        `SchwÃ¤rme alle ${this.config.schoolIntervalMin}â€“${this.config.schoolIntervalMax}s`,
    );
  }

  // -----------------------------------------------------------------------
  // Update â€“ jeden Frame von der Render-Loop aufrufen
  // -----------------------------------------------------------------------

  /**
   * @param additionalTargets â€“ Optionale zusÃ¤tzliche Echo-Ziele (z.â€¯B. von Quallen)
   */
  update(
    delta: number,
    elapsed: number,
    cameraPos: THREE.Vector3,
    additionalTargets?: EchoTarget[],
  ): void {
    for (const fish of this.soloFishes) {
      this._updateSoloFish(fish, delta, elapsed);
    }

    this._manageVisibility(cameraPos);
    this._updateSchools(delta, elapsed, cameraPos);
    this._updateEcholocation(delta, elapsed, cameraPos, additionalTargets);
  }

  // -----------------------------------------------------------------------
  // Exklusionszonen (Fische meiden Kuppeln)
  // -----------------------------------------------------------------------

  setExclusionZones(zones: ExclusionZone[], _cameraPos?: THREE.Vector3): void {
    this._exclusionZones = zones;
  }

  private _isInExclusionZone(
    x: number,
    z: number,
    margin: number = 0,
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

  private _repelFishFromZones(fish: SoloFish): void {
    const p = fish.params;
    for (const zone of this._exclusionZones) {
      const dx = p.centerX - zone.centerX;
      const dz = p.centerZ - zone.centerZ;
      const minDist = zone.radius + 6;
      const distSq = dx * dx + dz * dz;
      if (distSq < minDist * minDist) {
        const dist = Math.sqrt(distSq) || 0.001;
        const pushOut = minDist - dist + 2;
        p.centerX += (dx / dist) * pushOut;
        p.centerZ += (dz / dist) * pushOut;
      }
    }
    fish.repelCooldown = 2.0;
  }

  private _findValidPosition(
    baseX: number,
    baseZ: number,
    minDist: number,
    maxDist: number,
  ): { x: number; z: number } {
    const fishMargin = 15;
    let attempts = 0;
    while (attempts < 20) {
      const angle = Math.random() * Math.PI * 2;
      const dist = minDist + Math.random() * (maxDist - minDist);
      const cx = baseX + Math.cos(angle) * dist;
      const cz = baseZ + Math.sin(angle) * dist;

      if (!this._isInExclusionZone(cx, cz, fishMargin)) {
        return { x: cx, z: cz };
      }
      attempts++;
    }
    const fallbackAngle = Math.random() * Math.PI * 2;
    const fallbackDist = 30 + Math.random() * 20;
    return {
      x: baseX + Math.cos(fallbackAngle) * fallbackDist,
      z: baseZ + Math.sin(fallbackAngle) * fallbackDist,
    };
  }

  // -----------------------------------------------------------------------
  // AufrÃ¤umen
  // -----------------------------------------------------------------------

  dispose(): void {
    for (const fish of this.soloFishes) {
      this.scene.remove(fish.mesh);
      fish.mesh.traverse((ch) => {
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
    this.soloFishes.length = 0;

    for (const school of this.activeSchools) {
      this.scene.remove(school.instances);
      school.instances.dispose();
    }
    this.activeSchools.length = 0;

    this.fishModelTemplate = null;
    this.schoolFishMesh = null;

    if (this.echolocation) {
      this.echolocation.dispose();
      this.echolocation = null;
    }
  }

  // -----------------------------------------------------------------------
  // Private: Modell laden
  // -----------------------------------------------------------------------

  private _loadFishModel(path: string): Promise<THREE.Group | null> {
    return new Promise((resolve) => {
      this.loader.load(
        path,
        (gltf) => resolve(gltf.scene),
        undefined,
        (err) => {
          console.error("âŒ FishWorld: Fehler beim Laden:", err);
          resolve(null);
        },
      );
    });
  }

  // -----------------------------------------------------------------------
  // Private: Einzelfisch erstellen
  // -----------------------------------------------------------------------

  private _createSoloFish(params: SoloFishParams): SoloFish {
    const mesh = this.fishModelTemplate!.clone(true);
    mesh.scale.setScalar(this.soloScale);
    mesh.traverse((ch) => {
      if (ch instanceof THREE.Mesh) {
        ch.castShadow = true;
        ch.receiveShadow = true;
      }
    });

    let fishMesh: THREE.Mesh | null = null;
    let originalEmissive: THREE.Color | null = null;
    mesh.traverse((ch) => {
      if (ch instanceof THREE.Mesh && !fishMesh) {
        fishMesh = ch;
        const mat = ch.material as THREE.MeshStandardMaterial;
        originalEmissive = mat.emissive
          ? mat.emissive.clone()
          : new THREE.Color(0x000000);
      }
    });

    // Animations-Zustand aus dem Modul erzeugen
    const state = createSwimState(params.baseY);

    this.scene.add(mesh);

    // Fisch-Objekt anlegen
    const fish: SoloFish = {
      mesh,
      params,
      state,
      glowIntensity: 0,
      fishMesh,
      originalEmissive,
      repelCooldown: 0,
      _echoTarget: {
        position: new THREE.Vector3(),
        onHit: () => {
          // Wird unten überschrieben – Platzhalter
        },
      },
    };
    // Echten Closure erstellen, der fish.glowIntensity setzt
    fish._echoTarget.onHit = (intensity: number) => {
      fish.glowIntensity = intensity;
    };
    return fish;
  }

  /**
   * Positioniert einen Fisch in KameranÃ¤he (25-40m) auf einer neuen Ellipse,
   * die garantiert auÃŸerhalb aller Kuppeln liegt.
   */
  private _positionFishAt(
    fish: SoloFish,
    cameraPos: THREE.Vector3,
    minDist?: number,
    maxDist?: number,
  ): void {
    const p = fish.params;
    const mind = minDist ?? 50; // ✅ WEITER WEG spawnen (50m statt 25m)
    const maxd = maxDist ?? 65; //    der Fisch schwimmt dann von selbst näher

    const { x: validX, z: validZ } = this._findValidPosition(
      cameraPos.x,
      cameraPos.z,
      mind,
      maxd,
    );
    p.centerX = validX;
    p.centerZ = validZ;
    p.baseY =
      this.config.floorY +
      1.5 +
      Math.random() * (this.config.waterY - this.config.floorY - 2.5);
    p.startAngle = Math.random() * Math.PI * 2;

    // Startwinkel so drehen, dass der Fisch nicht in einer Zone startet
    let finalAngle = p.startAngle;
    if (this._exclusionZones.length > 0) {
      for (let attempt = 0; attempt < 12; attempt++) {
        const tx = p.centerX + Math.cos(finalAngle) * p.radiusX;
        const tz = p.centerZ + Math.sin(finalAngle) * p.radiusZ;
        if (!this._isInExclusionZone(tx, tz)) break;
        finalAngle += Math.PI / 6;
      }
    }

    fish.mesh.position.set(
      p.centerX + Math.cos(finalAngle) * p.radiusX,
      p.baseY,
      p.centerZ + Math.sin(finalAngle) * p.radiusZ,
    );

    // State zurÃ¼cksetzen
    fish.state.curY = p.baseY;
    fish.state.yaw = 0;
    fish.state.pitch = 0;
    fish.state.roll = 0;

    fish.mesh.visible = true;
  }

  // -----------------------------------------------------------------------
  // Private: Einzelfisch animieren
  // -----------------------------------------------------------------------

  private _updateSoloFish(
    fish: SoloFish,
    delta: number,
    elapsed: number,
  ): void {
    const p = fish.params;
    const { swim } = p;

    // --- Orbit-Position auf der Ellipse ---
    const { px, pz, ang } = computeOrbitPosition(
      p.centerX,
      p.centerZ,
      p.radiusX,
      p.radiusZ,
      p.speed,
      p.startAngle,
      elapsed,
    );

    // --- Sanftes Ausweichen vor Kuppeln (graduelle Lenkung) ---
    if (this._exclusionZones.length > 0) {
      const dt = Math.min(delta, 0.1);
      for (const zone of this._exclusionZones) {
        const dx2 = p.centerX - zone.centerX;
        const dz2 = p.centerZ - zone.centerZ;
        const distSq = dx2 * dx2 + dz2 * dz2;
        const minDist = zone.radius + 7;
        if (distSq < minDist * minDist) {
          const dist = Math.sqrt(distSq) || 0.001;
          const overlap = minDist - dist;
          const pushPerFrame = Math.min(overlap, 1.0) * 0.3 * dt;
          p.centerX += (dx2 / dist) * pushPerFrame;
          p.centerZ += (dz2 / dist) * pushPerFrame;
        }
      }
    }

    // --- Kuppel-Kollision: Position + Orbit-Zentrum direkt korrigieren ---
    let finalX = px;
    let finalZ = pz;
    if (this._exclusionZones.length > 0) {
      for (const zone of this._exclusionZones) {
        const dx3 = finalX - zone.centerX;
        const dz3 = finalZ - zone.centerZ;
        const distSq3 = dx3 * dx3 + dz3 * dz3;
        const radiusSq = zone.radius * zone.radius;
        if (distSq3 < radiusSq) {
          const dist3 = Math.sqrt(distSq3) || 0.001;
          const pushOut = zone.radius - dist3 + 0.5;
          finalX += (dx3 / dist3) * pushOut;
          finalZ += (dz3 / dist3) * pushOut;
          p.centerX += (dx3 / dist3) * pushOut;
          p.centerZ += (dz3 / dist3) * pushOut;
        }
      }
    }

    // --- Tiefe berechnen (Sinus-Welle + Boden-Abstand) ---
    const tgtY = computeTargetY(
      p.baseY,
      swim.depthAmp,
      swim.depthFreq,
      swim.phaseOffset,
      elapsed,
      this.config.floorY,
    );

    // --- Schwimm-Zustand aktualisieren (Burst + Yaw/Pitch/Roll) ---
    updateSwimState(swim, fish.state, delta, elapsed, ang);

    // Tangenten-Richtung (Blickrichtung)
    const { baseYaw } = computeOrbitTangent(p.radiusX, p.radiusZ, ang);

    // Y-Position lerpen
    const lf = 1 - Math.exp(-5.0 * Math.min(delta, 0.1));
    fish.state.curY += (tgtY - fish.state.curY) * lf;

    // --- Position + Rotation anwenden ---
    fish.mesh.position.set(finalX, fish.state.curY, finalZ);
    fish.mesh.rotation.set(0, 0, 0);
    fish.mesh.rotateY(baseYaw + fish.state.yaw);
    fish.mesh.rotateX(fish.state.pitch);
    fish.mesh.rotateZ(fish.state.roll);
  }

  // -----------------------------------------------------------------------
  // Private: Sichtbarkeit verwalten
  // -----------------------------------------------------------------------

  private _manageVisibility(cameraPos: THREE.Vector3): void {
    const maxDistSq = 80 * 80;
    const minSpawnDist = 50; // ✅ WEITER WEG: 50-65m statt 15-35m
    const maxSpawnDist = 65;
    const targetVisible = Math.max(1, this.config.soloCount);

    let visibleCount = 0;
    for (const fish of this.soloFishes) {
      const dx = fish.mesh.position.x - cameraPos.x;
      const dz = fish.mesh.position.z - cameraPos.z;
      if (dx * dx + dz * dz > maxDistSq) {
        fish.mesh.visible = false;
      } else {
        fish.mesh.visible = true;
        visibleCount++;
      }
    }

    if (visibleCount < targetVisible) {
      for (const fish of this.soloFishes) {
        if (!fish.mesh.visible) {
          this._positionFishAt(fish, cameraPos, minSpawnDist, maxSpawnDist);
          visibleCount++;
          if (visibleCount >= targetVisible) break;
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // Private: SchwÃ¤rme verwalten
  // -----------------------------------------------------------------------

  private _scheduleNextSchool(): void {
    const { schoolIntervalMin, schoolIntervalMax } = this.config;
    const interval =
      schoolIntervalMin +
      Math.random() * (schoolIntervalMax - schoolIntervalMin);
    this.nextSchoolTime = performance.now() + interval * 1000;
  }

  /** Legt einen School-Spawn in die Warteschlange (gestaffelt) */
  private _enqueueSchoolSpawn(cameraPos: THREE.Vector3): void {
    this._pendingSpawnQueue.push({
      cameraX: cameraPos.x,
      cameraZ: cameraPos.z,
    });
  }

  /**
   * Verarbeitet genau 1 School-Spawn aus der Warteschlange.
   * Wird von scene.ts aufgerufen (max 1 schwere Operation pro Frame).
   * @returns true wenn ein Spawn ausgeführt wurde
   */
  public processNextHeavyOp(): boolean {
    const pending = this._pendingSpawnQueue.shift();
    if (!pending) return false;
    const camPos = new THREE.Vector3(pending.cameraX, 0, pending.cameraZ);
    this._spawnSchool(camPos);
    return true;
  }

  private _spawnSchool(cameraPos: THREE.Vector3): void {
    if (!this.schoolFishMesh || this._schoolPool.length === 0) return;

    const { schoolSize } = this.config;
    const rand = Math.random;

    // ✅ Gecachte V-Formation verwenden (kein new Array mehr)
    const formation = this._defaultFormation;

    // Gültige Startposition außerhalb aller Kuppeln finden
    const { x: validX, z: validZ } = this._findValidPosition(
      cameraPos.x,
      cameraPos.z,
      12,
      20,
    );

    // ✅ Performance: Pool-Mesh nehmen statt new InstancedMesh
    const instances = this._schoolPool.pop()!;
    instances.visible = true;
    // Material zurücksetzen (opacity = 0, frischer Glow)
    const mat = instances.material as THREE.MeshStandardMaterial;
    mat.opacity = 0;

    const origEmissive = mat.emissive?.clone() ?? new THREE.Color(0x000000);

    const fadeMs = 2000;

    const school: FishSchool = {
      instances,
      fadeStartedAt: 0,
      spawnAt: performance.now(),
      fadeDuration: fadeMs,
      fishScale: this.schoolFishScale,
      glowIntensity: 0,
      originalEmissive: origEmissive,
      formation,
      centerX: validX,
      centerZ: validZ,
      baseY:
        this.config.floorY +
        2 +
        rand() * (this.config.waterY - this.config.floorY - 4),
      startAngle: rand() * Math.PI * 2,
      swimRadiusX: 8 + rand() * 6,
      swimRadiusZ: 5 + rand() * 5,
      speed: 0.08 + rand() * 0.12,
      depthAmp: 0.5 + rand() * 1.0,
      depthFreq: 0.06 + rand() * 0.08,
      _echoTarget: {
        position: new THREE.Vector3(),
        onHit: (intensity: number) => {
          school.glowIntensity = intensity;
        },
      },
    };
    this.activeSchools.push(school);
  }

  private _updateSchools(
    delta: number,
    elapsed: number,
    cameraPos: THREE.Vector3,
  ): void {
    const now = performance.now();

    if (now >= this.nextSchoolTime && this.activeSchools.length < 2) {
      // ✅ Nicht sofort spawnen, sondern in die Queue legen.
      // scene.ts verarbeitet max 1 pro Frame über processNextHeavyOp().
      this._enqueueSchoolSpawn(cameraPos);
      this._scheduleNextSchool();
    }

    const scale = this.schoolFishScale;
    const despawnDistSq = 65 * 65;

    for (let i = this.activeSchools.length - 1; i >= 0; i--) {
      const school = this.activeSchools[i];
      const mat = school.instances.material as THREE.MeshStandardMaterial;

      // Distanz zur Kamera prÃ¼fen
      const dx = school.centerX - cameraPos.x;
      const dz = school.centerZ - cameraPos.z;
      const distSq = dx * dx + dz * dz;

      // Fade-In / Fade-Out (distanzbasiert)
      const elapsedSinceSpawn = now - school.spawnAt;
      let opacity = 1;

      if (elapsedSinceSpawn < school.fadeDuration) {
        opacity = elapsedSinceSpawn / school.fadeDuration;
      } else if (distSq > despawnDistSq) {
        if (school.fadeStartedAt === 0) {
          school.fadeStartedAt = now;
        }
        const fadeElapsed = now - school.fadeStartedAt;
        if (fadeElapsed >= school.fadeDuration) {
          // ✅ Performance: Pool-Mesh zurückgeben statt dispose()
          school.instances.visible = false;
          this._schoolPool.push(school.instances);
          this.activeSchools.splice(i, 1);
          continue;
        }
        opacity = 1 - fadeElapsed / school.fadeDuration;
      } else {
        school.fadeStartedAt = 0;
      }

      mat.opacity = opacity;

      // ✅ Frame-Daten mit vorab alloziiertem Puffer berechnen (kein GC-Müll)
      // Den richtigen Puffer anhand des Pool-Index finden
      const poolIdx = this._schoolPool.indexOf(school.instances);
      const frameBuf =
        poolIdx >= 0 && poolIdx < this._schoolFrameBuffers.length
          ? this._schoolFrameBuffers[poolIdx]
          : this._schoolFrameBuffers[0];
      const baseYaw = computeSchoolFrame(
        school.formation,
        elapsed,
        school.centerX,
        school.centerZ,
        school.baseY,
        school.swimRadiusX,
        school.swimRadiusZ,
        school.speed,
        school.startAngle,
        school.depthAmp,
        school.depthFreq,
        this.config.floorY,
        frameBuf,
      );

      // Matrizen fÃ¼r jeden Fisch setzen
      for (let j = 0; j < frameBuf.length; j++) {
        const f = frameBuf[j];

        this._tmpVec3.set(f.fx, f.fy, f.fz);

        // Quaternion: Yaw â†’ Pitch â†’ Roll
        this._tmpQuat.identity();
        this._tmpQuatA.setFromAxisAngle(
          this._up,
          baseYaw + f.yawVariation,
        );
        this._tmpQuat.multiply(this._tmpQuatA);
        this._tmpQuatB.setFromAxisAngle(this._axisPitch, f.pitch);
        this._tmpQuat.multiply(this._tmpQuatB);
        this._tmpQuatA.setFromAxisAngle(this._axisRoll, f.roll);
        this._tmpQuat.multiply(this._tmpQuatA);

        this._tmpScale.set(scale, scale, scale);
        this._tmpMatrix.compose(this._tmpVec3, this._tmpQuat, this._tmpScale);
        school.instances.setMatrixAt(j, this._tmpMatrix);
      }
      school.instances.instanceMatrix.needsUpdate = true;
    }
  }

  // -----------------------------------------------------------------------
  // Private: Echoortung â€“ Ringe aussenden + Glow-Effekt
  // -----------------------------------------------------------------------

  private _updateEcholocation(
    delta: number,
    elapsed: number,
    cameraPos: THREE.Vector3,
    additionalTargets?: EchoTarget[],
  ): void {
    if (!this.echolocation) return;

    // Echo-Targets aus sichtbaren Einzelfischen sammeln
    // Performance: Nur sichtbare Fische als Targets – unsichtbare (>80m)
    // können nicht getroffen werden. Spart ~50% der Targets.
    this._echoTargets.length = 0;
    for (const fish of this.soloFishes) {
      if (!fish.fishMesh || !fish.mesh.visible) continue;
      fish._echoTarget.position.copy(fish.mesh.position);
      this._echoTargets.push(fish._echoTarget);
    }

    // Echo-Targets aus Schwärmen
    // Performance: Nur den Schwarm-Mittelpunkt als Target (nicht 20 Einzelfische)
    for (const school of this.activeSchools) {
      school._echoTarget.position.set(
        school.centerX,
        school.baseY,
        school.centerZ,
      );
      this._echoTargets.push(school._echoTarget);
    }

    // ZusÃ¤tzliche Echo-Targets (z.â€¯B. Quallen von JellyWorld)
    if (additionalTargets) {
      for (const t of additionalTargets) {
        this._echoTargets.push(t);
      }
    }

    this._echoOrigin.copy(cameraPos);
    this._echoOrigin.y -= 2.0;
    this.echolocation.update(
      elapsed,
      delta,
      this._echoOrigin,
      this._echoTargets,
    );

    // Glow bei Einzelfischen
    const decay = Math.exp(-3.0 * delta);
    for (const fish of this.soloFishes) {
      if (!fish.fishMesh || !fish.originalEmissive) continue;

      fish.glowIntensity *= decay;

      if (fish.glowIntensity > 0.01) {
        const mat = fish.fishMesh.material as THREE.MeshStandardMaterial;
        this._tmpColor
          .copy(fish.originalEmissive)
          .lerp(this._glowColor, fish.glowIntensity);
        mat.emissive.copy(this._tmpColor);
        mat.emissiveIntensity = 0.2 + fish.glowIntensity * 1.8;
      } else {
        const mat = fish.fishMesh.material as THREE.MeshStandardMaterial;
        mat.emissive.copy(fish.originalEmissive!);
        mat.emissiveIntensity = 0;
      }
    }

    // Glow bei SchwÃ¤rmen
    for (const school of this.activeSchools) {
      school.glowIntensity *= decay;

      if (school.glowIntensity > 0.01) {
        const mat = school.instances.material as THREE.MeshStandardMaterial;
        this._tmpColor
          .copy(school.originalEmissive)
          .lerp(this._glowColor, school.glowIntensity);
        mat.emissive.copy(this._tmpColor);
        mat.emissiveIntensity = 0.2 + school.glowIntensity * 1.8;
      } else {
        const mat = school.instances.material as THREE.MeshStandardMaterial;
        mat.emissive = school.originalEmissive;
        mat.emissiveIntensity = 0;
      }
    }
  }
}
