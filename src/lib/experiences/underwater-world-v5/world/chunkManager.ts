/**
 * chunkManager.ts â€“ Verwaltet das Be- und Entladen von Terrain-Chunks.
 *
 * DIESE DATEI IST DER KERN DER WFC-INTEGRATION.
 *
 * Im Gegensatz zur V4-Version ist der ChunkManager hier mit dem WFC-System
 * verknÃ¼pft: Beim Laden eines neuen Chunks fragt er beim WFC-System an,
 * welcher Typ (Sand, Riff, Stadt, Qualle, Fisch) fÃ¼r diese Position kollabiert
 * wurde. AbhÃ¤ngig vom Typ werden dann die passenden 3D-Objekte geladen.
 *
 * Der Boden wird als EIN EINZIGES Mesh aufgebaut, das alle aktuell geladenen
 * Chunks abdeckt. Dadurch gibt es keine Kanten oder LÃ¼cken zwischen Chunks.
 */

import * as THREE from "three/webgpu";
import { WFCSystem, type ChunkType } from "../wfc/wfcSystem";
import {
  createTerrainChunk,
  type ChunkConfig,
  type TerrainChunk,
} from "./terrainChunk";
import type { ExclusionZone } from "./cityWorld";

// ---------------------------------------------------------------------------
// Typen
// ---------------------------------------------------------------------------

export interface ChunkManagerConfig {
  chunkSize: number;
  floorY: number;
  duneHeight: number;
  seegrassCount: number;
  renderDistance: number;
}

// ---------------------------------------------------------------------------
// ChunkManager â€“ mit WFC-Integration
// ---------------------------------------------------------------------------

export class ChunkManager {
  private config: ChunkManagerConfig;
  private chunks: Map<string, TerrainChunk> = new Map();
  private scene: THREE.Scene;

  /** Das WFC-System, das die Chunk-Typen bestimmt */
  private wfc: WFCSystem;

  /** Das EINE Boden-Mesh (einmal gebaut, Vertex-Höhen werden live aktualisiert) */
  private floorMesh: THREE.Mesh | null = null;

  /** Aktuelle Position (smooth lerp) */
  private _floorPosX: number = 0;
  private _floorPosZ: number = 0;
  /** Ziel = Chunk-Mittelpunkt */
  private _floorTargetX: number = 0;
  private _floorTargetZ: number = 0;
  /** Letzter Chunk, für den die Höhen aktualisiert wurden */
  private _lastFloorChunkX: number = Number.NaN;
  private _lastFloorChunkZ: number = Number.NaN;

  /** Exklusionszonen â€“ hier wÃ¤chst kein Seegras */
  private _exclusionZones: ExclusionZone[] = [];
  /** Letzter Zonen-String zum Erkennen von Ã„nderungen */
  private _lastZoneKey: string = "";

  /** WFC-Callbacks: Werden benachrichtigt, wenn ein Chunk-Typ kollabiert */
  private _wfcCallbacks: Array<
    (cx: number, cz: number, type: ChunkType) => void
  > = [];

  /**
   * Warteschlange fÃ¼r Chunks, die noch geladen werden mÃ¼ssen.
   * Gestaffeltes Laden: max 2 Chunks pro Frame, damit der Haupt-Thread
   * nicht blockiert wird und kein Ruckler entsteht.
   */
  private _pendingLoad: Array<{ cx: number; cz: number }> = [];

  constructor(scene: THREE.Scene, config: ChunkManagerConfig) {
    this.scene = scene;
    this.config = config;
    this.wfc = new WFCSystem();
  }

  /**
   * Registriert einen Callback, der bei jedem WFC-Kollaps aufgerufen wird.
   * CityWorld und CoralReefWorld nutzen das, um StÃ¤dte/Riffe zu platzieren.
   */
  public onChunkCollapsed(
    callback: (cx: number, cz: number, type: ChunkType) => void,
  ): void {
    this._wfcCallbacks.push(callback);
  }

  /**
   * Gibt den WFC-Typ fÃ¼r eine Chunk-Koordinate zurÃ¼ck.
   * Wird von CityWorld, CoralReefWorld, FishWorld und JellyWorld genutzt,
   * um zu entscheiden, ob sie an dieser Position aktiv werden sollen.
   */
  public getChunkType(cx: number, cz: number): ChunkType {
    return this.wfc.getChunkType(cx, cz);
  }

