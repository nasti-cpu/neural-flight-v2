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
// Territorium: Eine Gruppe Fische an einem FISCH-Chunk
// ---------------------------------------------------------------------------

/** Ein Fisch-Territorium = alle Fische eines FISCH-Chunks (Welt-Position) */
interface FishTerritory {
  chunkX: number;
  chunkZ: number;
  centerX: number;
  centerZ: number;
  soloFishes: SoloFish[];
  schools: FishSchool[];
}

// ---------------------------------------------------------------------------
// Wander-Steering-Parameter eines Einzelfisches (welt-fixiert)
// ---------------------------------------------------------------------------

/**
 * Jeder Solo-Fisch schwimmt mit "Wander Steering" um seine Heimat-Position.
 * homeX/homeZ = fixe Welt-Position (Mitte des Territoriums + Offset).
 * wanderRadius = Radius, in dem der Fisch um sein Zuhause streift.
 */
interface SoloFishParams {
  /** Heimat-Position (Welt-Koordinaten) – der Fisch bleibt in der Nähe */
  homeX: number;
  homeZ: number;
  /** Radius, in dem der Fisch um homeX/homeZ wandert (25–35 m) */
  wanderRadius: number;
  /** Maximale Schwimm-Geschwindigkeit (Einheiten/s) */
  speed: number;
  /** Wie schnell der Fisch die Richtung ändert (0.3=elegant, 3.0=hektisch) */
  agility: number;

  // === ⚡ Geschwindigkeits-Modulation (Sinus-Bursts) ===
  speedModAmp: number;
  speedModFreq: number;

  // === Höhen-Varianz (relativ zur Spieler-Höhe, für Tiefenstaffelung) ===
  yOffset: number;
  yAmp: number;
  yFreq: number;

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

  /** Toggle für Separation: nur jeden 2. Frame neu berechnen */
  _sepToggle: boolean;
}

// ---------------------------------------------------------------------------
// Hauptklasse: FishWorld
// ---------------------------------------------------------------------------

export class FishWorld {
  private scene: THREE.Scene;
  private config: FishWorldConfig;
  private loader: GLTFLoader;

  /** Modell-Template (wird in init() geladen) */
  private fishModelTemplate: THREE.Group | null = null;
  /** Mesh für Instanced Schools */
  private schoolFishMesh: THREE.Mesh | null = null;

  /** Alle Fisch-Territorien, key = "chunkX,chunkZ" */
  private _territories: Map<string, FishTerritory> = new Map();

  /** Abstand, ab dem Fische um eine Stadt kreisen */
  private static readonly CITY_ATTRACTION_DIST = 35;
  /** Maximale Distanz zum Spieler, bevor ein Territorium entladen wird */
  private static readonly UNLOAD_DIST = 90;
  /** Distanz, ab der Fische anfangen durchzublenden (Nebel-Effekt) */
  private static readonly FADE_START = 50;
  /** Distanz, bei der Fische vollständig unsichtbar sind */
  private static readonly FADE_END = 75;

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

    // Schwarm-Mesh aus dem Template extrahieren
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

    console.log("🐟 FishWorld bereit – wartet auf FISCH-Chunks vom WFC");
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
    this._manageTerritoryLifecycle(cameraPos);

    // Glow-Decay einmal berechnen (wiederverwendet für alle Fische)
    const glowDecay = Math.exp(-3.0 * delta);

    // Alle Fische in allen Territorien aktualisieren
    for (const [, territory] of this._territories) {
      for (const fish of territory.soloFishes) {
        this._updateSoloFish(fish, delta, elapsed, cameraPos);
        this._applyGlowDecay(fish, glowDecay);
      }
      for (const school of territory.schools) {
        this._updateSchool(school, delta, elapsed, cameraPos);
        this._applySchoolGlowDecay(school, glowDecay);
      }
    }

