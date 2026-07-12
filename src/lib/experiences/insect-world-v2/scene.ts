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

/** Eigenes State-Interface für insect-world-v2 */
interface InsectWorldV2State extends ExperienceState {
  camera: THREE.PerspectiveCamera;
  grassManager: GrassManager;
  bees: BeeSwarm;
  butterflies: ButterflySwarm;
  pheromones: PheromoneSystem;
  sky: THREE.Mesh;
  cityManager: CityManager;
  guidePath: CityGuidePath;
  /** Zählt Frames für verzögertes Update (Bienen/Schmetterlinge/WFC) */
  tickInterval: number;
}

export async function setup(ctx: SetupContext): Promise<InsectWorldV2State> {
  // 1. Himmel
  const sky = createSky();
  ctx.scene.add(sky);

  // 2. Blumen vorladen (einmalig, wird von GrassManager wiederverwendet)
  const preloadedFlowers = await preloadFlowers();

  // 3. Wiese (Chunk-basiert, unendlich + WFC)
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

  // 4. Spawn-Chunk vorbereiten
  grassManager.preSeedSpawn();

  // 5. Ersten Chunk-Ladevorgang anstoßen
  grassManager.update(new THREE.Vector3(0, 2, 0));

  // 6. Bienen (langsam, zufällige Wegpunkte, +10cm höher)
  const bees = await createBees(beeGlbUrl, {
    count: 10,
    scale: 0.04,
    fieldRadius: 200,
    flyRadiusMin: 1,
    flyRadiusMax: 3,
    speedMin: 1.2,
    speedMax: 2.5,
    heightBaseMin: 0.9,
    heightBaseMax: 1.6,
    heightRange: 0.2,
  });
  ctx.scene.add(bees.group);

  // 7. Schmetterlinge (langsam, zufällige Wegpunkte, +10cm höher)
  const butterflies = await createButterflies(butterflyGlbUrl, {
    count: 6,
    scale: 0.036,
    fieldRadius: 200,
    flyRadiusMin: 1,
    flyRadiusMax: 4,
    speedMin: 0.8,
    speedMax: 1.8,
    heightBaseMin: 1.3,
    heightBaseMax: 2.3,
    heightRange: 0.4,
  });
  ctx.scene.add(butterflies.group);

  // 8. Pheromon-Spuren
  const pheromones = new PheromoneSystem();
  const pheromoneTargets = grassManager.flowerTargets.map((pos, i) => ({
    position: pos,
    color: grassManager.flowerColors[i] ?? new THREE.Color(0xffffff),
  }));
  pheromones.addTrails(pheromoneTargets, ctx.camera.position);
  ctx.scene.add(pheromones.group);

  // 9. Städte (prozedural, 250-400m entfernt, nur 3 Stück)
  const cityManager = new CityManager();
  const positions = cityManager.generatePositions(
    CITY_CONFIG.CITY_COUNT,
    CITY_CONFIG.MIN_DISTANCE,
    CITY_CONFIG.MAX_DISTANCE,
  );
  await cityManager.loadCities(positions, ctx.scene, grassManager);

  // Das Modell ist im modelPivot und wird erst per setActiveCity() sichtbar
  console.log(`[City] ${cityManager.cities.length} Städte erzeugt`);

  // 10. GuidePath – direkt beim Start zur nächsten Stadt aktivieren
  // Große Sprites (1.0-1.8) damit die Spur durch den Nebel sichtbar ist
  const guidePath = new CityGuidePath({
    neonColor: 0x44ffff,
    dashLength: 0.5,
    gapLength: 0.3,
    spriteSizeMin: 1.0,
    spriteSizeMax: 1.8,
    spritesPerDash: 3,
  });
  const firstCity = cityManager.getNearestUndiscovered(new THREE.Vector3(0, 2, 0));
  if (firstCity) {
    cityManager.setActiveCity(firstCity);
    guidePath.setTarget(new THREE.Vector3(0, 2, 0), firstCity.position);
    console.log(`[City] Leitspur aktiv: Stadt ${firstCity.index} bei`, firstCity.position);
  }
  ctx.scene.add(guidePath.group);

  // ── Atmosphärischer Nebel ──
  // Density 0.04 = Sichtweite ~30-50m, dann vollständig im Nebel.
  const fogColor = new THREE.Color("#4a90d9");
  ctx.scene.fog = new THREE.FogExp2(fogColor, 0.04);

  // Kamera positionieren (Insektenperspektive ~2m)
  const camera = ctx.camera;
  camera.position.set(0, 2, 0);

  return {
    camera,
    grassManager,
    bees,
    butterflies,
    pheromones,
    cityManager,
    guidePath,
    sky,
    tickInterval: 0,
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

  // Wiese: Chunks laden/entladen + WFC-Cleanup (jeden Frame – VIEW_RADIUS=1 = nur 9 Chunks)
  s.grassManager.update(ctx.camera.position);

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

  // 3. GuidePath reaktivieren (erst nach ausreichender Erkundung)
  if (!s.guidePath.isActive && last) {
    const distFromLast = ctx.camera.position.distanceTo(last.position);
    if (distFromLast > CITY_CONFIG.ACTIVATION_DISTANCE) {
      const next = s.cityManager.getNearestUndiscovered(ctx.camera.position);
      if (next) {
        s.guidePath.setTarget(ctx.camera.position, next.position);
        console.log(`[City] Leitspur zu Stadt ${next.index} aktiviert`);
      }
    }
  }

  // GuidePath animieren (pulsierende Sprites)
  s.guidePath.update(ctx.elapsed);

  return {
    state: s,
  };
}

export function dispose(state: ExperienceState, _scene: THREE.Scene): void {
  const s = state as InsectWorldV2State;

  s.bees.dispose();
  s.butterflies.dispose();
  s.pheromones.dispose();
  s.cityManager.dispose(_scene);
  s.guidePath.dispose();
  s.grassManager.dispose();
  _scene.remove(s.sky);
  (s.sky.geometry as THREE.BufferGeometry).dispose();
  (s.sky.material as THREE.Material).dispose();
  _scene.remove(s.grassManager.group);
  _scene.remove(s.bees.group);
  _scene.remove(s.butterflies.group);
  _scene.remove(s.guidePath.group);
  _scene.remove(s.pheromones.group);
}