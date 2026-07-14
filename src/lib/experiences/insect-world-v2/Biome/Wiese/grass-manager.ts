/**
 * insect-world-v2 — GrassManager (Chunk-basiert + WFC + Async Queue).
 *
 * Lädt Gras-Chunks und Blumen dynamisch um den Spieler herum.
 * Nutzt den Wavefunction-Collapse-Algorithmus (Robert Heaton)
 * für eine abwechslungsreiche Welt.
 *
 * Verbesserungen:
 * - Async-Chunk-Queue: Max 2 Chunks pro Frame → kein Ruckeln beim Laden
 * - Zwei Detailstufen: GROUND (Bodenplatte, sofort) + FULL (Gras+Blumen, asynchron)
 * - PREGEN_RADIUS=2: 25 Chunks getrackt, nur 9 mit vollem Detail
 * - Jittered Grid für Blumen: O(1) statt O(n²) → 100× schneller
 * - Keine leeren Kanten: Ground-Plane ist sofort da, Gras folgt unsichtbar
 *
 * WebGPU + TSL (siehe AGENTS.md).
 */
import * as THREE from "three/webgpu";
import {
  clamp,
  float,
  mix,
  positionLocal,
  uniform,
  vec3,
} from "three/tsl";
import type { MeadowConfig } from "./grass";
import { WFCEngine } from "./wfc-engine";
import { TILE_CONTENT, TileType } from "./wfc-tiles";
import type { PreloadedFlower } from "../../Objekte/Blumen/blumen";

// ── Konstanten ──

/** Chunk-Grösse in Metern (20m = feineres Grid, schnellere Ladezeiten) */
export const CHUNK_SIZE = 20;
/** Wie viele Chunks um den Spieler herum volle Details haben (2 = 5×5 = 100×100m) */
const VIEW_RADIUS = 2;
/** Wie viele Chunks vorab als Ground-Plane existieren (4 = 9×9 = 180×180m) */
const PREGEN_RADIUS = 4;
/** Maximal 4 Chunk-Upgrades pro update()-Aufruf (kleinere Chunks = mehr pro Frame) */
const QUEUE_ITEMS_PER_UPDATE = 4;

// ── Hilfsfunktion: Welthöhe (sanfte Mulde um den Ursprung) ──

function worldGroundHeight(x: number, z: number): number {
  const dist = Math.sqrt(x * x + z * z);
  return -0.00008 * dist * dist;
}

// ── ClearRegion (intern) ──

interface RectClearRegion {
  cx: number;
  cz: number;
  hw: number;
  hd: number;
  angle: number;
  border: number;
}

interface CircleClearRegion {
  cx: number;
  cz: number;
  radius: number;
  border: number;
}

// ── QueueItem (intern) ──

interface ChunkQueueItem {
  gx: number;
  gz: number;
}

// ── GrassChunk (intern) ──

interface GrassChunk {
  group: THREE.Group;
  /** InstancedMesh für Gras - null bedeutet: Chunk hat nur Ground (noch kein Gras) */
  mesh: THREE.InstancedMesh | null;
  ground: THREE.Mesh;
  gridX: number;
  gridZ: number;
  /** Blumen-InstancedMeshes in diesem Chunk */
  flowerMeshes: THREE.InstancedMesh[];
  /** Blumen-Positionen in diesem Chunk (für Target-Tracking) */
  flowerPositions: THREE.Vector3[];
  /** Vergangene Zeit seit Start des Fade-In (Sekunden) */
  fadeElapsed: number;
}

// ── Welthöhen-Funktion (exportiert für Blumen/Pheromone) ──

/** Höhe des Bodens an einer beliebigen Weltposition (sanfte Mulde). */
export function getWorldHeight(x: number, z: number): number {
  return worldGroundHeight(x, z);
}

// ── GrassManager ──

export class GrassManager {
  readonly group = new THREE.Group();

  private active = new Map<string, GrassChunk>();
  private config: MeadowConfig;
  private wfc = new WFCEngine();
  private preloadedFlowers: PreloadedFlower[];

