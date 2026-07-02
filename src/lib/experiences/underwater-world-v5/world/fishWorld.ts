/**
 * fishWorld.ts – Fisch-Integration für die Tiefsee-Unterwasserwelt
 *
 * Importiert die reine Bewegungs-Mathematik aus animationen/fische/ und
 * kümmert sich um Three.js-Rendering, Exklusionszonen und Echoortung.
 *
 * Modularer Aufbau:
 *   - orbitSwimming.ts  → Solo-Fisch-Animation (Carangiform + Burst)
 *   - schoolFormation.ts → Schwarm-Formation (V-Formation, Ellipsen-Bahn)
 *   - fishWorld.ts       → World-Management + Three.js-Integration
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
 * Lokaler Typ für eine Ausschlusszone (z. B. um eine Stadtkuppel).
 * Städte werden in diesen Zonen platziert – Fische sollen sie meiden.
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
 * Einstellungen für das Fisch-System in der Welt.
 * Alle Werte sind auf die Tiefsee-Unterwasserwelt abgestimmt.
 */
export interface FishWorldConfig {
  /** Y-Bereich: Boden (Fische schwimmen oberhalb) */
  floorY: number;
  /** Y-Bereich: Wasseroberfläche (Fische bleiben darunter) */
  waterY: number;
  /** Welt-Größe (XZ-Bereich für zufällige Positionen) */
  worldRadius: number;
  /** Anzahl Einzelfische, die dauerhaft herumschwimmen */
  soloCount: number;
  /** Minimale Fisch-Größe in Einheiten */
  fishMinSize: number;
  /** Maximale Fisch-Größe in Einheiten */
  fishMaxSize: number;
  /** Schwarm erscheint alle … Sekunden (Intervall, zufällig) */
  schoolIntervalMin: number;
  schoolIntervalMax: number;
  /** Schwarm bleibt … Sekunden sichtbar */
  schoolDurationMin: number;
  schoolDurationMax: number;
  /** Anzahl Fische pro Schwarm */
  schoolSize: number;
  /** Echoortung aktivieren? (Ringe + Aufleuchten bei Treffer) */
  echolocationEnabled: boolean;
  /** Echoortungs-Konfiguration (optional) */
  echolocationConfig?: Partial<EcholocationConfig>;
}

