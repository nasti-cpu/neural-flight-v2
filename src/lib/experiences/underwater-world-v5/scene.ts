/**
 * scene.ts – Hauptexperience: Endlose Tiefsee-Unterwasserwelt mit WFC.
 *
 * Diese Datei verbindet alle modularen Komponenten:
 *   - ChunkManager (mit WFC-Integration für prozedurale Weltgenerierung)
 *   - FishWorld (Fischschwärme + Einzelfische)
 *   - JellyWorld (Prozedurale Quallen)
 *   - CityWorld (Unterwasser-Stadtkuppeln)
 *   - CoralReefWorld (Korallenriffe)
 *   - GuidanceSystem (Leitsystem zu Städten)
 *   - SubmarineSpotlight (Scheinwerfer am U-Boot)
 *   - BioParticles (Biolumineszente Partikel)
 *
 * Der WFC-Algorithmus (wfc/wfcSystem.ts) bestimmt, an welchen Positionen
 * Städte, Riffe, Quallen und Fisch-Zonen erscheinen – so entsteht eine
 * abwechslungsreiche, aber harmonische Unterwasserwelt.
 */

import * as THREE from "three/webgpu";
import type { ExperienceState, SetupContext, TickContext } from "../types";
import { FlightPlayer } from "$lib/three/player";
import {
  createWaterSurface,
  createGodRay,
} from "$lib/experiences/underwater-world-v5/shader/wasser/wasserShader";
import {
  uniform,
  vec3,
  vec4,
  float,
  positionLocal,
  sin,
  cos,
  time,
} from "three/tsl";
import { PointsNodeMaterial } from "three/webgpu";
import { ChunkManager, type ChunkManagerConfig } from "./world/chunkManager";
import { FishWorld } from "./world/fishWorld";
import { JellyWorld } from "./world/jellyWorld";
import { CityWorld } from "./world/cityWorld";
import { CoralReefWorld } from "./world/coralReefWorld";
import { GuidanceSystem } from "./sinne/leitsystem/guidanceSystem";
import { SubmarineSpotlight } from "./sinne/beleuchtung/spotlight";
import { BioParticles } from "./sinne/beleuchtung/bioParticles";
import { startBackgroundAudio } from "./sinne/backgroundAudio";
import { LargeCreatureWorld } from "./world/largeCreatureWorld";

// ---------------------------------------------------------------------------
// Typen für den Experience-State
// ---------------------------------------------------------------------------

export interface UnderwaterWorldV5State extends ExperienceState {
  player: FlightPlayer;
  camera: THREE.PerspectiveCamera;

  // WFC-Weltsysteme
  chunkManager: ChunkManager;
  fishWorld: FishWorld;
  largeCreatureWorld: LargeCreatureWorld;
  jellyWorld: JellyWorld;
  cityWorld: CityWorld;
  coralReefWorld: CoralReefWorld;
  guidanceSystem: GuidanceSystem;
  submarineSpotlight: SubmarineSpotlight;
  bioParticles: BioParticles;

  // Visuelle Elemente
  waterSurface: THREE.Mesh;
  godRays: Array<{ mesh: THREE.Mesh; offsetX: number; offsetZ: number }>;
  particles: THREE.Points;
  particlePositions: THREE.BufferAttribute;
  particleArr: Float32Array;

  // Beleuchtung & Nebel (für dynamische Tiefen-Anpassung)
  ambientLight: THREE.AmbientLight;
  sunLight: THREE.DirectionalLight;
  fillLight: THREE.DirectionalLight;
  sceneFog: THREE.Fog;

  /** Hintergrund-Atmo (kann null sein, wenn Sound fehlschlägt) */
  audio: { stop: () => void } | null;

  /** Szene-Referenz für sauberes Cleanup */
  _scene: THREE.Scene;
  _frameCount: number;

