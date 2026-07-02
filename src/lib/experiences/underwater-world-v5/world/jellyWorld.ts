/**
 * jellyWorld.ts – Mondquallen in der Unterwasserwelt.
 *
 * Verhält sich wie die Fische: Quallen tauchen in Kameranähe auf
 * und verschwinden, wenn man sich entfernt. Sie erscheinen entweder
 * allein oder in Gruppen von 3–5 Tieren.
 *
 * In Gruppen behalten die Quallen Abstand zueinander – sie schwimmen
 * auf individuellen Mini-Orbits um das Gruppen-Zentrum.
 */

import * as THREE from "three/webgpu";
import {
  buildMoonJelly,
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
  /** Maximale Anzahl gleichzeitig aktiver Gruppen */
  maxGroups: number;
  /** Minimale Entfernung zur Kamera beim Spawn */
  spawnMinDist: number;
  /** Maximale Entfernung zur Kamera beim Spawn */
  spawnMaxDist: number;
  /** Ab dieser Entfernung wird die Gruppe umgesetzt */
  respawnDist: number;
}

const DEFAULT_CONFIG: JellyWorldConfig = {
  floorY: -4,
  waterY: 15,
  maxGroups: 1,
  spawnMinDist: 15,
  spawnMaxDist: 25,
  respawnDist: 30,
};

// ---------------------------------------------------------------------------
// Gruppe: Zentrum + Liste der Quallen + deren Offset-Daten
// ---------------------------------------------------------------------------

interface JellyGroupMember {
  jelly: ProceduralJelly;
  angle: number;
  orbitRadius: number;
  yOffset: number;
  animPhase: number;
  /** Echoortungs-Glow (0–1) */
  glowIntensity: number;
  /** Original-Emissive der Glocke vor dem Glow */
  originalEmissive: THREE.Color | null;
}

interface JellyGroup {
  members: JellyGroupMember[];
  centerX: number;
  centerZ: number;
  baseY: number;
  /** Winkelgeschwindigkeit der gesamten Gruppe */
  speed: number;
  /** Radius der Gruppen-Bahn */
  radius: number;
  /** Start-Winkel auf der Gruppen-Bahn */
  startAngle: number;
  /** Unsichtbar (zu weit von Kamera entfernt) – wird ohne Teleport neu positioniert */
  hidden: boolean;
}

// ---------------------------------------------------------------------------
// Haupt-Klasse
// ---------------------------------------------------------------------------

export class JellyWorld {
  private scene: THREE.Scene;
  private config: JellyWorldConfig;
  private groups: JellyGroup[] = [];

  /** Exklusionszonen (Stadt-Kuppeln) – Quallen meiden diese Bereiche */
  private _exclusionZones: ExclusionZone[] = [];

  /** Wiederverwendeter Array für getEchoTargets (vermeidet GC) */
  private _cachedEchoTargets: EchoTarget[] = [];

  // --- Echoortungs-Glow (wie bei Fischen) ---
  private _glowColor = new THREE.Color(0xffaa00);
  private _tmpColor = new THREE.Color();
  /** Merkt sich, ob überhaupt Glow aktiv ist (Performance-Optimierung) */
  private _hasActiveGlow: boolean = false;

