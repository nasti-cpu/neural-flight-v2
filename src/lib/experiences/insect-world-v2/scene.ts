/**
 * insect-world-v2 — Scene Lifecycle.
 * setup, tick, dispose — baut die vollständige Szene auf:
 * Himmel, Wiese (WFC-basiert), Blumen (dynamisch), Bienen, Schmetterlinge.
 *
 * WebGPU + TSL (siehe AGENTS.md).
 */
import * as THREE from "three/webgpu";
import type { ExperienceState, SetupContext, TickContext } from "../types";
import { createSky } from "./Biome/blauerHimmel/sky";
import { GrassManager } from "./Biome/Wiese/grass-manager";
import { preloadFlowers } from "./Objekte/Blumen/blumen";
import { createBees, type BeeSwarm } from "./Objekte/Bienen/bienen";
import {
  createButterflies,
  type ButterflySwarm,
} from "./Objekte/Schmetterlinge/schmetterlinge";
import { PheromoneSystem } from "./Sinne/Pheromonspuren/pheromonspuren";
import { CityManager } from "./Objekte/Stadt/city-manager";
import { CITY_CONFIG } from "./Objekte/Stadt/city";
import { CityGuidePath } from "./Objekte/Stadt/city-guide-path";
import beeGlbUrl from "./Objekte/Bienen/Bee.glb?url";
import butterflyGlbUrl from "./Objekte/Schmetterlinge/Beautiful Butterfly.glb?url";
import bgAudioUrl from "./Meadow-Sound.mp3?url";
import { loadBackgroundAudio } from "../../three/audio-manager";

/** Eigenes State-Interface für insect-world-v2 */
interface InsectWorldV2State extends ExperienceState {
  camera: THREE.PerspectiveCamera;
  grassManager: GrassManager;
  bees: BeeSwarm;
  butterflies: ButterflySwarm;
  pheromones: PheromoneSystem;
  sky: THREE.Mesh;
  /** Statische Grundplatte (verhindert leere Welt beim Umdrehen) */
  groundPlane: THREE.Mesh;
  cityManager: CityManager;
  guidePath: CityGuidePath;
  /** Hintergrund-Sound (Loop) */
  bgAudio: THREE.Audio;
  /** Startposition des Spielers (für verzögerte Leitspur) */
  startPosition: THREE.Vector3;
  /** Wurde die erste Leitspur bereits aktiviert? */
  firstPathActivated: boolean;
  /** Zählt Frames für verzögertes Update (Bienen/Schmetterlinge/WFC) */
  tickInterval: number;
  /** Letzte bekannte Blumen-Anzahl (für Pheromon-Nachrüstung) */
  lastFlowerCount: number;
}

