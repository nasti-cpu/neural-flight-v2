/**
 * largeCreatureWorld.ts – Delfine + Hai auf grossen Orbits
 *
 * Genau 2 Delfine + 1 Hai werden einmal geladen und schwimmen
 * auf weiten elliptischen Bahnen um den Spielerstart.
 *
 * Delfin und Hai sind phasenverschoben, sodass sie nie gleichzeitig
 * im Sichtfeld sind – und durch die grossen Radien tauchen sie
 * insgesamt seltener auf als die Quallen.
 */

import * as THREE from "three/webgpu";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { EchoTarget } from "../sinne/echoortung/echolocationRings";

// ---------------------------------------------------------------------------
// Konfiguration
// ---------------------------------------------------------------------------

export interface LargeCreatureConfig {
  floorY: number;
  waterY: number;
}

// ---------------------------------------------------------------------------
// Eine Kreatur
// ---------------------------------------------------------------------------

interface CreatureState {
  mesh: THREE.Group;
  type: "delfin" | "hai";

  /** Ellipsen-Parameter */
  centerX: number;
  centerZ: number;
  radiusX: number;
  radiusZ: number;
  speed: number;
  angle: number;
  /** Langsam rotierender Ellipsen-Winkel → kommt von allen Seiten */
  orbitRot: number;
  orbitRotSpeed: number;

  /** Y */
  baseY: number;

  /** Lerp-Zustand */
  currentPitch: number;
  currentRoll: number;
  currentYaw: number;
  currentY: number;

  // Delfin-spezifisch
  porpoiseAmp: number;
  porpoiseFreq: number;

  // Hai-spezifisch
  yawAmp: number;
  yawFreq: number;
  depthAmp: number;
  depthFreq: number;

  // Echoortung
  glowIntensity: number;
  creatureMeshes: THREE.Mesh[];
  originalEmissives: THREE.Color[];
  echoTarget: EchoTarget;
}

// ---------------------------------------------------------------------------
// Hauptklasse
// ---------------------------------------------------------------------------

export class LargeCreatureWorld {
  private scene: THREE.Scene;
  private config: LargeCreatureConfig;
  private loader: GLTFLoader;

  private _creatures: CreatureState[] = [];

  private _glowColor = new THREE.Color(0xffaa00);
  private _tmpColor = new THREE.Color();

  constructor(scene: THREE.Scene, config: LargeCreatureConfig) {
    this.scene = scene;
    this.config = config;
    this.loader = new GLTFLoader();
  }

  // ---------------------------------------------------------------------------
  // init – Lädt Modelle + erzeugt 2 Delfine + 1 Hai
  // ---------------------------------------------------------------------------

  async init(): Promise<void> {
    const [dolphinTemplate, sharkTemplate] = await Promise.all([
      this._loadModel("/3D Modelle/Dolphin.glb"),
      this._loadModel("/3D Modelle/Shark.glb"),
    ]);

    if (!dolphinTemplate || !sharkTemplate) {
      console.warn("⚠️ Delfin/Hai-Modell fehlt – große Tiere deaktiviert");
      return;
    }

    // Delfin skalieren
    let box = new THREE.Box3().setFromObject(dolphinTemplate);
    let size = new THREE.Vector3();
    box.getSize(size);
    dolphinTemplate.scale.setScalar(10 / size.z);
    dolphinTemplate.traverse((ch) => {
      if (ch instanceof THREE.Mesh) {
        ch.castShadow = true;
        ch.receiveShadow = true;
      }
    });

    // Hai skalieren
    box = new THREE.Box3().setFromObject(sharkTemplate);
    size = new THREE.Vector3();
    box.getSize(size);
    const longestAxis = Math.max(size.x, size.y, size.z);
    sharkTemplate.scale.setScalar(12 / longestAxis);
    sharkTemplate.traverse((ch) => {
      if (ch instanceof THREE.Mesh) {
        ch.castShadow = true;
        ch.receiveShadow = true;
      }
    });

    // ═══ 2 Delfine ═══
    const dolphinBaseAngle = Math.random() * Math.PI * 2;
    for (let i = 0; i < 2; i++) {
      const mesh = dolphinTemplate.clone(true);
      const state = this._createDolphinState(
        mesh,
        0, 0,
        8 + i * 2, 50,
        0.08,
        dolphinBaseAngle + i * Math.PI, // 180° Versatz untereinander
        8 + Math.random() * 6, // baseY in der sicheren Mittelzone (8–14)
        i,
      );
      mesh.position.set(state.centerX + 8, state.baseY, state.centerZ);
      this.scene.add(mesh);
      this._creatures.push(state);
    }

    // ═══ 1 Hai (180° Phasenversatz zu den Delfinen) ═══
    {
      const mesh = sharkTemplate.clone(true);
      const state = this._createSharkState(
        mesh,
        0, 0,
        50, 6,
        0.05,
        dolphinBaseAngle + Math.PI, // 180° weg von den Delfinen
        5 + Math.random() * 4, // baseY leicht unter den Delfinen (5–9)
      );
      mesh.position.set(state.centerX, state.baseY, state.centerZ);
      this.scene.add(mesh);
      this._creatures.push(state);
    }

    console.log(
      "🐬🦈 2 Delfine + 1 Hai gestartet – grosse Orbits, phasenversetzt",
    );
  }

