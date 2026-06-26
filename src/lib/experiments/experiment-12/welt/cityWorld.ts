/**
 * cityWorld.ts – Städte in der Tiefsee-Welt, auf festem Raster.
 *
 * Städte sitzen auf einem gleichmäßigen Raster (alle 48 Einheiten = 3 Chunks).
 * Das Leitsystem kennt ALLE Stadt-Positionen von Anfang an und kann immer
 * den Weg zur nächsten Stadt zeigen.
 *
 * Lebenszyklus pro Stadt:
 *   pending → ready (bei < 36 m – Modell wird geklont, bereit zum Einblenden)
 *   ready → visible (bei < 22 m – sanftes Fade-In)
 *   visible → ready (bei > 26 m – sanftes Fade-Out, Szene entfernt)
 *   ready → pending (bei > 44 m – Speicher freigegeben)
 *
 * Vorteile gegenüber dem alten System:
 *   - Städte springen nicht mehr (feste Raster-Positionen)
 *   - Kein plötzliches Erscheinen (Vorladen + Fade)
 *   - Leitsystem sieht immer alle Positionen
 */

import * as THREE from "three/webgpu";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

// ---------------------------------------------------------------------------
// Konfiguration pro Stadtmodell
// ---------------------------------------------------------------------------

interface CityConfig {
  path: string;
  scale: number;
  sinkDepth: number;
}

const CITY_CONFIGS: Record<string, CityConfig> = {
  blocks: {
    path: "/3D%20Modelle/city/Blocks%20Skyline.glb",
    scale: 4,
    sinkDepth: 0.3,
  },
  // ═════════════════════════════════════════════════════════════════
  // Pittsburgh vorübergehend deaktiviert.
  // ═════════════════════════════════════════════════════════════════
  // pittsburgh: {
  //   path: "/3D%20Modelle/city/Downtown%20Pittsburgh.glb",
  //   scale: 14,
  //   sinkDepth: 1.5,
  // },
};

// ---------------------------------------------------------------------------
// Raster-Konfiguration
// ---------------------------------------------------------------------------

/** Abstand zwischen Städten (5 Chunks × 16 m) */
const GRID_SPACING = 80;
/** Maximaler zufälliger Versatz pro Stadt (damit nicht zu perfekt im Raster) */
const MAX_OFFSET = 16;
/** Ausdehnung des Rasters ab Zentrum */
const GRID_EXTENT = 400;

// ---------------------------------------------------------------------------
// Distanzen für den Lebenszyklus
// ---------------------------------------------------------------------------

/** Stadt wird geklont und bereit gemacht (unsichtbar) */
const DIST_READY = 60;
/** Stadt wird sichtbar (bei Annäherung, Fade-In beginnt) */
const DIST_SHOW = 22;
/** Stadt beginnt auszublenden (beim Entfernen, Fade-Out) */
const DIST_HIDE = 30;
/** Stadt wird komplett aus dem Speicher entfernt */
const DIST_UNLOAD = 72;
/** Distanz, bei der volle Opazität erreicht ist */
const DIST_FULL_OPACITY = 14;

// ---------------------------------------------------------------------------
// Exklusionszone (für Fisch-Vermeidung)
// ---------------------------------------------------------------------------

export interface ExclusionZone {
  centerX: number;
  centerZ: number;
  radius: number;
}

// ---------------------------------------------------------------------------
// Interner Stadt-Slot
// ---------------------------------------------------------------------------

type CityState = "pending" | "ready" | "visible";

interface CitySlot {
  gridX: number;
  gridZ: number;
  worldX: number;
  worldZ: number;
  type: string;
  state: CityState;
  group: THREE.Group | null;
  domeRadius: number;
  height: number;
  opacity: number;
  lights: THREE.PointLight[];
}

// ---------------------------------------------------------------------------
// CityWorld
// ---------------------------------------------------------------------------

export class CityWorld {
  private scene: THREE.Scene;
  private loader: GLTFLoader;
  private floorY: number;

  /** Vorgeladene Modell-Templates (nach Typ) */
  private _templates: Map<string, THREE.Object3D> = new Map();
  /** Bounding-Box-Daten pro Template (für Kuppelradius) */
  private _templateData: Map<string, { domeRadius: number; height: number }> = new Map();

  /** Alle Stadt-Slots (Raster-Positionen + Zustand) */
  private _slots: CitySlot[] = [];

