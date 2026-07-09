/**
 * insect-world-v2 — Scene Lifecycle.
 * setup, tick, dispose — baut die vollständige Szene auf:
 * Himmel, Wiese (WFC-basiert), Blumen (dynamisch), Bienen, Schmetterlinge,
 * mehrere Städte (prozedural) und ein leuchtender Führungspfad zur nächsten Stadt.
 *
 * WebGPU + TSL (siehe AGENTS.md).
 */
import * as THREE from "three/webgpu";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { ExperienceState, SetupContext, TickContext } from "../types";
import { createSky } from "./Biome/blauerHimmel/sky";
import { GrassManager } from "./Biome/Wiese/grass-manager";
import { preloadFlowers } from "./Objekte/Blumen/blumen";
import { createBees, type BeeSwarm } from "./Objekte/Bienen/bienen";
import {
  createButterflies,
  type ButterflySwarm,
} from "./Objekte/Schmetterlinge/schmetterlinge";
import { CityManager } from "./Objekte/Stadt/city-manager";
import { CityGuidePath } from "./Objekte/Stadt/city-guide-path";
import { PheromoneSystem } from "./Sinne/Pheromonspuren/pheromonspuren";
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
      grassCount: 20000,
      curvature: 0.0001,
      color: "#6aaf4c",
      groundColor: "#6aaf4c",
      minHeight: 0.6,
      maxHeight: 1.8,
      windStrength: 0.06,
      windSpeedMultiplier: 1.0,
    },
    preloadedFlowers,
  );
  ctx.scene.add(grassManager.group);

  // 4. Städte prozedural spawnen
  const cityManager = new CityManager();

  // 4a. Eine Stadt ~1km entfernt platzieren
  const cityPositions = cityManager.generatePositions(
    1,
    1000,
    1000,
  );

  // 4b. Städte laden und platzieren
  await cityManager.loadCities(cityPositions, ctx.scene, grassManager);
  // Stadt-Modell unsichtbar starten (wird im tick bei <150m eingeblendet)
  for (const city of cityManager.cities) city.group.visible = false;

  // 4c. Spawn-Chunk vorbereiten: Wir sagen der WFC-Engine,
  // dass der Chunk an Position (0,0) auf jeden Fall FLOWERS_DENSE sein soll.
  grassManager.preSeedSpawn();

  // 4d. Ersten Chunk-Ladevorgang anstoßen.
  grassManager.update(new THREE.Vector3(0, 2, 0));

  // 5. Bienen (zufällige Sinus-Bahnen über die Wiese)
  const bees = await createBees(beeGlbUrl, {
    count: 10,
    scale: 0.04,
    fieldRadius: 200,
    flyRadiusMin: 1,
    flyRadiusMax: 3,
    speedMin: 2,
    speedMax: 4,
    heightBaseMin: 0.8,
    heightBaseMax: 1.5,
    heightRange: 0.2,
  });
  ctx.scene.add(bees.group);

  // 6. Schmetterlinge (zufällige Sinus-Bahnen über die Wiese)
  const butterflies = await createButterflies(butterflyGlbUrl, {
    count: 6,
    scale: 0.036,
    fieldRadius: 200,
    flyRadiusMin: 1,
    flyRadiusMax: 4,
    speedMin: 1.0,
    speedMax: 2.5,
    heightBaseMin: 1.2,
    heightBaseMax: 2.2,
    heightRange: 0.4,
  });
  ctx.scene.add(butterflies.group);

  // 7. Pheromon-Spuren (Glühwürmchen-Variante)
  const pheromones = new PheromoneSystem();
  const pheromoneTargets = grassManager.flowerTargets.map((pos, i) => ({
    position: pos,
    color: grassManager.flowerColors[i] ?? new THREE.Color(0xffffff),
  }));
  pheromones.addTrails(pheromoneTargets, ctx.camera.position);
  ctx.scene.add(pheromones.group);

  // ── Atmosphärischer Exponential-Nebel ──
  // Statt linearem Nebel (THREE.Fog) verwenden wir FogExp2:
  // Alles verschwindet sanft und gleichmäßig im Hintergrund,
  // wie eine atmosphärische Unschärfe.
  // Density 0.025 = Sichtweite ~50-80m, dann vollständig im Nebel.
  const fogColor = new THREE.Color("#4a90d9");
  ctx.scene.fog = new THREE.FogExp2(fogColor, 0.025);

  // Kamera positionieren (Insektenperspektive ~2m)
  const camera = ctx.camera;
  camera.position.set(0, 2, 0);

  // 8. City Guide Path (leuchtender Neon-Pfad zur nächsten Stadt)
  const guidePath = new CityGuidePath();
  ctx.scene.add(guidePath.group);

  // Ersten Pfad vom Startpunkt (0, 2, 0) zur Stadt setzen
  const startPos = new THREE.Vector3(0, 2, 0);
  const nearest = cityManager.getNearestUndiscovered(startPos);
  if (nearest) {
    guidePath.setTarget(startPos, nearest.position);
    // Kamera zur Stadt ausrichten
    const lookTarget = new THREE.Vector3(
      nearest.position.x,
      2,
      nearest.position.z,
    );
    camera.lookAt(lookTarget);
  }

  return {
    camera,
    grassManager,
    bees,
    butterflies,
    pheromones,
    sky,
    cityManager,
    guidePath,
  };
}

export function tick(
  state: ExperienceState,
  ctx: TickContext,
): { state: ExperienceState; outputs?: Record<string, number> } {
  const s = state as InsectWorldV2State;

  // Bienen-Animation (time + delta für Nebel-Zyklus)
  s.bees.update(ctx.elapsed, ctx.delta);
  // Schmetterlings-Animation
  s.butterflies.update(ctx.elapsed, ctx.delta);
  // Pheromon-Spuren-Animation
  s.pheromones.update(ctx.elapsed);

  // City Guide Path animieren
  s.guidePath.update(ctx.elapsed);

  // Stadt-Modell nur anzeigen wenn <150m entfernt (sonst im Nebel unsichtbar)
  const playerPos = ctx.camera.position;
  for (const city of s.cityManager.cities) {
    city.group.visible = playerPos.distanceTo(city.position) < 150;
  }

  // Prüfen ob der Spieler die Stadt erreicht hat (< 20m Distanz)
  const target = s.cityManager.getNearestUndiscovered(playerPos);
  if (target && playerPos.distanceTo(target.position) < 20) {
    s.cityManager.markVisited(target);
    s.guidePath.clear();
  }

  // Wiese: Chunks um den Spieler laden/entladen
  s.grassManager.update(ctx.camera.position);

  return {
    state: s,
    outputs: {
      citiesDiscovered: s.cityManager.discoveredCount,
    },
  };
}

export function dispose(state: ExperienceState, _scene: THREE.Scene): void {
  const s = state as InsectWorldV2State;

  s.bees.dispose();
  s.butterflies.dispose();
  s.pheromones.dispose();
  s.grassManager.dispose();
  s.cityManager.dispose(_scene);
  s.guidePath.dispose();
  _scene.remove(s.sky);
  (s.sky.geometry as THREE.BufferGeometry).dispose();
  (s.sky.material as THREE.Material).dispose();
  _scene.remove(s.grassManager.group);
  _scene.remove(s.bees.group);
  _scene.remove(s.butterflies.group);
  _scene.remove(s.pheromones.group);
  _scene.remove(s.guidePath.group);
}