  /** Globale Liste aller aktiven Blumen-Positionen (für Bienen, Schmetterlinge) */
  public readonly flowerTargets: THREE.Vector3[] = [];
  /** Globale Liste aller Blumen-Farben (parallel zu flowerTargets, für Pheromon-Spuren) */
  public readonly flowerColors: THREE.Color[] = [];

  /** Dauer des Fade-In für neue Chunks (0 = kein Fade) */
  private fadeDuration = 0;

  /** Zählt Updates für verzögertes WFC-Cleanup (nur alle 10 Frames) */
  private cleanupCounter = 0;

  /** Registrierte Clear-Regionen (z.B. Stadt) – Rechtecke */
  private clearRegions: RectClearRegion[] = [];
  /** Registrierte kreisförmige Clear-Regionen (z.B. Stadt) */
  private circleClearRegion: CircleClearRegion[] = [];

  /**
   * Async-Upgrade-Queue: Chunks, die noch Gras+Blumen brauchen.
   * Pro update()-Aufruf werden max QUEUE_ITEMS_PER_UPDATE Stück verarbeitet.
   */
  private chunkQueue: ChunkQueueItem[] = [];
  /** Keys von Chunks, die bereits in der Queue sind (kein Double-Enqueue) */
  private queuedKeys = new Set<string>();

  /**
   * Flag: Beim ersten update()-Aufruf werden ALLE Queue-Items synchron
   * verarbeitet, damit der Spawn sofort perfekt aussieht.
   * Danach wird asynchron (max 2 pro Aufruf) gearbeitet.
   */
  private initialLoadComplete = false;

  // Einmal erzeugte, gemeinsame Ressourcen (wiederverwendet)
  private bladeGeo: THREE.ConeGeometry;
  private bladeMat: THREE.MeshBasicNodeMaterial;
  private groundMat: THREE.MeshBasicNodeMaterial;

  constructor(config: MeadowConfig, preloadedFlowers: PreloadedFlower[]) {
    this.config = config;
    this.preloadedFlowers = preloadedFlowers;

    // ── Gemeinsame Geometrie für Grashalme ──
    // Ein Kegel pro Halm — wird per Instancing millionenfach gezeichnet.
    // 3 statt 4 Segmente: 25% weniger Dreiecke, optisch kein Unterschied.
    this.bladeGeo = new THREE.ConeGeometry(0.05, 1, 3);
    this.bladeGeo.translate(0, 0.5, 0); // Drehpunkt an die Basis

    // ── Gemeinsames TSL-Material für Grashalme ──
    this.bladeMat = this.createBladeMaterial();

    // ── Gemeinsames Material für den Boden ──
    this.groundMat = this.createGroundMaterial();
  }

  /**
   * Aktiviert den sanften Fade-In für neu geladene Chunks.
   * Sollte erst NACH dem ersten update()-Aufruf gesetzt werden,
   * damit die initialen Chunks ohne Fade erscheinen.
   *
   * @param duration - Dauer des Fade-In in Sekunden (z.B. 0.5)
   */
  setFadeDuration(duration: number): void {
    this.fadeDuration = duration;
  }

  /**
   * Stellt sicher, dass der Spawn-Chunk (0,0) garantiert Blumen hat.
   */
  preSeedSpawn(): void {
    this.wfc.preSeed(0, 0, "flowers_dense" as any);
  }

  /**
   * Prüft ob ein Chunk mit bestimmten Koordinaten aktuell aktiv ist.
   * Wird vom CityManager verwendet, um Stadt-Modelle zu platzieren.
   */
  hasChunk(gx: number, gz: number): boolean {
    return this.active.has(`${gx},${gz}`);
  }

  /**
   * Gibt den Tile-Typ eines aktiven Chunks zurück (oder undefined).
   */
  getTileTypeAt(gx: number, gz: number): string | undefined {
    const chunk = this.active.get(`${gx},${gz}`);
    if (!chunk) return undefined;
    // Den Tile-Typ via WFC abfragen (wird gecached)
    return this.wfc.getTileType(gx, gz) as unknown as string;
  }