  /** Gecachte Stadt-Positionen (vermeidet 121× new Vector3 pro Frame) */
  private _cachedPositions: THREE.Vector3[] = [];
  /** Gecachte Exklusionszonen – wird bei State-Änderungen neu aufgebaut */
  private _cachedZones: ExclusionZone[] = [];

  constructor(scene: THREE.Scene, floorY: number = -4) {
    this.scene = scene;
    this.loader = new GLTFLoader();
    this.floorY = floorY;
  }

  // -----------------------------------------------------------------------
  // Initialisierung
  // -----------------------------------------------------------------------

  /**
   * Lädt die Stadt-Templates (GLB-Modelle) und generiert das Raster.
   * Die Templates werden für alle Stadt-Instanzen wiederverwendet (geklont).
   */
  async init(): Promise<void> {
    const cityKeys = Object.keys(CITY_CONFIGS);

    for (const key of cityKeys) {
      const config = CITY_CONFIGS[key];

      const model = await this._loadModel(config.path);
      if (!model) {
        console.warn(`⚠️ CityWorld: "${key}" konnte nicht geladen werden`);
        continue;
      }

      // Modell skalieren und einfärben
      model.scale.set(config.scale, config.scale, config.scale);
      this._colorBuildings(model);

      // Kuppelradius aus Bounding Box berechnen
      const box = new THREE.Box3().setFromObject(model);
      const modelWidth = box.max.x - box.min.x;
      const modelDepth = box.max.z - box.min.z;
      const modelHeight = box.max.y - box.min.y;
      const halfExtent = Math.max(modelWidth, modelDepth) / 2;
      const domeRadius = Math.max(halfExtent * 1.25, modelHeight * 1.1);

      this._templates.set(key, model);
      this._templateData.set(key, { domeRadius, height: modelHeight });

      console.log(`🏙️ CityWorld: "${key}" geladen (Kuppelradius ${domeRadius.toFixed(1)})`);
    }

    // Raster-Positionen generieren
    this._generateGrid();

    // Cache für Stadt-Positionen und Exklusionszonen aufbauen (einmalig)
    this._cachedPositions.length = 0;
    for (const s of this._slots) {
      this._cachedPositions.push(new THREE.Vector3(s.worldX, 0, s.worldZ));
    }
    this._rebuildExclusionZones();

    console.log(`🏙️ CityWorld bereit: ${this._slots.length} Städte im Raster`);
  }

  // -----------------------------------------------------------------------
  // Update – jeden Frame
  // -----------------------------------------------------------------------

  /**
   * Aktualisiert den Lebenszyklus jeder Stadt basierend auf Kameradistanz.
   * - Städte werden vor-geklont (ready), bevor sie sichtbar werden
   * - Ein- und Ausblenden erfolgt sanft über Opazität
   * - Bei großer Entfernung wird der Speicher freigegeben
   */
  update(delta: number, cameraX: number, cameraZ: number): void {
    for (let i = 0; i < this._slots.length; i++) {
      const slot = this._slots[i];
      const dx = slot.worldX - cameraX;
      const dz = slot.worldZ - cameraZ;
      const distSq = dx * dx + dz * dz;
      const dist = Math.sqrt(distSq);

      this._updateSlotState(slot, dist, distSq, delta);
    }
  }

  // -----------------------------------------------------------------------
  // Öffentliche Getter
  // -----------------------------------------------------------------------

  /**
   * Gibt ALLE bekannten Stadt-Positionen zurück (auch unsichtbare).
   * Das Leitsystem sieht damit immer, wo die nächste Stadt ist,
   * und kann den Pfad dorthin zeichnen.
   */
  getActiveCityPositions(): THREE.Vector3[] {
    return this._cachedPositions;
  }

  /**
   * Gibt Exklusionszonen für sichtbare/geladene Städte zurück.
   * Nur "visible"-Städte blockieren Fische – "ready" ist unsichtbar,
   * aber Fische sollen trotzdem nicht durch Kuppeln schwimmen.
   */
  getExclusionZones(): ExclusionZone[] {
    return this._cachedZones;
  }

  /**
   * Baut den Exclusion-Zones-Cache neu auf. Wird nach jeder State-Änderung
   * einer Stadt aufgerufen, damit Fische/Korallen korrekt reagieren.
   */
  private _rebuildExclusionZones(): void {
    this._cachedZones.length = 0;
    for (const s of this._slots) {
      if (s.state === "visible" || s.state === "ready") {
        this._cachedZones.push({
          centerX: s.worldX,
          centerZ: s.worldZ,
          radius: s.domeRadius * 1.2,
        });
      }
    }
  }

