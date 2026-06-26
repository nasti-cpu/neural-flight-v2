/**
 * terrainChunk.ts – Erzeugt einen einzelnen Terrain-Chunk.
 *
 * Ein Chunk enthält nur noch Seegras-Dekoration.
 * Der Boden wird als EIN Mesh im ChunkManager verwaltet.
 */

import * as THREE from "three/webgpu";
import {
  createSeegrassBlade,
  createRibbonBlade,
} from "../shader/seegrass/seegrassShader";

// ---------------------------------------------------------------------------
// Typen
// ---------------------------------------------------------------------------

export interface ExclusionZone {
  centerX: number;
  centerZ: number;
  radius: number;
}

export interface ChunkConfig {
  chunkSize: number;
  floorY: number;
  duneHeight: number;
  seegrassCount: number;
}

export interface TerrainChunk {
  group: THREE.Group;
  coordX: number;
  coordZ: number;
}

// ---------------------------------------------------------------------------
// Chunk-Erstellung (nur Seegras)
// ---------------------------------------------------------------------------

export function createTerrainChunk(
  coordX: number,
  coordZ: number,
  config: ChunkConfig,
  seed: number = coordX * 10000 + coordZ,
  exclusionZones?: ExclusionZone[],
): TerrainChunk {
  const group = new THREE.Group();

  const worldOffsetX = coordX * config.chunkSize;
  const worldOffsetZ = coordZ * config.chunkSize;

  // --- Seegras ---
  const rand = createSeededRandom(seed);

  for (let i = 0; i < config.seegrassCount; i++) {
    const lx = (rand() - 0.5) * config.chunkSize;
    const lz = (rand() - 0.5) * config.chunkSize;

    // Welt-Koordinaten für Exklusionszonen-Check
    const wx = worldOffsetX + lx;
    const wz = worldOffsetZ + lz;
    if (exclusionZones && _isInAnyZone(wx, wz, exclusionZones)) {
      continue; // Kein Seegras unter/neben Kuppeln
    }

    const isRibbon = rand() > 0.6;

    // Tiefsee-Seegras: dunkle, gedämpfte Farben statt Giftgrün
    const darkOptions = {
      colorBottom: new THREE.Color("#0a1a0a"),
      colorTop: new THREE.Color("#1a4a1a"),
    };
    const blade = isRibbon
      ? createRibbonBlade(darkOptions, 0.3 + rand() * 0.3, 1.5 + rand() * 2.0)
      : createSeegrassBlade(
          darkOptions,
          0.1 + rand() * 0.15,
          1.0 + rand() * 1.5,
        );

    blade.position.set(lx, config.floorY + 0.1, lz);
    blade.rotation.y = rand() * Math.PI * 2;
    group.add(blade);
  }

  group.position.x = worldOffsetX;
  group.position.z = worldOffsetZ;

  return { group, coordX, coordZ };
}

// ---------------------------------------------------------------------------
// Hilfsfunktionen
// ---------------------------------------------------------------------------

function createSeededRandom(seed: number): () => number {
  let s = seed | 0;
  return (): number => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Kein disposeChunkCache mehr nötig – Material wird im ChunkManager gecacht

/**
 * Prüft, ob ein Welt-Punkt (wx, wz) innerhalb einer Exklusionszone liegt.
 * Wird von createTerrainChunk verwendet, um Seegras unter Kuppeln zu vermeiden.
 */
function _isInAnyZone(wx: number, wz: number, zones: ExclusionZone[]): boolean {
  for (const zone of zones) {
    const dx = wx - zone.centerX;
    const dz = wz - zone.centerZ;
    if (dx * dx + dz * dz < zone.radius * zone.radius) {
      return true;
    }
  }
  return false;
}
