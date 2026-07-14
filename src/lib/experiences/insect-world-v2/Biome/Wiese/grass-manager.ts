/**
 * insect-world-v2 — GrassManager (Chunk-basiert + WFC).
 *
 * Lädt Gras-Chunks und Blumen dynamisch um den Spieler herum.
 * Nutzt den Wavefunction-Collapse-Algorithmus (Robert Heaton)
 * für eine abwechslungsreiche, aber konsistente Welt.
 *
 * Funktionsweise:
 * - Die Welt wird in ein 40×40m-Raster eingeteilt (Chunks).
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

/** Chunk-Grösse in Metern (exportiert für Stadt-Position → Chunk-Koordinaten) */
export const CHUNK_SIZE = 40;
const VIEW_RADIUS = 1; // Wie viele Chunks um den Spieler herum geladen werden (1 = 3×3 = 9 Chunks)
// VIEW_RADIUS=1 lädt Chunks bis 40m Entfernung. Der Nebel (FogExp2, density 0.04)
// verdeckt bei 40m bereits ~80% → Chunks erscheinen/verschwinden unsichtbar.

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
  private circleClearRegions: CircleClearRegion[] = [];

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
   * damit die initialen 9 Chunks ohne Fade erscheinen.
   *
   * @param duration - Dauer des Fade-In in Sekunden (z.B. 0.5)
   */
  setFadeDuration(duration: number): void {
    this.fadeDuration = duration;
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
   * - Das sind 30 Blumen auf 40×40m, direkt beim Start sichtbar
   * - Die umliegenden Chunks passen sich automatisch an (WFC-Propagation)
   */
  preSeedSpawn(): void {
    // "flowers_dense" als String, weil TileType ein Enum ist
    // (der Import des Enums würde eine zirkuläre Abhängigkeit erzeugen)
    this.wfc.preSeed(0, 0, "flowers_dense" as any);
  }

  /**
   * Wird jeden Frame (oder jeden N-ten Frame) aufgerufen.
   * Berechnet, welche Chunks um den Spieler herum sichtbar sein müssen,
   * erzeugt neue und entfernt alte.
   * Wenn `delta` übergeben wird, werden neu geladene Chunks sanft eingeblendet.
   *
   * @param delta - Vergangene Zeit seit dem letzten Aufruf in Sekunden
   *                (optional – für Fade-Animation)
   */
  update(playerPosition: THREE.Vector3, delta?: number): void {
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

    // ── Fade-Animation für neu geladene Chunks ──
    if (delta !== undefined && this.fadeDuration > 0) {
      for (const [, chunk] of this.active) {
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
      this.wfc.cleanup(cx, cz, VIEW_RADIUS + 2);
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
    this.wfc.reset();
  }

  /**
   * Erzwingt einen WFC-Tile-Typ für einen bestimmten Chunk.
   * Wird vor dem ersten Laden des Chunks aufgerufen (z. B. für Stadt-Positionen).
   * Verhindert, dass eine Stadt zufällig in einem EMPTY-Chunk landet.
   */
  forceTileType(gx: number, gz: number, tile: TileType): void {
    this.wfc.preSeed(gx, gz, tile);
  }

  /**
   * Registriert einen rechteckigen Bereich, in dem kein Gras und keine Blumen wachsen sollen (z. B. Stadt).
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
   * Registriert einen kreisförmigen Bereich, in dem kein Gras und keine Blumen wachsen sollen.
   */
  addCircleClearRegion(
    cx: number,
    cz: number,
    radius: number,
    border: number = 0.5,
  ): void {
    this.circleClearRegions.push({ cx, cz, radius, border });
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
    for (const reg of this.circleClearRegions) {
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

    // Prüfen, ob Clear-Regionen (Städte) nahe genug sind, um diesen Chunk zu beeinflussen.
    // Nur dann müssen einzelne Halme/Blumen gegen Clear-Regionen geprüft werden.
    const chunkHalfDiag = CHUNK_SIZE * 0.71;
    const needsClearCheck =
      this.circleClearRegions.some((r) => {
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
        needsClearCheck,
      );
    }

    // ── Material-Klon für sanften Fade-In ──
    // Nur wenn Fade aktiv ist (fadeDuration > 0).
    // Die initialen 9 Chunks laden OHNE Fade, weil setFadeDuration()
    // erst nach dem ersten update()-Aufruf gesetzt wird.
    if (this.fadeDuration > 0) {
      const fadeBlade = this.bladeMat.clone();
      fadeBlade.transparent = true;
      fadeBlade.opacity = 0;
      mesh.material = fadeBlade;

      const fadeGround = this.groundMat.clone();
      fadeGround.transparent = true;
      fadeGround.opacity = 0;
      ground.material = fadeGround;
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
      fadeElapsed: 0,
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
    checkClear: boolean,
  ): void {
    const dummy = new THREE.Object3D();
    const MIN_FLOWER_DIST = 1.0; // Mindestabstand 1m zwischen Blumen (nie ineinander)

    // Bereits platzierte Positionen (für Abstands-Check, chunk-intern)
    const placedPositions: { x: number; z: number }[] = [];

    // Positionen pro Blumentyp sammeln
    const flowerInstances: Array<
      { x: number; y: number; z: number; rotY: number; s: number }[]
    > = Array.from({ length: this.preloadedFlowers.length }, () => []);

    for (let i = 0; i < flowerCount; i++) {
      const typeIdx = Math.floor(Math.random() * this.preloadedFlowers.length);

      // Versuche bis zu 20x einen freien Platz zu finden (mind. 15cm Abstand)
      let placed = false;
      for (let attempt = 0; attempt < 20; attempt++) {
        const x = worldX + (Math.random() - 0.5) * CHUNK_SIZE;
        const z = worldZ + (Math.random() - 0.5) * CHUNK_SIZE;

        // Überspringen, wenn Position in Clear-Region liegt (z.B. Stadt)
        // Nur prüfen, wenn Clear-Regionen in der Nähe sind
        if (checkClear && this.isPositionCleared(x, z)) {
          continue;
        }

        // Prüfen ob weit genug von anderen Blumen entfernt
        let tooClose = false;
        for (const p of placedPositions) {
          const dx = x - p.x;
          const dz = z - p.z;
          if (dx * dx + dz * dz < MIN_FLOWER_DIST * MIN_FLOWER_DIST) {
            tooClose = true;
            break;
          }
        }

        if (!tooClose) {
          const y = worldGroundHeight(x, z) + Math.random() * 0.05;
          const rotY = Math.random() * Math.PI * 2;
          const s =
            this.preloadedFlowers[typeIdx].scale * (0.8 + Math.random() * 0.7);

          flowerInstances[typeIdx].push({ x, y, z, rotY, s });
          placedPositions.push({ x, z });
          placed = true;
          break;
        }
      }
      // Wenn kein freier Platz gefunden, wird diese Blume übersprungen
      if (!placed) continue;
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
    checkClear: boolean,
  ): THREE.InstancedMesh {
    const worldX = gx * CHUNK_SIZE;
    const worldZ = gz * CHUNK_SIZE;
    const count = content.grassCount;

    // Jeder Chunk braucht eine eigene Geometrie-Kopie, weil die Instanz-Attribute
    // (aPhase, aSpeed, aBaseX, aBaseZ) pro Chunk unterschiedliche Längen haben.
    // Das Teilen einer Geometry würde die Buffer-Größen überschreiben → WebGPU-Fehler.
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
      // isPositionCleared wird nur geprüft, wenn Clear-Regionen in der Nähe sind
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
    const segs = 4; // 8→4: −75% Vertices, Wölbung bei 40m Chunk immer noch glatt
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

  /** Räumt einen Chunk auf (geht zurück in den Pool). */
  private disposeChunk(chunk: GrassChunk): void {
    // Geklonte Fade-Materials entsorgen (nur wenn ungleich Shared-Material)
    if (chunk.mesh.material !== this.bladeMat) {
      (chunk.mesh.material as THREE.Material).dispose();
    }
    if (chunk.ground.material !== this.groundMat) {
      (chunk.ground.material as THREE.Material).dispose();
    }

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
        this.flowerColors.splice(idx, 1);
      }
    }

    // Blumen-InstancedMeshes entfernen
    for (const fMesh of chunk.flowerMeshes) {
      fMesh.removeFromParent();
    }
  }
}
