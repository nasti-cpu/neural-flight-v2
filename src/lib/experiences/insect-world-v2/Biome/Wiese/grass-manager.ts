/**
 * insect-world-v2 — GrassManager (Chunk-basiert + WFC).
 *
 * Lädt Gras-Chunks und Blumen dynamisch um den Spieler herum.
 * Nutzt den Wavefunction-Collapse-Algorithmus (Robert Heaton)
 * für eine abwechslungsreiche, aber konsistente Welt.
 *
 * Funktionsweise:
 * - Die Welt wird in ein 80×80-Raster eingeteilt (Chunks).
 * - Nur Chunks in Sichtweite (3×3-Raster) sind aktiv.
 * - Entfernte Chunks werden entfernt, neue werden erzeugt.
 * - Geometrie und Material werden einmal erzeugt und wiederverwendet.
 * - Blumen werden aus vorab geladenen Assets instanziert.
 * - Clear-Regionen (z.B. Stadt) verhindern Gras/Blumen in bestimmten Bereichen.
 *
 * WebGPU + TSL (siehe AGENTS.md).
 */
import * as THREE from "three/webgpu";
import {
  attribute,
  clamp,
  dot,
  float,
  max,
  mix,
  normalize,
  normalWorld,
  positionLocal,
  sin,
  time,
  uniform,
  vec3,
} from "three/tsl";
import type { MeadowConfig } from "./grass";
import { WFCEngine } from "./wfc-engine";
import { TILE_CONTENT, TileType } from "./wfc-tiles";
import type { PreloadedFlower } from "../../Objekte/Blumen/blumen";

// ── Konstanten ──

const CHUNK_SIZE = 80; // Größe eines Chunks in Metern
const VIEW_RADIUS = 2; // Wie viele Chunks um den Spieler herum geladen werden (2 = 5×5 = 25 Chunks)

// ── Hilfsfunktion: Welthöhe (sanfte Mulde um den Ursprung) ──

function worldGroundHeight(x: number, z: number): number {
  const dist = Math.sqrt(x * x + z * z);
  return -0.00008 * dist * dist;
}

// ── ClearRegion (intern) ──

interface ClearRegion {
  cx: number;
  cz: number;
  hw: number;
  hd: number;
  angle: number;
  border: number;
}

// ── GrassChunk (intern) ──

interface GrassChunk {
  group: THREE.Group;
  mesh: THREE.InstancedMesh;
  ground: THREE.Mesh;
  gridX: number;
  gridZ: number;
  /** Blumen-InstancedMeshes in diesem Chunk */
  flowerMeshes: THREE.InstancedMesh[];
  /** Blumen-Positionen in diesem Chunk (für Target-Tracking) */
  flowerPositions: THREE.Vector3[];
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

  /** Registrierte Clear-Regionen (z.B. Stadt) */
  private clearRegions: ClearRegion[] = [];

  // Einmal erzeugte, gemeinsame Ressourcen (wiederverwendet)
  private bladeGeo: THREE.ConeGeometry;
  private bladeMat: THREE.MeshBasicNodeMaterial;
  private groundMat: THREE.MeshBasicNodeMaterial;

  constructor(config: MeadowConfig, preloadedFlowers: PreloadedFlower[]) {
    this.config = config;
    this.preloadedFlowers = preloadedFlowers;

    // ── Gemeinsame Geometrie für Grashalme ──
    // Ein Kegel pro Halm — wird per Instancing millionenfach gezeichnet.
    this.bladeGeo = new THREE.ConeGeometry(0.05, 1, 4);
    this.bladeGeo.translate(0, 0.5, 0); // Drehpunkt an die Basis

    // ── Gemeinsames TSL-Material für Grashalme ──
    this.bladeMat = this.createBladeMaterial();

    // ── Gemeinsames Material für den Boden ──
    this.groundMat = this.createGroundMaterial();
  }

