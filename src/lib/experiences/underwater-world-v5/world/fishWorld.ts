/**
 * fishWorld.ts – Fisch-Integration für die Tiefsee-Unterwasserwelt
 *
 * Einzelfische (Solo) schwimmen mit Reynolds Wander Steering + smooth
 * Sinus-Überlagerung (kein Random im Frame-Loop).
 * Schwärme (Schools) nutzen ebenfalls Smooth Wander + per-fish Offsets
 * + einfache Separation – kein Orbit mehr.
 *
 * Architektur:
 *   - orbitSwimming.ts → Yaw/Pitch/Roll-Animation + Burst-and-Glide
 *   - fishWorld.ts     → World-Management + Three.js-Integration
 *   - schoolFormation.ts nicht mehr benötigt (Separation inline)
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
  /** Smooth Wander-Winkel: Sinus-Überlagerung statt Random */
  wanderAngle: number;
  /** Phase für die zwei Sinus-Wellen (einmal in init() gesetzt) */
  wanderPhase: number;

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
// Per-Fish-Offset für Schulen (lokale Position relativ zum Schul-Zentrum)
// ---------------------------------------------------------------------------

interface SchoolFishOffsets {
  /** Abstand vom Schul-Zentrum */
  dist: number;
  /** Aktueller Winkel um das Zentrum (rad) */
  angle: number;
  /** Vertikaler Offset */
  ly: number;
  /** Phase für individuelle Schwimm-Animation */
  phase: number;
  /** Geschwindigkeits-Faktor der Rotation (0.8–1.2) */
  speedFactor: number;
}

// ---------------------------------------------------------------------------
// Fisch-Schwarm (persistent, smooth wander + lightweight Boids)
// ---------------------------------------------------------------------------

interface FishSchool {
  instances: THREE.InstancedMesh;
  fishScale: number;
  schoolId: number;

  // === Pro-Fisch Offsets (persistent) ===
  fishOffsets: SchoolFishOffsets[];

  // === Smooth Wander ===
  wanderPhase: number;
  wanderRange: number;

  // === Kamera-Folge ===
  lagFactor: number;
  centerX: number;
  centerZ: number;

  // === Höhen-Varianz ===
  yOffset: number;
  yAmp: number;
  yFreq: number;

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

  /** Abstand, ab dem Fische zurÃ¼ck zum Spieler teleportiert werden */
  private static readonly RESPAWN_DIST = 65;
  /** Abstand, ab dem Fische um eine Stadt kreisen */
  private static readonly CITY_ATTRACTION_DIST = 35;

  // Exklusionszonen (Stadtkuppeln)
  private _exclusionZones: ExclusionZone[] = [];

  // Echoortung
  private echolocation: EcholocationRings | null = null;
  private _echoTargets: EchoTarget[] = [];

  // Wiederverwendbare Puffer
  private _nextSchoolId = 0;

  /** Pre-allocierte Separation-Puffer (max 14 Fische pro Schule) */
  private _sepPushX: number[] = new Array(14).fill(0);
  private _sepPushZ: number[] = new Array(14).fill(0);

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
  // WFC-Callback: Neue Fische an einem FISCH-Chunk spawnen
  // -----------------------------------------------------------------------

  /**
   * Wird vom ChunkManager/Scene aufgerufen, wenn ein FISCH-Chunk kollabiert.
   * Erzeugt 2-3 Einzelfische + 1 Schule an dieser Position.
   */
  public registerFishAtChunk(cx: number, cz: number): void {
    if (!this.fishModelTemplate || !this.schoolFishMesh) return;
    const cs = 16;
    const worldX = cx * cs + cs / 2;
    const worldZ = cz * cs + cs / 2;

    const box = new THREE.Box3().setFromObject(this.fishModelTemplate);
    const size = new THREE.Vector3();
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z);