  // -----------------------------------------------------------------------
  // Aufräumen
  // -----------------------------------------------------------------------

  dispose(): void {
    for (const slot of this._slots) {
      this._removeGroupFromScene(slot);
      // Group bereits entfernt, aber Speicher freigeben
    }
    this._slots.length = 0;
    this._templates.clear();
    this._templateData.clear();
  }

  // -----------------------------------------------------------------------
  // Raster generieren
  // -----------------------------------------------------------------------

  /**
   * Erzeugt Stadt-Positionen auf einem gleichmäßigen Raster.
   * Jede Position bekommt einen kleinen Zufalls-Offset
   * und einen zufälligen Stadt-Typ.
   */
  private _generateGrid(): void {
    const types = Object.keys(CITY_CONFIGS);
    if (types.length === 0) return;

    const steps = Math.floor(GRID_EXTENT / GRID_SPACING);

    for (let gx = -steps; gx <= steps; gx++) {
      for (let gz = -steps; gz <= steps; gz++) {
        // Zufalls-Offset für natürlichere Positionen
        const offsetX = (Math.random() - 0.5) * MAX_OFFSET * 2;
        const offsetZ = (Math.random() - 0.5) * MAX_OFFSET * 2;

        const worldX = gx * GRID_SPACING + offsetX;
        const worldZ = gz * GRID_SPACING + offsetZ;
        const type = types[Math.floor(Math.random() * types.length)];

        this._slots.push({
          gridX: gx,
          gridZ: gz,
          worldX,
          worldZ,
          type,
          state: "pending",
          group: null,
          domeRadius: 10, // Platzhalter – wird in ready gesetzt
          height: 10,
          opacity: 0,
          lights: [],
        });
      }
    }
  }

  // -----------------------------------------------------------------------
  // Slot-State verwalten
  // -----------------------------------------------------------------------

  /**
   * Schaltet den Zustand einer Stadt basierend auf der Distanz zur Kamera.
   * Enthält auch die Opazitäts-Animation für sanftes Ein-/Ausblenden.
   *
   * Hysterese: DIST_SHOW (28 m) ist etwas größer als DIST_HIDE (26 m),
   * damit die Stadt nicht ständig ein-/ausschaltet, wenn der Spieler
   * an der Grenze steht.
   */
  private _updateSlotState(
    slot: CitySlot,
    dist: number,
    _distSq: number,
    delta: number,
  ): void {
    switch (slot.state) {
      case "pending":
        if (dist < DIST_READY) {
          this._makeReady(slot);
        }
        break;

      case "ready":
        if (dist < DIST_SHOW) {
          this._showCity(slot);
        } else if (dist > DIST_UNLOAD) {
          this._backToPending(slot);
        }
        break;

      case "visible": {
        // Ziel-Opazität berechnen
        let target = 1.0;
        if (dist > DIST_HIDE) {
          target = 0; // Ausblenden
        } else if (dist > DIST_FULL_OPACITY) {
          // Sanfter Übergang zwischen 14 m (voll) und 26 m (unsichtbar)
          const fadeRange = DIST_HIDE - DIST_FULL_OPACITY;
          target = 1.0 - (dist - DIST_FULL_OPACITY) / fadeRange;
        }

        this._animateOpacity(slot, target, delta);

        // Wenn vollständig ausgeblendet → zurück zu "ready"
        if (target === 0 && slot.opacity < 0.01) {
          this._hideCity(slot);
        }
        break;
      }
    }
  }

  // -----------------------------------------------------------------------
  // Opazitäts-Animation
  // -----------------------------------------------------------------------

  /**
   * Interpoliert die Opazität sanft in Richtung Zielwert.
   * Verhindert plötzliches Ein-/Ausblenden.
   */
  private _animateOpacity(slot: CitySlot, target: number, delta: number): void {
    target = Math.max(0, Math.min(1, target));

    // Schon nah am Ziel? Dann direkt setzen + traversieren überspringen.
    // Das verhindert unnötige group.traverse()-Aufrufe bei voll sichtbaren Städten.
    if (Math.abs(slot.opacity - target) < 0.01) {
      slot.opacity = target;
      return;
    }

    const lerpFactor = 1 - Math.exp(-5.0 * delta);
    slot.opacity += (target - slot.opacity) * lerpFactor;

    if (slot.group) {
      this._applyOpacity(slot.group, slot.opacity);
    }
  }

  // -----------------------------------------------------------------------
  // Lebenszyklus-Übergänge
  // -----------------------------------------------------------------------

