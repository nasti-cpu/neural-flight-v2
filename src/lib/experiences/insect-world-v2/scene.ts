/**
 * insect-world-v2 — Scene Lifecycle.
 * setup, tick, dispose — baut die vollständige Szene auf:
 * Himmel, Wiese (WFC-basiert), Blumen (dynamisch), Bienen, Schmetterlinge und Stadt.
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
import { CITY } from "./Objekte/Stadt/city";
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
  city: THREE.Group | null;
}

function loadGLB(url: string): Promise<THREE.Group> {
  return new Promise((resolve, reject) => {
    new GLTFLoader().load(
      url,
      (gltf) => resolve(gltf.scene),
      undefined,
      reject,
    );
  });
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

  // 4. Stadt laden
  let city: THREE.Group | null = null;
  try {
    const cityScene = await loadGLB(CITY.MODEL);
    cityScene.scale.setScalar(CITY.SCALE);
    cityScene.position.set(CITY.POSITION.x, CITY.POSITION.y, CITY.POSITION.z);
    cityScene.rotation.y = CITY.ROTATION_Y;
    ctx.scene.add(cityScene);
    city = cityScene;

    // Stadt-Bereich im GrassManager registrieren (verhindert Gras/Blumen dort)
    grassManager.addClearRegion(
      CITY.CLEAR.CENTER.x,
      CITY.CLEAR.CENTER.z,
      CITY.CLEAR.RECT.hw,
      CITY.CLEAR.RECT.hd,
      CITY.CLEAR.RECT.angle,
      CITY.CLEAR.RECT.border,
    );
  } catch (e) {
    console.warn("[V2] Stadt konnte nicht geladen werden:", e);
  }

  // 4b. Spawn-Chunk vorbereiten: Wir sagen der WFC-Engine,
  // dass der Chunk an Position (0,0) auf jeden Fall FLOWERS_DENSE sein soll.
  // Das garantiert, dass direkt beim Start Blumen zu sehen sind.
  // Ohne diesen Aufruf wäre der Chunk-Typ zufällig (nur ~34% Chance auf Blumen).
  grassManager.preSeedSpawn();

  // 4c. Ersten Chunk-Ladevorgang anstoßen.
  // Der Spieler startet bei (0, 2, 0) → Chunk (0,0) wird geladen.
  // Jetzt sind Gras, Boden und Blumen sofort sichtbar.
  grassManager.update(new THREE.Vector3(0, 2, 0));

  // 5. Bienen (fliegen von Blüte zu Blüte)
  const bees = await createBees(beeGlbUrl, {
    count: 20,
    scale: 0.04,
    fieldRadius: 200,
    flyRadiusMin: 1,
    flyRadiusMax: 3,
    speedMin: 2,
    speedMax: 4,
    heightBaseMin: 0.8,
    heightBaseMax: 1.5,
    heightRange: 0.2,
    flowerTargets: grassManager.flowerTargets,
    hoverDuration: 1.0,
  });
  ctx.scene.add(bees.group);

  // 6. Schmetterlinge (fliegen von Blüte zu Blüte)
  const butterflies = await createButterflies(butterflyGlbUrl, {
    count: 12,
    scale: 0.036,
    fieldRadius: 200,
    flyRadiusMin: 1,
    flyRadiusMax: 4,
    speedMin: 1.0,
    speedMax: 2.5,
    heightBaseMin: 1.2,
    heightBaseMax: 2.2,
    heightRange: 0.4,
    flowerTargets: grassManager.flowerTargets,
    hoverDuration: 2.0,
    heightAboveFlower: 2.0,
  });
  ctx.scene.add(butterflies.group);

  // 7. Pheromon-Spuren (Glühwürmchen-Variante)
  const pheromones = new PheromoneSystem();
  // Vector3[] + Color[] → FlowerTarget[] kombinieren (Pheromone brauchen .position und .color)
  const pheromoneTargets = grassManager.flowerTargets.map((pos, i) => ({
    position: pos,
    color: grassManager.flowerColors[i] ?? new THREE.Color(0xffffff),
  }));
  pheromones.addTrails(pheromoneTargets, ctx.camera.position);
  ctx.scene.add(pheromones.group);

  // Kamera positionieren (Insektenperspektive ~2m)
  const camera = ctx.camera;
  camera.position.set(0, 2, 0);

  return { camera, grassManager, bees, butterflies, pheromones, sky, city };
}

export function tick(
  state: ExperienceState,
  ctx: TickContext,
): { state: ExperienceState; outputs?: Record<string, number> } {
  const s = state as InsectWorldV2State;

  // Bienen-Animation
  s.bees.update(ctx.elapsed);
  // Schmetterlings-Animation
  s.butterflies.update(ctx.elapsed);
  // Pheromon-Spuren-Animation
  s.pheromones.update(ctx.elapsed);

  // Wiese: Chunks um den Spieler laden/entladen
  s.grassManager.update(ctx.camera.position);

  return { state: s };
}

export function dispose(state: ExperienceState, _scene: THREE.Scene): void {
  const s = state as InsectWorldV2State;

  s.bees.dispose();
  s.butterflies.dispose();
  s.pheromones.dispose();
  s.grassManager.dispose();
  if (s.city) {
    _scene.remove(s.city);
    s.city.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    });
  }
  _scene.remove(s.sky);
  (s.sky.geometry as THREE.BufferGeometry).dispose();
  (s.sky.material as THREE.Material).dispose();
  // Alle Gruppen aus der Szene entfernen
  _scene.remove(s.grassManager.group);
  _scene.remove(s.bees.group);
  _scene.remove(s.butterflies.group);
  _scene.remove(s.pheromones.group);
}
