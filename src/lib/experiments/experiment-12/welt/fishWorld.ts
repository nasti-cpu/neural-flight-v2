/**
 * fishWorld.ts – Fisch-Integration für die Tiefsee-Unterwasserwelt
 *
 * Kombiniert Module aus zwei Ordnern:
 *   - modelle/fish/       → Fisch-3D-Modelle (GLB-Dateien, GLTFLoader)
 *   - animationen/fische/ → Carangiforme Undulation + Burst-and-Glide (Formations-Schwarm)
 *
 * Ergebnis:
 *   - 3–5 Einzelfische, die mit natürlicher Schwimm-Animation umherschwimmen
 *   - Alle 30–60 Sekunden erscheint ein Formations-Schwarm (20 Fische in V-Formation),
 *     der nach 12–20 Sekunden wieder verschwindet
 *
 * Performance:
 *   - Einzelfische: einzelne Meshes (geringe Anzahl → kein InstancedMesh nötig)
 *   - Schwärme: InstancedMesh + feste Formation (keine Boids-Berechnung nötig)
 */

import * as THREE from "three/webgpu";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  EcholocationRings,
  type EchoTarget,
  type EcholocationConfig,
} from "../sinne/echoortung/echolocationRings";

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
// Einzelfisch – Schwimm-Parameter (Carangiforme Undulation + Burst-and-Glide)
// ---------------------------------------------------------------------------

/**
 * Jeder Einzelfisch bekommt leicht abgewandelte Schwimm-Parameter,
 * damit sie nicht alle synchron aussehen.
 */
interface SoloFishParams {
  /** Ellipsen-Bahn: Radius in X (klein, für Sichtbarkeit im Nebel) */
  radiusX: number;
  /** Ellipsen-Bahn: Radius in Z (klein, für Sichtbarkeit im Nebel) */
  radiusZ: number;
  /** Basis-Geschwindigkeit (rad/s) */
  speed: number;
  /** Yaw-Amplitude (Schwanzschlag nach links/rechts) */
  yawAmp: number;
  /** Yaw-Frequenz */
  yawFreq: number;
  /** Pitch-Amplitude (auf/ab) */
  pitchAmp: number;
  /** Pitch-Frequenz */
  pitchFreq: number;
  /** Roll-Amplitude (seitlich kippen) */
  rollAmp: number;
  /** Tiefen-Schwankung Amplitude */
  depthAmp: number;
  /** Tiefen-Schwankung Frequenz */
  depthFreq: number;
  /** Burst-Intervall (Sekunden) */
  burstInt: number;
  /** Burst-Dauer (Sekunden) */
  burstDur: number;
  /** Burst Yaw-Multiplikator */
  burstYawMul: number;
  /** Start-Phasenversatz (damit Fische nicht synchron starten) */
  phaseOffset: number;
  /** Start-Winkel auf der Ellipse */
  startAngle: number;
  /** Mittlere Y-Position */
  baseY: number;
  /** Zentrum der Ellipse in X (innerhalb der Nebel-Sichtweite) */
  centerX: number;
  /** Zentrum der Ellipse in Z (innerhalb der Nebel-Sichtweite) */
  centerZ: number;
}

/** Erzeugt leicht abgewandelte Schwimm-Parameter für einen Einzelfisch */
function createSoloParams(config: FishWorldConfig): SoloFishParams {
  const rand = Math.random;
  return {
    radiusX: 2 + rand() * 4,
    radiusZ: 2 + rand() * 3,
    speed: 0.08 + rand() * 0.15,
    yawAmp: 0.04 + rand() * 0.08,
    yawFreq: 0.4 + rand() * 0.4,
    pitchAmp: 0.02 + rand() * 0.03,
    pitchFreq: 0.3 + rand() * 0.3,
    rollAmp: 0.05 + rand() * 0.1,
    depthAmp: 0.5 + rand() * 1.0,
    depthFreq: 0.06 + rand() * 0.1,
    burstInt: 8 + rand() * 10,
    burstDur: 0.8 + rand() * 1.0,
    burstYawMul: 1.3 + rand() * 0.4,
    phaseOffset: rand() * Math.PI * 2,
    startAngle: rand() * Math.PI * 2,
    baseY: config.floorY + 1.5 + rand() * (config.waterY - config.floorY - 2.5),
    centerX: (rand() - 0.5) * 16,
    centerZ: (rand() - 0.5) * 16,
  };
}