  // ---------------------------------------------------------------------------
  // update
  // ---------------------------------------------------------------------------

  update(delta: number, elapsed: number, cameraPos: THREE.Vector3): void {
    const dt = Math.min(delta, 0.05);
    const glowDecay = Math.exp(-3.0 * delta);

    for (const creature of this._creatures) {
      this._updateCreature(creature, dt, elapsed, cameraPos);
      creature.echoTarget.position.copy(creature.mesh.position);
      this._applyGlowDecay(creature, glowDecay);
    }
  }

  // ---------------------------------------------------------------------------
  // Echo-Targets
  // ---------------------------------------------------------------------------

  getEchoTargets(): EchoTarget[] {
    return this._creatures.map((c) => c.echoTarget);
  }

  // ---------------------------------------------------------------------------
  // setExclusionZones (nicht mehr nötig – Tiere sind auf weiten Orbits)
  // ---------------------------------------------------------------------------

  setExclusionZones(_zones: unknown[]): void {
    // wird nicht mehr verwendet
  }

  // ---------------------------------------------------------------------------
  // dispose
  // ---------------------------------------------------------------------------

  dispose(): void {
    for (const creature of this._creatures) {
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
    this._creatures.length = 0;
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

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

  private _createDolphinState(
    mesh: THREE.Group,
    centerX: number,
    centerZ: number,
    radiusX: number,
    radiusZ: number,
    speed: number,
    angle: number,
    baseY: number,
    index: number,
  ): CreatureState {
    const ref: CreatureState = {
      mesh,
      type: "delfin",
      centerX,
      centerZ,
      radiusX,
      radiusZ,
      speed,
        angle,
        orbitRot: Math.random() * Math.PI * 2,
        orbitRotSpeed: (Math.random() - 0.5) * 0.008,
        baseY,
        currentPitch: 0,
        currentRoll: 0,
        currentYaw: 0,
        currentY: baseY,
        porpoiseAmp: 2 + Math.random() * 1.5,
      porpoiseFreq: 0.08 + Math.random() * 0.04,
      yawAmp: 0,
      yawFreq: 0,
      depthAmp: 0,
      depthFreq: 0,
      glowIntensity: 0,
      creatureMeshes: [],
      originalEmissives: [],
      echoTarget: { position: new THREE.Vector3(), onHit: () => {} },
    };
    ref.echoTarget.onHit = (intensity: number) => { ref.glowIntensity = intensity; };
    this._findMesh(ref);
    return ref;
  }

  private _createSharkState(
    mesh: THREE.Group,
    centerX: number,
    centerZ: number,
    radiusX: number,
    radiusZ: number,
    speed: number,
    angle: number,
    baseY: number,
  ): CreatureState {
    const ref: CreatureState = {
      mesh,
      type: "hai",
      centerX,
      centerZ,
      radiusX,
      radiusZ,
      speed,
      angle,
      orbitRot: Math.random() * Math.PI * 2,
      orbitRotSpeed: (Math.random() - 0.5) * 0.008,
      baseY,
      currentPitch: 0,
      currentRoll: 0,
      currentYaw: 0,
      currentY: baseY,
      porpoiseAmp: 0,
      porpoiseFreq: 0,
      yawAmp: 0.06 + Math.random() * 0.04,
      yawFreq: 0.3 + Math.random() * 0.1,
      depthAmp: 3 + Math.random() * 2,
      depthFreq: 0.04 + Math.random() * 0.03,
      glowIntensity: 0,
      creatureMeshes: [],
      originalEmissives: [],
      echoTarget: { position: new THREE.Vector3(), onHit: () => {} },
    };
    ref.echoTarget.onHit = (intensity: number) => { ref.glowIntensity = intensity; };
    this._findMesh(ref);
    return ref;
  }

  private _findMesh(creature: CreatureState): void {
    creature.mesh.traverse((ch) => {
      if (ch instanceof THREE.Mesh) {
        creature.creatureMeshes.push(ch);
        const mat = ch.material as THREE.MeshStandardMaterial;
        creature.originalEmissives.push(
          mat.emissive
            ? mat.emissive.clone()
            : new THREE.Color(0x000000),
        );
      }
    });
  }

  private _applyGlowDecay(creature: CreatureState, decay: number): void {
    if (creature.creatureMeshes.length === 0) return;
    creature.glowIntensity *= decay;
    const isActive = creature.glowIntensity > 0.01;
    for (let i = 0; i < creature.creatureMeshes.length; i++) {
      const mesh = creature.creatureMeshes[i];
      const orig = creature.originalEmissives[i];
      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (isActive) {
        this._tmpColor
          .copy(orig)
          .lerp(this._glowColor, creature.glowIntensity);
        mat.emissive.copy(this._tmpColor);
        mat.emissiveIntensity = 0.2 + creature.glowIntensity * 1.8;
      } else {
        mat.emissive.copy(orig);
        mat.emissiveIntensity = 0;
      }
    }
  }

  private _updateCreature(
    creature: CreatureState,
    dt: number,
    elapsed: number,
    cameraPos: THREE.Vector3,
  ): void {
    const { mesh, type, radiusX, radiusZ, speed, baseY } = creature;

    creature.angle += speed * dt;
    creature.orbitRot += creature.orbitRotSpeed * dt;

    // ── Rotierte Ellipse: cos/sin der Ellipse werden um orbitRot gedreht ──
    const cosA = Math.cos(creature.angle);
    const sinA = Math.sin(creature.angle);
    const cosRot = Math.cos(creature.orbitRot);
    const sinRot = Math.sin(creature.orbitRot);
    const rx = cosA * radiusX;
    const rz = sinA * radiusZ;
    const px = cameraPos.x + rx * cosRot - rz * sinRot;
    const pz = cameraPos.z + rx * sinRot + rz * cosRot;

    // ── Y + Rotation ──
    const lerpSpeed = 3.5;
    const lerp = 1 - Math.exp(-lerpSpeed * dt);

    if (type === "delfin") {
      const porpoisePhase = elapsed * creature.porpoiseFreq * Math.PI * 2;
      const porpoiseRaw = Math.sin(porpoisePhase);
      const porpoiseY =
        porpoiseRaw > 0 ? porpoiseRaw * creature.porpoiseAmp : 0;
      const targetY = baseY + porpoiseY;
      const targetPitch = Math.sin(elapsed * 0.6 * Math.PI * 2) * 0.06;
      const targetRoll =
        Math.cos(creature.angle) * Math.sin(elapsed * 0.5) * 0.06;

      creature.currentPitch += (targetPitch - creature.currentPitch) * lerp;
      creature.currentRoll += (targetRoll - creature.currentRoll) * lerp;
      creature.currentY += (targetY - creature.currentY) * lerp;
    } else {
      const depthOffset =
        Math.sin(elapsed * creature.depthFreq * Math.PI * 2) *
        creature.depthAmp;
      const targetY = baseY + depthOffset;
      const targetYaw =
        Math.sin(elapsed * creature.yawFreq * Math.PI * 2) * creature.yawAmp;
      const targetPitch = Math.sin(elapsed * 0.2 * Math.PI * 2) * 0.03;
      const targetRoll =
        Math.cos(creature.angle) * Math.sin(elapsed * 0.4) * 0.1;

      creature.currentYaw += (targetYaw - creature.currentYaw) * lerp;
      creature.currentPitch += (targetPitch - creature.currentPitch) * lerp;
      creature.currentRoll += (targetRoll - creature.currentRoll) * lerp;
      creature.currentY += (targetY - creature.currentY) * lerp;
    }

    // Sicherheitsabstand: 4m vom Boden, 4m von der Oberfläche
    creature.currentY = Math.max(
      this.config.floorY + 4,
      Math.min(this.config.waterY - 4, creature.currentY),
    );

    // ── Yaw aus der rotierten Ellipsen-Tangente ──
    const dRx = -sinA * radiusX;
    const dRz = cosA * radiusZ;
    const tangentX = dRx * cosRot - dRz * sinRot;
    const tangentZ = dRx * sinRot + dRz * cosRot;
    const baseYaw = Math.atan2(tangentX, tangentZ);

    mesh.position.set(px, creature.currentY, pz);
    mesh.rotation.set(0, 0, 0);
    mesh.rotateY(baseYaw + creature.currentYaw);
    mesh.rotateX(creature.currentPitch);
    mesh.rotateZ(creature.currentRoll);
  }
}