  /**
   * Wird jeden N-ten Frame aufgerufen.
   * - Erzeugt sofort Ground-Planes für Chunks in PREGEN_RADIUS
   * - Queued Upgrades (Gras+Blumen) für Chunks in VIEW_RADIUS
   * - Verarbeitet 2 Queue-Items pro Aufruf (außer beim ersten Mal)
   * - Entfernt Chunks außerhalb PREGEN_RADIUS
   *
   * @param playerPosition - Aktuelle Kameraposition
   * @param delta - Zeit seit letztem Aufruf (für Fade-Animation)
   */
  update(playerPosition: THREE.Vector3, delta?: number): void {
    // Aktuelle Chunk-Koordinaten des Spielers
    const cx = Math.floor(playerPosition.x / CHUNK_SIZE);
    const cz = Math.floor(playerPosition.z / CHUNK_SIZE);

    // Alle benötigten Chunk-Keys für PREGEN_RADIUS sammeln
    const needed = new Set<string>();

    for (let dx = -PREGEN_RADIUS; dx <= PREGEN_RADIUS; dx++) {
      for (let dz = -PREGEN_RADIUS; dz <= PREGEN_RADIUS; dz++) {
        const gx = cx + dx;
        const gz = cz + dz;
        const key = `${gx},${gz}`;
        needed.add(key);

        // Prüfen ob dieser Chunk im inneren Ring liegt (VIEW_RADIUS)
        const isInnerRing = Math.abs(dx) <= VIEW_RADIUS && Math.abs(dz) <= VIEW_RADIUS;

        const existing = this.active.get(key);

        if (!existing) {
          // Chunk existiert noch gar nicht → Ground-Plane sofort erstellen
          this.createGroundChunk(gx, gz);

          // Wenn im inneren Ring: Upgrade (Gras+Blumen) in die Queue
          if (isInnerRing) {
            this.enqueueUpgrade(gx, gz);
          }
        } else if (existing.mesh === null && isInnerRing) {
          // Chunk existiert nur als Ground, ist aber jetzt im inneren Ring → Upgrade queued
          this.enqueueUpgrade(gx, gz);
        }
      }
    }

    // ── Queue verarbeiten ──
    if (!this.initialLoadComplete) {
      // Beim ersten Aufruf: ALLE Queue-Items sofort verarbeiten
      // → Spawn sieht perfekt aus, kein Warten auf Gras
      while (this.chunkQueue.length > 0) {
        const item = this.chunkQueue.shift()!;
        this.queuedKeys.delete(`${item.gx},${item.gz}`);
        this.processUpgrade(item.gx, item.gz, false);
      }
      this.initialLoadComplete = true;
    } else {
      // Normale asynchrone Verarbeitung: max QUEUE_ITEMS_PER_UPDATE pro Frame
      let processed = 0;
      // Queue nach Distanz zum Spieler sortieren (nächste Chunks zuerst)
      this.chunkQueue.sort((a, b) => {
        const ax = a.gx * CHUNK_SIZE + CHUNK_SIZE / 2;
        const az = a.gz * CHUNK_SIZE + CHUNK_SIZE / 2;
        const bx = b.gx * CHUNK_SIZE + CHUNK_SIZE / 2;
        const bz = b.gz * CHUNK_SIZE + CHUNK_SIZE / 2;
        const da = (ax - playerPosition.x) ** 2 + (az - playerPosition.z) ** 2;
        const db = (bx - playerPosition.x) ** 2 + (bz - playerPosition.z) ** 2;
        return da - db;
      });

      while (this.chunkQueue.length > 0 && processed < QUEUE_ITEMS_PER_UPDATE) {
        const item = this.chunkQueue.shift()!;
        this.queuedKeys.delete(`${item.gx},${item.gz}`);
        this.processUpgrade(item.gx, item.gz, delta !== undefined);
        processed++;
      }
    }

    // ── Nicht mehr benötigte Chunks entfernen (außerhalb PREGEN_RADIUS) ──
    for (const [key, chunk] of this.active) {
      if (!needed.has(key)) {
        this.group.remove(chunk.group);
        this.disposeChunk(chunk);
        this.active.delete(key);
      }
    }

    // ── Fade-Animation für neu geladene Chunks ──
    if (delta !== undefined && this.fadeDuration > 0) {
      for (const [, chunk] of this.active) {
        // Ground-only Chunks haben kein mesh → Fade nicht nötig (Ground ist immer sichtbar)
        if (!chunk.mesh) continue;
        // Nur Chunks mit geklontem Material (Fade aktiv)
        if (chunk.mesh.material === this.bladeMat) continue;

        const meshMat = chunk.mesh.material as THREE.MeshBasicNodeMaterial;
        const groundMat = chunk.ground.material as THREE.MeshBasicNodeMaterial;

        chunk.fadeElapsed += delta;

        if (chunk.fadeElapsed >= this.fadeDuration) {
          // Fade abgeschlossen → transparent deaktivieren (opaque pass = performant)
          meshMat.transparent = false;
          groundMat.transparent = false;
          meshMat.opacity = 1;
          groundMat.opacity = 1;
        } else {
          // Smoothstep-Interpolation: weicher Ein- und Auslauf
          const t = chunk.fadeElapsed / this.fadeDuration;
          const smooth = t * t * (3 - 2 * t);
          meshMat.opacity = smooth;
          groundMat.opacity = smooth;
        }
      }
    }

    // WFC-Engine aufräumen, um Speicherplatz zu sparen (nur alle 10 Frames)
    this.cleanupCounter++;
    if (this.cleanupCounter % 10 === 0) {
      this.wfc.cleanup(cx, cz, PREGEN_RADIUS + 2);
    }
  }