  /**
   * Stellt sicher, dass der Spawn-Chunk (0,0) garantiert Blumen hat.
   *
   * Problem ohne diesen Aufruf:
   * - Die WFC-Engine würfelt den Chunk-Typ zufällig
   * - Nur ~34% der Chunks haben Blumen (FLOWERS_SPARSE/DENSE)
   * - Der Spieler startet also meistens in einer leeren Wiese
   *
   * Lösung:
   * - Wir sagen der WFC-Engine: "Chunk (0,0) = FLOWERS_DENSE"
   * - Das sind 30 Blumen auf 80×80m, direkt beim Start sichtbar
   * - Die umliegenden Chunks passen sich automatisch an (WFC-Propagation)
   */
  preSeedSpawn(): void {
    // "flowers_dense" als String, weil TileType ein Enum ist
    // (der Import des Enums würde eine zirkuläre Abhängigkeit erzeugen)
    this.wfc.preSeed(0, 0, "flowers_dense" as any);
  }

  /**
   * Wird jeden Frame aufgerufen.
   * Berechnet, welche Chunks um den Spieler herum sichtbar sein müssen,
   * erzeugt neue und entfernt alte.
   */
  update(playerPosition: THREE.Vector3): void {
    // Aktuelle Chunk-Koordinaten des Spielers
    const cx = Math.floor(playerPosition.x / CHUNK_SIZE);
    const cz = Math.floor(playerPosition.z / CHUNK_SIZE);

    // Alle benötigten Chunk-Keys sammeln
    const needed = new Set<string>();

    for (let dx = -VIEW_RADIUS; dx <= VIEW_RADIUS; dx++) {
      for (let dz = -VIEW_RADIUS; dz <= VIEW_RADIUS; dz++) {
        const gx = cx + dx;
        const gz = cz + dz;
        const key = `${gx},${gz}`;
        needed.add(key);

        if (!this.active.has(key)) {
          this.createChunk(gx, gz);
        }
      }
    }

    // Nicht mehr benötigte Chunks entfernen
    for (const [key, chunk] of this.active) {
      if (!needed.has(key)) {
        this.group.remove(chunk.group);
        this.disposeChunk(chunk);
        this.active.delete(key);
      }
    }

    // WFC-Engine aufräumen, um Speicherplatz zu sparen
    this.wfc.cleanup(cx, cz, VIEW_RADIUS + 2);
  }

  /** Entfernt alle Chunks (z. B. beim Experience-Wechsel). */
  clear(): void {
    for (const [, chunk] of this.active) {
      this.group.remove(chunk.group);
      this.disposeChunk(chunk);
    }
    this.active.clear();
    this.flowerTargets.length = 0;
    this.wfc.reset();
  }

  /**
   * Registriert einen Bereich, in dem kein Gras und keine Blumen wachsen sollen (z. B. Stadt).
   * Neue Chunks beachten das automatisch. Existierende Chunks werden nachträglich bereinigt.
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
   * Prüft, ob eine Position in einer der registrierten Clear-Regionen liegt.
   */
  private isPositionCleared(x: number, z: number): boolean {
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
    return false;
  }

  /**
   * Entfernt alle Grashalme in einem rotierten Rechteck (z. B. für Stadt).
   * Funktioniert chunk-übergreifend: sucht in allen aktiven Chunks
   * und versenkt Halme im Rechteck unter der Erde (y = -100).
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

  /** Gibt alle Ressourcen frei. */
  dispose(): void {
    this.clear();
    this.bladeGeo.dispose();
    this.bladeMat.dispose();
    this.groundMat.dispose();
  }

  // ── Private Hilfsfunktionen ──

