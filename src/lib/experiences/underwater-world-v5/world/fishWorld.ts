/**
 * fishWorld.ts – Fisch-Integration für die Tiefsee-Unterwasserwelt
 *
 * Einzelfische (Solo) schwimmen mit Reynolds Wander Steering – einer
 * weichen, kontinuierlichen Zufallsbewegung ohne harte Target-Wechsel.
 * Schwärme (Schools) orbitieren um den Spieler in konzentrischen Ringen.
 *
 * Architektur:
 *   - orbitSwimming.ts  → Schwimm-Parameter/Zustand (für Schulen)
 *   - schoolFormation.ts → Schwarm-Formation
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
  updateSwimState,
} from "../animationen/fische/orbitSwimming";
import {
  type FormationOffset,
  type SchoolFrameFish,
  generateVFormation,
  computeSchoolFrame,
} from "../animationen/fische/schoolFormation";

/**
 * Ausschlusszone (z. B. um eine Stadtkuppel).
 * Fische sollen diese Bereiche meiden.
 */
export interface ExclusionZone {
  centerX: number;
  centerZ: number;
  radius: number;
}

// ---------------------------------------------------------------------------
// Konfiguration
// ---------------------------------------------------------------------------

export interface FishWorldConfig {
  floorY: number;
  waterY: number;
  /** Anzahl Einzelfische (Standard: 14) */
  soloCount: number;
  fishMinSize: number;
  fishMaxSize: number;
  echolocationEnabled: boolean;
  echolocationConfig?: Partial<EcholocationConfig>;
}

/** Standard-Werte */
const DEFAULT_FISH_CONFIG: FishWorldConfig = {
  floorY: -4,
  waterY: 15,
  soloCount: 14,
  fishMinSize: 1.2,
  fishMaxSize: 2.5,
  echolocationEnabled: true,
};

// ---------------------------------------------------------------------------
// Orbit-Layer-Definitionen
// ---------------------------------------------------------------------------

/**
 * Ein Orbit-Layer definiert einen konzentrischen Ring um den Spieler.
 * Jeder Layer hat eigene Radien, Höhen, Geschwindigkeiten und Anzahl Fische.
 * So entsteht ein räumlich gestaffeltes, natürliches Schwimmbild.
 */
interface OrbitLayerDef {
  minRadius: number;
  maxRadius: number;
  minYOffset: number;
  maxYOffset: number;
  minSpeed: number;
  maxSpeed: number;
  soloCount: number;
  schoolCount: number;
  schoolSize: number;
  scaleMin: number;
  scaleMax: number;
}

const ORBIT_LAYERS: OrbitLayerDef[] = [
  {
    // Layer 0: Nah (10-16m) – kleine Einzelfische
    minRadius: 10, maxRadius: 16,
    minYOffset: -2, maxYOffset: 1.5,
    minSpeed: 0.12, maxSpeed: 0.22,
    soloCount: 4, schoolCount: 0, schoolSize: 0,
    scaleMin: 0.8, scaleMax: 1.3,
  },
  {
    // Layer 1: Mittel (22-32m) – Einzelfische + kleine Schule
    minRadius: 22, maxRadius: 32,
    minYOffset: -4.5, maxYOffset: 0.5,
    minSpeed: 0.09, maxSpeed: 0.18,
    soloCount: 5, schoolCount: 1, schoolSize: 6,
    scaleMin: 1.0, scaleMax: 1.6,
  },
  {
    // Layer 2: Fern (38-50m) – wenige Einzelfische + größere Schule
    minRadius: 38, maxRadius: 50,
    minYOffset: -6, maxYOffset: -1,
    minSpeed: 0.07, maxSpeed: 0.14,
    soloCount: 3, schoolCount: 1, schoolSize: 10,
    scaleMin: 1.3, scaleMax: 1.9,
  },
  {
    // Layer 3: Tief/Fern (55-72m) – große Fische + größte Schule
    minRadius: 55, maxRadius: 72,
    minYOffset: -8, maxYOffset: -3,
    minSpeed: 0.05, maxSpeed: 0.11,
    soloCount: 2, schoolCount: 1, schoolSize: 14,
    scaleMin: 1.6, scaleMax: 2.3,
  },
];

// ---------------------------------------------------------------------------
// Wander-Steering-Parameter eines Einzelfisches
// ---------------------------------------------------------------------------