  constructor(scene: THREE.Scene, config?: Partial<JellyWorldConfig>) {
    this.scene = scene;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // -----------------------------------------------------------------------
  // Exklusionszonen (Stadt-Kuppeln) – Quallen meiden diese Bereiche
  // -----------------------------------------------------------------------

  /**
   * Setzt die Zonen, die Quallen meiden sollen (z. B. Stadt-Kuppeln).
   * Die Quallen weichen sanft über die graduelle Lenkung in _updateGroup aus.
   */
  setExclusionZones(zones: ExclusionZone[], cameraPos?: THREE.Vector3): void {
    this._exclusionZones = zones;
  }

  /**
   * Gibt Echoortungs-Ziele für alle sichtbaren Quallen zurück.
   * Wird von FishWorld._updateEcholocation verwendet.
   */
  getEchoTargets(): EchoTarget[] {
    this._cachedEchoTargets.length = 0;
    for (const group of this.groups) {
      if (group.hidden) continue;
      for (const member of group.members) {
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

  /**
   * Prüft, ob eine (x, z)-Position innerhalb einer Exklusionszone liegt.
   * @param margin – Zusätzlicher Sicherheitsabstand
   */
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

  // -----------------------------------------------------------------------
  // Initialisierung – erzeugt die ersten Gruppen
  // -----------------------------------------------------------------------

  async init(cameraPos?: THREE.Vector3): Promise<void> {
    const pos = cameraPos ?? new THREE.Vector3(0, 0, 0);
    for (let i = 0; i < this.config.maxGroups; i++) {
      this._spawnGroup(pos);
    }
  }

  // -----------------------------------------------------------------------
  // Update – jeden Frame von underwaterWorld aufgerufen
  // -----------------------------------------------------------------------

  update(delta: number, elapsed: number, cameraPos: THREE.Vector3): void {
    const cfg = this.config;

    // --- Alle sichtbaren Gruppen animieren (Bahn + sanftes Ausweichen) ---
    for (const group of this.groups) {
      if (!group.hidden) {
        this._updateGroup(group, delta, elapsed);
      }
    }

    // --- Sichtbarkeit verwalten: Gruppen > 60 m verstecken, unsichtbare neu platzieren ---
    this._manageVisibility(cameraPos);

    // --- Echoortungs-Glow: exponentieller Abfall ---
    // Performance: nur weitermachen, wenn überhaupt Glow aktiv ist
    if (this._hasActiveGlow) {
      const decay = Math.exp(-3.0 * delta);
      this._hasActiveGlow = false;
      for (const group of this.groups) {
        for (const member of group.members) {
          if (member.glowIntensity < 0.01) continue;
          member.glowIntensity *= decay;
          if (member.glowIntensity > 0.01) {
            this._hasActiveGlow = true;
            const mat = member.jelly.bell
              .material as THREE.MeshPhysicalMaterial;
            this._tmpColor
              .copy(member.originalEmissive ?? this._tmpColor.set(0x000000))
              .lerp(this._glowColor, member.glowIntensity);
            mat.emissive.copy(this._tmpColor);
            mat.emissiveIntensity = 0.2 + member.glowIntensity * 1.8;
          } else {
            const mat = member.jelly.bell
              .material as THREE.MeshPhysicalMaterial;
            if (member.originalEmissive)
              mat.emissive.copy(member.originalEmissive);
            mat.emissiveIntensity = 0;
          }
        }
      }
    }

    // --- Neue Gruppe spawnen, wenn Platz ist ---
    while (this.groups.length < cfg.maxGroups) {
      this._spawnGroup(cameraPos);
    }
  }

  // -----------------------------------------------------------------------
  // Aufräumen
  // -----------------------------------------------------------------------

  dispose(): void {
    for (let i = this.groups.length - 1; i >= 0; i--) {
      this._removeGroup(i);
    }
  }

  // -----------------------------------------------------------------------
  // Private: Gruppe spawnen
  // -----------------------------------------------------------------------

  private _spawnGroup(cameraPos: THREE.Vector3): void {
    const cfg = this.config;

    // Zufällige Position in Kameranähe, außerhalb aller Exklusionszonen
    let cx: number, cz: number;
    let attempts = 0;
    const margin = 5;
    do {
      const angle = Math.random() * Math.PI * 2;
      const dist =
        cfg.spawnMinDist +
        Math.random() * (cfg.spawnMaxDist - cfg.spawnMinDist);
      cx = cameraPos.x + Math.cos(angle) * dist;
      cz = cameraPos.z + Math.sin(angle) * dist;
      attempts++;
    } while (
      this._exclusionZones.length > 0 &&
      this._isInExclusionZone(cx, cz, margin) &&
      attempts < 20
    );

    const baseY =
      cfg.floorY + 1.5 + Math.random() * (cfg.waterY - cfg.floorY - 3);

    // Gruppengröße: 1 oder 3 (max. 3 Quallen insgesamt)
    const sizeRoll = Math.random();
    const groupSize = sizeRoll < 0.5 ? 1 : 3;

    const members: JellyGroupMember[] = [];

    for (let i = 0; i < groupSize; i++) {
      const jelly = buildMoonJelly();

      // Gleichmäßig ums Zentrum verteilt + minimale Distanz
      const memberAngle = (i / groupSize) * Math.PI * 2 + Math.random() * 0.5;
      const orbitRadius = 0.8 + Math.random() * 1.2;
      const yOffset = (Math.random() - 0.5) * 1.0;

      // Animation-Phase individuell
      jelly.animState.phase = Math.random() * Math.PI * 2;

      // Gruppe ausrichten – alle Quallen schauen ungefähr in die gleiche Richtung
      jelly.group.position.set(
        cx + Math.cos(memberAngle) * orbitRadius,
        baseY + yOffset,
        cz + Math.sin(memberAngle) * orbitRadius,
      );

      this.scene.add(jelly.group);

      // Original-Emissive der Glocke speichern (für Echoortungs-Glow)
      const bellMat = jelly.bell.material as THREE.MeshPhysicalMaterial;
      const origEmissive = bellMat.emissive
        ? bellMat.emissive.clone()
        : new THREE.Color(0x000000);

      members.push({
        jelly,
        angle: memberAngle,
        orbitRadius,
        yOffset,
        animPhase: Math.random() * Math.PI * 2,
        glowIntensity: 0,
        originalEmissive: origEmissive,
      });
    }

    const group: JellyGroup = {
      members,
      centerX: cx,
      centerZ: cz,
      baseY,
      speed: 0.2 + Math.random() * 0.3,
      radius: 1.5 + Math.random() * 2.5,
      startAngle: Math.random() * Math.PI * 2,
      hidden: false,
    };

    this.groups.push(group);

    const sizeNames = ["einsam", "klein"];
    const sizeName = groupSize === 1 ? "einsam" : "klein";
    console.log(
      `🌊 Quallen-Gruppe erschienen (${sizeName}, ${groupSize} Tiere)`,
    );
  }

  // -----------------------------------------------------------------------
  // Private: Gruppe entfernen
  // -----------------------------------------------------------------------

  private _removeGroup(index: number): void {
    const group = this.groups[index];
    for (const member of group.members) {
      this.scene.remove(member.jelly.group);
      // Geometrien + Materialien disposen
      member.jelly.group.traverse((ch) => {
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
    this.groups.splice(index, 1);
  }

  // -----------------------------------------------------------------------
  // Private: Eine Gruppe animieren
  // -----------------------------------------------------------------------

  private _updateGroup(
    group: JellyGroup,
    delta: number,
    elapsed: number,
  ): void {
    // === Sanftes Ausweichen vor Kuppeln (graduelle Lenkung) ===
    if (this._exclusionZones.length > 0) {
      for (const zone of this._exclusionZones) {
        const dx = group.centerX - zone.centerX;
        const dz = group.centerZ - zone.centerZ;
        const dist = Math.sqrt(dx * dx + dz * dz) || 0.001;
        const minDist = zone.radius + group.radius + 2; // + Gruppen-Orbit-Radius + Puffer
        if (dist < minDist) {
          const overlap = minDist - dist;
          const pushPerFrame = Math.min(overlap, 1.0) * 0.25 * delta;
          group.centerX += (dx / dist) * pushPerFrame;
          group.centerZ += (dz / dist) * pushPerFrame;
        }
      }
    }

    // === Gruppen-Zentrum auf kleiner Ellipsenbahn ===
    const ang = elapsed * group.speed * 0.15 + group.startAngle;
    const cx = group.centerX + Math.cos(ang) * group.radius;
    const cz = group.centerZ + Math.sin(ang) * group.radius;

    // === Jede Qualle im eigenen Orbit ums Zentrum ===
    const MOON_PARAMS = {
      pulseSpeed: 0.9,
      liftStrength: 0.3,
      driftSpeed: 0.12,
    };

    for (const member of group.members) {
      const orbitAngle = elapsed * 0.2 + member.angle + member.animPhase * 0.3;
      const ox = cx + Math.cos(orbitAngle) * member.orbitRadius;
      const oz = cz + Math.sin(orbitAngle) * member.orbitRadius;
      const oy = group.baseY + member.yOffset;

      member.jelly.group.position.x = ox;
      member.jelly.group.position.z = oz;

      const jellyElapsed = elapsed + member.animPhase;
      animateProceduralJelly(
        member.jelly,
        jellyElapsed,
        delta,
        MOON_PARAMS,
        false,
      );

      // Y-Position setzen: animateProceduralJelly setzt group.position.y auf
      // lift + depthWave (relativ) – wir addieren baseY + yOffset für die Welt-Position
      member.jelly.group.position.y += oy;
    }
  }

  // -----------------------------------------------------------------------
  // Private: Sichtbarkeit verwalten (kein Teleport sichtbarer Quallen)
  // -----------------------------------------------------------------------

  /**
   * Versteckt Gruppen, die weiter als 60 m von der Kamera entfernt sind,
   * und positioniert unsichtbare Gruppen in Kameranähe neu.
   * So bleiben Quallen auf festen Welt-Orbits, ohne zu teleportieren.
   */
  private _manageVisibility(cameraPos: THREE.Vector3): void {
    const maxDistSq = 60 * 60;
    const targetVisible = this.config.maxGroups;

    // 1) Sichtbare Gruppen zählen, zu weit entfernte verstecken
    let visibleCount = 0;
    for (const group of this.groups) {
      const dx = group.centerX - cameraPos.x;
      const dz = group.centerZ - cameraPos.z;
      if (dx * dx + dz * dz > maxDistSq) {
        group.hidden = true;
        for (const member of group.members) {
          member.jelly.group.visible = false;
        }
      } else {
        group.hidden = false;
        for (const member of group.members) {
          member.jelly.group.visible = true;
        }
        visibleCount++;
      }
    }

    // 2) Nicht genug sichtbare Gruppen? → unsichtbare neu positionieren
    if (visibleCount < targetVisible) {
      for (const group of this.groups) {
        if (group.hidden) {
          this._repositionGroup(group, cameraPos);
          group.hidden = false;
          for (const member of group.members) {
            member.jelly.group.visible = true;
          }
          visibleCount++;
          if (visibleCount >= targetVisible) break;
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // Private: Gruppe an neue Position versetzen (wie Fisch-Respawn)
  // -----------------------------------------------------------------------

  private _repositionGroup(group: JellyGroup, cameraPos: THREE.Vector3): void {
    const cfg = this.config;

    // Neue Position außerhalb aller Exklusionszonen suchen
    let cx: number, cz: number;
    let attempts = 0;
    const margin = 5;
    do {
      const angle = Math.random() * Math.PI * 2;
      const dist =
        cfg.spawnMinDist +
        Math.random() * (cfg.spawnMaxDist - cfg.spawnMinDist);
      cx = cameraPos.x + Math.cos(angle) * dist;
      cz = cameraPos.z + Math.sin(angle) * dist;
      attempts++;
    } while (
      this._exclusionZones.length > 0 &&
      this._isInExclusionZone(cx, cz, margin) &&
      attempts < 20
    );

    const baseY =
      cfg.floorY + 1.5 + Math.random() * (cfg.waterY - cfg.floorY - 3);

    group.centerX = cx;
    group.centerZ = cz;
    group.baseY = baseY;
    group.startAngle = Math.random() * Math.PI * 2;

    for (let i = 0; i < group.members.length; i++) {
      const member = group.members[i];
      member.angle =
        (i / group.members.length) * Math.PI * 2 + Math.random() * 0.5;
      member.orbitRadius = 0.8 + Math.random() * 1.2;
      member.yOffset = (Math.random() - 0.5) * 1.0;
      member.animPhase = Math.random() * Math.PI * 2;
      member.glowIntensity = 0;

      // Original-Emissive neu speichern
      const bellMat = member.jelly.bell.material as THREE.MeshPhysicalMaterial;
      member.originalEmissive = bellMat.emissive
        ? bellMat.emissive.clone()
        : new THREE.Color(0x000000);
      bellMat.emissiveIntensity = 0;

      member.jelly.group.position.set(
        cx + Math.cos(member.angle) * member.orbitRadius,
        baseY + member.yOffset,
        cz + Math.sin(member.angle) * member.orbitRadius,
      );
      member.jelly.animState.phase = Math.random() * Math.PI * 2;
    }
  }
}