  /**
   * Setzt Zonen, in denen kein Seegras wachsen soll (z.â€¯B. Stadt-Kuppeln).
   */
  setExclusionZones(zones: ExclusionZone[]): void {
    const newKey = zones
      .map(
        (z) =>
          `${z.centerX.toFixed(2)},${z.centerZ.toFixed(2)},${z.radius.toFixed(2)}`,
      )
      .join("|");
    const changed = newKey !== this._lastZoneKey;

    if (changed) {
      const oldZones = this._exclusionZones;
      this._lastZoneKey = newKey;
      this._exclusionZones = zones;
      this._reloadChunksInZones(zones, oldZones);
    } else {
      this._exclusionZones = zones;
    }
  }

  /**
   * LÃ¤dt Chunks neu, die in alten oder neuen ExclusionZonen liegen.
   */
  private _reloadChunksInZones(
    newZones: ExclusionZone[],
    oldZones: ExclusionZone[],
  ): void {
    const allZones = [...oldZones, ...newZones];
    if (allZones.length === 0) return;
    const cs = this.config.chunkSize;

    const toReload: Array<{ cx: number; cz: number }> = [];
    for (const [, chunk] of this.chunks) {
      const worldX = chunk.coordX * cs + cs / 2;
      const worldZ = chunk.coordZ * cs + cs / 2;
      for (const zone of allZones) {
        const dx = worldX - zone.centerX;
        const dz = worldZ - zone.centerZ;
        if (dx * dx + dz * dz < zone.radius * zone.radius) {
          toReload.push({ cx: chunk.coordX, cz: chunk.coordZ });
          break;
        }
      }
    }

    for (const { cx, cz } of toReload) {
      const key = this._chunkKey(cx, cz);
      const chunk = this.chunks.get(key);
      if (chunk) {
        this._unloadChunk(chunk);
        this.chunks.delete(key);
        this._loadChunk(cx, cz);
      }
    }
  }

  // -----------------------------------------------------------------------
  // Ã–ffentliche API
  // -----------------------------------------------------------------------

  update(playerWorldX: number, playerWorldZ: number): void {
    const playerChunkX = Math.floor(playerWorldX / this.config.chunkSize);
    const playerChunkZ = Math.floor(playerWorldZ / this.config.chunkSize);
    const dist = this.config.renderDistance;

    // --- Bestimmen, welche Chunks geladen sein sollen ---
    const neededChunks = new Set<string>();
    const neededCoords: Array<{ cx: number; cz: number }> = [];

    for (let dx = -dist; dx <= dist; dx++) {
      for (let dz = -dist; dz <= dist; dz++) {
        const cx = playerChunkX + dx;
        const cz = playerChunkZ + dz;
        const key = this._chunkKey(cx, cz);
        neededChunks.add(key);
        neededCoords.push({ cx, cz });
      }
    }

    // --- Warteschlange fÃ¼llen: fehlende Chunks sammeln ---
    // Performance: nicht alle Chunks in einem Frame laden, sondern
    // gestaffelt (max 2 pro Frame). Das verhindert Ruckler beim
    // Betreten neuer Chunk-Reihen.
    this._pendingLoad.length = 0;
    for (const { cx, cz } of neededCoords) {
      const key = this._chunkKey(cx, cz);
      if (!this.chunks.has(key)) {
        this._pendingLoad.push({ cx, cz });
      }
    }

    // --- Gestaffelt laden: max 4 Chunks pro Frame ---
    const MAX_LOADS_PER_FRAME = 4;
    const toLoad = this._pendingLoad.slice(0, MAX_LOADS_PER_FRAME);
    // Geladene aus Warteschlange entfernen, Rest bleibt für nächste Frames
    this._pendingLoad = this._pendingLoad.slice(MAX_LOADS_PER_FRAME);
    for (const { cx, cz } of toLoad) {
      const key = this._chunkKey(cx, cz);
      if (this.chunks.has(key)) continue; // Wurde inzwischen geladen?

      // WFC-Collapse passiert hier automatisch beim ersten Aufruf
      const chunkType = this.wfc.getChunkType(cx, cz);
      this._loadChunk(cx, cz);

      // Benachrichtige alle registrierten Callbacks (CityWorld, CoralReefWorld, etc.)
      for (const cb of this._wfcCallbacks) {
        cb(cx, cz, chunkType);
      }
    }

    // --- EntlÃ¤dt alte Chunks ---
    for (const [key, chunk] of this.chunks) {
      if (!neededChunks.has(key)) {
        this._unloadChunk(chunk);
        this.chunks.delete(key);
      }
    }

    // --- Boden-Mesh: smooth lerp + live Vertex-Höhen ---
    // Das Mesh wird EINMAL gebaut. Die Position wird smooth zum
    // Chunk-Mittelpunkt interpoliert (kein Snap). Die Vertex-Höhen
    // werden jeden Frame an die aktuelle Position angepasst, sodass
    // die Dünen immer zur Welt-Position passen – auch während des
    // Lerps. Kein Neubau, kein Ruckeln, kein "Vorschnellen".
    const cs = this.config.chunkSize;
    const centerX = (playerChunkX + 0.5) * cs;
    const centerZ = (playerChunkZ + 0.5) * cs;

    if (!this.floorMesh) {
      // Einmal bauen (flach, ohne Höhen)
      this._buildFloorMesh();
    }

    // Ziel bei Chunk-Wechsel aktualisieren
    if (
      playerChunkX !== this._lastFloorChunkX ||
      playerChunkZ !== this._lastFloorChunkZ
    ) {
      // Aktuelle Position als Start für den Lerp merken
      this._floorPosX = this.floorMesh!.position.x;
      this._floorPosZ = this.floorMesh!.position.z;
      this._floorTargetX = centerX;
      this._floorTargetZ = centerZ;
      this._lastFloorChunkX = playerChunkX;
      this._lastFloorChunkZ = playerChunkZ;
    }

    // Smooth lerp zur Ziel-Position
    if (this.floorMesh) {
      this._floorPosX += (this._floorTargetX - this._floorPosX) * 0.08;
      this._floorPosZ += (this._floorTargetZ - this._floorPosZ) * 0.08;
      this.floorMesh.position.x = this._floorPosX;
      this.floorMesh.position.z = this._floorPosZ;

      // Vertex-Höhen an aktuelle Position anpassen (live, kein Neubau)
      this._updateFloorHeights();
    }
  }