/**
 * Jeder Solo-Fisch schwimmt mit "Wander Steering":
 * Ein Zielpunkt (wanderTarget) wird zufällig innerhalb eines Ringbereichs
 * (minDist/maxDist um das gelatchte Player-Zentrum) gesetzt. Der Fisch
 * steuert sanft darauf zu. Wenn das Ziel erreicht ist oder nach einer
 * zufälligen Zeit wird ein neues Ziel gewählt.
 *
 * Vorteile gegenüber Orbit:
 * - Keine perfekten Ellipsen → natürlich wirkende Bahnen
 * - Exklusionszonen werden über Velocity-Repulsion gemieden (kein Ruckeln)
 * - Fische verteilen sich organisch im Raum
 */
interface SoloFishParams {
  layerIndex: number;

  /** Mindestabstand zum Zentrum (für Zentrierung, keine harte Grenze) */
  minDist: number;
  /** Abstand, ab dem die Zentrierung sanft eingreift */
  maxDist: number;
  /** Maximale Schwimm-Geschwindigkeit (Einheiten/s) */
  speed: number;
  /** Wie schnell der Fisch die Richtung ändert (0.1=elegant, 3.0=hektisch) */
  agility: number;

  // === ⚡ Geschwindigkeits-Modulation (Sinus-Bursts) ===
  speedModAmp: number;
  speedModFreq: number;

  // === Höhen-Varianz ===
  yOffset: number;
  yAmp: number;
  yFreq: number;

  // === Kamera-Folge (Zentrum des Wander-Rings) ===
  lagFactor: number;
  centerX: number;
  centerZ: number;

  // === Schwimm-Animation (Yaw/Pitch/Roll, Burst) ===
  swim: SwimParams;
}

// ---------------------------------------------------------------------------
// Halter für einen Einzelfisch (Rendering + Zustand)
// ---------------------------------------------------------------------------

interface SoloFish {
  mesh: THREE.Group;
  params: SoloFishParams;
  state: SwimState;

  // === Wander-Steering-Zustand ===
  vx: number;
  vz: number;
  /** Reynolds-Wander-Winkel: wird pro Frame leicht verrauscht (keine harten Targets) */
  wanderAngle: number;

  /** Accumulierter Push aus Exklusionszonen (smooth, kein Instant-Ruck) */
  pushAccumX: number;
  pushAccumZ: number;

  // Kontinuierlicher Heading (Yaw) – wird über die π/-π Grenze hinweg aufgedreht
  heading: number;

  // Glow (Echoortung)
  glowIntensity: number;
  fishMesh: THREE.Mesh | null;
  originalEmissive: THREE.Color | null;

  // Vorab erstelltes EchoTarget (keine Allokation pro Frame)
  _echoTarget: EchoTarget;
}

// ---------------------------------------------------------------------------
// Fisch-Schwarm (persistent, orbitiert um den Spieler)
// ---------------------------------------------------------------------------

interface FishSchool {
  instances: THREE.InstancedMesh;
  formation: FormationOffset[];
  fishScale: number;
  schoolId: number;

  // === Orbit-Basis ===
  radiusX: number;
  radiusZ: number;
  speed: number;
  startAngle: number;

  // === Höhen-Varianz ===
  yOffset: number;
  yAmp: number;
  yFreq: number;

  // === ⚡ NEU: Radius-Drift ===
  driftAmp: number;
  driftFreqX: number;
  driftFreqZ: number;

  // === ⚡ NEU: Zentrum-Wanderung ===
  wanderAmp: number;
  wanderFreq: number;

  // === ⚡ NEU: Geschwindigkeits-Modulation ===
  speedModAmp: number;
  speedModFreq: number;

  // === Kamera-Folge ===
  lagFactor: number;
  centerX: number;
  centerZ: number;

  // Glow
  glowIntensity: number;
  originalEmissive: THREE.Color;

  // EchoTarget
  _echoTarget: EchoTarget;
}

// ---------------------------------------------------------------------------
// Hauptklasse: FishWorld
// ---------------------------------------------------------------------------

export class FishWorld {
  private scene: THREE.Scene;
  private config: FishWorldConfig;
  private loader: GLTFLoader;

  // Einzelfische
  private soloFishes: SoloFish[] = [];
  private fishModelTemplate: THREE.Group | null = null;

  // Schwärme
  private activeSchools: FishSchool[] = [];
  private schoolFishMesh: THREE.Mesh | null = null;

  // Exklusionszonen (Stadtkuppeln)
  private _exclusionZones: ExclusionZone[] = [];

  // Echoortung
  private echolocation: EcholocationRings | null = null;
  private _echoTargets: EchoTarget[] = [];