// ---------------------------------------------------------------------------
// Einzelfisch-Halter (Rendering + Zustand)
// ---------------------------------------------------------------------------

interface SoloFish {
  /** Mesh in der Szene (direkt oder Group) */
  mesh: THREE.Group;
  /** Schwimm-Parameter (individuell) */
  params: SoloFishParams;
  /** Aktuell interpolierte Werte (werden pro Frame gelerpt) */
  state: {
    yaw: number;
    pitch: number;
    roll: number;
    curY: number;
  };
  /** Geglättete Burst-Frequenz/Amplitude */
  smoothYawFreq: number;
  smoothYawAmp: number;

  // --- Glow (Echoortung, sofort auf 1.0 bei Treffer, dann Abfall) ---
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
  /** InstancedMesh für das Rendering */
  instances: THREE.InstancedMesh;
  /** Zeitpunkt, wann der Schwarm verschwinden soll (performance.now) */
  expireAt: number;
  /** Skalierungsfaktor für die Fisch-Instanzen */
  fishScale: number;
  // --- Glow (Echoortung, sofort auf 1.0 bei Treffer, dann Abfall) ---
  glowIntensity: number;
  originalEmissive: THREE.Color;

  // --- Formation-Daten (20 Fische in V-Formation, jeder auf individueller Ellipsenbahn) ---
  /** Relative XZ/Y-Offsets jedes Fisches zur Schwarm-Mitte */
  offsets: THREE.Vector3[];
  /** Zufällige Phasen-Offsets für individuelle Animation */
  phaseOffsets: number[];
  /** Zufällige Amplitudenfaktoren für Bewegung */
  ampFactors: number[];
  /** Zufällige Geschwindigkeitsfaktoren für individuelle Bahnen */
  speedFactors: number[];

  // --- Ellipsenbahn des Schwarm-Zentrums ---
  /** Start-X der Schwarm-Mitte */
  centerX: number;
  /** Start-Z der Schwarm-Mitte */
  centerZ: number;
  /** Basis-Y (mittlere Höhe) */
  baseY: number;
  /** Start-Winkel auf der Ellipse */
  startAngle: number;
  /** Horizontaler Ellipsen-Radius (X-Achse) */
  swimRadiusX: number;
  /** Horizontaler Ellipsen-Radius (Z-Achse) */
  swimRadiusZ: number;
  /** Geschwindigkeit auf der Ellipsenbahn */
  speed: number;
  /** Amplitude der vertikalen Pendelbewegung */
  depthAmp: number;
  /** Frequenz der vertikalen Pendelbewegung */
  depthFreq: number;
}

// ---------------------------------------------------------------------------
// Hauptklasse: FishWorld
// ---------------------------------------------------------------------------