  /** City-Vorab-Scan: Tracking des zuletzt gescannten Chunks */
  _lastCityScanChunkX: number;
  _lastCityScanChunkZ: number;

  /** City-Vorab-Scan: Aktuelle Zeile für Row-by-Row-Scan (0..20 = aktiv, >20 = fertig) */
  _cityScanRow: number;

  /** Flag: Flight-State muss beim ersten updatePlayer()-Aufruf zurückgesetzt werden */
  _needsFlightReset: boolean;
}

// ---------------------------------------------------------------------------
// Welt-Konfiguration (Tiefsee – dunkel, neblig)
// ---------------------------------------------------------------------------

const WORLD_CONFIG = {
  floorY: -4,
  duneHeight: 0.3,
  chunkSize: 16,
  renderDistance: 4, // 9×9 Quadrat, aber Circular = ~50 Chunks – immer genug um den Spieler herum
  seegrassCount: 10,

  waterY: 26,
  waterSize: 300,
  waterSegments: 70,

  godRayCount: 0,
  godRayHeight: 27,

  particleCount: 400,
};

const PARTICLE_BOX = 40;

// ---------------------------------------------------------------------------
// setup – Initialisiert die gesamte Tiefsee-Unterwasserwelt
// ---------------------------------------------------------------------------