  // Wiederverwendbare V-Formation für alle Schwärme
  private _defaultFormations: Map<number, FormationOffset[]> = new Map();

  // Wiederverwendbare Puffer für computeSchoolFrame (einer pro Schule)
  private _schoolFrameBuffers: Map<number, SchoolFrameFish[]> = new Map();
  private _nextSchoolId = 0;

  // Wiederverwendbare Vektoren/Quaternionen (kein "new" im Loop)
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

  constructor(scene: THREE.Scene, config?: Partial<FishWorldConfig>) {
    this.scene = scene;
    this.config = { ...DEFAULT_FISH_CONFIG, ...config };
    this.loader = new GLTFLoader();

    if (this.config.echolocationEnabled) {
      this.echolocation = new EcholocationRings(
        scene,
        this.config.echolocationConfig,
      );
    }
  }

  // -----------------------------------------------------------------------
  // Initialisierung (lädt das Fisch-Modell)
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

    const startPos = cameraPos ?? new THREE.Vector3(0, 4, 0);

    // --- Einzelfische pro Layer anlegen ---
    let soloIdx = 0;
    for (let l = 0; l < ORBIT_LAYERS.length; l++) {
      const layer = ORBIT_LAYERS[l];
      const count = layer.soloCount;
      for (let i = 0; i < count && soloIdx < this.config.soloCount; i++) {
        const params = this._createSoloParams(l, startPos);
        const scale = this._randomBetween(layer.scaleMin, layer.scaleMax) / maxDim;
        const fish = this._createSoloFish(params, scale, startPos);
        this.soloFishes.push(fish);
        soloIdx++;
      }
    }

    // Falls noch Slots frei sind (soloCount > Summe Layer), mit Layer 3 auffüllen
    while (soloIdx < this.config.soloCount) {
      const lastLayer = ORBIT_LAYERS.length - 1;
      const params = this._createSoloParams(lastLayer, startPos);
      const scale = this._randomBetween(
        ORBIT_LAYERS[lastLayer].scaleMin,
        ORBIT_LAYERS[lastLayer].scaleMax,
      ) / maxDim;
      const fish = this._createSoloFish(params, scale, startPos);
      this.soloFishes.push(fish);
      soloIdx++;
    }

    // --- Schwarm-Mesh extrahieren ---
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

    // --- Schwärme pro Layer anlegen (persistent!) ---
    if (this.schoolFishMesh) {
      for (let l = 0; l < ORBIT_LAYERS.length; l++) {
        const layer = ORBIT_LAYERS[l];
        for (let s = 0; s < layer.schoolCount; s++) {
          const school = this._createSchool(l, startPos, maxDim);
          this.activeSchools.push(school);
        }
      }
    }