export async function setup(ctx: SetupContext): Promise<InsectWorldV2State> {
  // 1. Himmel
  const sky = createSky();
  ctx.scene.add(sky);

  // 2. Gewölbte Grundplatte – erzeugt eine runde Horizontlinie
  // Liegt unter den per-Chunk-Bodenplatten und ist immer sichtbar.
  // Die Scheibe ist nach unten gebogen: flach in der Mitte, stark gekrümmt am Rand.
  // Zusammen mit dem Nebel entsteht ein runder Horizont, der im Nebel verschwindet.
  const GROUND_RADIUS = 250;
  const GROUND_SEGMENTS = 64;
  const GROUND_DROP = 50; // max Eintauchtiefe am Rand (m)
  const groundGeo = new THREE.CircleGeometry(GROUND_RADIUS, GROUND_SEGMENTS);
  {
    const pos = groundGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y2 = pos.getY(i);
      const dist = Math.sqrt(x * x + y2 * y2);
      const t = dist / GROUND_RADIUS;
      const drop = t * t * GROUND_DROP; // quadratisch: flach in der Mitte, steil am Rand
      pos.setZ(i, -drop - 5); // -5 = Basis-Tiefe, -drop = zusätzliche Krümmung
    }
    pos.needsUpdate = true;
    groundGeo.computeVertexNormals();
  }
  const groundPlane = new THREE.Mesh(
    groundGeo,
    new THREE.MeshBasicMaterial({ color: 0x3a6028, side: THREE.DoubleSide }),
  );
  groundPlane.rotation.x = -Math.PI / 2;
  ctx.scene.add(groundPlane);

  // 3. Blumen vorladen (einmalig, wird von GrassManager wiederverwendet)
  const preloadedFlowers = await preloadFlowers();

  // 4. Wiese (Chunk-basiert, unendlich + WFC)
  const grassManager = new GrassManager(
    {
      fieldSize: 60,
      grassCount: 14000,
      curvature: 0.0001,
      color: "#5a8a3c",
      groundColor: "#3a6028",
      minHeight: 0.6,
      maxHeight: 1.8,
      windStrength: 0.06,
      windSpeedMultiplier: 1.0,
    },
    preloadedFlowers,
  );
  ctx.scene.add(grassManager.group);

  // 5. Spawn-Chunk vorbereiten
  grassManager.preSeedSpawn();

  // 6. Ersten Chunk-Ladevorgang anstoßen (initial 9 Chunks ohne Fade)
  grassManager.update(new THREE.Vector3(0, 2, 0));
  // Fade erst NACH dem ersten Update aktivieren → nur Bewegungslade-Chunks fade
  grassManager.setFadeDuration(0.5);

  // 7. Bienen (Wander-Steuerung, +10cm höher)
  const bees = await createBees(beeGlbUrl, {
    count: 10,
    scale: 0.04,
    fieldRadius: 200,
    flyRadiusMin: 3,
    flyRadiusMax: 10,
    speedMin: 2.0,
    speedMax: 4.0,
    heightBaseMin: 0.9,
    heightBaseMax: 1.6,
    heightRange: 0.4,
  });
  ctx.scene.add(bees.group);

  // 8. Schmetterlinge (Wander-Steuerung, +10cm höher)
  const butterflies = await createButterflies(butterflyGlbUrl, {
    count: 6,
    scale: 0.036,
    fieldRadius: 200,
    flyRadiusMin: 3,
    flyRadiusMax: 12,
    speedMin: 1.5,
    speedMax: 3.0,
    heightBaseMin: 1.3,
    heightBaseMax: 2.3,
    heightRange: 0.6,
  });
  ctx.scene.add(butterflies.group);

  // 9. Pheromon-Spuren
  const pheromones = new PheromoneSystem();
  const pheromoneTargets = grassManager.flowerTargets.map((pos, i) => ({
    position: pos,
    color: grassManager.flowerColors[i] ?? new THREE.Color(0xffffff),
  }));
  pheromones.addTrails(pheromoneTargets, ctx.camera.position);
  ctx.scene.add(pheromones.group);

  // 10. Städte (prozedural, 250-400m entfernt, nur 3 Stück)
  const cityManager = new CityManager();
  const positions = cityManager.generatePositions(
    CITY_CONFIG.CITY_COUNT,
    CITY_CONFIG.MIN_DISTANCE,
    CITY_CONFIG.MAX_DISTANCE,
  );
  await cityManager.loadCities(positions, ctx.scene, grassManager);

  // Das Modell ist im modelPivot und wird erst per setActiveCity() sichtbar
  console.log(`[City] ${cityManager.cities.length} Städte erzeugt`);

  // 11. GuidePath – erst nach 30m Erkundung aktiv (verzögertes Erscheinen)
  const guidePath = new CityGuidePath({
    neonColor: 0x44ffff,
    dashLength: 0.5,
    gapLength: 0.3,
    spriteSizeMin: 1.4,
    spriteSizeMax: 2.2,
    spritesPerDash: 1,
    maxDist: 200,
  });
  const firstCity = cityManager.getNearestUndiscovered(new THREE.Vector3(0, 2, 0));
  if (firstCity) {
    // Stadt-Modell positionieren, aber Leitspur noch nicht aktivieren
    cityManager.setActiveCity(firstCity);
    console.log(`[City] Erste Stadt ${firstCity.index} bei`, firstCity.position);
  }
  ctx.scene.add(guidePath.group);

  // ── Atmosphärischer Nebel ──
  // Density 0.04 = Sichtweite ~30-50m, dann vollständig im Nebel.
  const fogColor = new THREE.Color("#4a90d9");
  ctx.scene.fog = new THREE.FogExp2(fogColor, 0.04);

  // Kamera positionieren (Insektenperspektive ~2m)
  const camera = ctx.camera;
  camera.position.set(0, 2, 0);

  // 12. Hintergrund-Sound laden und starten (Dauerschleife)
  const bgAudio = await loadBackgroundAudio(camera, bgAudioUrl);

  const startPosition = new THREE.Vector3(0, 2, 0);

  return {
    camera,
    grassManager,
    bees,
    butterflies,
    pheromones,
    cityManager,
    guidePath,
    bgAudio,
    sky,
    groundPlane,
    startPosition,
    firstPathActivated: false,
    tickInterval: 0,
    lastFlowerCount: 0,
  };
}