  /** Entfernt alle Chunks (z. B. beim Experience-Wechsel). */
  clear(): void {
    for (const [, chunk] of this.active) {
      this.group.remove(chunk.group);
      this.disposeChunk(chunk);
    }
    this.active.clear();
    this.flowerTargets.length = 0;
    this.flowerColors.length = 0;
    this.chunkQueue.length = 0;
    this.queuedKeys.clear();
    this.wfc.reset();
  }

  /**
   * Erzwingt einen WFC-Tile-Typ für einen bestimmten Chunk.
   * Wird vor dem ersten Laden des Chunks aufgerufen (z. B. für Stadt-Positionen).
   */
  forceTileType(gx: number, gz: number, tile: TileType): void {
    this.wfc.preSeed(gx, gz, tile);
  }

  /**
   * Registriert einen rechteckigen Bereich, in dem kein Gras und keine Blumen wachsen sollen.
   */
  addClearRegion(
    cx: number,
    cz: number,
    hw: number,
    hd: number,
    angle: number,
    border: number,
  ): void {
    this.clearRegions.push({ cx, cz, hw, hd, angle, border });
    // Bereits existierende Chunks nachträglich bereinigen
    this.clearRect(cx, cz, hw, hd, angle, border);
  }

  /**
   * Registriert einen kreisförmigen Bereich, in dem kein Gras und keine Blumen wachsen sollen.
   */
  addCircleClearRegion(
    cx: number,
    cz: number,
    radius: number,
    border: number = 0.5,
  ): void {
    this.circleClearRegion.push({ cx, cz, radius, border });
    // Bereits existierende Chunks nachträglich bereinigen
    this.clearCircle(cx, cz, radius, border);
  }