  /**
   * Macht eine Stadt "bereit": Klont das Template und bereitet alles vor.
   * Die Stadt ist noch unsichtbar, aber beim Betreten des DIST_SHOW-Bereichs
   * kann sie sofort eingeblendet werden.
   */
  private _makeReady(slot: CitySlot): void {
    const template = this._templates.get(slot.type);
    const data = this._templateData.get(slot.type);
    if (!template || !data) return;

    slot.domeRadius = data.domeRadius;
    slot.height = data.height;
    slot.state = "ready";
    this._rebuildExclusionZones();

    console.log(`🏙️ "${slot.type}" bereit bei (${slot.worldX.toFixed(0)}, ${slot.worldZ.toFixed(0)})`);
  }

  /**
   * Macht eine Stadt sichtbar: Erzeugt die Gruppe (Modell-Klon, Kuppel, Lichter)
   * und fügt sie der Szene hinzu. Die Opazität startet bei 0 (unsichtbar)
   * und wird dann in _animateOpacity hochgefahren.
   */
  private _showCity(slot: CitySlot): void {
    const template = this._templates.get(slot.type);
    const data = this._templateData.get(slot.type);
    if (!template || !data) return;

    const config = CITY_CONFIGS[slot.type];
    const groundY = this.floorY;

    const group = new THREE.Group();
    group.position.set(slot.worldX, 0, slot.worldZ);

    // Modell klonen
    const modelClone = template.clone(true);
    const box = new THREE.Box3().setFromObject(modelClone);
    modelClone.position.set(
      -(box.min.x + box.max.x) / 2,
      groundY - box.min.y - config.sinkDepth,
      -(box.min.z + box.max.z) / 2,
    );
    group.add(modelClone);

    // Kuppel
    const domeGroup = this._createDome(data.domeRadius);
    group.add(domeGroup);

    // Pittsburgh-Landschaft (nur wenn aktiviert)
    if (slot.type === "pittsburgh") {
      const halfExtent = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2;
      const landscape = this._createLandscape(data.domeRadius, groundY, halfExtent);
      group.add(landscape);
    }

    // Lichter
    const lights: THREE.PointLight[] = [];
    const lightPositions = [
      new THREE.Vector3(0, groundY + data.height * 0.3, 0),
      new THREE.Vector3(data.domeRadius * 0.3, groundY + data.height * 0.2, data.domeRadius * 0.3),
      new THREE.Vector3(-data.domeRadius * 0.3, groundY + data.height * 0.2, -data.domeRadius * 0.3),
    ];
    for (const lp of lightPositions) {
      const light = new THREE.PointLight(0xffaa44, 0.4, data.domeRadius * 1.5);
      light.position.copy(lp);
      group.add(light);
      lights.push(light);
    }

    // Gruppe am Start unsichtbar (Opazität 0)
    this._applyOpacity(group, 0);

    this.scene.add(group);

    slot.group = group;
    slot.lights = lights;
    slot.opacity = 0;
    slot.state = "visible";
    this._rebuildExclusionZones();

    console.log(`🏙️ "${slot.type}" sichtbar bei (${slot.worldX.toFixed(0)}, ${slot.worldZ.toFixed(0)})`);
  }

  /**
   * Blendet eine Stadt aus und entfernt sie aus der Szene.
   * Das geklonte Template bleibt im Speicher (kann wieder eingeblendet werden).
   */
  private _hideCity(slot: CitySlot): void {
    this._removeGroupFromScene(slot);
    slot.state = "ready";
    slot.opacity = 0;
    this._rebuildExclusionZones();

    console.log(`🏙️ "${slot.type}" ausgeblendet bei (${slot.worldX.toFixed(0)}, ${slot.worldZ.toFixed(0)})`);
  }

  /**
   * Setzt eine Stadt zurück in "pending".
   * Der Speicher wird freigegeben, das geklonte Template entfernt.
   */
  private _backToPending(slot: CitySlot): void {
    // Falls die Stadt noch in der Szene ist, entfernen
    if (slot.group) {
      this._removeGroupFromScene(slot);
    }
    slot.state = "pending";
    slot.group = null;
    slot.lights = [];
    slot.opacity = 0;
    this._rebuildExclusionZones();

    console.log(`🏙️ "${slot.type}" bei (${slot.worldX.toFixed(0)}, ${slot.worldZ.toFixed(0)}) entladen`);
  }

  // -----------------------------------------------------------------------
  // Hilfsfunktionen
  // -----------------------------------------------------------------------