export function tick(
  state: ExperienceState,
  ctx: TickContext,
): { state: ExperienceState; outputs?: Record<string, number> } {
  const s = state as InsectWorldV2State;

  // tickInterval reduziert CPU-Last: Bienen + Schmetterlinge updaten
  // nur jeden 3. Frame, WFC-Cleanup nur jeden 10. Frame.
  // Der Spieler sieht keinen Unterschied, aber die CPU spart ~50%.
  s.tickInterval++;

  // Bienen-Animation (jeden 3. Frame)
  if (s.tickInterval % 3 === 0) {
    s.bees.update(ctx.elapsed, ctx.delta);
  }
  // Schmetterlings-Animation (jeden 3. Frame)
  if (s.tickInterval % 3 === 0) {
    s.butterflies.update(ctx.elapsed, ctx.delta);
  }
  // Pheromon-Spuren-Animation (jeden Frame – nur opacity, billig)
  s.pheromones.update(ctx.elapsed);
  // Neue Spuren für Blumen in neu geladenen Chunks (ohne bestehende zu löschen)
  if (s.grassManager.flowerTargets.length !== s.lastFlowerCount) {
    s.lastFlowerCount = s.grassManager.flowerTargets.length;
    const targets = s.grassManager.flowerTargets.map((pos, i) => ({
      position: pos,
      color: s.grassManager.flowerColors[i] ?? new THREE.Color(0xffffff),
    }));
    s.pheromones.addMissingTrails(targets, s.startPosition);
  }

  // Wiese: Chunks laden/entladen + WFC-Cleanup (nur jeden 3. Frame)
  // In 3 Frames (~50ms bei 60fps) kann man keine 40m-Chunk-Grenze überschreiten.
  // Spart ~66% CPU-Last für Chunk-Verwaltung ohne sichtbaren Unterschied.
  // delta * 3, weil wir 2 von 3 Frames überspringen (Fade läuft trotzdem korrekt)
  if (s.tickInterval % 3 === 0) {
    s.grassManager.update(ctx.camera.position, ctx.delta * 3);
  }

  // ── Stadt- & Leitsystem (ohne Sofort-Redirect) ──
  const nearest = s.cityManager.getNearestUndiscovered(ctx.camera.position);
  const last = s.cityManager.lastVisitedCity;

  if (nearest) {
    const distToNearest = ctx.camera.position.distanceTo(nearest.position);
    const distFromLast = last
      ? ctx.camera.position.distanceTo(last.position)
      : Infinity;

    // 1. Modell-Steuerung: Zeige die Stadt, wenn nah dran,
    //    sonst das Modell an der zuletzt besuchten Stadt lassen.
    if (distToNearest < CITY_CONFIG.VISIBILITY_RANGE) {
      // Unbesuchte Stadt in Sichtweite → Modell dorthin schalten
      s.cityManager.setActiveCity(nearest);
    } else if (last) {
      // Weit weg von unbesuchten Städten → Modell an letzter besuchter Stadt
      s.cityManager.setActiveCity(last);
    } else {
      // Ganz am Start → Modell an erster Stadt (auch wenn im Nebel)
      s.cityManager.setActiveCity(nearest);
    }

    // 2. Ankunft an einer Stadt (→ besucht markieren, Trail löschen,
    //    KEIN Redirect zur nächsten Stadt!)
    if (distToNearest < CITY_CONFIG.ARRIVAL_DISTANCE && !nearest.visited) {
      s.cityManager.markVisited(nearest);
      s.guidePath.clear();
      console.log(`[City] Stadt ${nearest.index} erreicht`);
    }
  }

  // 3. Erste Leitspur aktivieren (nach 30m Erkundung, nicht sofort beim Start)
  if (!s.guidePath.isActive && !s.firstPathActivated) {
    const distFromStart = ctx.camera.position.distanceTo(s.startPosition);
    if (distFromStart > 30) {
      const nearest = s.cityManager.getNearestUndiscovered(ctx.camera.position);
      if (nearest) {
        s.guidePath.setTarget(ctx.camera.position, nearest.position);
        s.firstPathActivated = true;
        console.log(`[City] Erste Leitspur zu Stadt ${nearest.index} aktiviert`);
      }
    }
  }

  // 4. GuidePath reaktivieren (nach Stadtbesuch, erst nach ausreichender Erkundung)
  if (!s.guidePath.isActive && s.firstPathActivated && last) {
    const distFromLast = ctx.camera.position.distanceTo(last.position);
    if (distFromLast > CITY_CONFIG.ACTIVATION_DISTANCE) {
      const next = s.cityManager.getNearestUndiscovered(ctx.camera.position);
      if (next) {
        s.guidePath.setTarget(ctx.camera.position, next.position);
        console.log(`[City] Leitspur zu Stadt ${next.index} aktiviert`);
      }
    }
  }

  // GuidePath animieren (pulsierende Sprites – nur jeden 2. Frame)
  // Sinus-Puls bei 30Hz vs 60Hz ist visuell identisch, spart 50% CPU.
  if (s.tickInterval % 2 === 0) {
    s.guidePath.update(ctx.elapsed);
  }

  return {
    state: s,
  };
}

export function dispose(state: ExperienceState, _scene: THREE.Scene): void {
  const s = state as InsectWorldV2State;

  // Hintergrund-Sound stoppen und Listener entfernen
  s.bgAudio.stop();
  s.bgAudio.listener.removeFromParent();

  s.bees.dispose();
  s.butterflies.dispose();
  s.pheromones.dispose();
  s.cityManager.dispose(_scene);
  s.guidePath.dispose();
  s.grassManager.dispose();
  _scene.remove(s.sky);
  (s.sky.geometry as THREE.BufferGeometry).dispose();
  (s.sky.material as THREE.Material).dispose();
  _scene.remove(s.groundPlane);
  (s.groundPlane.geometry as THREE.BufferGeometry).dispose();
  (s.groundPlane.material as THREE.Material).dispose();
  _scene.remove(s.grassManager.group);
  _scene.remove(s.bees.group);
  _scene.remove(s.butterflies.group);
  _scene.remove(s.guidePath.group);
  _scene.remove(s.pheromones.group);
}