/** Standard-Werte – passend zur Tiefsee-Welt */
const DEFAULT_FISH_CONFIG: FishWorldConfig = {
  floorY: -4,
  waterY: 15,
  worldRadius: 50,
  soloCount: 6,
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
 * Nur die Orbit-spezifischen Felder – die Schwimm-Animation (Yaw/Pitch/Roll
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
}

// ---------------------------------------------------------------------------
// FischSchwarm – Vergänglicher Formations-Schwarm
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

  // --- Schwärme ---
  private activeSchools: FishSchool[] = [];
  private nextSchoolTime: number = 0;
  private schoolFishMesh: THREE.Mesh | null = null;
  private schoolFishScale: number = 1.0;

  // --- Exklusionszonen (Kuppeln, die Fische meiden) ---
  private _exclusionZones: ExclusionZone[] = [];

  // --- Echoortung ---
  private echolocation: EcholocationRings | null = null;
  private _echoTargets: EchoTarget[] = [];

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
  private _tmpSchoolCenter = new THREE.Vector3();

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
  // Initialisierung (async – lädt das Fisch-Modell)
  // -----------------------------------------------------------------------

  async init(cameraPos?: THREE.Vector3): Promise<void> {
    console.log("🐟 FishWorld: Lade Fisch-Modell...");

    this.fishModelTemplate = await this._loadFishModel(
      "/3D Modelle/fish/Fish(3).glb",
    );

    if (!this.fishModelTemplate) {
      console.warn("⚠️ FishWorld: Fisch-Modell konnte nicht geladen werden!");
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

    // Schwarm-Mesh für InstancedMesh extrahieren
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

    this._scheduleNextSchool();

    console.log(
      `🐟 FishWorld bereit: ${this.config.soloCount} Einzelfische, ` +
        `Schwärme alle ${this.config.schoolIntervalMin}–${this.config.schoolIntervalMax}s`,
    );
  }

  // -----------------------------------------------------------------------
  // Update – jeden Frame von der Render-Loop aufrufen
  // -----------------------------------------------------------------------

  /**
   * @param additionalTargets – Optionale zusätzliche Echo-Ziele (z. B. von Quallen)
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
  // Aufräumen
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
          console.error("❌ FishWorld: Fehler beim Laden:", err);
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

    return {
      mesh,
      params,
      state,
      glowIntensity: 0,
      fishMesh,
      originalEmissive,
      repelCooldown: 0,
    };
  }

  /**
   * Positioniert einen Fisch in Kameranähe (25-40m) auf einer neuen Ellipse,
   * die garantiert außerhalb aller Kuppeln liegt.
   */
  private _positionFishAt(
    fish: SoloFish,
    cameraPos: THREE.Vector3,
    minDist?: number,
    maxDist?: number,
  ): void {
    const p = fish.params;
    const mind = minDist ?? 25;
    const maxd = maxDist ?? 40;

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

    // State zurücksetzen
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
        const dist = Math.sqrt(dx2 * dx2 + dz2 * dz2) || 0.001;
        const minDist = zone.radius + 7;
        if (dist < minDist) {
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
        const dist3 = Math.sqrt(dx3 * dx3 + dz3 * dz3) || 0.001;
        if (dist3 < zone.radius) {
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
    const minSpawnDist = 15;
    const maxSpawnDist = 35;
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
  // Private: Schwärme verwalten
  // -----------------------------------------------------------------------

  private _scheduleNextSchool(): void {
    const { schoolIntervalMin, schoolIntervalMax } = this.config;
    const interval =
      schoolIntervalMin +
      Math.random() * (schoolIntervalMax - schoolIntervalMin);
    this.nextSchoolTime = performance.now() + interval * 1000;
  }

  private _spawnSchool(cameraPos: THREE.Vector3): void {
    if (!this.schoolFishMesh) return;

    const { schoolSize } = this.config;
    const rand = Math.random;

    // V-Formation aus dem Modul erzeugen
    const formation = generateVFormation(schoolSize);

    // Gültige Startposition außerhalb aller Kuppeln finden
    const { x: validX, z: validZ } = this._findValidPosition(
      cameraPos.x,
      cameraPos.z,
      12,
      20,
    );

    // Material klonen (jeder Schwarm braucht eigene Instanz für Glow)
    const schoolMat = (
      this.schoolFishMesh.material as THREE.MeshStandardMaterial
    ).clone();
    schoolMat.transparent = true;
    schoolMat.opacity = 0;

    // InstancedMesh erstellen
    const instances = new THREE.InstancedMesh(
      this.schoolFishMesh.geometry,
      schoolMat,
      schoolSize,
    );
    instances.castShadow = true;
    instances.receiveShadow = true;
    // Frustum-Culling deaktivieren – die Instanzen werden über die Matrizen
    // einzeln positioniert, aber der Bounding-Sphere der Geometrie ist winzig.
    // Ohne diese Zeile verschwindet der ganze Schwarm sobald dieser winzige
    // Sphere außerhalb des Kamera-Frustums liegt (Winkel-abhängiges Flackern).
    instances.frustumCulled = false;

    this.scene.add(instances);

    const origEmissive =
      (schoolMat as THREE.MeshStandardMaterial).emissive?.clone() ??
      new THREE.Color(0x000000);

    const fadeMs = 2000;

    this.activeSchools.push({
      instances,
      fadeStartedAt: 0,
      spawnAt: performance.now(),
      fadeDuration: fadeMs,
      fishScale: this.schoolFishScale,
      glowIntensity: 0,
      originalEmissive: origEmissive,
      // Formation aus dem Modul
      formation,
      // Ellipsenbahn
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
    });
  }

  private _updateSchools(
    delta: number,
    elapsed: number,
    cameraPos: THREE.Vector3,
  ): void {
    const now = performance.now();

    if (now >= this.nextSchoolTime && this.activeSchools.length < 2) {
      this._spawnSchool(cameraPos);
      this._scheduleNextSchool();
    }

    const scale = this.schoolFishScale;
    const despawnDistSq = 65 * 65;

    for (let i = this.activeSchools.length - 1; i >= 0; i--) {
      const school = this.activeSchools[i];
      const mat = school.instances.material as THREE.MeshStandardMaterial;

      // Distanz zur Kamera prüfen
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
          this.scene.remove(school.instances);
          school.instances.dispose();
          this.activeSchools.splice(i, 1);
          continue;
        }
        opacity = 1 - fadeElapsed / school.fadeDuration;
      } else {
        school.fadeStartedAt = 0;
      }

      mat.opacity = opacity;

      // Frame-Daten aus dem Modul berechnen
      const frame = computeSchoolFrame(
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
      );

      // Matrizen für jeden Fisch setzen
      for (let j = 0; j < frame.fish.length; j++) {
        const f = frame.fish[j];

        this._tmpVec3.set(f.fx, f.fy, f.fz);

        // Quaternion: Yaw → Pitch → Roll
        this._tmpQuat.identity();
        this._tmpQuatA.setFromAxisAngle(
          this._up,
          frame.baseYaw + f.yawVariation,
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
  // Private: Echoortung – Ringe aussenden + Glow-Effekt
  // -----------------------------------------------------------------------

  private _updateEcholocation(
    delta: number,
    elapsed: number,
    cameraPos: THREE.Vector3,
    additionalTargets?: EchoTarget[],
  ): void {
    if (!this.echolocation) return;

    // Echo-Targets aus Einzelfischen sammeln
    this._echoTargets.length = 0;
    for (const fish of this.soloFishes) {
      if (!fish.fishMesh) continue;
      this._echoTargets.push({
        position: fish.mesh.position,
        onHit: () => {
          fish.glowIntensity = 1.0;
        },
      });
    }

    // Echo-Targets aus Schwärmen (wiederverwendeter Vector3 – kein GC!)
    for (const school of this.activeSchools) {
      this._echoTargets.push({
        position: this._tmpSchoolCenter.set(
          school.centerX,
          school.baseY,
          school.centerZ,
        ),
        onHit: () => {
          school.glowIntensity = 1.0;
        },
      });
    }

    // Zusätzliche Echo-Targets (z. B. Quallen von JellyWorld)
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
        mat.emissive = this._tmpColor.clone();
        mat.emissiveIntensity = 0.2 + fish.glowIntensity * 1.8;
      } else {
        const mat = fish.fishMesh.material as THREE.MeshStandardMaterial;
        mat.emissive = fish.originalEmissive;
        mat.emissiveIntensity = 0;
      }
    }

    // Glow bei Schwärmen
    for (const school of this.activeSchools) {
      school.glowIntensity *= decay;

      if (school.glowIntensity > 0.01) {
        const mat = school.instances.material as THREE.MeshStandardMaterial;
        this._tmpColor
          .copy(school.originalEmissive)
          .lerp(this._glowColor, school.glowIntensity);
        mat.emissive = this._tmpColor.clone();
        mat.emissiveIntensity = 0.2 + school.glowIntensity * 1.8;
      } else {
        const mat = school.instances.material as THREE.MeshStandardMaterial;
        mat.emissive = school.originalEmissive;
        mat.emissiveIntensity = 0;
      }
    }
  }
}