  /**
   * Entfernt die Gruppe einer Stadt aus der Szene und gibt Ressourcen frei.
   */
  private _removeGroupFromScene(slot: CitySlot): void {
    if (!slot.group) return;

    this.scene.remove(slot.group);

    slot.group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry?.dispose();
        if (child.material) {
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          for (const m of mats) m.dispose();
        }
      }
    });

    slot.group = null;
  }

  /**
   * Wendet eine Opazität auf alle Meshes einer Gruppe an.
   * Die originale Opazität jedes Materials wird beim ersten Durchlauf
   * in userData gespeichert und dann als Basis für die Skalierung genutzt.
   * So behalten z. B. Kuppeln ihre ursprüngliche Transparenz (0.22).
   */
  private _applyOpacity(group: THREE.Group, opacity: number): void {
    group.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material) {
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        for (const m of mats) {
          if (!m.transparent) {
            // Material temporär transparent machen, damit es mitfadet
            m.transparent = true;
          }
          // Original-Opazität beim ersten Mal speichern
          if (m.userData.baseOpacity === undefined) {
            m.userData.baseOpacity = m.opacity;
          }
          m.opacity = (m.userData.baseOpacity as number) * opacity;
        }
      }
    });
  }

  // -----------------------------------------------------------------------
  // Modell laden
  // -----------------------------------------------------------------------

  private _loadModel(path: string): Promise<THREE.Group | null> {
    return new Promise((resolve) => {
      this.loader.load(
        path,
        (gltf) => resolve(gltf.scene),
        undefined,
        (err) => {
          console.error(`❌ CityWorld: Fehler beim Laden: ${path}`, err);
          resolve(null);
        },
      );
    });
  }

  // -----------------------------------------------------------------------
  // Gebäude einfärben
  // -----------------------------------------------------------------------

  private _colorBuildings(model: THREE.Object3D): void {
    const colors: number[] = [
      0xd4c5a9, 0xc8b898, 0xddd5c0, 0xbfae8e, 0xd9ccb0,
      0xccbfa0, 0xe0d5ba, 0xe8e4d8, 0xdcd8cc, 0xd0ccc0,
      0xc8c4b8, 0xbfbab0, 0xb8c8a8, 0xa0b898, 0x8a9e7e,
      0x7a8e6e, 0x9aaa84, 0x6e7e5e, 0xc4a882, 0xb8956e,
      0xa08060, 0x8a6e4e, 0xcc9988, 0xb88470, 0x9e6e5e,
      0xd4b878, 0xc8a868, 0xbb9a5a, 0xa08848, 0x8a9aaa,
      0x7a8a9a, 0x9aaa9a, 0x6e7e8e,
    ];
    const windowColors: number[] = [
      0xffdd88, 0xffeeaa, 0xffcc66, 0xffaa44, 0x88ccff, 0xaaddff,
    ];

    model.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const baseColor = new THREE.Color(colors[Math.floor(Math.random() * colors.length)]);
        const hasLights = Math.random() < 0.6;
        let emissive = new THREE.Color(0x000000);
        let emissiveIntensity = 0;
        if (hasLights) {
          emissive = new THREE.Color(windowColors[Math.floor(Math.random() * windowColors.length)]);
          emissiveIntensity = 0.15 + Math.random() * 0.4;
        }
        child.material = new THREE.MeshStandardMaterial({
          color: baseColor,
          roughness: 0.5,
          metalness: 0.05,
          emissive,
          emissiveIntensity,
          transparent: true,
          opacity: 1,
        });
      }
    });
  }

  // -----------------------------------------------------------------------
  // Kuppel bauen
  // -----------------------------------------------------------------------

  private _createDome(radius: number): THREE.Group {
    const group = new THREE.Group();
    const domeY = this.floorY + 0.1;

    const domeGeom = new THREE.SphereGeometry(radius, 64, 32, 0, Math.PI * 2, 0, Math.PI / 2);
    const dome = new THREE.Mesh(
      domeGeom,
      new THREE.MeshPhysicalMaterial({
        color: 0xccddff,
        transparent: true,
        opacity: 0.03,
        roughness: 0.0,
        metalness: 0.0,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    dome.position.y = domeY;
    group.add(dome);

    const ringGeom = new THREE.TorusGeometry(radius, 0.2, 16, 128);
    const ring = new THREE.Mesh(
      ringGeom,
      new THREE.MeshStandardMaterial({
        color: 0x889999,
        roughness: 0.3,
        metalness: 0.8,
      }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = domeY;
    group.add(ring);

    return group;
  }

  // -----------------------------------------------------------------------
  // Pittsburgh-Landschaft (Grünfläche + Bäume)
  // -----------------------------------------------------------------------

  private _createLandscape(
    domeRadius: number,
    groundY: number,
    exclusionRadius: number,
  ): THREE.Group {
    const group = new THREE.Group();

    const meadowGeom = new THREE.CircleGeometry(domeRadius, 48);
    const meadowMat = new THREE.MeshStandardMaterial({
      color: 0x5a7a3a,
      roughness: 0.9,
      metalness: 0.0,
      side: THREE.DoubleSide,
    });
    const meadow = new THREE.Mesh(meadowGeom, meadowMat);
    meadow.rotation.x = -Math.PI / 2;
    meadow.position.y = groundY + 0.05;
    group.add(meadow);

    const meadow2Geom = new THREE.CircleGeometry(domeRadius * 0.85, 48);
    const meadow2Mat = new THREE.MeshStandardMaterial({
      color: 0x4e6e30,
      roughness: 0.85,
      metalness: 0.0,
      side: THREE.DoubleSide,
    });
    const meadow2 = new THREE.Mesh(meadow2Geom, meadow2Mat);
    meadow2.rotation.x = -Math.PI / 2;
    meadow2.position.y = groundY + 0.06;
    group.add(meadow2);

    const treeColors = [0x4a6e2a, 0x3d5e1e, 0x557a30, 0x3a5a18, 0x4e7230];
    const treeMinDist = Math.max(exclusionRadius, domeRadius * 0.2);
    const treeMaxDist = domeRadius * 0.85;
    for (let i = 0; i < 35; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = treeMinDist + Math.random() * (treeMaxDist - treeMinDist);
      const tx = Math.cos(angle) * dist;
      const tz = Math.sin(angle) * dist;
      const treeHeight = 1.2 + Math.random() * 1.8;
      const tree = this._createTree(treeHeight, 0x6b4e3a, treeColors[Math.floor(Math.random() * treeColors.length)]);
      tree.position.set(tx, groundY + 0.05, tz);
      tree.rotation.y = Math.random() * Math.PI * 2;
      group.add(tree);
    }

    const bushColors = [0x5a7e2a, 0x4e7230, 0x628a32, 0x3e5e1e, 0x6a8a3a];
    const bushMinDist = Math.max(exclusionRadius * 0.9, domeRadius * 0.1);
    for (let i = 0; i < 25; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = bushMinDist + Math.random() * (domeRadius * 0.85 - bushMinDist);
      const bx = Math.cos(angle) * dist;
      const bz = Math.sin(angle) * dist;
      const bush = this._createBush(0.25 + Math.random() * 0.4, bushColors[Math.floor(Math.random() * bushColors.length)]);
      bush.position.set(bx, groundY + 0.06, bz);
      group.add(bush);
    }

    return group;
  }

  private _createTree(height: number, trunkColor: number, crownColor: number): THREE.Group {
    const tree = new THREE.Group();
    const trunkGeom = new THREE.CylinderGeometry(0.15, 0.2, height * 0.5, 6);
    const trunkMat = new THREE.MeshStandardMaterial({ color: trunkColor, roughness: 0.9, metalness: 0.0 });
    const trunk = new THREE.Mesh(trunkGeom, trunkMat);
    trunk.position.y = height * 0.25;
    tree.add(trunk);

    const crownGeom = new THREE.ConeGeometry(0.7, height * 0.65, 7);
    const crownMat = new THREE.MeshStandardMaterial({ color: crownColor, roughness: 0.8, metalness: 0.0 });
    const crown = new THREE.Mesh(crownGeom, crownMat);
    crown.position.y = height * 0.5 + height * 0.65 * 0.4;
    tree.add(crown);

    const crown2Geom = new THREE.ConeGeometry(0.45, height * 0.65 * 0.7, 7);
    const crown2 = new THREE.Mesh(crown2Geom, crownMat);
    crown2.position.y = height * 0.5 + height * 0.65 * 0.75;
    tree.add(crown2);
    return tree;
  }

  private _createBush(radius: number, color: number): THREE.Mesh {
    const geom = new THREE.SphereGeometry(radius, 6, 4, 0, Math.PI * 2, 0, Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.0 });
    const bush = new THREE.Mesh(geom, mat);
    bush.scale.y = 0.6;
    return bush;
  }
}