  /**
   * Prüft, ob eine Position in einer der registrierten Clear-Regionen liegt.
   */
  private isPositionCleared(x: number, z: number): boolean {
    // Rechtecke prüfen
    for (const reg of this.clearRegions) {
      const dx = x - reg.cx;
      const dz = z - reg.cz;
      const sinVal = Math.sin(reg.angle);
      const cosVal = Math.cos(reg.angle);
      const localX = dx * cosVal - dz * sinVal;
      const localZ = dx * sinVal + dz * cosVal;
      const bw = reg.hw + reg.border;
      const bd = reg.hd + reg.border;
      if (Math.abs(localX) < bw && Math.abs(localZ) < bd) {
        return true;
      }
    }
    // Kreise prüfen
    for (const reg of this.circleClearRegion) {
      const dx = x - reg.cx;
      const dz = z - reg.cz;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < reg.radius + reg.border) {
        return true;
      }
    }
    return false;
  }

  /**
   * Entfernt alle Grashalme in einem rotierten Rechteck (z. B. für Stadt).
   */
  clearRect(
    cx: number,
    cz: number,
    hw: number,
    hd: number,
    angle: number,
    border: number,
  ): void {
    const sinVal = Math.sin(angle);
    const cosVal = Math.cos(angle);
    const bw = hw + border;
    const bd = hd + border;
    const dummy = new THREE.Object3D();
    const pos = new THREE.Vector3();

    for (const chunk of this.active.values()) {
      if (!chunk.mesh) continue; // Ground-only Chunks haben keine Instanzen
      const mesh = chunk.mesh;
      const count = mesh.count;

      for (let i = 0; i < count; i++) {
        mesh.getMatrixAt(i, dummy.matrix);
        pos.setFromMatrixPosition(dummy.matrix);
        const dx = pos.x - cx;
        const dz = pos.z - cz;
        const localX = dx * cosVal - dz * sinVal;
        const localZ = dx * sinVal + dz * cosVal;

        if (Math.abs(localX) < bw && Math.abs(localZ) < bd) {
          dummy.position.set(pos.x, -100, pos.z);
          dummy.scale.setScalar(0);
          dummy.rotation.set(0, 0, 0);
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
        }
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /**
   * Entfernt alle Grashalme in einem Kreis (z. B. für Stadt).
   */
  clearCircle(
    cx: number,
    cz: number,
    radius: number,
    border: number = 0.5,
  ): void {
    const r = radius + border;
    const dummy = new THREE.Object3D();
    const pos = new THREE.Vector3();

    for (const chunk of this.active.values()) {
      if (!chunk.mesh) continue; // Ground-only Chunks haben keine Instanzen
      const mesh = chunk.mesh;
      const count = mesh.count;

      for (let i = 0; i < count; i++) {
        mesh.getMatrixAt(i, dummy.matrix);
        pos.setFromMatrixPosition(dummy.matrix);
        const dx = pos.x - cx;
        const dz = pos.z - cz;
        const dist = Math.sqrt(dx * dx + dz * dz);

        if (dist < r) {
          dummy.position.set(pos.x, -100, pos.z);
          dummy.scale.setScalar(0);
          dummy.rotation.set(0, 0, 0);
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
        }
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /** Gibt alle Ressourcen frei. */
  dispose(): void {
    this.clear();
    this.bladeGeo.dispose();
    this.bladeMat.dispose();
    this.groundMat.dispose();
  }

  // ── Queue-Logik ──

  /**
   * Fügt einen Chunk in die Upgrade-Queue ein (falls nicht bereits vorhanden).
   * Die Queue wird später nach Distanz zum Spieler sortiert.
   */
  private enqueueUpgrade(gx: number, gz: number): void {
    const key = `${gx},${gz}`;
    if (!this.queuedKeys.has(key)) {
      this.queuedKeys.add(key);
      this.chunkQueue.push({ gx, gz });
    }
  }

  // ── Private Hilfsfunktionen ──

  /**
   * Erzeugt einen Ground-only Chunk (nur Bodenplatte, kein Gras, keine Blumen).
   * Das ist billig (~0.1ms) und passiert sofort.
   * Gras+Blumen werden später per upgradeChunkToFull() asynchron nachgeliefert.
   */
  private createGroundChunk(gx: number, gz: number): void {
    const worldX = gx * CHUNK_SIZE + CHUNK_SIZE / 2;
    const worldZ = gz * CHUNK_SIZE + CHUNK_SIZE / 2;

    const group = new THREE.Group();
    const ground = this.createGround(worldX, worldZ);
    group.add(ground);

    this.group.add(group);
    this.active.set(`${gx},${gz}`, {
      group,
      mesh: null, // ground-only → noch kein Gras
      ground,
      gridX: gx,
      gridZ: gz,
      flowerMeshes: [],
      flowerPositions: [],
      fadeElapsed: 0,
    });
  }

  /**
   * Verarbeitet ein Queue-Item: Erzeugt Gras+Blumen für einen existierenden
   * Ground-only Chunk. Der Chunk muss existieren und mesh === null haben.
   *
   * @param useFade - Ob die neuen Meshes mit Fade-In erscheinen sollen
   */
  private processUpgrade(gx: number, gz: number, useFade: boolean): void {
    const key = `${gx},${gz}`;
    const existing = this.active.get(key);
    // Nur upgraden, wenn der Chunk noch existiert und ground-only ist
    if (!existing || existing.mesh !== null) return;

    const worldX = gx * CHUNK_SIZE + CHUNK_SIZE / 2;
    const worldZ = gz * CHUNK_SIZE + CHUNK_SIZE / 2;

    // WFC-Typ und Content bestimmen
    const tileType = this.wfc.getTileType(gx, gz);
    const content = TILE_CONTENT[tileType];

    // Prüfen, ob Clear-Regionen in der Nähe sind (spart isPositionCleared-Aufrufe)
    const chunkHalfDiag = CHUNK_SIZE * 0.71;
    const needsClearCheck =
      this.circleClearRegion.some((r) => {
        const dx = worldX - r.cx;
        const dz = worldZ - r.cz;
        return Math.sqrt(dx * dx + dz * dz) < r.radius + r.border + chunkHalfDiag;
      }) ||
      this.clearRegions.some((r) => {
        const dx = Math.abs(worldX - r.cx);
        const dz = Math.abs(worldZ - r.cz);
        return dx < r.hw + r.border + chunkHalfDiag && dz < r.hd + r.border + chunkHalfDiag;
      });

    // ── Grashalme ──
    const mesh = this.createChunkGrass(gx, gz, content, needsClearCheck);
    existing.group.add(mesh);

    // ── Blumen generieren (Jittered Grid) ──
    if (content.flowerCount > 0 && this.preloadedFlowers.length > 0) {
      this.generateFlowersForChunk(
        worldX,
        worldZ,
        content.flowerCount,
        existing.group,
        existing.flowerMeshes,
        existing.flowerPositions,
        needsClearCheck,
      );
    }

    // ── Material-Klon für sanften Fade-In ──
    if (useFade && this.fadeDuration > 0) {
      const fadeBlade = this.bladeMat.clone();
      fadeBlade.transparent = true;
      fadeBlade.opacity = 0;
      mesh.material = fadeBlade;
    }

    // Chunk auf "volles Detail" aktualisieren
    existing.mesh = mesh;
    existing.fadeElapsed = 0;
  }

  /**
   * Generiert Blumen für einen Chunk mit Jittered Grid.
   *
   * Statt O(n²) Rejection-Sampling (alte Version) werden Blumen auf
   * einem regelmäßigen Grid platziert und innerhalb ihrer Zelle zufällig
   * versetzt ("gejittert"). Das sieht genauso zufällig aus, ist aber O(1)
   * pro Blume und garantiert Mindestabstand.
   */
  private generateFlowersForChunk(
    worldX: number,
    worldZ: number,
    flowerCount: number,
    group: THREE.Group,
    flowerMeshesOut: THREE.InstancedMesh[],
    flowerPositionsOut: THREE.Vector3[],
    checkClear: boolean,
  ): void {
    const dummy = new THREE.Object3D();

    // Jittered Grid: Blumen auf einem Raster verteilen
    // gridCols × gridCols Zellen, jede bekommt maximal eine Blume
    const gridCols = Math.ceil(Math.sqrt(flowerCount));
    const spacing = CHUNK_SIZE / gridCols;
    const halfSize = CHUNK_SIZE / 2;

    // Positionen pro Blumentyp sammeln
    const flowerInstances: Array<
      { x: number; y: number; z: number; rotY: number; s: number }[]
    > = Array.from({ length: this.preloadedFlowers.length }, () => []);

    let placed = 0;
    for (let r = 0; r < gridCols && placed < flowerCount; r++) {
      for (let c = 0; c < gridCols && placed < flowerCount; c++) {
        // Jitter: ±40% der Zellgröße → Blume bleibt in ihrer Zelle
        const jx = (Math.random() - 0.5) * spacing * 0.8;
        const jz = (Math.random() - 0.5) * spacing * 0.8;

        const x = worldX - halfSize + (c + 0.5) * spacing + jx;
        const z = worldZ - halfSize + (r + 0.5) * spacing + jz;

        // Clear-Region prüfen (z.B. Stadt)
        if (checkClear && this.isPositionCleared(x, z)) continue;

        const typeIdx = Math.floor(Math.random() * this.preloadedFlowers.length);
        const y = worldGroundHeight(x, z) + Math.random() * 0.05;
        const rotY = Math.random() * Math.PI * 2;
        const s =
          this.preloadedFlowers[typeIdx].scale * (0.8 + Math.random() * 0.7);

        flowerInstances[typeIdx].push({ x, y, z, rotY, s });
        placed++;
      }
    }

    // InstancedMeshes pro Blumentyp erstellen (gleicher Code wie vorher)
    for (let typeIdx = 0; typeIdx < this.preloadedFlowers.length; typeIdx++) {
      const flower = this.preloadedFlowers[typeIdx];
      const instances = flowerInstances[typeIdx];
      const count = instances.length;

      if (count > 0) {
        for (const { geometry, material } of flower.materialGroups) {
          const fMesh = new THREE.InstancedMesh(geometry, material, count);
          for (let i = 0; i < count; i++) {
            const p = instances[i];
            dummy.position.set(p.x, p.y, p.z);
            dummy.scale.setScalar(p.s);
            dummy.rotation.set(0, p.rotY, 0);
            dummy.updateMatrix();
            fMesh.setMatrixAt(i, dummy.matrix);
          }
          fMesh.instanceMatrix.needsUpdate = true;
          fMesh.castShadow = false;
          fMesh.receiveShadow = false;
          group.add(fMesh);
          flowerMeshesOut.push(fMesh);
        }

        // Positionen als Targets registrieren (für Bienen, Schmetterlinge, Pheromone)
        for (const p of instances) {
          const pos = new THREE.Vector3(p.x, p.y, p.z);
          flowerPositionsOut.push(pos);
          this.flowerTargets.push(pos);
          // Farbe der Blume speichern (für Pheromon-Spuren)
          this.flowerColors.push(flower.color.clone());
        }
      }
    }
  }

  /** Erzeugt einen InstancedMesh mit Grashalmen für einen Chunk. */
  private createChunkGrass(
    gx: number,
    gz: number,
    content: {
      grassCount: number;
      grassMinHeight: number;
      grassMaxHeight: number;
    },
    checkClear: boolean,
  ): THREE.InstancedMesh {
    const worldX = gx * CHUNK_SIZE + CHUNK_SIZE / 2;
    const worldZ = gz * CHUNK_SIZE + CHUNK_SIZE / 2;
    const count = content.grassCount;

    // Jeder Chunk braucht eine eigene Geometrie-Kopie, weil die Instanz-Attribute
    // (aPhase, aSpeed, aBaseX, aBaseZ) pro Chunk unterschiedliche Längen haben.
    const bladeGeoClone = this.bladeGeo.clone();
    const mesh = new THREE.InstancedMesh(bladeGeoClone, this.bladeMat, count);

    const dummy = new THREE.Object3D();

    for (let i = 0; i < count; i++) {
      // Zufällige Position innerhalb des Chunks
      const x = worldX + (Math.random() - 0.5) * CHUNK_SIZE;
      const z = worldZ + (Math.random() - 0.5) * CHUNK_SIZE;

      // Zufällige Höhe und Rotation
      const h =
        content.grassMinHeight +
        Math.random() * (content.grassMaxHeight - content.grassMinHeight);
      const rotY = Math.random() * Math.PI * 2;
      const sx = 0.5 + Math.random() * 0.8;
      const sz = 0.5 + Math.random() * 0.8;

      // Bodenniveau am Weltpunkt
      const baseY = worldGroundHeight(x, z);

      // Instanz-Matrix setzen (unter die Erde, wenn in Clear-Region)
      if (checkClear && this.isPositionCleared(x, z)) {
        dummy.position.set(x, -100, z);
        dummy.scale.setScalar(0);
      } else {
        dummy.position.set(x, baseY, z);
        dummy.scale.set(sx, h, sz);
      }
      dummy.rotation.set(0, rotY, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }

    mesh.instanceMatrix.needsUpdate = true;

    return mesh;
  }

  /** Erzeugt die Bodenplatte für einen Chunk mit leichter Wölbung. */
  private createGround(worldX: number, worldZ: number): THREE.Mesh {
    const segs = 4;
    const geo = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE, segs, segs);
    geo.rotateX(-Math.PI / 2);

    // Höhen anpassen (sanfte Mulde zum Ursprung hin)
    const pos = geo.attributes.position as THREE.Float32BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + worldX;
      const z = pos.getZ(i) + worldZ;
      pos.setY(i, worldGroundHeight(x, z));
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();

    const mesh = new THREE.Mesh(geo, this.groundMat);
    mesh.position.set(worldX, 0, worldZ);
    return mesh;
  }

  /** Erzeugt das TSL-Material für die Grashalme. */
  private createBladeMaterial(): THREE.MeshBasicNodeMaterial {
    const uColor = uniform(new THREE.Color(this.config.color));
    const uGroundColor = uniform(new THREE.Color(this.config.groundColor));
    const uMinHeight = uniform(this.config.minHeight);
    const uMaxHeight = uniform(this.config.maxHeight);

    //── colorNode: Höhenfärbung (keine Lichtberechnung – spart ~20% GPU) ──
    const heightT = clamp(
      positionLocal.y
        .sub(uMinHeight)
        .div(uMaxHeight.sub(uMinHeight).add(0.001)),
      float(0),
      float(1),
    );

    const mat = new THREE.MeshBasicNodeMaterial();
    mat.colorNode = mix(uGroundColor, uColor, heightT);
    mat.fog = true;

    return mat;
  }

  /** Erzeugt das TSL-Material für die Bodenplatte. */
  private createGroundMaterial(): THREE.MeshBasicNodeMaterial {
    const gc = new THREE.Color(this.config.groundColor);
    const mat = new THREE.MeshBasicNodeMaterial();
    mat.colorNode = vec3(gc.r, gc.g, gc.b);
    mat.fog = true;
    return mat;
  }

  /** Räumt einen Chunk auf (entfernt Geometrie und Targets). */
  private disposeChunk(chunk: GrassChunk): void {
    // Gras (falls vorhanden – Ground-only Chunks haben kein mesh)
    if (chunk.mesh) {
      if (chunk.mesh.material !== this.bladeMat) {
        (chunk.mesh.material as THREE.Material).dispose();
      }
      chunk.mesh.geometry.dispose();
      chunk.mesh.removeFromParent();
    }

    // Boden (immer vorhanden)
    if (chunk.ground.material !== this.groundMat) {
      (chunk.ground.material as THREE.Material).dispose();
    }
    chunk.ground.geometry.dispose();
    chunk.ground.removeFromParent();

    // Blumen-Instanzen aus globalen Targets austragen
    for (const pos of chunk.flowerPositions) {
      const idx = this.flowerTargets.indexOf(pos);
      if (idx !== -1) {
        this.flowerTargets.splice(idx, 1);
        this.flowerColors.splice(idx, 1);
      }
    }

    // Blumen-InstancedMeshes entfernen
    for (const fMesh of chunk.flowerMeshes) {
      fMesh.removeFromParent();
    }
  }
}