export async function setup(
  ctx: SetupContext,
): Promise<UnderwaterWorldV5State> {
  // =========================================================================
  // 0. Tiefsee-Nebel überschreiben (der Loader setzt Manifest-Werte,
  //    aber wir wollen engen, dunklen Tiefsee-Nebel wie in V4)
  // =========================================================================
  ctx.scene.background = new THREE.Color("#000814");
  const sceneFog = new THREE.Fog("#000814", 4, 24);
  ctx.scene.fog = sceneFog;

  // =========================================================================
  // 1. FlightPlayer für fliegende Bewegung
  // =========================================================================
  const player = new FlightPlayer({
    fov: 75,
    near: 0.1,
    far: 80, // Kamera-Far-Clip passend zum Nebel
    spawnPosition: { x: 0, y: 4, z: 0 },
    baseSpeed: 10,
  });
  player.rollYawMultiplier = 0;
  // clampToTerrain deaktivieren – wir haben unseren eigenen Y-Clamp
  player.minClearance = -1000;
  ctx.scene.add(player.rig);

  // =========================================================================
  // 2. Tiefsee-Beleuchtung (eigene Lichter, nicht die vom Loader)
  // =========================================================================
  // Loader-Lichter entfernen (wir machen unser eigenes Setup)
  _removeLoaderLights(ctx.scene);

  const ambientLight = new THREE.AmbientLight("#1a3355", 1.2);
  ctx.scene.add(ambientLight);
  const sunLight = new THREE.DirectionalLight("#3366aa", 1.5);
  sunLight.position.set(4, 10, 2);
  ctx.scene.add(sunLight);
  const fillLight = new THREE.DirectionalLight("#223355", 0.6);
  fillLight.position.set(-4, 2, -3);
  ctx.scene.add(fillLight);

  // =========================================================================
  // 3. Wasseroberfläche (von unten gesehen, mit Wellen)
  // =========================================================================
  const waterSurface = createWaterSurface(
    {
      waveAmplitude: 0.45,
      waveSpeed: 0.4,
      opacity: 0.9,
      surfaceColor: new THREE.Color("#010816"),
      highlightColor: new THREE.Color("#1a4470"),
    },
    WORLD_CONFIG.waterSize,
    WORLD_CONFIG.waterSegments,
  );
  waterSurface.position.y = WORLD_CONFIG.waterY;
  ctx.scene.add(waterSurface);

  // =========================================================================
  // 4. God Rays (deaktiviert für Tiefsee, aber Struktur bleibt)
  // =========================================================================
  const godRays: Array<{ mesh: THREE.Mesh; offsetX: number; offsetZ: number }> =
    [];

  // =========================================================================
  // 5. Biolumineszente Partikel (schwebendes Plankton)
  // =========================================================================
  const particleMat = new PointsNodeMaterial();
  particleMat.transparent = true;
  particleMat.blending = THREE.AdditiveBlending;
  particleMat.depthWrite = false;
  particleMat.positionNode = vec3(
    positionLocal.x.add(
      sin(time.mul(0.4).add(positionLocal.y.mul(2.5))).mul(0.08),
    ),
    positionLocal.y.add(
      cos(time.mul(0.3).add(positionLocal.x.mul(1.8))).mul(0.05),
    ),
    positionLocal.z.add(
      cos(time.mul(0.35).add(positionLocal.z.mul(2.2))).mul(0.08),
    ),
  );
  particleMat.sizeNode = float(0.035);
  const particleCol = uniform(new THREE.Color("#88ffcc"));
  const depthFactor = positionLocal.y.mul(0.1).add(0.7).clamp(0.5, 1.0);
  particleMat.colorNode = vec4(particleCol.mul(depthFactor), 0.6);

  const particleGeo = new THREE.BufferGeometry();
  const particleBuffer = new Float32Array(WORLD_CONFIG.particleCount * 3);
  for (let i = 0; i < WORLD_CONFIG.particleCount; i++) {
    particleBuffer[i * 3] = (Math.random() - 0.5) * PARTICLE_BOX;
    particleBuffer[i * 3 + 1] =
      WORLD_CONFIG.floorY +
      Math.random() * (WORLD_CONFIG.waterY - WORLD_CONFIG.floorY);
    particleBuffer[i * 3 + 2] = (Math.random() - 0.5) * PARTICLE_BOX;
  }
  particleGeo.setAttribute(
    "position",
    new THREE.BufferAttribute(particleBuffer, 3),
  );
  const particles = new THREE.Points(particleGeo, particleMat);
  ctx.scene.add(particles);
  const particlePositions = particleGeo.getAttribute(
    "position",
  ) as THREE.BufferAttribute;
  const particleArr = particlePositions.array as Float32Array;

  // =========================================================================
  // 6. Chunk-Manager (mit WFC-Integration!)
  // =========================================================================
  const chunkConfig: ChunkManagerConfig = {
    chunkSize: WORLD_CONFIG.chunkSize,
    floorY: WORLD_CONFIG.floorY,
    duneHeight: WORLD_CONFIG.duneHeight,
    seegrassCount: WORLD_CONFIG.seegrassCount,
    renderDistance: WORLD_CONFIG.renderDistance,
  };
  const chunkManager = new ChunkManager(ctx.scene, chunkConfig);

  // =========================================================================
  // 7. Fisch-System
  // =========================================================================
  const fishWorld = new FishWorld(ctx.scene, {
    floorY: WORLD_CONFIG.floorY,
    waterY: WORLD_CONFIG.waterY,
    // Längeres Intervall: Echoortung startet seltener (10s statt 5s)
    echolocationConfig: { ringInterval: 10 },
  });
  await fishWorld.init(player.camera.position);

  // =========================================================================
  // 8. Große Tiere (Delfine + Haie, chunk-basiert)
  // =========================================================================
  const largeCreatureWorld = new LargeCreatureWorld(ctx.scene, {
    floorY: WORLD_CONFIG.floorY,
    waterY: WORLD_CONFIG.waterY,
  });
  await largeCreatureWorld.init();

  // =========================================================================
  // 10. Quallen-System
  // =========================================================================
  const jellyWorld = new JellyWorld(ctx.scene, {
    floorY: WORLD_CONFIG.floorY,
    waterY: WORLD_CONFIG.waterY,
  });
  await jellyWorld.init();

  // =========================================================================
  // 11. Stadtmodelle
  // =========================================================================
  const cityWorld = new CityWorld(ctx.scene, WORLD_CONFIG.floorY);
  await cityWorld.init();

  // =========================================================================
  // 12. Korallenriffe
  // =========================================================================
  const coralReefWorld = new CoralReefWorld(ctx.scene, WORLD_CONFIG.floorY);
  await coralReefWorld.init();

  // =========================================================================
  // 13. Leitsystem
  // =========================================================================
  const guidanceSystem = new GuidanceSystem(ctx.scene, WORLD_CONFIG.floorY);

  // =========================================================================
  // 14. Unterwasser-Scheinwerfer
  // =========================================================================
  const submarineSpotlight = new SubmarineSpotlight(ctx.scene);

  // =========================================================================
  // 15. Biolumineszenz
  // =========================================================================
  const bioParticles = new BioParticles(ctx.scene);

  // =========================================================================
  // 16. Hintergrund-Atmo starten (sanft, leise, loop)
  // =========================================================================
  // Falls das Laden fehlschlägt, ist audio = null – alles okay.
  const backgroundAudio = startBackgroundAudio();

  // =========================================================================
  // 17. WFC-Callbacks registrieren:
  //     Wenn ein Chunk kollabiert, werden CityWorld und CoralReefWorld
  //     benachrichtigt, damit sie Städte/Riffe an den richtigen Positionen platzieren
  // =========================================================================
  chunkManager.onChunkCollapsed((cx, cz, type) => {
    if (type === "STADT") {
      cityWorld.registerCityAtChunk(cx, cz);
    } else if (type === "RIFF") {
      coralReefWorld.registerReefAtChunk(cx, cz);
    }
    // "FISCH" wird nicht mehr beachtet – Fische schwimmen jetzt
    // auf Kamera-zentrierten Orbits (32 Einzelfische + 1 Schule).
  });

  console.log("🌊 Underwater World V5 gestartet! (WFC-gesteuert)");
  console.log("   🧠 WFC bestimmt die Weltverteilung von Städten & Riffen");
  console.log("   🌫️  Dynamischer Tiefsee-Nebel + Beleuchtung");
  console.log("   🐟 Fische + Schwärme | 🐬 Delfine + 🦈 Haie | 🪼 Quallen | 🏙️ Städte | 🪸 Korallen");
  console.log("   🧭 Leitsystem | 🔦 Scheinwerfer | ✨ Biolumineszenz");

  return {
    player,
    camera: player.camera,
    audio: backgroundAudio,
    chunkManager,
    fishWorld,
    largeCreatureWorld,
    jellyWorld,
    cityWorld,
    coralReefWorld,
    guidanceSystem,
    submarineSpotlight,
    bioParticles,
    waterSurface,
    godRays,
    particles,
    particlePositions,
    particleArr,
    ambientLight,
    sunLight,
    fillLight,
    sceneFog,
    _scene: ctx.scene,
    _frameCount: 0,
    _lastCityScanChunkX: NaN,
    _lastCityScanChunkZ: NaN,
    _cityScanRow: 9999,
    _needsFlightReset: true,
  };
}