    // 2-3 Einzelfische
    const count = 2 + Math.floor(Math.random() * 2);
    for (let i = 0; i < count; i++) {
      const layerIdx = Math.floor(Math.random() * ORBIT_LAYERS.length);
      const layer = ORBIT_LAYERS[layerIdx];
      const params = this._createSoloParams(layerIdx, new THREE.Vector3(worldX, 0, worldZ));
      params.centerX = worldX + (Math.random() - 0.5) * 10;
      params.centerZ = worldZ + (Math.random() - 0.5) * 10;
      const scale = this._randomBetween(layer.scaleMin, layer.scaleMax) / maxDim;
      const fish = this._createSoloFish(params, scale, new THREE.Vector3(worldX, 0, worldZ));
      this.soloFishes.push(fish);
    }

    // 1 Schule
    const school = this._createSchool(
      Math.floor(Math.random() * ORBIT_LAYERS.length),
      new THREE.Vector3(worldX, 0, worldZ),
      maxDim,
    );
    school.centerX = worldX;
    school.centerZ = worldZ;
    this.activeSchools.push(school);
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
      wanderPhase: Math.random() * Math.PI * 2,
      pushAccumX: 0,
      pushAccumZ: 0,
      heading: Math.atan2(Math.sin(initAngle), Math.cos(initAngle) + 0.0001),
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

    // Persistente lokale Offsets für jeden Fisch im Schwarm
    // Jeder Fisch hat einen zufälligen Abstand und Winkel zum Schul-Zentrum.
    // Der Winkel rotiert langsam – so entsteht eine natürliche, lockere Schul-Formation.
    const fishOffsets: SchoolFishOffsets[] = [];
    for (let j = 0; j < schoolSize; j++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = 1.0 + Math.random() * 5.0; // 1–6m vom Zentrum
      fishOffsets.push({
        dist,
        angle,
        ly: (Math.random() - 0.5) * 2.0,
        phase: Math.random() * Math.PI * 2,
        speedFactor: 0.5 + Math.random() * 1.0, // 0.5–1.5 = breite Streuung
      });
    }