  /** Erzeugt einen neuen Gras-Chunk an der angegebenen Raster-Position. */
  private createChunk(gx: number, gz: number): void {
    const worldX = gx * CHUNK_SIZE;
    const worldZ = gz * CHUNK_SIZE;

    const group = new THREE.Group();

    // ── Bodenplatte ──
    const ground = this.createGround(worldX, worldZ);
    group.add(ground);

    // ── WFC-Typ und Content bestimmen ──
    const tileType = this.wfc.getTileType(gx, gz);
    const content = TILE_CONTENT[tileType];

    // ── Grashalme ──
    const mesh = this.createChunkGrass(gx, gz, content);
    group.add(mesh);

    // ── Blumen generieren ──
    const flowerMeshes: THREE.InstancedMesh[] = [];
    const flowerPositions: THREE.Vector3[] = [];

    if (content.flowerCount > 0 && this.preloadedFlowers.length > 0) {
      this.generateFlowersForChunk(
        worldX,
        worldZ,
        content.flowerCount,
        group,
        flowerMeshes,
        flowerPositions,
      );
    }

    this.group.add(group);
    this.active.set(`${gx},${gz}`, {
      group,
      mesh,
      ground,
      gridX: gx,
      gridZ: gz,
      flowerMeshes,
      flowerPositions,
    });
  }

  /**
   * Generiert Blumen für einen Chunk aus den vorab geladenen Assets.
   * Verhindert Performance-Einbrüche beim dynamischen Laden.
   */
  private generateFlowersForChunk(
    worldX: number,
    worldZ: number,
    flowerCount: number,
    group: THREE.Group,
    flowerMeshesOut: THREE.InstancedMesh[],
    flowerPositionsOut: THREE.Vector3[],
  ): void {
    const dummy = new THREE.Object3D();

    // Positionen pro Blumentyp sammeln
    const flowerInstances: Array<
      { x: number; y: number; z: number; rotY: number; s: number }[]
    > = Array.from({ length: this.preloadedFlowers.length }, () => []);

    for (let i = 0; i < flowerCount; i++) {
      const typeIdx = Math.floor(Math.random() * this.preloadedFlowers.length);
      const x = worldX + (Math.random() - 0.5) * CHUNK_SIZE;
      const z = worldZ + (Math.random() - 0.5) * CHUNK_SIZE;

      // Überspringen, wenn Position in Clear-Region liegt (z.B. Stadt)
      if (this.isPositionCleared(x, z)) {
        continue;
      }

      const y = worldGroundHeight(x, z) + Math.random() * 0.05;
      const rotY = Math.random() * Math.PI * 2;
      const s =
        this.preloadedFlowers[typeIdx].scale * (0.8 + Math.random() * 0.7);

      flowerInstances[typeIdx].push({ x, y, z, rotY, s });
    }

    // InstancedMeshes pro Blumentyp erstellen
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
          // Farbe der Blume speichern (pink, gelb oder weiß – für Pheromon-Spuren)
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
  ): THREE.InstancedMesh {
    const worldX = gx * CHUNK_SIZE;
    const worldZ = gz * CHUNK_SIZE;
    const count = content.grassCount;

    // Jeder Chunk braucht eine eigene Geometrie-Kopie, weil die Instanz-Attribute
    // (aPhase, aSpeed, aBaseX, aBaseZ) pro Chunk unterschiedliche Längen haben.
    // Das Teilen einer Geometry würde die Buffer-Größen überschreiben → WebGPU-Fehler.
    const bladeGeoClone = this.bladeGeo.clone();
    const mesh = new THREE.InstancedMesh(bladeGeoClone, this.bladeMat, count);

    // Per-Instance-Attribute für Wind-Animation
    const phaseArr = new Float32Array(count);
    const speedArr = new Float32Array(count);
    const baseXArr = new Float32Array(count);
    const baseZArr = new Float32Array(count);

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

      // Wind-Daten
      phaseArr[i] = Math.random() * Math.PI * 2;
      speedArr[i] = 0.5 + Math.random() * 1.5;
      baseXArr[i] = x;
      baseZArr[i] = z;

      // Instanz-Matrix setzen (unter die Erde, wenn in Clear-Region)
      if (this.isPositionCleared(x, z)) {
        dummy.position.set(x, -100, z);
        dummy.scale.setScalar(0);
      } else {
        dummy.position.set(x, baseY + h / 2, z);
        dummy.scale.set(sx, h, sz);
      }
      dummy.rotation.set(0, rotY, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }

    mesh.instanceMatrix.needsUpdate = true;

    // Instanz-Attribute für den TSL-Shader
    mesh.geometry.setAttribute(
      "aPhase",
      new THREE.InstancedBufferAttribute(phaseArr, 1),
    );
    mesh.geometry.setAttribute(
      "aSpeed",
      new THREE.InstancedBufferAttribute(speedArr, 1),
    );
    mesh.geometry.setAttribute(
      "aBaseX",
      new THREE.InstancedBufferAttribute(baseXArr, 1),
    );
    mesh.geometry.setAttribute(
      "aBaseZ",
      new THREE.InstancedBufferAttribute(baseZArr, 1),
    );

    return mesh;
  }