  dispose(): void {
    if (this.floorMesh) {
      this.scene.remove(this.floorMesh);
      this.floorMesh.geometry?.dispose();
      this.floorMesh = null;
    }
    for (const chunk of this.chunks.values()) {
      this._unloadChunk(chunk);
    }
    this.chunks.clear();
    if (cachedFloorMat) {
      cachedFloorMat.dispose();
      cachedFloorMat = null;
    }
  }

  get loadedCount(): number {
    return this.chunks.size;
  }

  // -----------------------------------------------------------------------
  // Private: Boden-Mesh
  // -----------------------------------------------------------------------

  /**
   * Baut das Boden-Mesh EINMAL an Position (0, floorY, 0) mit flacher Geometrie.
   * Die Vertex-Höhen werden live in _updateFloorHeights gesetzt.
   */
  private _buildFloorMesh(): void {
    const radius = 100;
    const thetaSegs = Math.max(96, Math.ceil(radius * 3));
    const radialSegs = Math.max(32, Math.ceil(radius * 0.8));
    const geo = new THREE.RingGeometry(0, radius, thetaSegs, radialSegs);

    // Zusätzlichen Platz für Normalen (wird später befüllt)
    const posCount = geo.getAttribute("position").count;
    const normals = new Float32Array(posCount * 3);
    geo.setAttribute("normal", new THREE.BufferAttribute(normals, 3));

    if (!cachedFloorMat) {
      cachedFloorMat = new THREE.MeshStandardNodeMaterial({
        color: new THREE.Color("#d4c090"),
        roughness: 0.6,
        metalness: 0.0,
      });
    }

    this.floorMesh = new THREE.Mesh(geo, cachedFloorMat);
    this.floorMesh.position.set(0, this.config.floorY, 0);
    this.floorMesh.rotation.x = -Math.PI / 2;
    this.scene.add(this.floorMesh);

    // Erste Höhen-Berechnung
    this._updateFloorHeights();
  }

