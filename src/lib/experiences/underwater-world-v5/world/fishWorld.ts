/**
 * fishWorld.ts – Fische auf Kamera-zentrierten Orbits
 *
 * 32 Solo-Fische + 1 Schule (8 Fische) schwimmen auf Ellipsen-Orbits
 * um die Kamera. Kein WFC, keine Territorien, kein Lifecycle.
 * Ersetzt das alte wander-basierte System.
 */

import * as THREE from "three/webgpu";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  EcholocationRings,
  type EchoTarget,
  type EcholocationConfig,
} from "../sinne/echoortung/echolocationRings";

/**
 * Ausschlusszone (z. B. um eine Stadtkuppel).
 * Fische meiden diese Bereiche.
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
  soloCount: number;
  fishMinSize: number;
  fishMaxSize: number;
  echolocationEnabled: boolean;
  echolocationConfig?: Partial<EcholocationConfig>;
}

const DEFAULT_FISH_CONFIG: FishWorldConfig = {
  floorY: -4,
  waterY: 26,
  soloCount: 32,
  fishMinSize: 0.8,
  fishMaxSize: 1.5,
  echolocationEnabled: true,
};

// ---------------------------------------------------------------------------
// Zustand eines Solo-Fisches
// ---------------------------------------------------------------------------

interface SoloFishState {
  mesh: THREE.Group;
  scale: number;

  /** Lissajous-Orbit um die Kamera */
  radiusX: number;
  radiusZ: number;
  speed: number;
  /** Richtung: 1 = rechtsrum, -1 = linksrum */
  direction: number;
  /** Frequenz-Verhältnis X/Z (nie 1.0 → Lissajous statt Kreis) */
  freqRatio: number;
  angle: number;

  /** Geschwindigkeits-Modulation (Burst-and-Glide) */
  speedAmp: number;
  speedFreq: number;
  burstInt: number;
  burstDur: number;

  /** Y relativ zur Kamera */
  yOffset: number;
  yAmp: number;
  yFreq: number;

  /** Schwimm-Animation */
  yawAmp: number;
  yawFreq: number;
  pitchAmp: number;
  pitchFreq: number;

  /** Lerp-Zustände */
  currentYaw: number;
  currentPitch: number;
  currentRoll: number;
  currentY: number;

  // Echo
  glowIntensity: number;
  fishMesh: THREE.Mesh | null;
  originalEmissive: THREE.Color | null;
  _echoTarget: EchoTarget;
}

// ---------------------------------------------------------------------------
// Schul-Fisch (Offsets für InstancedMesh)
// ---------------------------------------------------------------------------

interface SchoolFishOffset {
  angle: number;
  dist: number;
  ly: number;
  phase: number;
  speedFactor: number;
}

interface FishSchool {
  instances: THREE.InstancedMesh;
  fishScale: number;

  /** Orbit-Parameter */
  orbitRadius: number;
  orbitSpeed: number;
  orbitAngle: number;

  /** Y relativ zur Kamera */
  yOffset: number;
  yAmp: number;

  /** Glow */
  glowIntensity: number;
  originalEmissive: THREE.Color;

  /** Per-Fish Offsets */
  offsets: SchoolFishOffset[];

  _echoTarget: EchoTarget;
}

// ---------------------------------------------------------------------------
// Hauptklasse
// ---------------------------------------------------------------------------

export class FishWorld {
  private scene: THREE.Scene;
  private config: FishWorldConfig;
  private loader: GLTFLoader;

  private fishModelTemplate: THREE.Group | null = null;
  private schoolFishMesh: THREE.Mesh | null = null;

  private soloFish: SoloFishState[] = [];
  private school: FishSchool | null = null;

  private _exclusionZones: ExclusionZone[] = [];

  // Echoortung
  private echolocation: EcholocationRings | null = null;
  private _echoOrigin = new THREE.Vector3();

  // Wiederverwendbare Puffer
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
  // Initialisierung
  // -----------------------------------------------------------------------