    const schoolId = this._nextSchoolId++;
    const school: FishSchool = {
      instances,
      fishScale: scale,
      schoolId,
      fishOffsets,
      wanderPhase: Math.random() * Math.PI * 2,
      wanderRange: 8 + Math.random() * 8, // 8–16m
      lagFactor: 0.5 + Math.random() * 1.0,
      centerX: startPos.x,
      centerZ: startPos.z,
      yOffset: this._randomBetween(layer.minYOffset, layer.maxYOffset),
      yAmp: 0.2 + Math.random() * 1.0,
      yFreq: 0.04 + Math.random() * 0.08,
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
   * Fische sind NICHT mehr an den Spieler gebunden. Ihre Zentren
   * bleiben auf ihrer ursprünglichen Welt-Position.
   * Nur wenn ein Fisch > 65m vom Spieler entfernt ist, wird er
   * in die Blickrichtung des Spielers vorgeholt ("Respawn").
   * Das simuliert natürlich wirkende Fische, die von Chunk zu Chunk
   * schwimmen, ohne den Spieler zu verfolgen.
   */
  private _updateOrbitCenters(
    delta: number, elapsed: number, cameraPos: THREE.Vector3,
  ): void {
    const cs = 16;
    for (const fish of this.soloFishes) {
      const p = fish.params;
      const dx = p.centerX - cameraPos.x;
      const dz = p.centerZ - cameraPos.z;
      if (dx * dx + dz * dz > FishWorld.RESPAWN_DIST * FishWorld.RESPAWN_DIST) {
        // Neues Zentrum: zufällig in Blickrichtung + seitlichem Offset
        const angle = Math.atan2(cameraPos.x - p.centerX, cameraPos.z - p.centerZ);
        const spawnDist = 15 + Math.random() * 25;
        const spreadAngle = (Math.random() - 0.5) * Math.PI * 1.5;
        p.centerX = cameraPos.x + Math.sin(angle + spreadAngle) * spawnDist;
        p.centerZ = cameraPos.z + Math.cos(angle + spreadAngle) * spawnDist;
      }
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

    // ═══ 2. Reynolds Wander (smooth Sinus-Überlagerung) ═══
    // Der Wander-Winkel ändert sich smooth – kein Random, kein Ruckeln.
    // Das Ziel ist immer VOR dem Fisch in seiner aktuellen Richtung.
    // Ein sanfter Zentrierungs-Pull verhindert, dass Fische abdriften.
    const smoothAngle =
      Math.sin(elapsed * 0.15 + fish.wanderPhase) * 1.5 +
      Math.sin(elapsed * 0.37 + fish.wanderPhase * 1.7) * 0.7;
    const angleLerp = 1 - Math.exp(-1.5 * dt);
    fish.wanderAngle += (smoothAngle - fish.wanderAngle) * angleLerp;

    // Vorwärts-Richtung aus Velocity (oder Heading als Fallback)
    const vLen = Math.sqrt(fish.vx * fish.vx + fish.vz * fish.vz);
    const fwdX = vLen > 0.01 ? fish.vx / vLen : Math.sin(fish.heading);
    const fwdZ = vLen > 0.01 ? fish.vz / vLen : Math.cos(fish.heading);

    // Wander-Kreis: 8m vor dem Fisch + 4m Radius
    const wDist = 8.0;
    const wRad = 4.0;
    const cX = pos.x + fwdX * wDist;
    const cZ = pos.z + fwdZ * wDist;
    let tX = cX + Math.cos(fish.wanderAngle) * wRad;
    let tZ = cZ + Math.sin(fish.wanderAngle) * wRad;

    // Sanfter Zentrierungs-Pull: Fisch bleibt im Layer-Ring
    const centerDx = p.centerX - pos.x;
    const centerDz = p.centerZ - pos.z;
    const centerDist = Math.sqrt(centerDx * centerDx + centerDz * centerDz);
    if (centerDist > p.maxDist) {
      const pull = (centerDist - p.maxDist) * 0.15;
      tX += (centerDx / centerDist) * pull;
      tZ += (centerDz / centerDist) * pull;
    }

    // ═══ 3. Exklusionszonen: Ziel sanft wegdrücken ═══
    let targetPushX = 0;
    let targetPushZ = 0;
    if (this._exclusionZones.length > 0) {
      for (const zone of this._exclusionZones) {
        const zx = tX - zone.centerX;
        const zz = tZ - zone.centerZ;
        const zDistSq = zx * zx + zz * zz;
        const effectRadius = zone.radius + 5.0;
        if (zDistSq < effectRadius * effectRadius && zDistSq > 0.01) {
          const zDist = Math.sqrt(zDistSq);
          const overlap = 1 - zDist / effectRadius;
          const push = overlap * 6.0;
          targetPushX += (zx / zDist) * push;
          targetPushZ += (zz / zDist) * push;
        }
      }
    }
    const pushLerp = 1 - Math.exp(-3.0 * dt);
    fish.pushAccumX += (targetPushX - fish.pushAccumX) * pushLerp;
    fish.pushAccumZ += (targetPushZ - fish.pushAccumZ) * pushLerp;
    if (targetPushX === 0 && targetPushZ === 0) {
      fish.pushAccumX *= Math.exp(-2.0 * dt);
      fish.pushAccumZ *= Math.exp(-2.0 * dt);
    }
    tX += fish.pushAccumX;
    tZ += fish.pushAccumZ;

    // ═══ 4. Stadt-Orbit: Statt Repulsion → Orbit um die Kuppel ═══
    // Wenn der Fisch in der NÃ¤he einer Stadt ist, ersetzt das
    // Orbit-Ziel das Wander-Ziel. Der Fisch kreist um die Kuppel.
    if (this._exclusionZones.length > 0) {
      for (const zone of this._exclusionZones) {
        const dx = pos.x - zone.centerX;
        const dz = pos.z - zone.centerZ;
        const distSq = dx * dx + dz * dz;
        const attractionRadius = zone.radius + FishWorld.CITY_ATTRACTION_DIST;
        if (distSq < attractionRadius * attractionRadius) {
          const orbitRadius = zone.radius + 18;
          const orbitSpeed = 0.08 + ((fish.wanderPhase * 0.5) % 0.08);
          const orbitAngle = elapsed * orbitSpeed + fish.wanderPhase;
          tX = zone.centerX + Math.cos(orbitAngle) * orbitRadius;
          tZ = zone.centerZ + Math.sin(orbitAngle) * orbitRadius;
          break;
        }
      }
    }

    // ═══ 5. Steering zum Ring-Target ═══
    const tdx = tX - pos.x;
    const tdz = tZ - pos.z;
    const targetDist = Math.sqrt(tdx * tdx + tdz * tdz) || 0.001;
    const steerX = tdx / targetDist;
    const steerZ = tdz / targetDist;

    // ═══ 5. Velocity (Lerp in Ziel-Richtung) ═══
    const steerLerp = 1 - Math.exp(-p.agility * 3.0 * dt);
    fish.vx += (steerX * currentSpeed - fish.vx) * steerLerp;
    fish.vz += (steerZ * currentSpeed - fish.vz) * steerLerp;

    // Velocity limitieren + anwenden
    const newVLen = Math.sqrt(fish.vx * fish.vx + fish.vz * fish.vz);
    if (newVLen > currentSpeed) {
      fish.vx = (fish.vx / newVLen) * currentSpeed;
      fish.vz = (fish.vz / newVLen) * currentSpeed;
    }
    pos.x += fish.vx * dt;
    pos.z += fish.vz * dt;

    // ═══ 6. Y-Position (zwei Sinus-Wellen) ═══
    const playerY = cameraPos.y;
    const yPhase = fish.wanderPhase;
    const yWave1 = Math.sin(elapsed * p.yFreq * Math.PI * 2 + yPhase) * p.yAmp;
    const yWave2 = Math.sin(elapsed * p.yFreq * 0.7 * Math.PI * 2 + yPhase * 0.3) * p.yAmp * 0.4;
    const rawY = playerY + p.yOffset + yWave1 + yWave2;
    const clampedY = Math.max(
      this.config.floorY + 2.0,
      Math.min(this.config.waterY - 0.5, rawY),
    );
    const yLerp = 1 - Math.exp(-5.0 * dt);
    fish.state.curY += (clampedY - fish.state.curY) * yLerp;
    pos.y = fish.state.curY;

    // ═══ 7. Heading aus Velocity (max 90°/s Drehrate) ═══
    // So schwimmt der Fisch immer in die Richtung, in die er sich bewegt.
    // Die max. Drehrate verhindert 180°-Flips (Rückwärts-Schwimmen).
    if (newVLen > 0.01) {
      const velYaw = Math.atan2(fish.vx, fish.vz + 0.0001);
      let diff = velYaw - fish.heading;
      if (diff > Math.PI) diff -= Math.PI * 2;
      if (diff < -Math.PI) diff += Math.PI * 2;
      const maxTurn = 1.57 * dt; // 90° pro Sekunde
      fish.heading += Math.max(-maxTurn, Math.min(maxTurn, diff));
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
      const dt = Math.min(delta, 0.05);
      const wp = school.wanderPhase;

      // ═══ 0. Respawn: Schule zu weit vom Spieler → neu positionieren ═══
      {
        const dx = school.centerX - cameraPos.x;
        const dz = school.centerZ - cameraPos.z;
        if (dx * dx + dz * dz > FishWorld.RESPAWN_DIST * FishWorld.RESPAWN_DIST) {
          const angle = Math.atan2(cameraPos.x - school.centerX, cameraPos.z - school.centerZ);
          const spawnDist = 20 + Math.random() * 30;
          const spreadAngle = (Math.random() - 0.5) * Math.PI * 1.5;
          school.centerX = cameraPos.x + Math.sin(angle + spreadAngle) * spawnDist;
          school.centerZ = cameraPos.z + Math.cos(angle + spreadAngle) * spawnDist;
        }
      }

      // ═══ 1. Prüfen ob die Schule in der Nähe einer Stadt ist → Orbit ═══
      let orbitTargetX: number | null = null;
      let orbitTargetZ: number | null = null;
      if (this._exclusionZones.length > 0) {
        for (const zone of this._exclusionZones) {
          const dx = school.centerX - zone.centerX;
          const dz = school.centerZ - zone.centerZ;
          const distSq = dx * dx + dz * dz;
          const attractionRadius = zone.radius + FishWorld.CITY_ATTRACTION_DIST;
          if (distSq < attractionRadius * attractionRadius) {
            const orbitRadius = zone.radius + 22;
            const orbitSpeed = 0.06 + ((wp * 0.3) % 0.06);
            const orbitAngle = elapsed * orbitSpeed + wp;
            orbitTargetX = zone.centerX + Math.cos(orbitAngle) * orbitRadius;
            orbitTargetZ = zone.centerZ + Math.sin(orbitAngle) * orbitRadius;
            break;
          }
        }
      }

      if (orbitTargetX !== null && orbitTargetZ !== null) {
        // ═══ 1b. Stadt-Orbit: Schule kreist um die Kuppel ═══
        const followRate = 1 - Math.exp(-0.8 * dt);
        school.centerX += (orbitTargetX - school.centerX) * followRate;
        school.centerZ += (orbitTargetZ - school.centerZ) * followRate;
      } else {
        // ═══ 1c. Wander-Target: um das feste Schul-Zentrum ═══
        const wr = school.wanderRange;
        const targetX = school.centerX
          + Math.sin(elapsed * 0.05 + wp) * wr * 0.5
          + Math.sin(elapsed * 0.11 + wp * 1.7) * wr * 0.15;
        const targetZ = school.centerZ
          + Math.cos(elapsed * 0.04 + wp * 1.3) * wr * 0.5
          + Math.cos(elapsed * 0.09 + wp * 0.7) * wr * 0.15;

        // ═══ 2. Schul-Zentrum folgt dem Target mit Trägheit ═══
        const followRate = 1 - Math.exp(-0.5 * school.lagFactor * dt);
        school.centerX += (targetX - school.centerX) * followRate;
        school.centerZ += (targetZ - school.centerZ) * followRate;
      }

      // ═══ 3. Exklusionszonen-Push auf das Zentrum (weicht Hindernissen aus) ═══
      if (this._exclusionZones.length > 0 && orbitTargetX === null) {
        for (const zone of this._exclusionZones) {
          const dx = school.centerX - zone.centerX;
          const dz = school.centerZ - zone.centerZ;
          const distSq = dx * dx + dz * dz;
          const minDist = zone.radius + 14;
          if (distSq < minDist * minDist && distSq > 0.01) {
            const dist = Math.sqrt(distSq);
            const push = (minDist - dist) * 1.5 * dt;
            school.centerX += (dx / dist) * push;
            school.centerZ += (dz / dist) * push;
          }
        }
      }

      // ═══ 4. Basis-Yaw aus Richtung zum Target/Orbit-Ziel ═══
      const yawTargetX = orbitTargetX !== null ? orbitTargetX : school.centerX + Math.sin(elapsed * 0.05 + wp) * school.wanderRange * 0.5;
      const yawTargetZ = orbitTargetZ !== null ? orbitTargetZ : school.centerZ + Math.cos(elapsed * 0.04 + wp * 1.3) * school.wanderRange * 0.5;
      const dirToTargetX = yawTargetX - school.centerX;
      const dirToTargetZ = yawTargetZ - school.centerZ;
      const baseYaw = Math.atan2(dirToTargetX, dirToTargetZ);

      // ═══ 5. Y-Position der Schule ═══
      const schoolY = cameraPos.y + school.yOffset +
        Math.sin(elapsed * school.yFreq * Math.PI * 2) * school.yAmp;
      const clampedY = Math.max(
        this.config.floorY + 2.0,
        Math.min(this.config.waterY - 0.5, schoolY),
      );

      // ═══ 6. Separation: einfacher Abstands-Check innerhalb der Schule ═══
      // Nur wenn zwei Fische < 1.5m auseinander sind, werden sie sanft getrennt.
      const offsets = school.fishOffsets;
      const len = offsets.length;
      const sepPushX = this._sepPushX;
      const sepPushZ = this._sepPushZ;
      for (let j = 0; j < len; j++) {
        sepPushX[j] = 0;
        sepPushZ[j] = 0;
      }
      if (len <= 14) {
        for (let a = 0; a < len; a++) {
          const oa = offsets[a];
          const ax = school.centerX + Math.cos(oa.angle) * oa.dist;
          const az = school.centerZ + Math.sin(oa.angle) * oa.dist;
          for (let b = a + 1; b < len; b++) {
            const ob = offsets[b];
            const bx = school.centerX + Math.cos(ob.angle) * ob.dist;
            const bz = school.centerZ + Math.sin(ob.angle) * ob.dist;
            const dx = ax - bx;
            const dz = az - bz;
            const distSq = dx * dx + dz * dz;
            if (distSq < 2.25 && distSq > 0.01) {
              const dist = Math.sqrt(distSq);
              const push = (1.5 - dist) * 0.5 * delta;
              const nx = dx / dist;
              const nz = dz / dist;
              sepPushX[a] += nx * push;
              sepPushZ[a] += nz * push;
              sepPushX[b] -= nx * push;
              sepPushZ[b] -= nz * push;
            }
          }
        }
      }

      // ═══ 7. Jeden Fisch individuell positionieren ═══
      // Jeder Fisch hat eigene Amplituden (aus speedFactor) und Frequenzen
      // für Yaw/Pitch/Roll + Distanz-Puls + Höhen-Bobbing.
      const scale = school.fishScale;
      for (let j = 0; j < len; j++) {
        const fo = offsets[j];

        // Offset rotiert mit individueller Geschwindigkeit
        fo.angle += fo.speedFactor * 0.08 * delta;

        // Amplituden-Skalierung aus speedFactor (0.5–1.5)
        const amp = 0.5 + fo.speedFactor; // 1.0–2.0

        // Distanz pulsiert leicht (±15%) pro Fisch
        const distPulse = 1.0 + Math.sin(elapsed * (0.08 + fo.speedFactor * 0.06) + fo.phase * 0.5) * 0.15;

        // Separation anwenden
        const sepX = sepPushX[j] || 0;
        const sepZ = sepPushZ[j] || 0;

        // Position = Zentrum + rotierter Offset * Puls + Separation
        const cosA = Math.cos(fo.angle);
        const sinA = Math.sin(fo.angle);
        const px = school.centerX + cosA * fo.dist * distPulse + sepX;
        const pz = school.centerZ + sinA * fo.dist * distPulse + sepZ;
        const py = clampedY + fo.ly
          + Math.sin(elapsed * (0.2 + fo.speedFactor * 0.15) + fo.phase) * (0.4 * amp);

        // ═══ 8. Richtung mit individueller Variation ═══
        // Yaw: ±0.2–0.4 rad – jeder Fisch schaut etwas anders
        const yawVar = Math.sin(elapsed * (0.5 + fo.speedFactor * 0.3) + fo.phase) * (0.2 * amp);
        // Pitch: ±0.08–0.16 rad – leichte Nick-Bewegung
        const pitch = Math.sin(elapsed * (0.4 + fo.speedFactor * 0.2) + fo.phase * 0.7) * (0.08 * amp);
        // Roll: ±0.12–0.24 rad – wie echte Fische in der Kurve
        const roll = Math.cos(elapsed * (0.3 + fo.speedFactor * 0.2) + fo.phase * 0.3) * (0.12 * amp);
        const yaw = baseYaw + yawVar;

        // Matrix setzen
        this._tmpVec3.set(px, py, pz);
        this._tmpQuat.identity();
        this._tmpQuatA.setFromAxisAngle(this._up, yaw);
        this._tmpQuat.multiply(this._tmpQuatA);
        this._tmpQuatB.setFromAxisAngle(this._axisPitch, pitch);
        this._tmpQuat.multiply(this._tmpQuatB);
        this._tmpQuatA.setFromAxisAngle(this._axisRoll, roll);
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
