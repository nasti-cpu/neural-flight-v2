/**
 * jellyWorld.ts – Mondquallen, reduziert auf 5 Stück mit großen Orbits.
 *
 * Änderung: Statt einem Territorium pro FISCH-Chunk gibt es genau
 * 5 Quallen (2 Solo + 1 Dreier-Gruppe), die auf großen elliptischen
 * Bahnen umherschwimmen und dabei immer wieder im Nebel verschwinden.
 *
 * So wirkt es zufällig, wann und wo sie auftauchen – genau wie die Fische.
 */

import * as THREE from "three/webgpu";
import {
  buildMoonJelly,
  cloneJelly,
  animateProceduralJelly,
  type ProceduralJelly,
} from "../animationen/quallen/proceduralJelly";
import type { EchoTarget } from "../sinne/echoortung/echolocationRings";

// ---------------------------------------------------------------------------
// Konfiguration
// ---------------------------------------------------------------------------

export interface JellyWorldConfig {
  floorY: number;
  waterY: number;
}

const DEFAULT_CONFIG: JellyWorldConfig = {
  floorY: -4,
  waterY: 15,
};

// ---------------------------------------------------------------------------
// Eine einzelne Qualle mit großen Orbits
// ---------------------------------------------------------------------------

interface JellyMember {
  jelly: ProceduralJelly;

  /** Zentrum der großen Ellipse (Welt-Koordinaten) */
  centerX: number;
  centerZ: number;

  /** Ellipsen-Radien für den grossen Orbit (30–50 Einheiten) */
  orbitRadiusX: number;
  orbitRadiusZ: number;

  /** Geschwindigkeit auf dem grossen Orbit */
  orbitSpeed: number;
  /** Start-Winkel auf dem grossen Orbit */
  orbitAngle: number;

  /** Y-Basis */
  baseY: number;

  /** Teil der 3er-Gruppe? */
  isGrouped: boolean;
  /** Radius innerhalb der Gruppe (nur grouped) */
  groupMemberRadius: number;
  /** Winkel innerhalb der Gruppe (nur grouped) */
  groupMemberAngle: number;

  /** Animations-Phase (individuell) */
  animPhase: number;

  // Glow (Echoortung)
  glowIntensity: number;
  originalEmissive: THREE.Color | null;
}

// ---------------------------------------------------------------------------
// Hauptklasse
// ---------------------------------------------------------------------------

export class JellyWorld {
  private scene: THREE.Scene;
  private config: JellyWorldConfig;

  /** Alle 5 Quallen als flaches Array */
  private _members: JellyMember[] = [];

  /** Pool fürs Klonen */
  private _template: ProceduralJelly | null = null;

  private readonly JELLY_PARAMS = {
    pulseSpeed: 0.9,
    liftStrength: 0.3,
    driftSpeed: 0.12,
  };

  // Echoortung
  private _cachedEchoTargets: EchoTarget[] = [];
  private _glowColor = new THREE.Color(0xffaa00);
  private _tmpColor = new THREE.Color();

