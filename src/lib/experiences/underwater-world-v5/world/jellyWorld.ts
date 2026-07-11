/**
 * jellyWorld.ts – Mondquallen chunk-basiert wie die Fische.
 *
 * Jedes Territorium (FISCH-Chunk) enthält 5 Quallen:
 *   2 Einzel-Quallen (schwimmen allein auf kleinen Orbits)
 *   1 Gruppe aus 3 Quallen (orbites Gruppen-Zentrum + individueller Orbit)
 *
 * Die Quallen werden prozedural gebaut (SphereGeometry + TubeGeometry)
 * und via Pool geklont – das ist günstiger als jedes Mal neu zu bauen.
 */

import * as THREE from "three/webgpu";
import {
  buildMoonJelly,
  cloneJelly,
  animateProceduralJelly,
  type ProceduralJelly,
} from "../animationen/quallen/proceduralJelly";
import type { ExclusionZone } from "./cityWorld";
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

const UNLOAD_DIST = 90;
const UNLOAD_DIST_SQ = UNLOAD_DIST * UNLOAD_DIST;

// ---------------------------------------------------------------------------
// Eine einzelne Qualle im Territorium
// ---------------------------------------------------------------------------

interface JellyMember {
  jelly: ProceduralJelly;

  /** Heimat-Position (Chunk-Zentrum + Offset) */
  homeX: number;
  homeZ: number;
  /** Basis-Y im Wasser */
  baseY: number;

  /** Ist diese Qualle Teil der 3er-Gruppe? */
  isGrouped: boolean;
  /** Wenn grouped: Winkel der Gruppe um das Territorium */
  groupAngle: number;
  /** Wenn grouped: Radius der Gruppe um das Territorium */
  groupRadius: number;
  /** Wenn grouped: Winkel dieser Qualle innerhalb der Gruppe */
  memberAngle: number;

  /** Wenn solo: eigener kleiner Orbit (Winkel, Radius, Geschwindigkeit) */
  soloAngle: number;
  soloOrbitRadius: number;
  soloOrbitSpeed: number;

  /** Animations-Phase (individuell) */
  animPhase: number;

  // Glow (Echoortung)
  glowIntensity: number;
  originalEmissive: THREE.Color | null;
}

// ---------------------------------------------------------------------------
// Ein Territorium = alle Quallen eines Chunks
// ---------------------------------------------------------------------------

interface JellyTerritory {
  chunkX: number;
  chunkZ: number;
  centerX: number;
  centerZ: number;
  members: JellyMember[];
}

// ---------------------------------------------------------------------------
// Hauptklasse
// ---------------------------------------------------------------------------

export class JellyWorld {
  private scene: THREE.Scene;
  private config: JellyWorldConfig;

  /** Alle Territorien, key = "chunkX,chunkZ" */
  private _territories: Map<string, JellyTerritory> = new Map();

  /** Exklusionszonen (Stadt-Kuppeln) */
  private _exclusionZones: ExclusionZone[] = [];

  /** Pool: Einmal gebaute Quallen werden via cloneJelly() wiederverwendet */
  private _jellyPool: ProceduralJelly[] = [];