    console.log(
      `🐟 FishWorld bereit: ${this.soloFishes.length} Einzelfische, ` +
      `${this.activeSchools.length} Schwärme`,
    );
  }

  // -----------------------------------------------------------------------
  // Update – jeden Frame von scene.ts aufgerufen
  // -----------------------------------------------------------------------

  update(
    delta: number,
    elapsed: number,
    cameraPos: THREE.Vector3,
    additionalTargets?: EchoTarget[],
  ): void {
    this._updateOrbitCenters(delta, elapsed, cameraPos);

    // Einzelfische aktualisieren
    for (const fish of this.soloFishes) {
      this._updateSoloFish(fish, delta, elapsed, cameraPos);
    }

    // Schwärme aktualisieren
    this._updateSchools(delta, elapsed, cameraPos);

    // Echoortung
    this._updateEcholocation(delta, elapsed, cameraPos, additionalTargets);
  }

  // -----------------------------------------------------------------------
  // Exklusionszonen (Fische meiden Kuppeln)
  // -----------------------------------------------------------------------

  setExclusionZones(zones: ExclusionZone[]): void {
    this._exclusionZones = zones;
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
  // Private: Helfer
  // -----------------------------------------------------------------------

  private _randomBetween(min: number, max: number): number {
    return min + Math.random() * (max - min);
  }

  private _isInExclusionZone(x: number, z: number, margin: number = 0): boolean {
    for (const zone of this._exclusionZones) {
      const dx = x - zone.centerX;
      const dz = z - zone.centerZ;
      const r = zone.radius + margin;
      if (dx * dx + dz * dz < r * r) return true;
    }
    return false;
  }

  // -----------------------------------------------------------------------
  // Private: Orbit-Parameter erzeugen
  // -----------------------------------------------------------------------

  /**
   * Erzeugt Wander-Parameter für einen Einzelfisch.
   * Fische werden im Wander-Ring (minDist–maxDist) gleichmäßig verteilt
   * initial positioniert und erhalten individuelle Geschwindigkeiten + Agilität.
   */
  private _createSoloParams(
    layerIndex: number,
    startPos: THREE.Vector3,
  ): SoloFishParams {
    const layer = ORBIT_LAYERS[layerIndex];
    const rand = Math.random;
    return {
      layerIndex,
      minDist: layer.minRadius,
      maxDist: layer.maxRadius,
      speed: this._randomBetween(0.3, 0.8),
      agility: 0.3 + rand() * 1.2,
      speedModAmp: 0.10 + rand() * 0.20,
      speedModFreq: 0.04 + rand() * 0.10,
      yOffset: this._randomBetween(layer.minYOffset, layer.maxYOffset),
      yAmp: 0.3 + rand() * 1.2,
      yFreq: 0.04 + rand() * 0.10,
      lagFactor: 0.6 + rand() * 1.2,
      centerX: startPos.x,
      centerZ: startPos.z,
      swim: createSwimParams(),
    };
  }

  /**
   * Zufällige Startposition im Ring, außerhalb aller Exklusionszonen.
   * (Nur für initiale Platzierung; das Laufzeit-Steering nutzt
   * Reynolds Wander, keine harten Weltraum-Targets.)
   */
  private _randomWanderTarget(
    centerX: number, centerZ: number,
    minDist: number, maxDist: number,
  ): { x: number; z: number } {
    for (let attempt = 0; attempt < 8; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = this._randomBetween(minDist, maxDist);
      const x = centerX + Math.cos(angle) * dist;
      const z = centerZ + Math.sin(angle) * dist;
      if (!this._isInExclusionZone(x, z, 2.0)) {
        return { x, z };
      }
    }
    // Fallback: Zentrum selbst (wird durch center-Push auch außerhalb der Zone sein)
    return { x: centerX, z: centerZ };
  }

  // -----------------------------------------------------------------------
  // Private: Einzelfisch erzeugen
  // -----------------------------------------------------------------------

  private _createSoloFish(
    params: SoloFishParams, scale: number, startPos: THREE.Vector3,
  ): SoloFish {
    const mesh = this.fishModelTemplate!.clone(true);
    mesh.scale.setScalar(scale);
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

    const state = createSwimState(0);

    // Initiale Position: zufällig im Wander-Ring
    const initTarget = this._randomWanderTarget(
      startPos.x, startPos.z, params.minDist, params.maxDist,
    );
    mesh.position.set(initTarget.x, startPos.y + params.yOffset, initTarget.z);

    // Zufällige Anfangs-Velocity
    const initAngle = Math.random() * Math.PI * 2;
    const initSpeed = params.speed * (0.5 + Math.random() * 0.5);
    this.scene.add(mesh);

    const fish: SoloFish = {
      mesh,
      params,
      state,
      vx: Math.sin(initAngle) * initSpeed,
      vz: Math.cos(initAngle) * initSpeed,
      wanderAngle: Math.random() * Math.PI * 2,
      pushAccumX: 0,
      pushAccumZ: 0,
      heading: Math.atan2(Math.sin(initAngle), -Math.cos(initAngle) + 0.0001),
      glowIntensity: 0,
      fishMesh,
      originalEmissive,
      _echoTarget: {
        position: new THREE.Vector3(),
        onHit: () => {},
      },
    };
    fish._echoTarget.onHit = (intensity: number) => {
      fish.glowIntensity = intensity;
    };
    return fish;
  }

  // -----------------------------------------------------------------------
  // Private: School erzeugen (persistent)
  // -----------------------------------------------------------------------

  private _createSchool(
    layerIndex: number, startPos: THREE.Vector3, maxDim: number,
  ): FishSchool {
    const layer = ORBIT_LAYERS[layerIndex];
    const schoolSize = layer.schoolSize;
    const rand = Math.random;

    // Formation für diese Schulgröße (cached)
    if (!this._defaultFormations.has(schoolSize)) {
      this._defaultFormations.set(schoolSize, generateVFormation(schoolSize));
    }
    const formation = this._defaultFormations.get(schoolSize)!;

    // Frame-Puffer für diese Schule
    const schoolId = this._nextSchoolId++;
    const buf: SchoolFrameFish[] = [];
    for (let j = 0; j < schoolSize; j++) {
      buf.push({ fx: 0, fy: 0, fz: 0, yawVariation: 0, pitch: 0, roll: 0 });
    }
    this._schoolFrameBuffers.set(schoolId, buf);

    // InstancedMesh
    const mat = (
      this.schoolFishMesh!.material as THREE.MeshStandardMaterial
    ).clone();
    mat.transparent = true;
    const instances = new THREE.InstancedMesh(
      this.schoolFishMesh!.geometry,
      mat,
      schoolSize,
    );
    instances.castShadow = true;
    instances.receiveShadow = true;
    instances.frustumCulled = false;
    this.scene.add(instances);

    const scale = this._randomBetween(layer.scaleMin, layer.scaleMax) / maxDim;
    const radius = this._randomBetween(layer.minRadius, layer.maxRadius);

    const school: FishSchool = {
      instances,
      formation,
      fishScale: scale,
      schoolId,
      radiusX: radius,
      radiusZ: radius * (0.85 + rand() * 0.3),
      speed: this._randomBetween(layer.minSpeed, layer.maxSpeed) * 0.25,
      startAngle: rand() * Math.PI * 2,
      yOffset: this._randomBetween(layer.minYOffset, layer.maxYOffset),
      yAmp: 0.2 + rand() * 1.0,
      yFreq: 0.04 + rand() * 0.08,

      // Radius drift
      driftAmp: 0.5 + rand() * 2.0,
      driftFreqX: 0.03 + rand() * 0.06,
      driftFreqZ: 0.04 + rand() * 0.07,

      // Zentrum-Wanderung
      wanderAmp: 0.3 + rand() * 1.5,
      wanderFreq: 0.02 + rand() * 0.05,

      // Geschwindigkeits-Modulation
      speedModAmp: 0.05 + rand() * 0.10,
      speedModFreq: 0.04 + rand() * 0.10,

      lagFactor: 0.5 + rand() * 1.0,
      centerX: startPos.x,
      centerZ: startPos.z,
      glowIntensity: 0,
      originalEmissive: mat.emissive?.clone() ?? new THREE.Color(0x000000),
      _echoTarget: {
        position: new THREE.Vector3(),
        onHit: (intensity: number) => {
          school.glowIntensity = intensity;
        },
      },
    };

    return school;
  }

  // -----------------------------------------------------------------------
  // Private: Orbit-Zentren sanft zur Spieler-Position führen
  // -----------------------------------------------------------------------

  /**
   * Führt das Wander-Zentrum jedes Fisches/Schwarms mit langsamer
   * Trägheit zur Kamera (Zeitkonstante ~4s).
   *
   * Wichtig: KEINE Zone-Repulsion auf das Zentrum – das erzeugt nur
   * Oszillation. Stattdessen werden nur die Wander-Targets so gewählt,
   * dass sie außerhalb aller Zonen liegen (safe target selection).
   *
   * Solo-Fische: Das Zentrum definiert den Mittelpunkt des Wander-Rings.
   * Schulen:     Das Zentrum ist der Orbit-Mittelpunkt.
   */
  private _updateOrbitCenters(
    delta: number, elapsed: number, cameraPos: THREE.Vector3,
  ): void {
    const dt = Math.min(delta, 0.1);

    for (const fish of this.soloFishes) {
      const p = fish.params;
      const rate = 0.2 * p.lagFactor;
      const lf = 1 - Math.exp(-rate * dt);
      p.centerX += (cameraPos.x - p.centerX) * lf;
      p.centerZ += (cameraPos.z - p.centerZ) * lf;
    }

    for (const school of this.activeSchools) {
      const rate = 0.3 * school.lagFactor;
      const lf = 1 - Math.exp(-rate * dt);
      school.centerX += (cameraPos.x - school.centerX) * lf;
      school.centerZ += (cameraPos.z - school.centerZ) * lf;

      // Schul-Zentren von Zonen wegdrücken (nur Schulen, da Orbit-Modell)
      if (this._exclusionZones.length > 0) {
        for (const zone of this._exclusionZones) {
          const dx = school.centerX - zone.centerX;
          const dz = school.centerZ - zone.centerZ;
          const distSq = dx * dx + dz * dz;
          const minDist = zone.radius + Math.max(school.radiusX, school.radiusZ) + 4.0;
          if (distSq < minDist * minDist && distSq > 0.01) {
            const dist = Math.sqrt(distSq);
            const push = (minDist - dist) * 2.0 * dt;
            school.centerX += (dx / dist) * push;
            school.centerZ += (dz / dist) * push;
          }
        }
      }

      const wa = school.wanderAmp * dt;
      school.centerX += Math.sin(elapsed * school.wanderFreq * Math.PI * 2 + school.startAngle) * wa;
      school.centerZ += Math.cos(elapsed * school.wanderFreq * 0.7 * Math.PI * 2 + school.startAngle) * wa;
    }
  }

  // -----------------------------------------------------------------------
  // Private: Einzelfisch animieren
  // -----------------------------------------------------------------------

  /**
   * Reynolds Wander Steering – erweitert um 4 Verbesserungen:
   *
   * 1. ⚡ Speed-Modulation: Sinus-Bursts wie bei Schwärmen (0.10–0.30)
   * 2. ⚡ orbitSwimming angebunden: Yaw/Pitch/Roll + Burst-and-Glide
   * 3. ⚡ Accumulierter Exklusionszonen-Push (kein Instant-Ruck)
   * 4. ⚡ Speed-Dampening bei scharfen Kurswechseln
   */
  private _updateSoloFish(
    fish: SoloFish,
    delta: number,
    elapsed: number,
    cameraPos: THREE.Vector3,
  ): void {
    const p = fish.params;
    const dt = Math.min(delta, 0.05);
    const pos = fish.mesh.position;

    // ═══ 1. Speed-Modulation (Burst-and-Glide) ═══
    // Burst-Phase aus orbitSwimming: bei "burst" gibts einen extra Schub
    const bursting = elapsed % p.swim.burstInt < p.swim.burstDur;
    const burstMul = bursting ? 1.2 : 1.0;
    const speedMod =
      1.0 +
      Math.sin(elapsed * p.speedModFreq * Math.PI * 2) * p.speedModAmp;
    const currentSpeed = p.speed * burstMul * speedMod;

    // ═══ 2. Reynolds Wander Steering ═══
    fish.wanderAngle += (Math.random() - 0.5) * p.agility * 2.0 * dt;

    const vLen = Math.sqrt(fish.vx * fish.vx + fish.vz * fish.vz);
    const fwdX = vLen > 0.01 ? fish.vx / vLen : Math.sin(fish.heading);
    const fwdZ = vLen > 0.01 ? fish.vz / vLen : -Math.cos(fish.heading);

    const wDist = 8.0;
    const wRad = 4.0;
    const cX = pos.x + fwdX * wDist;
    const cZ = pos.z + fwdZ * wDist;
    let tX = cX + Math.cos(fish.wanderAngle) * wRad;
    let tZ = cZ + Math.sin(fish.wanderAngle) * wRad;

    // Sanfte Zentrierung
    const centerDx = p.centerX - pos.x;
    const centerDz = p.centerZ - pos.z;
    const centerDist = Math.sqrt(centerDx * centerDx + centerDz * centerDz);
    if (centerDist > p.maxDist) {
      const pull = (centerDist - p.maxDist) * 0.15;
      tX += (centerDx / centerDist) * pull;
      tZ += (centerDz / centerDist) * pull;
    }

    // ═══ 3. Accumulierter Exklusionszonen-Push (kein Instant-Ruck) ═══
    // Statt das Target sofort wegzudrücken (→ ruckartige Kurven),
    // berechnen wir einen Ziel-Push und lerpen den accumulated push dorthin.
    let targetPushX = 0;
    let targetPushZ = 0;
    if (this._exclusionZones.length > 0) {
      for (const zone of this._exclusionZones) {
        const zx = tX - zone.centerX;
        const zz = tZ - zone.centerZ;
        const zDistSq = zx * zx + zz * zz;
        const effectRadius = zone.radius + 3.0;
        if (zDistSq < effectRadius * effectRadius && zDistSq > 0.01) {
          const zDist = Math.sqrt(zDistSq);
          const overlap = 1 - zDist / effectRadius; // 0..1
          const push = overlap * 3.0;
          targetPushX += (zx / zDist) * push;
          targetPushZ += (zz / zDist) * push;
        }
      }
    }

    // Accumulierten Push sanft zum Ziel-Push führen
    const pushLerp = 1 - Math.exp(-3.0 * dt);
    fish.pushAccumX += (targetPushX - fish.pushAccumX) * pushLerp;
    fish.pushAccumZ += (targetPushZ - fish.pushAccumZ) * pushLerp;

    // Decay wenn kein Push nötig
    if (targetPushX === 0 && targetPushZ === 0) {
      fish.pushAccumX *= Math.exp(-2.0 * dt);
      fish.pushAccumZ *= Math.exp(-2.0 * dt);
    }

    tX += fish.pushAccumX;
    tZ += fish.pushAccumZ;

    // ═══ 4. Steering-Vektor ═══
    const tdx = tX - pos.x;
    const tdz = tZ - pos.z;
    const targetDist = Math.sqrt(tdx * tdx + tdz * tdz) || 0.001;
    const steerX = tdx / targetDist;
    const steerZ = tdz / targetDist;

    // ═══ 5. Speed-Dampening bei scharfen Kurven ═══
    // Echte Fische bremsen in Kurven. Wenn der Winkel zwischen aktueller
    // Flugrichtung und Steering-Richtung > 30° (0.5 rad), wird runtergebremst.
    const cosDiff = fwdX * steerX + fwdZ * steerZ;
    const angleDiff = Math.acos(Math.max(-1, Math.min(1, cosDiff)));
    const speedDamp = angleDiff > 0.5
      ? Math.max(0.4, 1.0 - (angleDiff - 0.5) * 0.8)
      : 1.0;
    const adjSpeed = currentSpeed * speedDamp;

    // ═══ 6. Steering-Velocity (Lerp zur Ziel-Richtung) ═══
    const steerLerp = 1 - Math.exp(-p.agility * 4.0 * dt);
    const targetVx = steerX * adjSpeed;
    const targetVz = steerZ * adjSpeed;
    fish.vx += (targetVx - fish.vx) * steerLerp;
    fish.vz += (targetVz - fish.vz) * steerLerp;

    // ═══ 7. Velocity limitieren + anwenden ═══
    const newVLen = Math.sqrt(fish.vx * fish.vx + fish.vz * fish.vz);
    if (newVLen > currentSpeed) {
      fish.vx = (fish.vx / newVLen) * currentSpeed;
      fish.vz = (fish.vz / newVLen) * currentSpeed;
    }
    pos.x += fish.vx * dt;
    pos.z += fish.vz * dt;

    // ═══ 8. Y-Position ═══
    const playerY = cameraPos.y;
    const rawY =
      playerY +
      p.yOffset +
      Math.sin(elapsed * p.yFreq * Math.PI * 2) * p.yAmp;
    const clampedY = Math.max(
      this.config.floorY + 2.0,
      Math.min(this.config.waterY - 0.5, rawY),
    );
    const yLerp = 1 - Math.exp(-5.0 * dt);
    fish.state.curY += (clampedY - fish.state.curY) * yLerp;
    pos.y = fish.state.curY;

    // ═══ 9. Heading (Yaw) aus Velocity – kein π-Sprung ═══
    if (vLen > 0.01) {
      const rawYaw = Math.atan2(fish.vx, -fish.vz + 0.0001);
      let diff = rawYaw - fish.heading;
      if (diff > Math.PI) diff -= Math.PI * 2;
      if (diff < -Math.PI) diff += Math.PI * 2;
      fish.heading += diff;
    }

    // ═══ 10. orbitSwimming: Yaw/Pitch/Roll-Animation + Burst ═══
    updateSwimState(p.swim, fish.state, delta, elapsed, fish.wanderAngle);

    // ═══ 11. Rotation anwenden (TSL kümmert sich um die Vertex-Deformation) ═══
    fish.mesh.rotation.set(0, 0, 0);
    fish.mesh.rotateY(fish.heading + fish.state.yaw);
    fish.mesh.rotateX(fish.state.pitch);
    fish.mesh.rotateZ(fish.state.roll);
  }

  // -----------------------------------------------------------------------
  // Private: Schwärme aktualisieren
  // -----------------------------------------------------------------------

  private _updateSchools(
    delta: number,
    elapsed: number,
    cameraPos: THREE.Vector3,
  ): void {
    for (const school of this.activeSchools) {
      // ═══ Radius-Drift für die Schulbahn ═══
      const driftX = Math.sin(elapsed * school.driftFreqX * Math.PI * 2) * school.driftAmp;
      const driftZ = Math.sin(elapsed * school.driftFreqZ * Math.PI * 2) * school.driftAmp;
      const rX = school.radiusX + driftX;
      const rZ = school.radiusZ + driftZ;

      // ═══ Geschwindigkeits-Modulation ═══
      const speedMod = 1.0 + Math.sin(elapsed * school.speedModFreq * Math.PI * 2) * school.speedModAmp;
      const currentSpeed = school.speed * speedMod;

      // School-Y: Höhen-Offset + vertikale Oszillation
      const schoolY = cameraPos.y + school.yOffset +
        Math.sin(elapsed * school.yFreq * Math.PI * 2) * school.yAmp;
      const clampedY = Math.max(
        this.config.floorY + 2.0,
        Math.min(this.config.waterY - 0.5, schoolY),
      );

      // Vorab alloziierten Frame-Puffer für diese Schule abrufen
      const schoolBuf = this._schoolFrameBuffers.get(school.schoolId);
      if (!schoolBuf) continue;

      const baseYaw = computeSchoolFrame(
        school.formation,
        elapsed,
        school.centerX,
        school.centerZ,
        clampedY,
        rX,
        rZ,
        currentSpeed,
        school.startAngle,
        0,
        0,
        this.config.floorY,
        schoolBuf,
      );

      // ═══ Sanfter radialer Push aus Exklusionszonen (quadratisch = weicher Rand) ═══
      if (this._exclusionZones.length > 0) {
        for (let j = 0; j < schoolBuf.length; j++) {
          const f = schoolBuf[j];
          for (const zone of this._exclusionZones) {
            const dx = f.fx - zone.centerX;
            const dz = f.fz - zone.centerZ;
            const distSq = dx * dx + dz * dz;
            const effectRadius = zone.radius + 3.0;
            if (distSq < effectRadius * effectRadius && distSq > 0.01) {
              const dist = Math.sqrt(distSq);
              const overlap = 1 - dist / effectRadius; // 0..1
              const strength = overlap * overlap; // quadratisch = sanfter Einstieg
              const pushDist = strength * 2.5;
              f.fx += (dx / dist) * pushDist;
              f.fz += (dz / dist) * pushDist;
              f.fy = Math.max(f.fy, this.config.floorY + 2.0 + strength * 4.0);
            }
          }
        }
      }

      // Matrizen setzen
      const scale = school.fishScale;
      for (let j = 0; j < schoolBuf.length; j++) {
        const f = schoolBuf[j];

        this._tmpVec3.set(f.fx, f.fy, f.fz);

        this._tmpQuat.identity();
        this._tmpQuatA.setFromAxisAngle(this._up, baseYaw + f.yawVariation);
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
  // Private: Echoortung
  // -----------------------------------------------------------------------

  private _updateEcholocation(
    delta: number,
    elapsed: number,
    cameraPos: THREE.Vector3,
    additionalTargets?: EchoTarget[],
  ): void {
    if (!this.echolocation) return;

    // Echo-Targets sammeln
    this._echoTargets.length = 0;
    for (const fish of this.soloFishes) {
      if (!fish.fishMesh) continue;
      fish._echoTarget.position.copy(fish.mesh.position);
      this._echoTargets.push(fish._echoTarget);
    }
    for (const school of this.activeSchools) {
      school._echoTarget.position.set(
        school.centerX,
        cameraPos.y + school.yOffset,
        school.centerZ,
      );
      this._echoTargets.push(school._echoTarget);
    }
    if (additionalTargets) {
      for (const t of additionalTargets) {
        this._echoTargets.push(t);
      }
    }

    this._echoOrigin.copy(cameraPos);
    this._echoOrigin.y -= 2.0;
    this.echolocation.update(
      elapsed, delta, this._echoOrigin, this._echoTargets,
    );

    // Glow decay
    const decay = Math.exp(-3.0 * delta);
    for (const fish of this.soloFishes) {
      if (!fish.fishMesh || !fish.originalEmissive) continue;
      fish.glowIntensity *= decay;
      const mat = fish.fishMesh.material as THREE.MeshStandardMaterial;
      if (fish.glowIntensity > 0.01) {
        this._tmpColor
          .copy(fish.originalEmissive)
          .lerp(this._glowColor, fish.glowIntensity);
        mat.emissive.copy(this._tmpColor);
        mat.emissiveIntensity = 0.2 + fish.glowIntensity * 1.8;
      } else {
        mat.emissive.copy(fish.originalEmissive);
        mat.emissiveIntensity = 0;
      }
    }
    for (const school of this.activeSchools) {
      school.glowIntensity *= decay;
      const mat = school.instances.material as THREE.MeshStandardMaterial;
      if (school.glowIntensity > 0.01) {
        this._tmpColor
          .copy(school.originalEmissive)
          .lerp(this._glowColor, school.glowIntensity);
        mat.emissive.copy(this._tmpColor);
        mat.emissiveIntensity = 0.2 + school.glowIntensity * 1.8;
      } else {
        mat.emissive = school.originalEmissive;
        mat.emissiveIntensity = 0;
      }
    }
  }
}
