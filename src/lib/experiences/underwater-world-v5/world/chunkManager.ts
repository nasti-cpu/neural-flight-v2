/**
 * chunkManager.ts – Verwaltet das Be- und Entladen von Terrain-Chunks.
 *
 * DIESE DATEI IST DER KERN DER WFC-INTEGRATION.
 *
 * Im Gegensatz zur V4-Version ist der ChunkManager hier mit dem WFC-System
 * verknüpft: Beim Laden eines neuen Chunks fragt er beim WFC-System an,
 * welcher Typ (Sand, Riff, Stadt, Qualle, Fisch) für diese Position kollabiert
 * wurde. Abhängig vom Typ werden dann die passenden 3D-Objekte geladen.
 *
 * Der Boden wird als EIN EINZIGES Mesh aufgebaut, das alle aktuell geladenen
 * Chunks abdeckt. Dadurch gibt es keine Kanten oder Lücken zwischen Chunks.
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
// ChunkManager – mit WFC-Integration
// ---------------------------------------------------------------------------

export class ChunkManager {
  private config: ChunkManagerConfig;
  private chunks: Map<string, TerrainChunk> = new Map();
  private scene: THREE.Scene;

  /** Das WFC-System, das die Chunk-Typen bestimmt */
  private wfc: WFCSystem;

  /** Das EINE Boden-Mesh, das alle Chunks abdeckt */
  private floorMesh: THREE.Mesh | null = null;

  /** Letzter Chunk, für den das Boden-Mesh gebaut wurde */
  private _lastFloorChunkX: number = Number.NaN;
  private _lastFloorChunkZ: number = Number.NaN;

  /** Exklusionszonen – hier wächst kein Seegras */
  private _exclusionZones: ExclusionZone[] = [];
  /** Letzter Zonen-String zum Erkennen von Änderungen */
  private _lastZoneKey: string = "";

  /** WFC-Callbacks: Werden benachrichtigt, wenn ein Chunk-Typ kollabiert */
  private _wfcCallbacks: Array<
    (cx: number, cz: number, type: ChunkType) => void
  > = [];

  constructor(scene: THREE.Scene, config: ChunkManagerConfig) {
    this.scene = scene;
    this.config = config;
    this.wfc = new WFCSystem();
  }

  /**
   * Registriert einen Callback, der bei jedem WFC-Kollaps aufgerufen wird.
   * CityWorld und CoralReefWorld nutzen das, um Städte/Riffe zu platzieren.
   */
  public onChunkCollapsed(
    callback: (cx: number, cz: number, type: ChunkType) => void,
  ): void {
    this._wfcCallbacks.push(callback);
  }

  /**
   * Gibt den WFC-Typ für eine Chunk-Koordinate zurück.
   * Wird von CityWorld, CoralReefWorld, FishWorld und JellyWorld genutzt,
   * um zu entscheiden, ob sie an dieser Position aktiv werden sollen.
   */
  public getChunkType(cx: number, cz: number): ChunkType {
    return this.wfc.getChunkType(cx, cz);
  }

  /**
   * Setzt Zonen, in denen kein Seegras wachsen soll (z. B. Stadt-Kuppeln).
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
   * Lädt Chunks neu, die in alten oder neuen ExclusionZonen liegen.
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
  // Öffentliche API
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

    // --- Lädt neue Chunks (inkl. WFC-Kollaps + Callback) ---
    for (const { cx, cz } of neededCoords) {
      const key = this._chunkKey(cx, cz);
      if (!this.chunks.has(key)) {
        // WFC-Collapse passiert hier automatisch beim ersten Aufruf
        const chunkType = this.wfc.getChunkType(cx, cz);
        this._loadChunk(cx, cz);

        // Benachrichtige alle registrierten Callbacks (CityWorld, CoralReefWorld, etc.)
        for (const cb of this._wfcCallbacks) {
          cb(cx, cz, chunkType);
        }
      }
    }

    // --- Entlädt alte Chunks ---
    for (const [key, chunk] of this.chunks) {
      if (!neededChunks.has(key)) {
        this._unloadChunk(chunk);
        this.chunks.delete(key);
      }
    }

    // --- Boden-Mesh: neu bauen wenn Spieler in neuen Chunk wechselt ---
    const chunkChanged =
      playerChunkX !== this._lastFloorChunkX ||
      playerChunkZ !== this._lastFloorChunkZ;
    if (!this.floorMesh || chunkChanged) {
      if (this.floorMesh) {
        this.scene.remove(this.floorMesh);
        this.floorMesh.geometry?.dispose();
      }
      this._buildFloorMesh(neededCoords);
      this._lastFloorChunkX = playerChunkX;
      this._lastFloorChunkZ = playerChunkZ;
    }
    if (!this.floorMesh) return;
    const cs = this.config.chunkSize;
    const centerX = (playerChunkX + 0.5) * cs;
    const centerZ = (playerChunkZ + 0.5) * cs;
    this.floorMesh.position.set(centerX, this.config.floorY, centerZ);
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

  private _buildFloorMesh(
    neededCoords: Array<{ cx: number; cz: number }>,
  ): void {
    if (neededCoords.length === 0) return;

    let minCX = Infinity,
      maxCX = -Infinity;
    let minCZ = Infinity,
      maxCZ = -Infinity;
    for (const { cx, cz } of neededCoords) {
      if (cx < minCX) minCX = cx;
      if (cx > maxCX) maxCX = cx;
      if (cz < minCZ) minCZ = cz;
      if (cz > maxCZ) maxCZ = cz;
    }

    const cs = this.config.chunkSize;
    const worldMinX = minCX * cs;
    const worldMinZ = minCZ * cs;
    const worldMaxX = (maxCX + 1) * cs;
    const worldMaxZ = (maxCZ + 1) * cs;
    const totalWidth = worldMaxX - worldMinX;
    const totalDepth = worldMaxZ - worldMinZ;

    const radius = Math.max(totalWidth, totalDepth) * 0.6;
    const thetaSegs = Math.max(96, Math.ceil(radius * 3));
    const radialSegs = Math.max(32, Math.ceil(radius * 0.8));
    const geo = new THREE.RingGeometry(0, radius, thetaSegs, radialSegs);

    const centerX = (worldMinX + worldMaxX) / 2;
    const centerZ = (worldMinZ + worldMaxZ) / 2;
    const pos = geo.getAttribute("position") as THREE.BufferAttribute;
    const posArr = pos.array as Float32Array;

    for (let i = 0; i < pos.count; i++) {
      const lx = posArr[i * 3];
      const ly = posArr[i * 3 + 1];
      const wx = centerX + lx;
      const wz = centerZ + ly;
      const h = this._duneHeight(wx, wz);
      posArr[i * 3 + 2] = h;
    }
    pos.needsUpdate = true;

    // Normalen analytisch berechnen
    const normals = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const lx = posArr[i * 3];
      const ly = posArr[i * 3 + 1];
      const wx = centerX + lx;
      const wz = centerZ + ly;
      const [nx, ny, nz] = this._duneNormalLocal(wx, wz);
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      normals[i * 3] = nx / len;
      normals[i * 3 + 1] = ny / len;
      normals[i * 3 + 2] = nz / len;
    }
    geo.setAttribute("normal", new THREE.BufferAttribute(normals, 3));

    if (!cachedFloorMat) {
      cachedFloorMat = new THREE.MeshStandardNodeMaterial({
        color: new THREE.Color("#d4c090"),
        roughness: 0.6,
        metalness: 0.0,
      });
    }

    this.floorMesh = new THREE.Mesh(geo, cachedFloorMat);
    this.floorMesh.rotation.x = -Math.PI / 2;
    this.scene.add(this.floorMesh);
  }

  // -----------------------------------------------------------------------
  // Dünen-Mathematik
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

  private _duneNormalLocal(wx: number, wz: number): [number, number, number] {
    const [dhdx, dhdz] = this._duneDerivatives(wx, wz);
    return [-dhdx, -dhdz, 1.0];
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
        if (child.material) {
          const mats = Array.isArray(child.material)
            ? child.material
            : [child.material];
          for (const mat of mats) {
            if (mat instanceof THREE.MeshBasicNodeMaterial) {
              mat.dispose();
            }
          }
        }
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Gecachtes Boden-Material
// ---------------------------------------------------------------------------

let cachedFloorMat: THREE.MeshStandardNodeMaterial | null = null;