// ---------------------------------------------------------------------------
// tick – Wird jeden Frame aufgerufen
// ---------------------------------------------------------------------------

export function tick(
  state: ExperienceState,
  ctx: TickContext,
): { state: ExperienceState } {
  const s = state as UnderwaterWorldV5State;

  // Player-Bewegung wird NICHT hier gemacht – updatePlayer() steuert
  // das Rig direkt über ICAROS-Controller/WASD. s.player.tick()
  // würde den FlightPlayer-eigenen Zustand nutzen, der nie gesetzt
  // wird, und damit die updatePlayer-Position überschreiben.
  // Stattdessen machen wir hier nur die Y-Begrenzung als Sicherheitsnetz.
  const rigPos = s.player.rig.position;
  if (rigPos.y < WORLD_CONFIG.floorY + 0.5) {
    rigPos.y = WORLD_CONFIG.floorY + 0.5;
  }
  if (rigPos.y > WORLD_CONFIG.waterY - 0.3) {
    rigPos.y = WORLD_CONFIG.waterY - 0.3;
  }

  const { camera } = s;

  // =========================================================================
  // Tiefenabhängige Beleuchtung & Nebel (dunkler je tiefer)
  // =========================================================================
  const depthRange = WORLD_CONFIG.waterY - WORLD_CONFIG.floorY;
  const surfaceT = (rigPos.y - WORLD_CONFIG.floorY) / depthRange;
  const lightFactor = surfaceT * surfaceT;

  s.ambientLight.intensity = 0.6 + lightFactor * 1.2;
  s.sunLight.intensity = 0.8 + lightFactor * 2.7;
  s.fillLight.intensity = 0.3 + lightFactor * 0.9;

  // Dynamischer Nebel: oben weiter, unten enger
  // WICHTIG: Nebel immer KÜRZER als renderDistance * chunkSize,
  // damit die Lade-Kante der Chunks unsichtbar bleibt.
  const MAX_FOG_FAR = WORLD_CONFIG.chunkSize * WORLD_CONFIG.renderDistance - 6; // 58m
  s.sceneFog.near = 4 + lightFactor * 8;
  s.sceneFog.far = Math.min(24 + lightFactor * 40, MAX_FOG_FAR);

  // =========================================================================
  // Chunks aktualisieren (WFC-Collapse passiert automatisch bei neuen Chunks!)
  // =========================================================================
  s.chunkManager.update(rigPos.x, rigPos.z);

  // =========================================================================
  // Städte + Korallen (Lebenszyklus: laden, einblenden, ausblenden, entladen)
  // =========================================================================
  s.cityWorld.update(ctx.delta, rigPos.x, rigPos.z);
  s.coralReefWorld.update(ctx.delta, rigPos.x, rigPos.z);

  // =========================================================================
  // Gestaffelte Queue: Max 1 schwere Operation pro Frame (gesamt).
  // CityWorld und CoralReefWorld teilen sich dieses "Ticket".
  // FishWorld hat keine schweren Operationen mehr (Fische sind persistent).
  // =========================================================================
  if (!s.cityWorld.processNextHeavyOp()) {
    s.coralReefWorld.processNextHeavyOp();
  }

  // =========================================================================
  // 15. City-Vorab-Scan: Städte in größerer Distanz erkennen (für Leitsystem)
  // =========================================================================
  // OPTIMIERT: Der erste Scan (441 Lookups) wird NICHT in einem Frame
  // ausgeführt, sondern Row-by-Row über 21 Frames verteilt (je 21 Lookups).
  // So gibt es keinen Frame-Freeze beim Start.
  //
  // FOLGEDURCHLÄUFE scannen weiterhin den äußeren Ring bei SCAN_RADIUS,
  // um Städte in 160m Entfernung zu finden, sobald der Spieler einen neuen
  // Chunk betritt.
  // ---------------------------------------------------------------------------
  {
    const SCAN_RADIUS = 10; // 10 Chunks = 160m
    const cs = WORLD_CONFIG.chunkSize;
    const pCx = Math.floor(rigPos.x / cs);
    const pCz = Math.floor(rigPos.z / cs);

    // ★ INITIALER SCAN: Eine Zeile pro Frame (21 Lookups statt 441)
    if (s._cityScanRow <= SCAN_RADIUS) {
      if (s._cityScanRow === 9999) {
        s._cityScanRow = -SCAN_RADIUS;
      }
      const row = s._cityScanRow;
      for (let dx = -SCAN_RADIUS; dx <= SCAN_RADIUS; dx++) {
        if (s.chunkManager.getChunkType(pCx + dx, pCz + row) === "STADT") {
          s.cityWorld.registerCityAtChunk(pCx + dx, pCz + row);
        }
      }
      s._cityScanRow++;
    }

    // ★ FOLGEDURCHLÄUFE: Nur den äußeren Ring bei SCAN_RADIUS scannen
    if (
      pCx !== s._lastCityScanChunkX ||
      pCz !== s._lastCityScanChunkZ
    ) {
      s._lastCityScanChunkX = pCx;
      s._lastCityScanChunkZ = pCz;

      for (let i = -SCAN_RADIUS; i <= SCAN_RADIUS; i++) {
        const check = (cx: number, cz: number) => {
          if (s.chunkManager.getChunkType(cx, cz) === "STADT") {
            s.cityWorld.registerCityAtChunk(cx, cz);
          }
        };
        // Obere Kante (cz = -SCAN_RADIUS)
        check(pCx + i, pCz - SCAN_RADIUS);
        // Untere Kante (cz = +SCAN_RADIUS)
        check(pCx + i, pCz + SCAN_RADIUS);
        // Linke Kante, ohne Ecken
        if (i > -SCAN_RADIUS && i < SCAN_RADIUS) {
          check(pCx - SCAN_RADIUS, pCz + i);
        }
        // Rechte Kante, ohne Ecken
        if (i > -SCAN_RADIUS && i < SCAN_RADIUS) {
          check(pCx + SCAN_RADIUS, pCz + i);
        }
      }
    }
  }

  // =========================================================================
  // Leitsystem (zeigt den Weg zur nächsten Stadt)
  // =========================================================================
  s.guidanceSystem.update(
    ctx.delta,
    ctx.elapsed,
    rigPos,
    s.cityWorld.getActiveCityPositions(),
  );

  // =========================================================================
  // Scheinwerfer folgt der Kamera
  // =========================================================================
  s.submarineSpotlight.update(camera);

  // =========================================================================
  // Biolumineszenz
  // =========================================================================
  s.bioParticles.update(rigPos);

  // =========================================================================
  // Exklusionszonen für Kuppeln (Fische & Quallen & Seegras meiden Städte)
  // =========================================================================
  const exclusionZones = s.cityWorld.getExclusionZones();
  s.fishWorld.setExclusionZones(exclusionZones);
  s.largeCreatureWorld.setExclusionZones(exclusionZones);
  s.chunkManager.setExclusionZones(exclusionZones);
  s.coralReefWorld.setExclusionZones(exclusionZones);
  s.jellyWorld.setExclusionZones(exclusionZones);

  // =========================================================================
  // Fische + Quallen + Große Tiere aktualisieren
  // =========================================================================
  // Echo-Targets von Quallen + großen Tieren für die Echoortung sammeln
  const echoTargets = [
    ...s.jellyWorld.getEchoTargets(),
    ...s.largeCreatureWorld.getEchoTargets(),
  ];
  s.fishWorld.update(ctx.delta, ctx.elapsed, rigPos, echoTargets);
  s.largeCreatureWorld.update(ctx.delta, ctx.elapsed, rigPos);
  s.jellyWorld.update(ctx.delta, ctx.elapsed, rigPos);

  // =========================================================================
  // Wasseroberfläche folgt der Kamera (sanft)
  // =========================================================================
  _updateWaterPosition(s);

  // =========================================================================
  // Partikel-Wrap-Around (um die Kamera herum)
  // =========================================================================
  _updateParticles(s, camera);

  return { state: s };
}

