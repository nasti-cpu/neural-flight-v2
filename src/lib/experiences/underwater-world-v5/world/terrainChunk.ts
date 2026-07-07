/**
 * terrainChunk.ts - Erzeugt einen einzelnen Terrain-Chunk.
 *
 * Ein Chunk enthalt nur noch Seegras-Dekoration.
 * Der Boden wird als EIN Mesh im ChunkManager verwaltet.
 *
 * PERFORMANCE: Alle Seegras-Halme teilen sich EIN Material.
 * Statt fur jeden Halm ein eigenes MeshBasicNodeMaterial (TSL) zu erzeugen,
 * nutzen wir genau EINES. Das spart hunderte Shader-Node-Graphen und damit
 * massiv GPU-Overhead.
 */

import * as THREE from "three/webgpu";
import {
  createSeegrassBladeGeometry,
  createRibbonGeometry,
  createSeegrassMaterial,
} from "../shader/seegrass/seegrassShader";

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

const _sharedSeegrassMat = createSeegrassMaterial({
  colorBottom: new THREE.Color("#0a1a0a"),
  colorTop: new THREE.Color("#1a4a1a"),
  swayAmount: 0.2,
  swaySpeed: 1.3,
});

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

  const rand = createSeededRandom(seed);

  for (let i = 0; i < config.seegrassCount; i++) {
    const lx = (rand() - 0.5) * config.chunkSize;
    const lz = (rand() - 0.5) * config.chunkSize;

    const wx = worldOffsetX + lx;
    const wz = worldOffsetZ + lz;
    if (exclusionZones && _isInAnyZone(wx, wz, exclusionZones)) {
      continue;
    }

    const isRibbon = rand() > 0.6;

    const geo = isRibbon
      ? createRibbonGeometry(0.3 + rand() * 0.3, 1.5 + rand() * 2.0)
      : createSeegrassBladeGeometry(0.1 + rand() * 0.15, 1.0 + rand() * 1.5);
    const blade = new THREE.Mesh(geo, _sharedSeegrassMat);

    blade.position.set(lx, config.floorY + 0.1, lz);
    blade.rotation.y = rand() * Math.PI * 2;
    group.add(blade);
  }

  group.position.x = worldOffsetX;
  group.position.z = worldOffsetZ;

  return { group, coordX, coordZ };
}

function createSeededRandom(seed: number): () => number {
  let s = seed | 0;
  return (): number => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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