  /** Erzeugt die Bodenplatte für einen Chunk mit leichter Wölbung. */
  private createGround(worldX: number, worldZ: number): THREE.Mesh {
    const segs = 8;
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
    //── Uniforms ──
    const uWindStrength = uniform(this.config.windStrength);
    const uWindSpeed = uniform(this.config.windSpeedMultiplier);
    const uColor = uniform(new THREE.Color(this.config.color));
    const uGroundColor = uniform(new THREE.Color(this.config.groundColor));
    const uMinHeight = uniform(this.config.minHeight);
    const uMaxHeight = uniform(this.config.maxHeight);

    //── Instanz-Attribute ──
    const aPhase = attribute("aPhase", "float");
    const aSpeed = attribute("aSpeed", "float");
    const aBaseX = attribute("aBaseX", "float");
    const aBaseZ = attribute("aBaseZ", "float");

    //── positionNode: Wind ──
    const timeFactor = time.mul(uWindSpeed);
    const swayX = sin(timeFactor.mul(aSpeed).add(aPhase).add(aBaseX.mul(0.5)))
      .mul(uWindStrength)
      .mul(positionLocal.y);
    const swayZ = sin(
      timeFactor.mul(aSpeed).mul(0.7).add(aPhase).add(aBaseZ.mul(0.5)),
    )
      .mul(uWindStrength)
      .mul(0.7)
      .mul(positionLocal.y);

    //── colorNode: Höhenfärbung + Licht ──
    const heightT = clamp(
      positionLocal.y
        .sub(uMinHeight)
        .div(uMaxHeight.sub(uMinHeight).add(0.001)),
      float(0),
      float(1),
    );
    const lightDir = normalize(vec3(0.5, 0.8, 0.3));
    const diff = max(dot(normalWorld, lightDir), float(0));
    const lightFactor = float(0.35).add(diff.mul(0.65));

    const mat = new THREE.MeshBasicNodeMaterial();
    mat.positionNode = positionLocal.add(vec3(swayX, float(0), swayZ));
    mat.colorNode = mix(uGroundColor, uColor, heightT).mul(lightFactor);
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

  /** Räumt einen Chunk auf (geht zurück in den Pool). */
  private disposeChunk(chunk: GrassChunk): void {
    // Instanz-Geometrie freigeben
    chunk.mesh.geometry.dispose();
    chunk.mesh.removeFromParent();

    // Boden-Geometrie freigeben
    chunk.ground.geometry.dispose();
    chunk.ground.removeFromParent();

    // Blumen-Instanzen aus globalen Targets austragen
    for (const pos of chunk.flowerPositions) {
      const idx = this.flowerTargets.indexOf(pos);
      if (idx !== -1) {
        this.flowerTargets.splice(idx, 1);
      }
    }

    // Blumen-InstancedMeshes entfernen
    for (const fMesh of chunk.flowerMeshes) {
      fMesh.removeFromParent();
    }
  }
}