// ---------------------------------------------------------------------------
// dispose – Räumt alle Ressourcen auf
// ---------------------------------------------------------------------------

export function dispose(state: ExperienceState, scene: THREE.Scene): void {
  const s = state as UnderwaterWorldV5State;

  scene.remove(s.player.rig);

  s.godRays.length = 0;

  s.chunkManager.dispose();
  s.fishWorld.dispose();
  s.largeCreatureWorld.dispose();
  s.jellyWorld.dispose();
  s.cityWorld.dispose();
  s.coralReefWorld.dispose();
  s.guidanceSystem.dispose();
  s.submarineSpotlight.dispose();
  s.bioParticles.dispose();

  // Wasseroberfläche
  if (s.waterSurface) {
    s.waterSurface.removeFromParent();
    s.waterSurface.geometry?.dispose();
    (s.waterSurface.material as any)?.dispose();
  }

  // Partikel
  if (s.particles) {
    s.particles.removeFromParent();
    s.particles.geometry?.dispose();
    (s.particles.material as any)?.dispose();
  }

  // Beleuchtung aufräumen
  if (s.ambientLight) { s.ambientLight.removeFromParent(); s.ambientLight.dispose(); }
  if (s.sunLight) { s.sunLight.removeFromParent(); s.sunLight.dispose(); }
  if (s.fillLight) { s.fillLight.removeFromParent(); s.fillLight.dispose(); }

  // Hintergrund-Atmo stoppen
  s.audio?.stop();
}