/**
 * Verwaltet alle Fische in der Unterwasserwelt:
 * Einzelfische + periodisch erscheinende Formations-Schwärme.
 *
 * Wird von der Haupt-Experience (underwaterWorld.ts) importiert
 * und in der Render-Loop aufgerufen.
 */
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
  /** Ursprung für Echo-Ringe (Kamera-Position, aber Y nach unten versetzt) */
  private _echoOrigin = new THREE.Vector3();
  /** Wiederverwendbarer Vektor für Distanz-Prüfungen */
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
  // Initialisierung (async – lädt das Fisch-Modell)
  // -----------------------------------------------------------------------

  /**
   * Lädt das Fisch-3D-Modell und erstellt alle Einzelfische.
   * Muss VOR dem ersten Render-Aufruf abgeschlossen sein.
   * @param cameraPos – Initiale Kameraposition für den ersten Fisch-Spawn
   */
  async init(cameraPos?: THREE.Vector3): Promise<void> {
    console.log("🐟 FishWorld: Lade Fisch-Modell...");

    // --- Fisch-Modell laden ---
    this.fishModelTemplate = await this._loadFishModel(
      "/3D Modelle/fish/Fish(3).glb",
    );

    if (!this.fishModelTemplate) {
      console.warn("⚠️ FishWorld: Fisch-Modell konnte nicht geladen werden!");
      return;
    }

    // --- Skalierung berechnen ---
    const box = new THREE.Box3().setFromObject(this.fishModelTemplate);
    const size = new THREE.Vector3();
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z);
    this.soloScale = 1.8 / maxDim;
    this.schoolFishScale = 1.2 / maxDim;

    // --- Einzelfische erstellen (über Kameraposition verteilt) ---
    const spawnPos = cameraPos ?? new THREE.Vector3(0, 0, 0);
    for (let i = 0; i < this.config.soloCount; i++) {
      const params = createSoloParams(this.config);
      const fish = this._createSoloFish(params);
      this._positionFishAt(fish, spawnPos);
      this.soloFishes.push(fish);
    }

    // --- Schwarm-Mesh für InstancedMesh extrahieren (kopieren) ---
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

    // --- Nächsten Schwarm zeitlich planen ---
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
   * Aktualisiert alle Fische für einen Frame.
   *
   * @param delta    – Zeit seit letztem Frame in Sekunden
   * @param elapsed  – Gesamtzeit seit Start in Sekunden
   * @param cameraPos – Aktuelle Kameraposition
   */
  update(delta: number, elapsed: number, cameraPos: THREE.Vector3): void {
    // --- Einzelfische aktualisieren (Bahn + sanftes Ausweichen) ---
    for (const fish of this.soloFishes) {
      this._updateSoloFish(fish, delta, elapsed);
    }

    // --- Sichtbarkeit verwalten: Fische > 80 m verstecken, unsichtbare neu platzieren ---
    this._manageVisibility(cameraPos);

    // --- Schwärme aktualisieren (mit Kameraposition für Spawn) ---
    this._updateSchools(delta, elapsed, cameraPos);

    // --- Echoortung: Ringe senden + Fische aufleuchten lassen ---
    this._updateEcholocation(delta, elapsed, cameraPos);
  }

  // -----------------------------------------------------------------------
  // Exklusionszonen (Fische meiden Kuppeln)
  // -----------------------------------------------------------------------

  /**
   * Setzt die Zonen, die Fische meiden sollen (z. B. Stadt-Kuppeln).
   * Die Fische weichen sanft über die graduelle Lenkung in _updateSoloFish aus.
   *
   * @param zones – Die neuen Exklusionszonen
   */
  setExclusionZones(zones: ExclusionZone[], cameraPos?: THREE.Vector3): void {
    this._exclusionZones = zones;
  }

  /**
   * Prüft, ob eine (x, z)-Position innerhalb einer Exklusionszone liegt.
   * @param margin – Zusätzlicher Sicherheitsabstand (z. B. für Fisch-Ellipsen-Radius)
   */
  private _isInExclusionZone(x: number, z: number, margin: number = 0): boolean {
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

  /**
   * Schiebt einen Fisch sanft aus allen Kuppeln, in denen er steckt.
   * Das Orbit-Zentrum wird radial nach aussen versetzt, der Fisch
   * schwimmt einfach weiter – kein Ruckeln, kein Teleport.
   */
  private _repelFishFromZones(fish: SoloFish): void {
    const p = fish.params;
    for (const zone of this._exclusionZones) {
      // Prüfen, ob das Orbit-Zentrum zu nah an der Kuppel ist
      const dx = p.centerX - zone.centerX;
      const dz = p.centerZ - zone.centerZ;
      const minDist = zone.radius + 6; // Kuppelradius + max. Orbit-Radius
      const distSq = dx * dx + dz * dz;
      if (distSq < minDist * minDist) {
        const dist = Math.sqrt(distSq) || 0.001;
        const pushOut = minDist - dist + 2; // +2 m Sicherheit
        p.centerX += (dx / dist) * pushOut;
        p.centerZ += (dz / dist) * pushOut;
      }
    }
    fish.repelCooldown = 2.0;
  }

  /**
   * Findet eine zufällige Position, die NICHT in einer Exklusionszone liegt.
   * Der Margin (12) ist größer als der maximale Ellipsen-Radius (ca. 7,8),
   * damit der Fisch auf seiner gesamten Bahn niemals in die Kuppel gerät.
   */
  private _findValidPosition(
    baseX: number,
    baseZ: number,
    minDist: number,
    maxDist: number,
  ): { x: number; z: number } {
    const fishMargin = 15; // Sicherheitsabstand zu Kuppeln (Orbit max ~7,8 m + Puffer)
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
    // Fallback: noch weiter weg suchen (30-50m, damit wir sicher ausserhalb aller Kuppeln sind)
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
    // Einzelfische entfernen
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

    // Schwärme entfernen
    for (const school of this.activeSchools) {
      this.scene.remove(school.instances);
      school.instances.dispose();
    }
    this.activeSchools.length = 0;

    this.fishModelTemplate = null;
    this.schoolFishMesh = null;

    // Echoortung
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
    // Template klonen (jeder Fisch hat eigene Meshes)
    const mesh = this.fishModelTemplate!.clone(true);

    // Skalierung + Schatten
    mesh.scale.setScalar(this.soloScale);
    mesh.traverse((ch) => {
      if (ch instanceof THREE.Mesh) {
        ch.castShadow = true;
        ch.receiveShadow = true;
      }
    });

    // Erstes Mesh + Original-Emissive speichern (für Echoortung-Glow)
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

    this.scene.add(mesh);

    return {
      mesh,
      params,
      state: { yaw: 0, pitch: 0, roll: 0, curY: params.baseY },
      smoothYawFreq: params.yawFreq,
      smoothYawAmp: params.yawAmp,
      glowIntensity: 0,
      fishMesh,
      originalEmissive,
      repelCooldown: 0,
    };
  }

  /**
   * Positioniert einen Fisch in 8–16 Einheiten Entfernung zur Kamera.
   * Der alte Standort war > 16 Einheiten (jenseits des Nebels) →
   * der Fisch ist unsichtbar verschwunden und taucht hier neu auf.
   * Die Ellipse wird so platziert, dass der FISCH NIEMALS in eine
   * Kuppel geraten kann (großer Sicherheitsabstand).
   */
  private _positionFishAt(fish: SoloFish, cameraPos: THREE.Vector3, minDist?: number, maxDist?: number): void {
    const p = fish.params;
    const mind = minDist ?? 25;
    const maxd = maxDist ?? 40;

    // Gültige Position außerhalb aller Kuppeln suchen
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

    // Position sofort auf die neue Ellipse setzen
    const ang = p.startAngle;
    const fx = p.centerX + Math.cos(ang) * p.radiusX;
    const fz = p.centerZ + Math.sin(ang) * p.radiusZ;

    // Startwinkel so drehen, dass der Fisch nicht in einer Zone startet
    let finalAngle = ang;
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
    fish.smoothYawFreq = p.yawFreq;
    fish.smoothYawAmp = p.yawAmp;

    // Fisch ist sofort sichtbar (alter Standort war im Nebel versteckt)
    fish.mesh.visible = true;
  }

  // -----------------------------------------------------------------------
  // Private: Einzelfisch animieren (Carangiform + Burst-and-Glide)
  // -----------------------------------------------------------------------

  private _updateSoloFish(
    fish: SoloFish,
    delta: number,
    elapsed: number,
  ): void {
    const p = fish.params;
    const dt = Math.min(delta, 0.1);

    // --- Bahnposition auf der Ellipse (festes Welt-Orbit, kein Teleport) ---
    const ang = elapsed * p.speed + p.startAngle;
    const px = p.centerX + Math.cos(ang) * p.radiusX;
    const pz = p.centerZ + Math.sin(ang) * p.radiusZ;

    // --- Sanftes Ausweichen vor Kuppeln (graduelle Lenkung, kein Ruckeln) ---
    // Das Orbit-Zentrum wird pro Frame um maximal ~0.3 m verschoben,
    // sodass der Fisch eine sanfte Kurve um die Stadt fliegt.
    if (this._exclusionZones.length > 0) {
      for (const zone of this._exclusionZones) {
        const dx2 = p.centerX - zone.centerX;
        const dz2 = p.centerZ - zone.centerZ;
        const dist = Math.sqrt(dx2 * dx2 + dz2 * dz2) || 0.001;
        // Sicherheitsabstand: Kuppelradius + max. Orbit-Radius (~7 m) + Puffer
        const minDist = zone.radius + 7;
        if (dist < minDist) {
          const overlap = minDist - dist;
          const pushPerFrame = Math.min(overlap, 1.0) * 0.15 * dt * 60;
          p.centerX += (dx2 / dist) * pushPerFrame;
          p.centerZ += (dz2 / dist) * pushPerFrame;
        }
      }
    }

    const finalX = px;
    const finalZ = pz;

    // --- Tiefe (sanfte Sinus-Welle) -- niemals unter floorY + 1.0 (Dünen-Vermeidung) ---
    const rawY =
      p.baseY +
      Math.sin(elapsed * p.depthFreq * Math.PI * 2 + p.phaseOffset) *
        p.depthAmp;
    const tgtY = Math.max(this.config.floorY + 1.0, rawY);

    // --- Burst-and-Glide: Geschwindigkeits-Burst alle burstInt Sekunden ---
    const bursting = elapsed % p.burstInt < p.burstDur;
    const tgtBurstFreq = bursting ? p.yawFreq * p.burstYawMul : p.yawFreq;
    const tgtBurstAmp = bursting ? p.yawAmp * 1.5 : p.yawAmp;
    const burstLerp = 1 - Math.exp(-3.0 * dt);
    fish.smoothYawFreq += (tgtBurstFreq - fish.smoothYawFreq) * burstLerp;
    fish.smoothYawAmp += (tgtBurstAmp - fish.smoothYawAmp) * burstLerp;

    // --- Rotation (Yaw, Pitch, Roll) ---
    const tgtYaw =
      Math.sin(elapsed * fish.smoothYawFreq * Math.PI * 2 + p.phaseOffset) *
      fish.smoothYawAmp;
    const tgtPitch =
      Math.sin(elapsed * p.pitchFreq * Math.PI * 2 + p.phaseOffset * 0.7) *
      p.pitchAmp;
    const tgtRoll =
      Math.cos(ang + p.phaseOffset * 0.3) * Math.sin(elapsed * 0.6) * p.rollAmp;

    // Sanft interpolieren (Lerp)
    const lf = 1 - Math.exp(-5.0 * dt);
    fish.state.yaw += (tgtYaw - fish.state.yaw) * lf;
    fish.state.pitch += (tgtPitch - fish.state.pitch) * lf;
    fish.state.roll += (tgtRoll - fish.state.roll) * lf;
    fish.state.curY += (tgtY - fish.state.curY) * lf;

    // --- Position + Rotation anwenden (mit Kuppel-Ausweich-Offset) ---
    fish.mesh.position.set(finalX, fish.state.curY, finalZ);

    // Schwimmrichtung (Tangente der Ellipse)
    const tx = -Math.sin(ang) * p.radiusX;
    const tz = Math.cos(ang) * p.radiusZ;
    const baseYaw = Math.atan2(tx, tz);

    fish.mesh.rotation.set(0, 0, 0);
    fish.mesh.rotateY(baseYaw + fish.state.yaw);
    fish.mesh.rotateX(fish.state.pitch);
    fish.mesh.rotateZ(fish.state.roll);
  }

  // -----------------------------------------------------------------------
  // Private: Sichtbarkeit verwalten (kein Teleport sichtbarer Fische)
  // -----------------------------------------------------------------------

  /**
   * Versteckt Fische, die weiter als 80 m von der Kamera entfernt sind,
   * und positioniert unsichtbare Fische in Kameranähe neu.
   *
   * So schwimmen Fische auf festen Welt-Orbits, ohne zu teleportieren,
   * aber es sind immer genug Fische in der Nähe des Spielers sichtbar.
   */
  private _manageVisibility(cameraPos: THREE.Vector3): void {
    const maxDistSq = 80 * 80;
    const minSpawnDist = 15;
    const maxSpawnDist = 35;
    const targetVisible = Math.max(1, this.config.soloCount);

    // 1) Sichtbare Fische zählen, zu weit entfernte verstecken
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

    // 2) Nicht genug sichtbare Fische? → unsichtbare neu positionieren
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

    // --- Formation-Offsets für 20 Fische in V-Formation erzeugen ---
    const offsets: THREE.Vector3[] = [];
    const phaseOffsets: number[] = [];
    const ampFactors: number[] = [];
    const speedFactors: number[] = [];

    const baseSpacingX = 4.5;  // Horizontaler Abstand zwischen den Fischen
    const baseSpacingZ = 5.0;  // Abstand zwischen den Reihen (von vorne nach hinten)

    for (let i = 0; i < schoolSize; i++) {
      // 5 Spalten × 4 Reihen ergibt 20 Fische
      const col = i % 5;
      const row = Math.floor(i / 5);
      const centerCol = 2; // Mittlere Spalte (Index 2) ist die Spitze der V-Formation
      const ox = (col - centerCol) * baseSpacingX;
      const oz = -row * baseSpacingZ + (rand() - 0.5) * 2.0;
      const oy = (row - 1.5) * 2.0 + (rand() - 0.5) * 3.0;
      offsets.push(new THREE.Vector3(ox, oy, oz));
      phaseOffsets.push(rand() * Math.PI * 2);
      ampFactors.push(0.7 + rand() * 0.6);
      speedFactors.push(0.92 + rand() * 0.16);
    }

    // --- Gültige Startposition außerhalb aller ExclusionZonen finden ---
    const { x: validX, z: validZ } = this._findValidPosition(
      cameraPos.x, cameraPos.z, 12, 20,
    );

    // --- Material klonen (jeder Schwarm braucht eigene Instanz für Glow) ---
    const schoolMat = (this.schoolFishMesh.material as THREE.MeshStandardMaterial).clone();

    // --- InstancedMesh erstellen ---
    const instances = new THREE.InstancedMesh(
      this.schoolFishMesh.geometry,
      schoolMat,
      schoolSize,
    );
    instances.castShadow = true;
    instances.receiveShadow = true;

    this.scene.add(instances);

    // --- Original-Emissive speichern (für Echoortung-Glow) ---
    const origEmissive =
      (schoolMat as THREE.MeshStandardMaterial).emissive
        ?.clone() ?? new THREE.Color(0x000000);

    // --- Zufällige Dauer für diesen Schwarm ---
    const duration =
      this.config.schoolDurationMin +
      rand() *
        (this.config.schoolDurationMax - this.config.schoolDurationMin);

    // --- Schwarm-Zustand speichern ---
    this.activeSchools.push({
      instances,
      expireAt: performance.now() + duration * 1000,
      fishScale: this.schoolFishScale,
      glowIntensity: 0,
      originalEmissive: origEmissive,
      // Formation-Daten
      offsets,
      phaseOffsets,
      ampFactors,
      speedFactors,
      // Ellipsenbahn-Zentrum
      centerX: validX,
      centerZ: validZ,
      baseY: this.config.floorY + 2 + rand() * (this.config.waterY - this.config.floorY - 4),
      startAngle: rand() * Math.PI * 2,
      swimRadiusX: 8 + rand() * 6,
      swimRadiusZ: 5 + rand() * 5,
      speed: 0.08 + rand() * 0.12,
      depthAmp: 0.5 + rand() * 1.0,
      depthFreq: 0.06 + rand() * 0.08,
    });

    console.log(
      `🐟🐟🐟 Formations-Schwarm erschienen! ${schoolSize} Fische, ` +
        `verschwindet in ${duration.toFixed(0)}s`,
    );
  }

  private _updateSchools(delta: number, elapsed: number, cameraPos: THREE.Vector3): void {
    const now = performance.now();

    // --- Prüfen, ob ein neuer Schwarm erscheinen soll ---
    if (now >= this.nextSchoolTime) {
      this._spawnSchool(cameraPos);
      this._scheduleNextSchool();
    }

    // --- Abgelaufene Schwärme entfernen ---
    for (let i = this.activeSchools.length - 1; i >= 0; i--) {
      if (now >= this.activeSchools[i].expireAt) {
        const school = this.activeSchools[i];
        this.scene.remove(school.instances);
        school.instances.dispose();
        this.activeSchools.splice(i, 1);
        console.log("🐟🐟🐟 Formations-Schwarm verschwunden.");
      }
    }

    // --- Aktive Schwärme aktualisieren (Formations-Rendering) ---
    const scale = this.schoolFishScale;
    const { _up: up, _axisPitch: axisPitch, _axisRoll: axisRoll } = this;

    for (const school of this.activeSchools) {
      // Schwarm-Zentrum auf Ellipsenbahn berechnen
      const ang = elapsed * school.speed + school.startAngle;
      const cx = school.centerX + Math.cos(ang) * school.swimRadiusX;
      const cz = school.centerZ + Math.sin(ang) * school.swimRadiusZ;
      const rawSchoolY = school.baseY + Math.sin(elapsed * school.depthFreq * Math.PI * 2) * school.depthAmp;
      const cy = Math.max(this.config.floorY + 1.0, rawSchoolY);

      // Schwimmrichtung = Tangente der Ellipse (Grund-Yaw)
      const tx = -Math.sin(ang) * school.swimRadiusX;
      const tz = Math.cos(ang) * school.swimRadiusZ;
      const baseYaw = Math.atan2(tx, tz);
      const cosA = Math.cos(baseYaw);
      const sinA = Math.sin(baseYaw);

      for (let i = 0; i < school.offsets.length; i++) {
        const offset = school.offsets[i];
        const phaseShift = school.phaseOffsets[i];
        const ampFactor = school.ampFactors[i];
        const speedFactor = school.speedFactors[i];

        // Individuelle Ellipsenbahn-Position jedes Fisches (eigene Geschwindigkeit)
        const fishAng = elapsed * school.speed * speedFactor;
        const fishPx = school.centerX + Math.cos(fishAng) * school.swimRadiusX;
        const fishPz = school.centerZ + Math.sin(fishAng) * school.swimRadiusZ;

        // Offset in Schwimmrichtung rotieren (damit V-Formation immer nach vorne zeigt)
        const rx = offset.x * cosA - offset.z * sinA;
        const rz = offset.x * sinA + offset.z * cosA;

        this._tmpVec3.set(fishPx + rx, cy + offset.y, fishPz + rz);

        // --- Rotation: Yaw (Gier), Pitch (Nick), Roll (Wanken) ---
        const fishYaw = Math.sin(elapsed * 1.2 * Math.PI * 2 + phaseShift) * 0.15 * ampFactor;
        const fishPitch = Math.sin(elapsed * 0.9 * Math.PI * 2 + phaseShift * 0.7) * 0.05 * ampFactor;
        const fishRoll = Math.cos(fishAng + phaseShift * 0.3) * Math.sin(elapsed * 0.6) * 0.2 * ampFactor;

        // Quaternion in der richtigen Reihenfolge aufbauen: Yaw → Pitch → Roll
        this._tmpQuat.identity();
        this._tmpQuatA.setFromAxisAngle(up, baseYaw + fishYaw);
        this._tmpQuat.multiply(this._tmpQuatA);
        this._tmpQuatB.setFromAxisAngle(axisPitch, fishPitch);
        this._tmpQuat.multiply(this._tmpQuatB);
        this._tmpQuatA.setFromAxisAngle(axisRoll, fishRoll);
        this._tmpQuat.multiply(this._tmpQuatA);

        this._tmpScale.set(scale, scale, scale);
        this._tmpMatrix.compose(this._tmpVec3, this._tmpQuat, this._tmpScale);
        school.instances.setMatrixAt(i, this._tmpMatrix);
      }
      school.instances.instanceMatrix.needsUpdate = true;
    }
  }

  // -----------------------------------------------------------------------
  // Private: Echoortung – Ringe aussenden + Glow-Effekt
  // -----------------------------------------------------------------------

  /**
   * Aktualisiert die Echoortungs-Ringe und wendet Glow auf getroffene Fische an.
   * Die Ringe gehen von der Kameraposition (Spieler) aus.
   */
  private _updateEcholocation(
    delta: number,
    elapsed: number,
    cameraPos: THREE.Vector3,
  ): void {
    if (!this.echolocation) return;

    // --- Echo-Targets aus Einzelfischen sammeln ---
    this._echoTargets.length = 0;
    for (const fish of this.soloFishes) {
      if (!fish.fishMesh) continue;
      this._echoTargets.push({
        position: fish.mesh.position,
        onHit: () => {
          fish.glowIntensity = 1.0; // Sofort aufleuchten
        },
      });
    }

    // --- Echo-Targets aus Schwarm-Fischen sammeln ---
    // Für Formations-Schwärme wird vereinfacht das Zentrum genutzt
    for (const school of this.activeSchools) {
      this._echoTargets.push({
        position: new THREE.Vector3(school.centerX, school.baseY, school.centerZ),
        onHit: () => {
          school.glowIntensity = 1.0; // Ganzer Schwarm leuchtet auf
        },
      });
    }

    // --- Ringe aktualisieren (prüft Kollisionen mit allen Targets) ---
    // Ursprung liegt 2 Einheiten tiefer als die Kamera, damit die Ringe
    // unterhalb des Spielers schweben und besser sichtbar sind.
    this._echoOrigin.copy(cameraPos);
    this._echoOrigin.y -= 2.0;
    this.echolocation.update(elapsed, delta, this._echoOrigin, this._echoTargets);

    // --- Glow bei Einzelfischen: exponentieller Abfall ---
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

    // --- Glow bei Schwärmen: exponentieller Abfall ---
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