    // Echoortung (nur Targets sammeln + updaten, kein Glow-Decay mehr)
    this._updateEcholocationTargets(delta, elapsed, cameraPos, additionalTargets);
  }

  // -----------------------------------------------------------------------
  // WFC-Callback: Neue Fische an einem FISCH-Chunk spawnen
  // -----------------------------------------------------------------------

  /**
   * Wird vom ChunkManager/Scene aufgerufen, wenn ein FISCH-Chunk kollabiert.
   * Erzeugt ein Territorium mit 4-6 Einzelfischen + 1 Schule.
   * Alle Fische haben ihre Heimat in diesem Chunk (Welt-Position).
   */
  public registerFishAtChunk(cx: number, cz: number): void {
    if (!this.fishModelTemplate || !this.schoolFishMesh) return;
    const key = `${cx},${cz}`;
    if (this._territories.has(key)) return;

    const cs = 16;
    const worldX = cx * cs + cs / 2;
    const worldZ = cz * cs + cs / 2;

    const box = new THREE.Box3().setFromObject(this.fishModelTemplate);
    const size = new THREE.Vector3();
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z);
    const scale = (0.8 + Math.random() * 1.5) / maxDim;

    const soloFishes: SoloFish[] = [];
    const count = 6 + Math.floor(Math.random() * 5); // 6-10 Fische
    for (let i = 0; i < count; i++) {
      // Jeder Fisch hat sein eigenes "Zuhause" im Territorium
      const homeX = worldX + (Math.random() - 0.5) * 12;
      const homeZ = worldZ + (Math.random() - 0.5) * 12;
      const params = this._createSoloParams(homeX, homeZ);
      const fish = this._createSoloFish(params, scale, homeX, homeZ);
      soloFishes.push(fish);
    }

    // 1 Schule
    const school = this._createSchool(
      worldX, worldZ, scale,
    );

    const territory: FishTerritory = {
      chunkX: cx, chunkZ: cz,
      centerX: worldX, centerZ: worldZ,
      soloFishes,
      schools: [school],
    };

    this._territories.set(key, territory);
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
    for (const [, territory] of this._territories) {
      this._unloadTerritory(territory);
    }
    this._territories.clear();
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
  // Private: Solo-Fisch-Parameter erzeugen (welt-fixiert)
  // -----------------------------------------------------------------------

  /**
   * Erzeugt Wander-Parameter für einen Einzelfisch mit fixer Heimat-Position.
   * Der Fisch wandert in einem Radius von 25–35 m um homeX/homeZ.
   */
  private _createSoloParams(
    homeX: number, homeZ: number,
  ): SoloFishParams {
    const rand = Math.random;
    const yOff = this._randomBetween(-5, 2);
    return {
      homeX,
      homeZ,
      // 8-24m = ~0.5-1.5 Chunks – Fisch bleibt in der Nähe seines
      // Territoriums, kann aber in benachbarte Chunks schwimmen
      wanderRadius: 8 + rand() * 16,
      speed: this._randomBetween(0.5, 1.2),
      agility: 0.3 + rand() * 1.2,
      speedModAmp: 0.10 + rand() * 0.20,
      speedModFreq: 0.04 + rand() * 0.10,
      yOffset: yOff,
      yAmp: 0.3 + rand() * 1.2,
      yFreq: 0.04 + rand() * 0.10,
      swim: createSwimParams(),
    };
  }

  // -----------------------------------------------------------------------
  // Private: Einzelfisch erzeugen
  // -----------------------------------------------------------------------

  private _createSoloFish(
    params: SoloFishParams, scale: number, homeX: number, homeZ: number,
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

    // Startposition nahe der Heimat
    const startAngle = Math.random() * Math.PI * 2;
    const startDist = Math.random() * 8;
    mesh.position.set(
      homeX + Math.cos(startAngle) * startDist,
      (mesh.position.y || 4) + params.yOffset,
      homeZ + Math.sin(startAngle) * startDist,
    );

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
    homeX: number, homeZ: number, scale: number,
  ): FishSchool {
    const schoolSize = 6 + Math.floor(Math.random() * 3); // 6–8 Fische (O(n²) = 64 vs 144)

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

    // Persistente lokale Offsets
    const fishOffsets: SchoolFishOffsets[] = [];
    for (let j = 0; j < schoolSize; j++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = 1.0 + Math.random() * 5.0;
      fishOffsets.push({
        dist,
        angle,
        ly: (Math.random() - 0.5) * 2.0,
        phase: Math.random() * Math.PI * 2,
        speedFactor: 0.5 + Math.random() * 1.0,
      });
    }

    const schoolId = this._nextSchoolId++;
    const school: FishSchool = {
      instances,
      fishScale: scale,
      schoolId,
      fishOffsets,
      wanderPhase: Math.random() * Math.PI * 2,
      wanderRange: 20 + Math.random() * 15, // 20–35m
      lagFactor: 0.5 + Math.random() * 1.0,
      centerX: homeX,
      centerZ: homeZ,
      yOffset: this._randomBetween(-5, 2),
      yAmp: 0.2 + Math.random() * 1.0,
      yFreq: 0.04 + Math.random() * 0.08,
      glowIntensity: 0,
      originalEmissive: mat.emissive?.clone() ?? new THREE.Color(0x000000),
      _sepToggle: true,
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
  // Private: Territorium-Lebenszyklus (laden/entladen basierend auf Distanz)
  // -----------------------------------------------------------------------

  /**
   * Entlädt Territorien, die zu weit vom Spieler entfernt sind
   * und wendet Distanz-basierte Opazität an (Fade im Nebel).
   */
  private _manageTerritoryLifecycle(cameraPos: THREE.Vector3): void {
    for (const [key, territory] of this._territories) {
      const dx = territory.centerX - cameraPos.x;
      const dz = territory.centerZ - cameraPos.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      if (dist > FishWorld.UNLOAD_DIST) {
        // ★ Zu weit → Territorium entladen
        this._unloadTerritory(territory);
        this._territories.delete(key);
        continue;
      }

      // ★ Fade im Nebel (50-75m: Fisch wird langsam unsichtbar)
      let opacity = 1.0;
      if (dist > FishWorld.FADE_START) {
        const fadeRange = FishWorld.FADE_END - FishWorld.FADE_START;
        opacity = Math.max(0, 1.0 - (dist - FishWorld.FADE_START) / fadeRange);
      }
      this._applyTerritoryOpacity(territory, opacity);
    }
  }

  /**
   * Wendet Opazität auf alle Fische eines Territoriums an.
   */
  private _applyTerritoryOpacity(territory: FishTerritory, opacity: number): void {
    for (const fish of territory.soloFishes) {
      fish.mesh.traverse((ch) => {
        if (ch instanceof THREE.Mesh && ch.material) {
          const mats = Array.isArray(ch.material) ? ch.material : [ch.material];
          for (const m of mats) {
            if (!m.transparent) m.transparent = true;
            m.opacity = opacity;
          }
        }
      });
    }
    for (const school of territory.schools) {
      const mat = school.instances.material as THREE.MeshStandardMaterial;
      if (!mat.transparent) mat.transparent = true;
      mat.opacity = opacity;
    }
  }

  /**
   * Entlädt ein Territorium (entfernt alle Meshes, gibt Speicher frei).
   */
  private _unloadTerritory(territory: FishTerritory): void {
    for (const fish of territory.soloFishes) {
      this.scene.remove(fish.mesh);
      fish.mesh.traverse((ch) => {
        if (ch instanceof THREE.Mesh) {
          ch.geometry?.dispose();
          if (ch.material) {
            const mats = Array.isArray(ch.material) ? ch.material : [ch.material];
            for (const m of mats) m.dispose();
          }
        }
      });
    }
    for (const school of territory.schools) {
      this.scene.remove(school.instances);
      school.instances.dispose();
    }
  }

  // -----------------------------------------------------------------------
  // Private: Einzelfisch animieren
  // -----------------------------------------------------------------------

  /**
   * Reynolds Wander Steering um die Heimat-Position (kein Player-Tracking).
   * Bei Städten: Orbit um die Kuppel.
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
    const bursting = elapsed % p.swim.burstInt < p.swim.burstDur;
    const burstMul = bursting ? 1.2 : 1.0;
    const speedMod =
      1.0 +
      Math.sin(elapsed * p.speedModFreq * Math.PI * 2) * p.speedModAmp;
    const currentSpeed = p.speed * burstMul * speedMod;

    // ═══ 2. Reynolds Wander (smooth Sinus-Überlagerung) ═══
    const smoothAngle =
      Math.sin(elapsed * 0.15 + fish.wanderPhase) * 1.5 +
      Math.sin(elapsed * 0.37 + fish.wanderPhase * 1.7) * 0.7;
    const angleLerp = 1 - Math.exp(-1.5 * dt);
    fish.wanderAngle += (smoothAngle - fish.wanderAngle) * angleLerp;

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

    // ═══ 3. Sanfter Zentrierungs-Pull zur Heimat (verhindert Abdriften) ═══
    const homeDx = p.homeX - pos.x;
    const homeDz = p.homeZ - pos.z;
    const homeDist = Math.sqrt(homeDx * homeDx + homeDz * homeDz);
    if (homeDist > p.wanderRadius) {
      // Stärkerer Pull zurück zur Heimat (0.2 statt 0.12) –
      // der Fisch bleibt natürlich im sichtbaren Bereich
      const pull = (homeDist - p.wanderRadius) * 0.2;
      tX += (homeDx / homeDist) * pull;
      tZ += (homeDz / homeDist) * pull;
    }

    // ═══ 4. Exklusionszonen: Ziel sanft wegdrücken ═══
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

    // ═══ 5. Stadt-Orbit: Um die Kuppel kreisen (außerhalb) ═══
    if (this._exclusionZones.length > 0) {
      for (const zone of this._exclusionZones) {
        const dx = pos.x - zone.centerX;
        const dz = pos.z - zone.centerZ;
        const distSq = dx * dx + dz * dz;
        const attractionRadius = zone.radius + FishWorld.CITY_ATTRACTION_DIST;
        if (distSq < attractionRadius * attractionRadius) {
          const orbitRadius = zone.radius + 22; // Weiter draußen, damit Fische nicht im Modell sind
          const orbitSpeed = 0.08 + ((fish.wanderPhase * 0.5) % 0.08);
          const orbitAngle = elapsed * orbitSpeed + fish.wanderPhase;
          tX = zone.centerX + Math.cos(orbitAngle) * orbitRadius;
          tZ = zone.centerZ + Math.sin(orbitAngle) * orbitRadius;
          break;
        }
      }
    }

    // ═══ 5b. Hard Clamp: Fisch ist IN einer ExclusionZone → sofort raus ═══
    if (this._exclusionZones.length > 0) {
      for (const zone of this._exclusionZones) {
        const dx = pos.x - zone.centerX;
        const dz = pos.z - zone.centerZ;
        const distSq = dx * dx + dz * dz;
        const minDist = zone.radius + 4; // 4m Sicherheitsabstand zur Kuppel
        if (distSq < minDist * minDist && distSq > 0.01) {
          const dist = Math.sqrt(distSq);
          const pushOut = (minDist - dist) * 0.5;
          pos.x += (dx / dist) * pushOut;
          pos.z += (dz / dist) * pushOut;
          // Auch das Target anpassen, damit der Fisch nicht zurücksteuert
          tX = pos.x + (dx / dist) * 5;
          tZ = pos.z + (dz / dist) * 5;
          break;
        }
      }
    }

    // ═══ 6. Steering zum Target ═══
    const tdx = tX - pos.x;
    const tdz = tZ - pos.z;
    const targetDist = Math.sqrt(tdx * tdx + tdz * tdz) || 0.001;
    const steerX = tdx / targetDist;
    const steerZ = tdz / targetDist;

    // ═══ 7. Velocity (Lerp in Ziel-Richtung) ═══
    const steerLerp = 1 - Math.exp(-p.agility * 3.0 * dt);
    fish.vx += (steerX * currentSpeed - fish.vx) * steerLerp;
    fish.vz += (steerZ * currentSpeed - fish.vz) * steerLerp;

    const newVLen = Math.sqrt(fish.vx * fish.vx + fish.vz * fish.vz);
    if (newVLen > currentSpeed) {
      fish.vx = (fish.vx / newVLen) * currentSpeed;
      fish.vz = (fish.vz / newVLen) * currentSpeed;
    }
    pos.x += fish.vx * dt;
    pos.z += fish.vz * dt;

    // ═══ 8. Y-Position (zwei Sinus-Wellen, relativ zur Heimat-Höhe) ═══
    const yPhase = fish.wanderPhase;
    const yWave1 = Math.sin(elapsed * p.yFreq * Math.PI * 2 + yPhase) * p.yAmp;
    const yWave2 = Math.sin(elapsed * p.yFreq * 0.7 * Math.PI * 2 + yPhase * 0.3) * p.yAmp * 0.4;
    const rawY = cameraPos.y + p.yOffset + yWave1 + yWave2;
    const clampedY = Math.max(
      this.config.floorY + 2.0,
      Math.min(this.config.waterY - 0.5, rawY),
    );
    const yLerp = 1 - Math.exp(-5.0 * dt);
    fish.state.curY += (clampedY - fish.state.curY) * yLerp;
    pos.y = fish.state.curY;

    // ═══ 9. Heading aus Velocity (max 90°/s Drehrate) ═══
    if (newVLen > 0.01) {
      const velYaw = Math.atan2(fish.vx, fish.vz + 0.0001);
      let diff = velYaw - fish.heading;
      if (diff > Math.PI) diff -= Math.PI * 2;
      if (diff < -Math.PI) diff += Math.PI * 2;
      const maxTurn = 1.57 * dt;
      fish.heading += Math.max(-maxTurn, Math.min(maxTurn, diff));
    }

    // ═══ 10. orbitSwimming: Yaw/Pitch/Roll-Animation + Burst ═══
    updateSwimState(p.swim, fish.state, delta, elapsed, fish.wanderAngle);

    // ═══ 11. Rotation anwenden ═══
    fish.mesh.rotation.set(0, 0, 0);
    fish.mesh.rotateY(fish.heading + fish.state.yaw);
    fish.mesh.rotateX(fish.state.pitch);
    fish.mesh.rotateZ(fish.state.roll);
  }

  // -----------------------------------------------------------------------
  // Private: Schwärme aktualisieren
  // -----------------------------------------------------------------------
  private _updateSchool(
    school: FishSchool,
    delta: number,
    elapsed: number,
    cameraPos: THREE.Vector3,
  ): void {
    const dt = Math.min(delta, 0.05);
    const wp = school.wanderPhase;

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
      // ═══ 1c. Wander-Target: um das feste Schul-Zentrum (welt-fixiert) ═══
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

    // ═══ 3. Exklusionszonen-Push auf das Zentrum ═══
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

    // ═══ 3b. Hard Clamp: Schul-Zentrum ist IN einer ExclusionZone → sofort raus ═══
    if (this._exclusionZones.length > 0) {
      for (const zone of this._exclusionZones) {
        const dx = school.centerX - zone.centerX;
        const dz = school.centerZ - zone.centerZ;
        const distSq = dx * dx + dz * dz;
        const minDist = zone.radius + 8; // 8m Sicherheitsabstand
        if (distSq < minDist * minDist && distSq > 0.01) {
          const dist = Math.sqrt(distSq);
          const pushOut = (minDist - dist) * 0.3;
          school.centerX += (dx / dist) * pushOut;
          school.centerZ += (dz / dist) * pushOut;
          break;
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

    // ═══ 6. Separation (nur jeden 2. Frame – spart 50% CPU bei O(n²))
    const offsets = school.fishOffsets;
    const len = offsets.length;
    const sepPushX = this._sepPushX;
    const sepPushZ = this._sepPushZ;
    if (school._sepToggle) {
      school._sepToggle = false;
      for (let j = 0; j < len; j++) {
        sepPushX[j] = 0;
        sepPushZ[j] = 0;
      }
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
    } else {
      school._sepToggle = true;
      // Vorherige Push-Werte beibehalten (kein Reset)
    }

    // ═══ 7. Jeden Fisch individuell positionieren ═══
    const scale = school.fishScale;
    for (let j = 0; j < len; j++) {
      const fo = offsets[j];

      fo.angle += fo.speedFactor * 0.08 * delta;
      const amp = 0.5 + fo.speedFactor;
      const distPulse = 1.0 + Math.sin(elapsed * (0.08 + fo.speedFactor * 0.06) + fo.phase * 0.5) * 0.15;

      const sepX = sepPushX[j] || 0;
      const sepZ = sepPushZ[j] || 0;

      const cosA = Math.cos(fo.angle);
      const sinA = Math.sin(fo.angle);
      const px = school.centerX + cosA * fo.dist * distPulse + sepX;
      const pz = school.centerZ + sinA * fo.dist * distPulse + sepZ;
      const py = clampedY + fo.ly
        + Math.sin(elapsed * (0.2 + fo.speedFactor * 0.15) + fo.phase) * (0.4 * amp);

      const yawVar = Math.sin(elapsed * (0.5 + fo.speedFactor * 0.3) + fo.phase) * (0.2 * amp);
      const pitch = Math.sin(elapsed * (0.4 + fo.speedFactor * 0.2) + fo.phase * 0.7) * (0.08 * amp);
      const roll = Math.cos(elapsed * (0.3 + fo.speedFactor * 0.2) + fo.phase * 0.3) * (0.12 * amp);
      const yaw = baseYaw + yawVar;

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

  // -----------------------------------------------------------------------
  // Private: Echoortung – nur Targets sammeln (Glow-Decay ist im Haupt-Update)
  // -----------------------------------------------------------------------

  private _updateEcholocationTargets(
    delta: number,
    elapsed: number,
    cameraPos: THREE.Vector3,
    additionalTargets?: EchoTarget[],
  ): void {
    if (!this.echolocation) return;

    // Echo-Targets sammeln (über Territorien)
    this._echoTargets.length = 0;
    for (const [, territory] of this._territories) {
      for (const fish of territory.soloFishes) {
        if (!fish.fishMesh) continue;
        fish._echoTarget.position.copy(fish.mesh.position);
        this._echoTargets.push(fish._echoTarget);
      }
      for (const school of territory.schools) {
        school._echoTarget.position.set(
          school.centerX,
          cameraPos.y + school.yOffset,
          school.centerZ,
        );
        this._echoTargets.push(school._echoTarget);
      }
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
  }

  // -----------------------------------------------------------------------
  // Private: Glow-Decay für Einzelfische (inline im Haupt-Loop)
  // -----------------------------------------------------------------------

  /**
   * Wendet Glow-Decay auf einen Einzelfisch an.
   * Wird direkt im Haupt-Update-Loop aufgerufen – kein 2. Durchlauf nötig.
   */
  private _applyGlowDecay(fish: SoloFish, decay: number): void {
    if (!fish.fishMesh || !fish.originalEmissive) return;
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

  /**
   * Wendet Glow-Decay auf eine Schule an.
   * Wird direkt im Haupt-Update-Loop aufgerufen – kein 2. Durchlauf nötig.
   */
  private _applySchoolGlowDecay(school: FishSchool, decay: number): void {
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