// ---------------------------------------------------------------------------
// Private Hilfsfunktionen (kurz, <20 Zeilen, eine Aufgabe pro Funktion)
// ---------------------------------------------------------------------------

/**
 * Entfernt die vom Loader erstellten Lichter, weil wir eigene
 * Tiefsee-Beleuchtung brauchen. Der Loader erstellt Ambient + Sun.
 */
function _removeLoaderLights(scene: THREE.Scene): void {
  const toRemove: THREE.Object3D[] = [];
  scene.traverse((obj) => {
    if (
      obj instanceof THREE.AmbientLight ||
      obj instanceof THREE.DirectionalLight
    ) {
      toRemove.push(obj);
    }
  });
  for (const obj of toRemove) {
    scene.remove(obj);
    if (obj instanceof THREE.Light) {
      obj.dispose();
    }
  }
}

/** Wasseroberfläche folgt der Kamera (snap – keine harten Kanten sichtbar) */
function _updateWaterPosition(s: UnderwaterWorldV5State): void {
  const { camera, waterSurface } = s;
  waterSurface.position.x = camera.position.x;
  waterSurface.position.z = camera.position.z;
}

/** Partikel-Wrap-Around: Hält die Partikel um die Kamera herum */
function _updateParticles(
  s: UnderwaterWorldV5State,
  camera: THREE.PerspectiveCamera,
): void {
  const { particles, particlePositions, particleArr } = s;
  const halfBox = PARTICLE_BOX / 2;
  const pp = particles.position;
  let wrapped = false;
  const count = particleArr.length / 3;

  for (let i = 0; i < count; i++) {
    const idx = i * 3;
    const worldX = pp.x + particleArr[idx];
    const worldZ = pp.z + particleArr[idx + 2];
    const relX = worldX - camera.position.x;
    const relZ = worldZ - camera.position.z;

    if (relZ < -halfBox) {
      particleArr[idx + 2] += PARTICLE_BOX;
      wrapped = true;
    }
    if (relZ > halfBox) {
      particleArr[idx + 2] -= PARTICLE_BOX;
      wrapped = true;
    }
    if (relX < -halfBox) {
      particleArr[idx] += PARTICLE_BOX;
      wrapped = true;
    }
    if (relX > halfBox) {
      particleArr[idx] -= PARTICLE_BOX;
      wrapped = true;
    }
  }

  if (wrapped) {
    particlePositions.needsUpdate = true;
  }

  // Periodisches Re-Centering alle ~200 Frames
  s._frameCount++;
  if (s._frameCount > 200) {
    s._frameCount = 0;
    const cx = Math.round(camera.position.x);
    const cz = Math.round(camera.position.z);
    for (let i = 0; i < count; i++) {
      particleArr[i * 3] -= cx;
      particleArr[i * 3 + 2] -= cz;
    }
    particlePositions.needsUpdate = true;
    particles.position.x += cx;
    particles.position.z += cz;
  }
}