  constructor(scene: THREE.Scene, config?: Partial<JellyWorldConfig>) {
    this.scene = scene;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // -----------------------------------------------------------------------
  // Echo-Targets
  // -----------------------------------------------------------------------

  getEchoTargets(): EchoTarget[] {
    this._cachedEchoTargets.length = 0;
    for (const member of this._members) {
      this._cachedEchoTargets.push({
        position: member.jelly.group.position,
        onHit: () => {
          member.glowIntensity = 1.0;
        },
      });
    }
    return this._cachedEchoTargets;
  }

  // -----------------------------------------------------------------------
  // Init – baut genau 5 Quallen
  // -----------------------------------------------------------------------

  async init(_cameraPos?: THREE.Vector3): Promise<void> {
    this._template = buildMoonJelly();

    // ═══ 2 Einzel-Quallen ═══
    for (let i = 0; i < 2; i++) {
      this._createSolo(i);
    }

    // ═══ 1 Gruppe aus 3 Quallen ═══
    this._createGroup();

    console.log("🪼 5 Mondquallen gestartet (2 Solo + 1 Gruppe)");
  }

  // -----------------------------------------------------------------------
  // Update – jeden Frame
  // -----------------------------------------------------------------------

  update(delta: number, elapsed: number, _cameraPos: THREE.Vector3): void {
    const dt = Math.min(delta, 0.05);
    const glowDecay = Math.exp(-3.0 * delta);

    for (const member of this._members) {
      this._updateMember(member, dt, elapsed);
      this._applyGlowDecay(member, glowDecay);
    }
  }

  // -----------------------------------------------------------------------
  // dispose
  // -----------------------------------------------------------------------

  dispose(): void {
    for (const member of this._members) {
      this.scene.remove(member.jelly.group);
      this._disposeJelly(member.jelly);
    }
    this._members.length = 0;

    if (this._template) {
      this._disposeJelly(this._template);
      this._template = null;
    }
  }

  // -----------------------------------------------------------------------
  // Private: Qualle aus Template klonen
  // -----------------------------------------------------------------------

  private _makeJelly(): ProceduralJelly {
    if (!this._template) {
      this._template = buildMoonJelly();
    }
    const clone = cloneJelly(this._template);

    // Skalieren: 35 % der Originalgröße (die Quallen waren zu groß)
    clone.group.scale.setScalar(0.35);

    return clone;
  }

  // -----------------------------------------------------------------------
  // Private: 2 Einzel-Quallen mit grossem Orbit
  // -----------------------------------------------------------------------

  private _createSolo(index: number): void {
    const jelly = this._makeJelly();

    // Weit gestreute Zentren, damit sie nie alle gleichzeitig sichtbar sind
    const centerAngle = (index / 2) * Math.PI + Math.random() * 0.5;
    const centerDist = 8 + Math.random() * 8;
    const centerX = Math.cos(centerAngle) * centerDist;
    const centerZ = Math.sin(centerAngle) * centerDist;

    const origEmissive =
      jelly.bell.material instanceof THREE.MeshPhysicalMaterial
        ? (jelly.bell.material.emissive?.clone() ?? new THREE.Color(0x000000))
        : new THREE.Color(0x000000);

    this.scene.add(jelly.group);

    this._members.push({
      jelly,
      centerX,
      centerZ,
      orbitRadiusX: 30 + Math.random() * 25,
      orbitRadiusZ: 30 + Math.random() * 25,
      orbitSpeed: 0.04 + Math.random() * 0.04,
      orbitAngle: Math.random() * Math.PI * 2,
      baseY:
        this.config.floorY +
        1.5 +
        Math.random() * (this.config.waterY - this.config.floorY - 3),
      isGrouped: false,
      groupMemberRadius: 0,
      groupMemberAngle: 0,
      animPhase: Math.random() * Math.PI * 2,
      glowIntensity: 0,
      originalEmissive: origEmissive,
    });
  }

  // -----------------------------------------------------------------------
  // Private: 1 Gruppe aus 3 Quallen
  // -----------------------------------------------------------------------

  private _createGroup(): void {
    // Gruppen-Zentrum – nah am Ursprung, damit sie oft sichtbar sind
    const centerX = (Math.random() - 0.5) * 6;
    const centerZ = (Math.random() - 0.5) * 6;

    for (let i = 0; i < 3; i++) {
      const jelly = this._makeJelly();

      const origEmissive =
        jelly.bell.material instanceof THREE.MeshPhysicalMaterial
          ? (jelly.bell.material.emissive?.clone() ?? new THREE.Color(0x000000))
          : new THREE.Color(0x000000);

      this.scene.add(jelly.group);

      this._members.push({
        jelly,
        centerX,
        centerZ,
        orbitRadiusX: 25 + Math.random() * 15,
        orbitRadiusZ: 25 + Math.random() * 15,
        orbitSpeed: 0.03 + Math.random() * 0.03,
        orbitAngle: (i / 3) * Math.PI * 2 + Math.random() * 0.3,
        baseY:
          this.config.floorY +
          2 +
          Math.random() * (this.config.waterY - this.config.floorY - 5),
        isGrouped: true,
        groupMemberRadius: 1.5 + Math.random() * 1.5,
        groupMemberAngle: (i / 3) * Math.PI * 2 + Math.random() * 0.5,
        animPhase: Math.random() * Math.PI * 2,
        glowIntensity: 0,
        originalEmissive: origEmissive,
      });
    }
  }

  // -----------------------------------------------------------------------
  // Private: Eine Qualle animieren
  // -----------------------------------------------------------------------

  private _updateMember(
    member: JellyMember,
    delta: number,
    elapsed: number,
  ): void {
    const { jelly, centerX, centerZ, orbitRadiusX, orbitRadiusZ, orbitSpeed } =
      member;

    // ═══ Grosser Orbit ═══
    member.orbitAngle += orbitSpeed * delta;
    const orbitX = Math.cos(member.orbitAngle) * orbitRadiusX;
    const orbitZ = Math.sin(member.orbitAngle) * orbitRadiusZ;

    let px = centerX + orbitX;
    let pz = centerZ + orbitZ;

    // ═══ Gruppen-Offset (kleiner Orbit innerhalb der Gruppe) ═══
    if (member.isGrouped) {
      const ma = elapsed * 0.15 + member.groupMemberAngle;
      px += Math.cos(ma) * member.groupMemberRadius;
      pz += Math.sin(ma) * member.groupMemberRadius;
    }

    // ═══ Position setzen ═══
    jelly.group.position.x = px;
    jelly.group.position.z = pz;

    // ═══ Prozedurale Animation (Puls, Tentakel, Y-Lift) ═══
    const jellyElapsed = elapsed + member.animPhase;
    animateProceduralJelly(
      jelly,
      jellyElapsed,
      delta,
      this.JELLY_PARAMS,
      false,
    );

    // Y: animateProceduralJelly setzt group.position.y auf lift + depthWave.
    // Wir addieren baseY.
    jelly.group.position.y += member.baseY;

    // Y-Begrenzung
    jelly.group.position.y = Math.max(
      this.config.floorY + 0.5,
      Math.min(this.config.waterY - 0.5, jelly.group.position.y),
    );

    // ═══ Sanfte Rotation zur Bewegungsrichtung (nur grob) ═══
    const dirX = -Math.sin(member.orbitAngle) * orbitRadiusX;
    const dirZ = Math.cos(member.orbitAngle) * orbitRadiusZ;
    const yaw = Math.atan2(dirX, dirZ);
    jelly.group.rotation.y = yaw;
  }

  // -----------------------------------------------------------------------
  // Private: Glow-Effekt nach Echo-Treffer
  // -----------------------------------------------------------------------

  private _applyGlowDecay(member: JellyMember, decay: number): void {
    if (member.glowIntensity < 0.01) return;
    member.glowIntensity *= decay;

    const mat = member.jelly.bell.material as THREE.MeshPhysicalMaterial;
    if (member.glowIntensity > 0.01) {
      this._tmpColor
        .copy(member.originalEmissive ?? this._tmpColor.set(0x000000))
        .lerp(this._glowColor, member.glowIntensity);
      mat.emissive.copy(this._tmpColor);
      mat.emissiveIntensity = 0.2 + member.glowIntensity * 1.8;
    } else {
      if (member.originalEmissive) mat.emissive.copy(member.originalEmissive);
      mat.emissiveIntensity = 0;
    }
  }

  // -----------------------------------------------------------------------
  // Private: Disposal
  // -----------------------------------------------------------------------

  private _disposeJelly(jelly: ProceduralJelly): void {
    jelly.bell.geometry?.dispose();
    (jelly.bell.material as THREE.Material)?.dispose();

    const disposeChildren = (obj: THREE.Object3D) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry?.dispose();
        if (Array.isArray(obj.material)) {
          for (const m of obj.material) m.dispose();
        } else {
          (obj.material as THREE.Material)?.dispose();
        }
      }
      for (const child of obj.children) {
        disposeChildren(child);
      }
    };
    for (const root of jelly.tentacleRoots) disposeChildren(root);
    for (const arm of jelly.oralArms) disposeChildren(arm);
  }
}