  async init(_cameraPos?: THREE.Vector3): Promise<void> {
    console.log("🐟 FishWorld: Lade Fisch-Modell...");

    this.fishModelTemplate = await this._loadModel(
      "/3D Modelle/fish/Fish(3).glb",
    );
    if (!this.fishModelTemplate) {
      console.warn("⚠️ FishWorld: Fisch-Modell konnte nicht geladen werden!");
      return;
    }

    // Maximale Ausdehnung des Modells für korrekte Skalierung
    const rawBox = new THREE.Box3().setFromObject(this.fishModelTemplate);
    const rawSize = new THREE.Vector3();
    rawBox.getSize(rawSize);
    const maxDim = Math.max(rawSize.x, rawSize.y, rawSize.z);

    // Mesh für die Schule extrahieren
    this._extractSchoolMesh();

    // ═══ 32 Solo-Fische erzeugen ═══
    for (let i = 0; i < this.config.soloCount; i++) {
      const fish = this._createSoloFish(maxDim);
      this.scene.add(fish.mesh);
      this.soloFish.push(fish);
    }

    // ═══ 1 Schule erzeugen ═══
    this.school = this._createSchool();

    console.log(
      `🐟 FishWorld: ${this.soloFish.length} Solo-Fische + 1 Schule gestartet`,
    );
  }

  // -----------------------------------------------------------------------
  // Update – jeden Frame
  // -----------------------------------------------------------------------

  update(
    delta: number,
    elapsed: number,
    cameraPos: THREE.Vector3,
    additionalTargets?: EchoTarget[],
  ): void {
    const dt = Math.min(delta, 0.05);
    const glowDecay = Math.exp(-3.0 * delta);

    // Solo-Fische
    for (const fish of this.soloFish) {
      this._updateSoloFish(fish, dt, elapsed, cameraPos);
      this._applyGlowDecay(fish, glowDecay);
    }

    // Schule
    if (this.school) {
      this._updateSchool(this.school, dt, elapsed, cameraPos);
      this._applySchoolGlowDecay(this.school, glowDecay);
    }

    // Echoortung
    this._updateEcholocationTargets(delta, elapsed, cameraPos, additionalTargets);
  }

  // -----------------------------------------------------------------------
  // WFC (nicht mehr genutzt – wird aber von scene.ts aufgerufen)
  // -----------------------------------------------------------------------

  public registerFishAtChunk(_cx: number, _cz: number): void {
    // no-op – Fische sind jetzt kamerazentriert
  }

  // -----------------------------------------------------------------------
  // Exklusionszonen
  // -----------------------------------------------------------------------

  setExclusionZones(zones: ExclusionZone[]): void {
    this._exclusionZones = zones;
  }

  // -----------------------------------------------------------------------
  // Aufräumen
  // -----------------------------------------------------------------------