// ---------------------------------------------------------------------------
// updatePlayer – ICAROS-Controller-Steuerung (VR-Pfad)
// ---------------------------------------------------------------------------

/** Glättungsfaktor für Controller-Daten (Rauschunterdrückung) */
const PLAYER_LERP = 0.15;
/** Wie stark Roll die Flugrichtung ändert */
const ROLL_HEADING_MULT = 1.0;
/** Basis-Geschwindigkeit als Faktor von baseSpeed (sanftes Floaten) */
const FLOAT_SPEED_FACTOR = 0.25;
/** Geschwindigkeits-Multiplikator bei Accelerate */
const ACCEL_BOOST = 2.0;
/** Geschwindigkeits-Multiplikator bei Brake */
const BRAKE_FACTOR = 0.25;

/** Gesmoothte Controller-Werte (modulweit, weil über Frames hinweg) */
let _smoothedPitch = 0;
let _smoothedRoll = 0;
let _heading = 0;
let _playerSpeed = 2;
const _forwardVecUpdate = new THREE.Vector3();

/**
 * Verarbeitet ICAROS-Controller-Daten und steuert den FlightPlayer.
 * Wird vom VR-Loader jeden Frame aufgerufen.
 */
export function updatePlayer(
  orientation: { pitch: number; roll: number },
  speed: { accelerate: boolean; brake: boolean },
  state: ExperienceState,
  delta: number,
): void {
  const s = state as UnderwaterWorldV5State;

  // Bei Re-Setup (nach Portal-Transition): Flight-State zurücksetzen
  if (s._needsFlightReset) {
    s._needsFlightReset = false;
    _smoothedPitch = 0;
    _smoothedRoll = 0;
    _heading = 0;
    _playerSpeed = s.player.baseSpeed * FLOAT_SPEED_FACTOR;
  }

  // Controller-Werte sanft interpolieren
  _smoothedPitch += (orientation.pitch - _smoothedPitch) * PLAYER_LERP;
  _smoothedRoll += (orientation.roll - _smoothedRoll) * PLAYER_LERP;

  // Roll in Heading umwandeln (Banking = Kurvenflug)
  _heading -=
    _smoothedRoll * THREE.MathUtils.DEG2RAD * ROLL_HEADING_MULT * delta;

  // Ziel-Geschwindigkeit berechnen
  let targetSpeed = s.player.baseSpeed * FLOAT_SPEED_FACTOR;
  if (speed.accelerate) targetSpeed *= ACCEL_BOOST;
  else if (speed.brake) targetSpeed *= BRAKE_FACTOR;
  _playerSpeed += (targetSpeed - _playerSpeed) * Math.min(1, 3 * delta);

  // Forward-Vektor aus Heading + Pitch (sphärische Koordinaten)
  const pitchRad = _smoothedPitch * THREE.MathUtils.DEG2RAD;
  _forwardVecUpdate.set(
    -Math.sin(_heading) * Math.cos(pitchRad),
    -Math.sin(pitchRad),
    -Math.cos(_heading) * Math.cos(pitchRad),
  );
  _forwardVecUpdate.normalize();

  // Rig bewegen (Welt-Position)
  s.player.rig.position.addScaledVector(
    _forwardVecUpdate,
    _playerSpeed * delta,
  );

  // Rig-Rotation setzen (YXZ-Euler für flugsimulation)
  s.player.rig.rotation.set(
    -pitchRad,
    _heading,
    -_smoothedRoll * THREE.MathUtils.DEG2RAD,
    "YXZ",
  );

  // Y-Begrenzung
  const rigPos = s.player.rig.position;
  if (rigPos.y < WORLD_CONFIG.floorY + 0.5)
    rigPos.y = WORLD_CONFIG.floorY + 0.5;
  if (rigPos.y > WORLD_CONFIG.waterY - 0.3)
    rigPos.y = WORLD_CONFIG.waterY - 0.3;
}