  /** Animations-Parameter (wie bisher) */
  private readonly MOON_PARAMS = {
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
  // Exklusionszonen
  // -----------------------------------------------------------------------

  setExclusionZones(zones: ExclusionZone[], _cameraPos?: THREE.Vector3): void {
    this._exclusionZones = zones;
  }

  // -----------------------------------------------------------------------
  // Echo-Targets für die Echoortung
  // -----------------------------------------------------------------------

  getEchoTargets(): EchoTarget[] {
    this._cachedEchoTargets.length = 0;
    for (const [, territory] of this._territories) {
      for (const member of territory.members) {
        this._cachedEchoTargets.push({
          position: member.jelly.group.position,
          onHit: () => {
            member.glowIntensity = 1.0;
          },
        });
      }
    }
    return this._cachedEchoTargets;
  }

  // -----------------------------------------------------------------------
  // Initialisierung – baut den Quallen-Pool vor
  // -----------------------------------------------------------------------

  async init(_cameraPos?: THREE.Vector3): Promise<void> {
    // 15 Quallen vorab bauen (reicht für 3 Territories à 5)
    // Falls mehr gebraucht werden, bauen wir on-demand nach
    for (let i = 0; i < 15; i++) {
      this._jellyPool.push(buildMoonJelly());
    }
    console.log("🪼 JellyWorld bereit – wartet auf FISCH-Chunks");
  }

  // -----------------------------------------------------------------------
  // WFC-Callback: Neues Territorium an einem FISCH-Chunk registrieren
  // -----------------------------------------------------------------------

  registerJellyAtChunk(cx: number, cz: number): void {
    const key = `${cx},${cz}`;
    if (this._territories.has(key)) return;

    const cs = 16;
    const worldX = cx * cs + cs / 2;
    const worldZ = cz * cs + cs / 2;

    const members: JellyMember[] = [];

    // ═══ 2 Einzel-Quallen (solo) ═══
    for (let i = 0; i < 2; i++) {
      const jelly = this._getJellyFromPool();
      const homeX = worldX + (Math.random() - 0.5) * 8;
      const homeZ = worldZ + (Math.random() - 0.5) * 8;
      const baseY =
        this.config.floorY + 1.5 + Math.random() * (this.config.waterY - this.config.floorY - 3);

      const origEmissive = jelly.bell.material instanceof THREE.MeshPhysicalMaterial
        ? (jelly.bell.material.emissive?.clone() ?? new THREE.Color(0x000000))
        : new THREE.Color(0x000000);

      jelly.group.position.set(homeX, baseY, homeZ);
      this.scene.add(jelly.group);

      members.push({
        jelly,
        homeX,
        homeZ,
        baseY,
        isGrouped: false,
        groupAngle: 0,
        groupRadius: 0,
        memberAngle: 0,
        soloAngle: Math.random() * Math.PI * 2,
        soloOrbitRadius: 2 + Math.random() * 3,
        soloOrbitSpeed: 0.08 + Math.random() * 0.08,
        animPhase: Math.random() * Math.PI * 2,
        glowIntensity: 0,
        originalEmissive: origEmissive,
      });
    }

    // ═══ 1 Gruppe aus 3 Quallen ═══
    const groupCenterX = worldX + (Math.random() - 0.5) * 6;
    const groupCenterZ = worldZ + (Math.random() - 0.5) * 6;
    const groupBaseY =
      this.config.floorY + 1.5 + Math.random() * (this.config.waterY - this.config.floorY - 3);
    const groupRadius = 3 + Math.random() * 3;
    const groupAngle = Math.random() * Math.PI * 2;

    for (let i = 0; i < 3; i++) {
      const jelly = this._getJellyFromPool();
      const mAngle = (i / 3) * Math.PI * 2 + Math.random() * 0.5;
      const oRadius = 0.8 + Math.random() * 1.2;
      const yOffset = (Math.random() - 0.5) * 1.0;

      const origEmissive = jelly.bell.material instanceof THREE.MeshPhysicalMaterial
        ? (jelly.bell.material.emissive?.clone() ?? new THREE.Color(0x000000))
        : new THREE.Color(0x000000);

      jelly.group.position.set(
        groupCenterX + Math.cos(mAngle) * oRadius,
        groupBaseY + yOffset,
        groupCenterZ + Math.sin(mAngle) * oRadius,
      );
      this.scene.add(jelly.group);

      members.push({
        jelly,
        homeX: groupCenterX,
        homeZ: groupCenterZ,
        baseY: groupBaseY,
        isGrouped: true,
        groupAngle,
        groupRadius,
        memberAngle: mAngle,
        soloAngle: 0,
        soloOrbitRadius: oRadius,
        soloOrbitSpeed: 0,
        animPhase: Math.random() * Math.PI * 2,
        glowIntensity: 0,
        originalEmissive: origEmissive,
      });
    }

    this._territories.set(key, {
      chunkX: cx,
      chunkZ: cz,
      centerX: worldX,
      centerZ: worldZ,
      members,
    });
  }

  // -----------------------------------------------------------------------
  // Update – jeden Frame von scene.ts aufgerufen
  // -----------------------------------------------------------------------

  update(delta: number, elapsed: number, cameraPos: THREE.Vector3): void {
    const dt = Math.min(delta, 0.05);
    const glowDecay = Math.exp(-3.0 * delta);

    // Territories verwalten (laden/entladen)
    this._manageLifecycle(cameraPos);

    // Alle sichtbaren Quallen animieren
    for (const [, territory] of this._territories) {
      for (const member of territory.members) {
        this._updateMember(member, dt, elapsed);
        this._applyGlowDecay(member, glowDecay);
      }
    }
  }

  // -----------------------------------------------------------------------
  // dispose
  // -----------------------------------------------------------------------

  dispose(): void {
    for (const [, territory] of this._territories) {
      this._unloadTerritory(territory);
    }
    this._territories.clear();

    // Pool leeren
    for (const jelly of this._jellyPool) {
      this._disposeJelly(jelly);
    }
    this._jellyPool.length = 0;
  }

  // -----------------------------------------------------------------------
  // Private: Qualle aus dem Pool holen (oder nachbauen)
  // -----------------------------------------------------------------------

  private _getJellyFromPool(): ProceduralJelly {
    if (this._jellyPool.length > 0) {
      const template = this._jellyPool.pop()!;
      return cloneJelly(template);
    }
    // Pool leer → neue Qualle bauen
    return buildMoonJelly();
  }

  // -----------------------------------------------------------------------
  // Private: Lebenszyklus der Territorien
  // -----------------------------------------------------------------------

  private _manageLifecycle(cameraPos: THREE.Vector3): void {
    for (const [key, territory] of this._territories) {
      const dx = territory.centerX - cameraPos.x;
      const dz = territory.centerZ - cameraPos.z;
      if (dx * dx + dz * dz > UNLOAD_DIST_SQ) {
        this._unloadTerritory(territory);
        this._territories.delete(key);
      }
    }
  }

  private _unloadTerritory(territory: JellyTerritory): void {
    for (const member of territory.members) {
      this.scene.remove(member.jelly.group);
      this._disposeJelly(member.jelly);
    }
  }

  /** Entsorgt die Geometrien und Materialien einer Qualle */
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

  // -----------------------------------------------------------------------
  // Private: Exklusionszonen-Prüfung
  // -----------------------------------------------------------------------

  private _isInExclusionZone(x: number, z: number, margin: number = 0): boolean {
    for (const zone of this._exclusionZones) {
      const dx = x - zone.centerX;
      const dz = z - zone.centerZ;
      const effectiveRadius = zone.radius + margin;
      if (dx * dx + dz * dz < effectiveRadius * effectiveRadius) return true;
    }
    return false;
  }

  // -----------------------------------------------------------------------
  // Private: Eine Qualle animieren
  // -----------------------------------------------------------------------

  private _updateMember(member: JellyMember, delta: number, elapsed: number): void {
    const { jelly, isGrouped, homeX, homeZ, baseY } = member;

    // ═══ Position berechnen ═══
    let px: number;
    let pz: number;

    if (isGrouped) {
      // Gruppe: Das Gruppen-Zentrum wandert langsam um das Chunk-Zentrum
      const groupAng = member.groupAngle + elapsed * 0.03;
      const gx = homeX + Math.cos(groupAng) * member.groupRadius;
      const gz = homeZ + Math.sin(groupAng) * member.groupRadius;

      // Jede Qualle orbites das Gruppen-Zentrum
      const memberAng = elapsed * 0.2 + member.memberAngle + member.animPhase * 0.3;
      px = gx + Math.cos(memberAng) * member.soloOrbitRadius;
      pz = gz + Math.sin(memberAng) * member.soloOrbitRadius;
    } else {
      // Solo: kleiner Orbit um die Heimat-Position
      member.soloAngle += member.soloOrbitSpeed * delta;
      px = homeX + Math.cos(member.soloAngle) * member.soloOrbitRadius;
      pz = homeZ + Math.sin(member.soloAngle) * member.soloOrbitRadius;
    }

    // ═══ Exklusionszonen (Städte) – sanft wegdrücken ═══
    if (this._exclusionZones.length > 0) {
      for (const zone of this._exclusionZones) {
        const dx = px - zone.centerX;
        const dz = pz - zone.centerZ;
        const distSq = dx * dx + dz * dz;
        const effectRadius = zone.radius + 8;
        if (distSq < effectRadius * effectRadius && distSq > 0.01) {
          const dist = Math.sqrt(distSq);
          const overlap = 1 - dist / effectRadius;
          const push = overlap * overlap * 6;
          px += (dx / dist) * push;
          pz += (dz / dist) * push;
        }
      }
    }

    // ═══ X/Z setzen ═══
    jelly.group.position.x = px;
    jelly.group.position.z = pz;

    // ═══ Prozedurale Animation (Puls, Tentakel, Y-Lift) ═══
    const jellyElapsed = elapsed + member.animPhase;
    animateProceduralJelly(jelly, jellyElapsed, delta, this.MOON_PARAMS, false);

    // Y-Position: animateProceduralJelly setzt group.position.y auf lift + depthWave.
    // Wir addieren baseY + kleine individuelle Variation
    const yOffset = isGrouped ? 0 : (Math.random() - 0.5) * 0.3;
    jelly.group.position.y += baseY + yOffset;

    // Y-Begrenzung
    jelly.group.position.y = Math.max(
      this.config.floorY + 0.5,
      Math.min(this.config.waterY - 0.5, jelly.group.position.y),
    );
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
}