  dispose(): void {
    for (const fish of this.soloFish) {
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
    this.soloFish.length = 0;

    if (this.school) {
      this.scene.remove(this.school.instances);
      this.school.instances.dispose();
      this.school = null;
    }

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

  private _loadModel(path: string): Promise<THREE.Group | null> {
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
  // Private: Mesh für Schule extrahieren
  // -----------------------------------------------------------------------

  private _extractSchoolMesh(): void {
    if (!this.fishModelTemplate) return;
    const clone = this.fishModelTemplate.clone(true);
    this.scene.add(clone);
    let found: THREE.Mesh | null = null;
    clone.traverse((ch) => {
      if (ch instanceof THREE.Mesh && !found) found = ch;
    });
    this.scene.remove(clone);
    this.schoolFishMesh = found;
  }

  // -----------------------------------------------------------------------
  // Private: Solo-Fisch erzeugen
  // -----------------------------------------------------------------------

  private _createSoloFish(maxDim: number): SoloFishState {
    const mesh = this.fishModelTemplate!.clone(true);
    // Skalierung wie im alten System: relativ zur Modellgröße
    const scale = (0.8 + Math.random() * 1.2) / maxDim;
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

    // Orbit: 25–70m, elliptisch + Lissajous-Frequenz (nie 1.0)
    const rBase = 25 + Math.random() * 45;
    const ellipticity = 0.3 + Math.random() * 0.7;
    const radiusX = rBase * (1 + (Math.random() - 0.5) * 0.6);
    const radiusZ = rBase * ellipticity;

    // Frequenz-Verhältnis: 0.6–0.95 oder 1.05–1.4 (nie genau 1.0)
    const freqRatio = Math.random() > 0.5
      ? 0.6 + Math.random() * 0.35
      : 1.05 + Math.random() * 0.35;
    // Richtung: 50% links-/rechtsrum
    const direction = Math.random() > 0.5 ? 1 : -1;

    const state: SoloFishState = {
      mesh,
      scale,
      radiusX,
      radiusZ,
      speed: 0.03 + Math.random() * 0.04,
      direction,
      freqRatio,
      angle: Math.random() * Math.PI * 2,
      // Burst-and-Glide: sanfte Geschwindigkeits-Änderungen
      speedAmp: 0.15 + Math.random() * 0.2,
      speedFreq: 0.03 + Math.random() * 0.05,
      burstInt: 4 + Math.random() * 4,
      burstDur: 1.5 + Math.random() * 1.5,
      yOffset: (Math.random() - 0.5) * 6,
      yAmp: 0.5 + Math.random() * 2.0,
      yFreq: 0.04 + Math.random() * 0.08,
      yawAmp: 0.1 + Math.random() * 0.15,
      yawFreq: 0.3 + Math.random() * 0.2,
      pitchAmp: 0.03 + Math.random() * 0.05,
      pitchFreq: 0.4 + Math.random() * 0.2,
      currentYaw: 0,
      currentPitch: 0,
      currentRoll: 0,
      currentY: 0,
      glowIntensity: 0,
      fishMesh,
      originalEmissive,
      _echoTarget: {
        position: new THREE.Vector3(),
        onHit: (intensity: number) => { state.glowIntensity = intensity; },
      },
    };

    return state;
  }

  // -----------------------------------------------------------------------
  // Private: Schule erzeugen
  // -----------------------------------------------------------------------

  private _createSchool(): FishSchool | null {
    if (!this.schoolFishMesh) return null;

    // Box einmal aus dem geladenen Modell holen
    const rawBox = new THREE.Box3().setFromObject(this.fishModelTemplate!);
    const rawSize = new THREE.Vector3();
    rawBox.getSize(rawSize);
    const maxDim = Math.max(rawSize.x, rawSize.y, rawSize.z);
    const schoolScale = 1.5 / maxDim; // etwas größer als Einzelfische

    const schoolSize = 8;
    const mat = (
      this.schoolFishMesh.material as THREE.MeshStandardMaterial
    ).clone();
    mat.transparent = true;
    const instances = new THREE.InstancedMesh(
      this.schoolFishMesh.geometry,
      mat,
      schoolSize,
    );
    instances.castShadow = true;
    instances.receiveShadow = true;
    instances.frustumCulled = false;
    this.scene.add(instances);

    const offsets: SchoolFishOffset[] = [];
    for (let j = 0; j < schoolSize; j++) {
      offsets.push({
        angle: Math.random() * Math.PI * 2,
        dist: 1.0 + Math.random() * 4.0,
        ly: (Math.random() - 0.5) * 2.5,
        phase: Math.random() * Math.PI * 2,
        speedFactor: 0.5 + Math.random() * 1.0,
      });
    }

    const result: FishSchool = {
      instances,
      fishScale: schoolScale,
      orbitRadius: 30 + Math.random() * 20, // 30–50m, weiter weg als Solos
      orbitSpeed: 0.06 + Math.random() * 0.04,
      orbitAngle: Math.random() * Math.PI * 2,
      yOffset: (Math.random() - 0.5) * 4,
      yAmp: 0.3 + Math.random() * 1.0,
      glowIntensity: 0,
      originalEmissive: mat.emissive?.clone() ?? new THREE.Color(0x000000),
      offsets,
      _echoTarget: {
        position: new THREE.Vector3(),
        onHit: (_intensity: number) => {},
      },
    };
    result._echoTarget.onHit = (intensity: number) => {
      result.glowIntensity = intensity;
    };
    return result;
  }

  // -----------------------------------------------------------------------
  // Private: Solo-Fisch animieren (Ellipsen-Orbit um Kamera)
  // -----------------------------------------------------------------------

  private _updateSoloFish(
    fish: SoloFishState,
    dt: number,
    elapsed: number,
    cameraPos: THREE.Vector3,
  ): void {
    const lerpSpeed = 3.5;
    const lerp = 1 - Math.exp(-lerpSpeed * dt);

    // ═══ Geschwindigkeits-Modulation (sanfter Burst-and-Glide) ═══
    // Sinus-Welle für weiche Übergänge (kein harter Ein/Aus-Schalter)
    const burstPhase = ((elapsed % fish.burstInt) / fish.burstInt) * Math.PI * 2;
    const burstCurve = Math.max(0, Math.sin(burstPhase));
    const burstFactor = 1.0 + burstCurve * fish.speedAmp;
    // Zusätzliche sanfte Welligkeit
    const smoothMod =
      1.0 + Math.sin(elapsed * fish.speedFreq * Math.PI * 2) * fish.speedAmp * 0.3;
    const currentSpeed = fish.speed * Math.max(0.7, burstFactor * smoothMod);

    // Lissajous-Orbit
    fish.angle += currentSpeed * fish.direction * dt;
    const angleX = fish.angle * fish.freqRatio;
    const angleZ = fish.angle;
    const px = cameraPos.x + Math.cos(angleX) * fish.radiusX;
    const pz = cameraPos.z + Math.sin(angleZ) * fish.radiusZ;

    // Y relativ zur Kamera
    const targetY =
      cameraPos.y +
      fish.yOffset +
      Math.sin(elapsed * fish.yFreq * Math.PI * 2) * fish.yAmp;
    const clampedY = Math.max(
      this.config.floorY + 2,
      Math.min(this.config.waterY - 0.5, targetY),
    );

    // Exclusion-Zonen: sanfter radialer Push (dt-smooth, kein Zischen)
    let pushX = 0;
    let pushZ = 0;
    if (this._exclusionZones.length > 0) {
      for (const zone of this._exclusionZones) {
        const dx = px - zone.centerX;
        const dz = pz - zone.centerZ;
        const distSq = dx * dx + dz * dz;
        const minDist = zone.radius + 2;
        if (distSq < minDist * minDist && distSq > 0.01) {
          const dist = Math.sqrt(distSq);
          const overlap = (minDist - dist) / minDist;
          const push = overlap * dt * 30;
          pushX += (dx / dist) * push;
          pushZ += (dz / dist) * push;
        }
      }
    }

    // Yaw aus der Lissajous-Tangente (Ableitung der Kurve)
    const dX = -Math.sin(angleX) * fish.radiusX * fish.freqRatio * fish.direction;
    const dZ = Math.cos(angleZ) * fish.radiusZ * fish.direction;
    const baseYaw = Math.atan2(dX, dZ);
    const yawVar =
      Math.sin(elapsed * fish.yawFreq * Math.PI * 2) * fish.yawAmp;
    const targetYaw = baseYaw + yawVar + pushX * 0.02 + pushZ * 0.02;

    // Pitch aus vertikaler Bewegung
    const targetPitch =
      Math.sin(elapsed * fish.pitchFreq * Math.PI * 2) * fish.pitchAmp;

    // Roll: sanfte Neigung (max ±3.5°)
    const targetRoll = Math.sin(elapsed * 0.3 + fish.angle) * 0.06;

    fish.currentYaw += (targetYaw - fish.currentYaw) * lerp;
    fish.currentPitch += (targetPitch - fish.currentPitch) * lerp;
    fish.currentRoll += (targetRoll - fish.currentRoll) * lerp;
    fish.currentY += (clampedY - fish.currentY) * lerp;

    fish.mesh.position.set(px + pushX, fish.currentY, pz + pushZ);
    fish.mesh.rotation.set(0, 0, 0);
    fish.mesh.rotateY(fish.currentYaw);
    fish.mesh.rotateX(fish.currentPitch);
    fish.mesh.rotateZ(fish.currentRoll);
  }

  // -----------------------------------------------------------------------
  // Private: Schule aktualisieren
  // -----------------------------------------------------------------------

  private _updateSchool(
    school: FishSchool,
    dt: number,
    elapsed: number,
    cameraPos: THREE.Vector3,
  ): void {
    // Orbit-Position der Schule
    school.orbitAngle += school.orbitSpeed * dt;
    const cx = cameraPos.x + Math.cos(school.orbitAngle) * school.orbitRadius;
    const cz = cameraPos.z + Math.sin(school.orbitAngle) * school.orbitRadius;

    // Exklusion
    let pushX = 0;
    let pushZ = 0;
    if (this._exclusionZones.length > 0) {
      for (const zone of this._exclusionZones) {
        const dx = cx - zone.centerX;
        const dz = cz - zone.centerZ;
        const distSq = dx * dx + dz * dz;
        const minDist = zone.radius + 16;
        if (distSq < minDist * minDist && distSq > 0.01) {
          const dist = Math.sqrt(distSq);
          const overlap = 1 - dist / minDist;
          const push = overlap * overlap * 30 * dt;
          pushX += (dx / dist) * push;
          pushZ += (dz / dist) * push;
        }
      }
    }

    const centerX = cx + pushX;
    const centerZ = cz + pushZ;

    // Y-Position
    const schoolY =
      cameraPos.y +
      school.yOffset +
      Math.sin(elapsed * 0.06 * Math.PI * 2) * school.yAmp;
    const clampedY = Math.max(
      this.config.floorY + 2,
      Math.min(this.config.waterY - 0.5, schoolY),
    );

    // Basis-Yaw aus der Tangenten-Richtung
    const tX = -Math.sin(school.orbitAngle) * school.orbitRadius;
    const tZ = Math.cos(school.orbitAngle) * school.orbitRadius;
    const baseYaw = Math.atan2(tX, tZ);

    // Jeden Fisch positionieren
    const len = school.offsets.length;
    for (let j = 0; j < len; j++) {
      const o = school.offsets[j];

      o.angle += o.speedFactor * 0.08 * dt;
      const amp = 0.5 + o.speedFactor;
      const distPulse =
        1.0 +
        Math.sin(
          elapsed * (0.08 + o.speedFactor * 0.06) + o.phase * 0.5,
        ) * 0.15;

      const cosA = Math.cos(o.angle);
      const sinA = Math.sin(o.angle);
      const px = centerX + cosA * o.dist * distPulse;
      const pz = centerZ + sinA * o.dist * distPulse;
      const py =
        clampedY +
        o.ly +
        Math.sin(elapsed * (0.2 + o.speedFactor * 0.15) + o.phase) *
          (0.4 * amp);

      const yawVar =
        Math.sin(elapsed * (0.5 + o.speedFactor * 0.3) + o.phase) *
        (0.2 * amp);
      const pitch =
        Math.sin(elapsed * (0.4 + o.speedFactor * 0.2) + o.phase * 0.7) *
        (0.08 * amp);
      const roll =
        Math.cos(elapsed * (0.3 + o.speedFactor * 0.2) + o.phase * 0.3) *
        (0.12 * amp);
      const yaw = baseYaw + yawVar;

      this._tmpVec3.set(px, py, pz);
      this._tmpQuat.identity();
      this._tmpQuatA.setFromAxisAngle(this._up, yaw);
      this._tmpQuat.multiply(this._tmpQuatA);
      this._tmpQuatB.setFromAxisAngle(this._axisPitch, pitch);
      this._tmpQuat.multiply(this._tmpQuatB);
      this._tmpQuatA.setFromAxisAngle(this._axisRoll, roll);
      this._tmpQuat.multiply(this._tmpQuatA);
      this._tmpScale.set(school.fishScale, school.fishScale, school.fishScale);
      this._tmpMatrix.compose(this._tmpVec3, this._tmpQuat, this._tmpScale);
      school.instances.setMatrixAt(j, this._tmpMatrix);
    }
    school.instances.instanceMatrix.needsUpdate = true;
  }

  // -----------------------------------------------------------------------
  // Private: Echoortung
  // -----------------------------------------------------------------------

  private _updateEcholocationTargets(
    delta: number,
    elapsed: number,
    cameraPos: THREE.Vector3,
    additionalTargets?: EchoTarget[],
  ): void {
    if (!this.echolocation) return;

    const targets: EchoTarget[] = [];

    for (const fish of this.soloFish) {
      if (!fish.fishMesh) continue;
      fish._echoTarget.position.copy(fish.mesh.position);
      targets.push(fish._echoTarget);
    }

    if (this.school) {
      this.school._echoTarget.position.copy(
        this.school.instances.position,
      );
      targets.push(this.school._echoTarget);
    }

    if (additionalTargets) {
      for (const t of additionalTargets) {
        targets.push(t);
      }
    }

    this._echoOrigin.copy(cameraPos);
    this._echoOrigin.y -= 2.0;
    this.echolocation.update(elapsed, delta, this._echoOrigin, targets);
  }

  // -----------------------------------------------------------------------
  // Private: Glow
  // -----------------------------------------------------------------------

  private _applyGlowDecay(fish: SoloFishState, decay: number): void {
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

  private _applySchoolGlowDecay(school: FishSchool, decay: number): void {
    school.glowIntensity *= decay;
    const mat = school.instances.material as THREE.MeshStandardMaterial;
    if (school.glowIntensity > 0.01) {
      this._tmpColor
        .copy(school.originalEmissive)
        .lerp(this._glowColor, school.glowIntensity);
      mat.emissiveIntensity = 0.2 + school.glowIntensity * 1.8;
    } else {
      mat.emissive.copy(school.originalEmissive);
      mat.emissiveIntensity = 0;
    }
  }
}