  /**
   * Aktualisiert die Vertex-Höhen + Normalen des Boden-Meshes
   * basierend auf der aktuellen Mesh-Position.
   * Dadurch passen die Dünen immer zur Welt-Position – auch während Lerp.
   */
  private _updateFloorHeights(): void {
    if (!this.floorMesh) return;

    const meshX = this.floorMesh.position.x;
    const meshZ = this.floorMesh.position.z;

    const pos = this.floorMesh.geometry.getAttribute(
      "position",
    ) as THREE.BufferAttribute;
    const posArr = pos.array as Float32Array;
    const count = pos.count;

    // --- Höhen aktualisieren ---
    // Nach rotation.x = -PI/2:
    //   world_x = mesh.position.x + local_x
    //   world_z = mesh.position.z - local_y
    //   local_z = duneHeight(world_x, world_z) → wird zum world_y
    for (let i = 0; i < count; i++) {
      const lx = posArr[i * 3];
      const ly = posArr[i * 3 + 1];
      const wx = meshX + lx;
      const wz = meshZ - ly;
      posArr[i * 3 + 2] = this._duneHeight(wx, wz);
    }
    pos.needsUpdate = true;

    // --- Normalen aktualisieren ---
    // dz/dx = dh/dwx * 1 = dhdx
    // dz/dy = dh/dwz * (-1) = -dhdz
    // Normal = (-dz/dx, -dz/dy, 1) = (-dhdx, +dhdz, 1)
    const normal = this.floorMesh.geometry.getAttribute(
      "normal",
    ) as THREE.BufferAttribute;
    const normalArr = normal.array as Float32Array;
    for (let i = 0; i < count; i++) {
      const lx = posArr[i * 3];
      const ly = posArr[i * 3 + 1];
      const wx = meshX + lx;
      const wz = meshZ - ly;
      const [dhdx, dhdz] = this._duneDerivatives(wx, wz);
      let nx = -dhdx;
      let ny = dhdz;
      let nz = 1.0;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      normalArr[i * 3] = nx / len;
      normalArr[i * 3 + 1] = ny / len;
      normalArr[i * 3 + 2] = nz / len;
    }
    normal.needsUpdate = true;
  }

  // -----------------------------------------------------------------------
  // DÃ¼nen-Mathematik
  // -----------------------------------------------------------------------

  private _duneHeight(wx: number, wz: number): number {
    const dh = this.config.duneHeight;
    return (
      dh * 0.5 * Math.sin(wx * 0.4) * Math.cos(wz * 0.6) +
      dh * 0.3 * Math.sin(wx * 1.2 + wz * 0.8) +
      dh * 0.2 * Math.cos(wx * 2.0 - wz * 1.4)
    );
  }

  private _duneDerivatives(wx: number, wz: number): [number, number] {
    const dh = this.config.duneHeight;
    const A = dh * 0.5,
      B = dh * 0.3,
      C = dh * 0.2;
    const a1 = 0.4,
      b1 = 0.6,
      a2 = 1.2,
      b2 = 0.8,
      a3 = 2.0,
      b3 = 1.4;

    const dhdx =
      A * a1 * Math.cos(wx * a1) * Math.cos(wz * b1) +
      B * a2 * Math.cos(wx * a2 + wz * b2) -
      C * a3 * Math.sin(wx * a3 - wz * b3);

    const dhdz =
      -A * b1 * Math.sin(wx * a1) * Math.sin(wz * b1) +
      B * b2 * Math.cos(wx * a2 + wz * b2) +
      C * b3 * Math.sin(wx * a3 - wz * b3);

    return [dhdx, dhdz];
  }

  // -----------------------------------------------------------------------
  // Private: Chunk-Laden/Entladen
  // -----------------------------------------------------------------------

  private _chunkKey(cx: number, cz: number): string {
    return `${cx},${cz}`;
  }

  private _loadChunk(cx: number, cz: number): void {
    const chunkConfig: ChunkConfig = {
      chunkSize: this.config.chunkSize,
      floorY: this.config.floorY,
      duneHeight: this.config.duneHeight,
      seegrassCount: this.config.seegrassCount,
    };
    const chunk = createTerrainChunk(
      cx,
      cz,
      chunkConfig,
      undefined,
      this._exclusionZones,
    );
    this.chunks.set(this._chunkKey(cx, cz), chunk);
    this.scene.add(chunk.group);
  }

  private _unloadChunk(chunk: TerrainChunk): void {
    this.scene.remove(chunk.group);
    chunk.group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry?.dispose();
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Gecachtes Boden-Material
// ---------------------------------------------------------------------------

let cachedFloorMat: THREE.MeshStandardNodeMaterial | null = null;
