/**
 * underwaterWorld.ts – Haupt-Experience: Die endlose Tiefsee-Unterwasserwelt.
 *
 * Visuelle Referenz: experiment-11 "deepsea" mood (Atmosphäre).
 * Sandboden, Tiefsee-Beleuchtung, große Wasseroberfläche.
 *
 * Steuerung: WASD + Maus (First-Person, PointerLock).
 */

import * as THREE from "three/webgpu";
import {
  createWaterSurface,
  createGodRay,
} from "../shader/wasser/wasserShader";
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
import { ChunkManager, type ChunkManagerConfig } from "./chunkManager";
import { FishWorld } from "./fishWorld";
import { JellyWorld } from "./jellyWorld";
import { CityWorld } from "./cityWorld";
import { CoralReefWorld } from "./coralReefWorld";
import { GuidanceSystem } from "../sinne/leitsystem/guidanceSystem";
import { SubmarineSpotlight } from "../sinne/beleuchtung/spotlight";
import { BioParticles } from "../sinne/beleuchtung/bioParticles";

// ---------------------------------------------------------------------------
// Konfiguration – abgestimmt auf Experiment-11 Tiefsee
// ---------------------------------------------------------------------------

const WORLD_CONFIG = {
  // --- Boden ---
  floorY: -4, // Y-Position des Meeresbodens (wie exp-11)
  duneHeight: 0.3, // Sanfte Dünen
  chunkSize: 16,
  renderDistance: 2, // 5×5=25 Chunks = 80×80 Einheiten – gute Balance
  seegrassCount: 10, // Weniger Seegras in der Tiefsee

  // --- Wasser ---
  waterY: 22, // Höher – mehr Raum zwischen Kuppelspitze und Wasseroberfläche
  waterSize: 100,
  waterSegments: 70, // Von 100 reduziert – ~50% weniger Vertex-Arbeit im Wellenshader

  // --- God Rays ---
  godRayCount: 0, // Deaktiviert – die Kaustik-Bänder sahen aus wie zitternde Ringe
  godRayHeight: 27, // Gleicher Bodenabstand wie bei waterY=15 (unten ≈ -6.5), reicht bis ~1.5m unter Wasser

  // --- Partikel ---
  particleCount: 400, // Weniger Partikel = schöner, performanter

  // --- Kamera & Bewegung ---
  cameraFov: 65, // Wie exp-11
  cameraNear: 0.1,
  cameraFar: 80, // Weit über renderDistance, damit Fog ausblendet bevor Clip sichtbar wird
  moveSpeed: 8,
  sprintMultiplier: 2.5,
  mouseSensitivity: 0.002,
  startPosition: new THREE.Vector3(0, 0, -4),
};

// ---------------------------------------------------------------------------
// Typen
// ---------------------------------------------------------------------------

interface GodRayInstance {
  mesh: THREE.Mesh;
  offsetX: number;
  offsetZ: number;
}

// ---------------------------------------------------------------------------
// UnderwaterWorldState – Interface für Catalog-Integration
// ---------------------------------------------------------------------------

export interface UnderwaterWorldState {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGPURenderer;
  chunkManager: ChunkManager;
  fishWorld: FishWorld;
  jellyWorld: JellyWorld;
  cityWorld: CityWorld;
  coralReefWorld: CoralReefWorld;
  guidanceSystem: GuidanceSystem;
  submarineSpotlight: SubmarineSpotlight;
  bioParticles: BioParticles;
  waterSurface: THREE.Mesh;
  godRays: GodRayInstance[];
  particles: THREE.Points;
  particlePositions: THREE.BufferAttribute;
  particleArr: Float32Array;
  ambientSound: THREE.Audio;
  listener: THREE.AudioListener;
  ambientLight: THREE.AmbientLight;
  sunLight: THREE.DirectionalLight;
  fillLight: THREE.DirectionalLight;
  sceneFog: THREE.Fog;
}

// ---------------------------------------------------------------------------
// Globale Referenzen für cleanup
// ---------------------------------------------------------------------------

let _renderer: THREE.WebGPURenderer | null = null;
let _scene: THREE.Scene | null = null;
let _camera: THREE.PerspectiveCamera | null = null;
let _chunkManager: ChunkManager | null = null;
let _fishWorld: FishWorld | null = null;
let _jellyWorld: JellyWorld | null = null;
let _cityWorld: CityWorld | null = null;
let _coralReefWorld: CoralReefWorld | null = null;
let _guidanceSystem: GuidanceSystem | null = null;
let _submarineSpotlight: SubmarineSpotlight | null = null;
let _bioParticles: BioParticles | null = null;
let _waterSurface: THREE.Mesh | null = null;
let _godRays: GodRayInstance[] = [];
let _particles: THREE.Points | null = null;
let _particlePositions: THREE.BufferAttribute | null = null;
let _particleArr: Float32Array | null = null;
let _ambientSound: THREE.Audio | null = null;
let _listener: THREE.AudioListener | null = null;
let _audioStarted = false;
let _ambientLight: THREE.AmbientLight | null = null;
let _sunLight: THREE.DirectionalLight | null = null;
let _fillLight: THREE.DirectionalLight | null = null;
let _sceneFog: THREE.Fog | null = null;
let _keys: Record<string, boolean> = {};
let _euler: THREE.Euler = new THREE.Euler(0, 0, 0, "YXZ");
let _animFrameId: number | null = null;
let _lastTime = 0;
let _startTime = 0;
let _frameCount = 0;
let _canvas: HTMLCanvasElement | null = null;

// Event-Listener-Referenzen für sauberes cleanup (Bugfix 3+5)
let _onKeyDown: ((e: KeyboardEvent) => void) | null = null;
let _onKeyUp: ((e: KeyboardEvent) => void) | null = null;
let _onClick: (() => void) | null = null;
let _onMouseMove: ((e: MouseEvent) => void) | null = null;
let _onResize: (() => void) | null = null;

// Player-Status für ICAROS-Controller (Catalog-Pfad)
let _playerPitch = 0;        // Aktuelle Pitch-Neigung in Grad (gesmootht)
let _playerRoll = 0;         // Aktuelle Roll-Neigung in Grad (gesmootht)
let _heading = 0;            // Kumulierte Gier-Richtung im Bogenmaß
let _playerSpeed = WORLD_CONFIG.moveSpeed;

// ---------------------------------------------------------------------------
// Initialisierung
// ---------------------------------------------------------------------------

/** Erzeugt Scene, Kamera, Renderer, Input und alle Weltobjekte (Standalone-Modus) */
export async function initWorld(container: HTMLElement): Promise<void> {
  // =========================================================================
  // 1. Szene
  // =========================================================================
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#000814");
  const sceneFog = new THREE.Fog("#000814", 4, 24);
  scene.fog = sceneFog;
  _sceneFog = sceneFog;

  // =========================================================================
  // 2. Kamera
  // =========================================================================
  const camera = new THREE.PerspectiveCamera(
    WORLD_CONFIG.cameraFov,
    window.innerWidth / window.innerHeight,
    WORLD_CONFIG.cameraNear,
    WORLD_CONFIG.cameraFar,
  );
  camera.position.copy(WORLD_CONFIG.startPosition);

  // =========================================================================
  // 3. Renderer (WebGPU)
  // =========================================================================
  const renderer = new THREE.WebGPURenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = false;
  container.appendChild(renderer.domElement);
  await renderer.init();

  // =========================================================================
  // 4. Alle Weltobjekte erstellen (shared mit createWorldState)
  // =========================================================================
  const state = await createWorldState(scene, camera, renderer);
  _frameCount = 0;
  _canvas = renderer.domElement;

  // =========================================================================
  // 5. WASD + Maus-Steuerung  (nur Standalone)
  // =========================================================================
  _keys = {};
  _euler = new THREE.Euler(0, 0, 0, "YXZ");

  _onKeyDown = (e: KeyboardEvent) => { _keys[e.code] = true; };
  window.addEventListener("keydown", _onKeyDown);

  _onKeyUp = (e: KeyboardEvent) => { _keys[e.code] = false; };
  window.addEventListener("keyup", _onKeyUp);

  _onClick = () => {
    renderer.domElement.requestPointerLock();
    state.listener.context.resume();
    if (!state.ambientSound.isPlaying) {
      state.ambientSound.play();
    }
  };
  renderer.domElement.addEventListener("click", _onClick);

  _onMouseMove = (e: MouseEvent) => {
    if (document.pointerLockElement !== renderer.domElement) return;
    _euler.setFromQuaternion(camera.quaternion);
    _euler.y -= e.movementX * WORLD_CONFIG.mouseSensitivity;
    _euler.x -= e.movementY * WORLD_CONFIG.mouseSensitivity;
    _euler.x = Math.max(-Math.PI * 0.45, Math.min(Math.PI * 0.45, _euler.x));
    camera.quaternion.setFromEuler(_euler);
  };
  document.addEventListener("mousemove", _onMouseMove);

  // =========================================================================
  // 6. Resize-Handler
  // =========================================================================
  _onResize = () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  };
  window.addEventListener("resize", _onResize);

  // =========================================================================
  // 7. Animations-Loop
  // =========================================================================
  let lastTime = performance.now();
  const moveDir = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const startTime = performance.now();

  function animate(): void {
    _animFrameId = requestAnimationFrame(animate);

    const now = performance.now();
    const delta = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;
    const elapsed = (now - startTime) / 1000;

    // Floaten + WASD (nur Standalone – weil nur hier PointerLock aktiv)
    camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    right.crossVectors(forward, camera.up).normalize();
    camera.position.add(forward.clone().multiplyScalar(0.9 * delta));

    moveDir.set(0, 0, 0);
    if (_keys["KeyW"]) moveDir.add(forward);
    if (_keys["KeyS"]) moveDir.sub(forward);
    if (_keys["KeyA"]) moveDir.sub(right);
    if (_keys["KeyD"]) moveDir.add(right);
    if (_keys["KeyQ"]) moveDir.y -= 1;
    if (_keys["KeyE"] || _keys["Space"]) moveDir.y += 1;

    let speed = WORLD_CONFIG.moveSpeed;
    if (_keys["ShiftLeft"] || _keys["ShiftRight"]) speed *= WORLD_CONFIG.sprintMultiplier;

    if (moveDir.lengthSq() > 0) {
      moveDir.normalize().multiplyScalar(speed * delta);
      camera.position.add(moveDir);
    }

    if (camera.position.y < WORLD_CONFIG.floorY + 0.5) camera.position.y = WORLD_CONFIG.floorY + 0.5;
    if (camera.position.y > WORLD_CONFIG.waterY - 0.3) camera.position.y = WORLD_CONFIG.waterY - 0.3;

    // Welt-Updates (shared mit updateWorld)
    updateWorld(state, delta, elapsed);

    // Debug
    const debugEl = document.getElementById("debug");
    if (debugEl) {
      debugEl.textContent =
        `Chunks: ${state.chunkManager.loadedCount} | ` +
        `XZ: ${camera.position.x.toFixed(0)},${camera.position.z.toFixed(0)} | ` +
        `Y: ${camera.position.y.toFixed(1)}`;
    }

    renderer.render(scene, camera);
  }

  animate();

  // =========================================================================
  // Debug (globale Referenzen für Console)
  // =========================================================================
  (window as any).__scene = scene;
  (window as any).__chunkManager = state.chunkManager;
  (window as any).__camera = camera;
  (window as any).__fishWorld = state.fishWorld;
  (window as any).__jellyWorld = state.jellyWorld;
  (window as any).__cityWorld = state.cityWorld;
  (window as any).__guidanceSystem = state.guidanceSystem;
  (window as any).__coralReefWorld = state.coralReefWorld;
  (window as any).__submarineSpotlight = state.submarineSpotlight;
  (window as any).__bioParticles = state.bioParticles;

  console.log("🌑 Tiefsee-Unterwasserwelt gestartet!");
  console.log("   WASD = bewegen | Maus = schauen | Q/E = hoch/runter");
  console.log("   Shift = sprinten | Klick = Maus sperren");
  console.log(`   🐟 Fische + Schwärme | 🪼 Quallen | 🏙️ Städte | 🪸 Korallen`);
  console.log(`   🧭 Leitsystem | 🔦 Scheinwerfer | ✨ Biolumineszenz`);
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

export function disposeWorld(): void {
  // Animations-Loop stoppen (Bugfix 2)
  if (_animFrameId !== null) {
    cancelAnimationFrame(_animFrameId);
    _animFrameId = null;
  }

  // Event-Listener entfernen (Bugfix 3+5)
  if (_onKeyDown) { window.removeEventListener("keydown", _onKeyDown); _onKeyDown = null; }
  if (_onKeyUp) { window.removeEventListener("keyup", _onKeyUp); _onKeyUp = null; }
  if (_onClick && _canvas) { _canvas.removeEventListener("click", _onClick); _onClick = null; }
  if (_onMouseMove) { document.removeEventListener("mousemove", _onMouseMove); _onMouseMove = null; }
  if (_onResize) { window.removeEventListener("resize", _onResize); _onResize = null; }

  _godRays = [];

  if (_chunkManager) {
    _chunkManager.dispose();
    _chunkManager = null;
  }
  if (_fishWorld) {
    _fishWorld.dispose();
    _fishWorld = null;
  }
  if (_jellyWorld) {
    _jellyWorld.dispose();
    _jellyWorld = null;
  }
  if (_cityWorld) {
    _cityWorld.dispose();
    _cityWorld = null;
  }
  if (_coralReefWorld) {
    _coralReefWorld.dispose();
    _coralReefWorld = null;
  }
  if (_guidanceSystem) {
    _guidanceSystem.dispose();
    _guidanceSystem = null;
  }
  if (_submarineSpotlight) {
    _submarineSpotlight.dispose();
    _submarineSpotlight = null;
  }
  if (_bioParticles) {
    _bioParticles.dispose();
    _bioParticles = null;
  }
  if (_particles) {
    _particles.removeFromParent();
    _particles.geometry?.dispose();
    (_particles.material as any)?.dispose();
    _particles = null;
  }
  if (_waterSurface) {
    _waterSurface.removeFromParent();
    _waterSurface.geometry?.dispose();
    (_waterSurface.material as any)?.dispose();
    _waterSurface = null;
  }
  if (_ambientSound) {
    _ambientSound.stop();
    _ambientSound.removeFromParent();
  }
  if (_renderer) {
    _renderer.dispose();
    _renderer = null;
  }
  if (_canvas && _canvas.parentElement) {
    _canvas.parentElement.removeChild(_canvas);
  }
  _scene = null;
  _camera = null;
  _keys = {};
  _listener = null;
  _audioStarted = false;
}

// ---------------------------------------------------------------------------
// createWorldState – Erstellt alle Weltobjekte (shared Standalone + Catalog)
// ---------------------------------------------------------------------------

const PARTICLE_BOX = 40;

export async function createWorldState(
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  renderer: THREE.WebGPURenderer,
): Promise<UnderwaterWorldState> {
  // --- Audio ---
  const listener = new THREE.AudioListener();
  camera.add(listener);
  const ambientSound = new THREE.Audio(listener);
  const audioLoader = new THREE.AudioLoader();
  audioLoader.load("/sounds/ambiente unterwasser.mp3", (buffer) => {
    ambientSound.setBuffer(buffer);
    ambientSound.setLoop(true);
    ambientSound.setVolume(0.4);
  });

  // --- Beleuchtung – Tiefsee ---
  const ambientLight = new THREE.AmbientLight("#1a3355", 1.2);
  scene.add(ambientLight);
  const sunLight = new THREE.DirectionalLight("#3366aa", 1.5);
  sunLight.position.set(4, 10, 2);
  scene.add(sunLight);
  const fillLight = new THREE.DirectionalLight("#223355", 0.6);
  fillLight.position.set(-4, 2, -3);
  scene.add(fillLight);

  // --- Wasseroberfläche ---
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
  scene.add(waterSurface);

  // --- God Rays ---
  const godRays: GodRayInstance[] = [];
  for (let i = 0; i < WORLD_CONFIG.godRayCount; i++) {
    const angle = (i / WORLD_CONFIG.godRayCount) * Math.PI * 2;
    const radius = 2 + Math.random() * 4;
    const offsetX = Math.cos(angle) * radius;
    const offsetZ = Math.sin(angle) * radius;
    const rayMesh = createGodRay(
      {
        brightness: 0.08 + Math.random() * 0.15,
        softness: 1.2 + Math.random() * 0.6,
        reach: 0.3 + Math.random() * 0.2,
        wobble: 0.05 + Math.random() * 0.1,
        rayColor: new THREE.Color("#3366aa"),
      },
      0.15 + Math.random() * 0.2,
      0.03 + Math.random() * 0.05,
      WORLD_CONFIG.godRayHeight,
    );
    rayMesh.position.set(
      offsetX,
      WORLD_CONFIG.waterY - WORLD_CONFIG.godRayHeight / 2 - 1.5,
      offsetZ,
    );
    scene.add(rayMesh);
    godRays.push({ mesh: rayMesh, offsetX, offsetZ });
  }

  // --- Partikel ---
  const PARTICLE_COUNT = WORLD_CONFIG.particleCount;
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
  const particleBuffer = new Float32Array(PARTICLE_COUNT * 3);
  for (let i = 0; i < PARTICLE_COUNT; i++) {
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
  scene.add(particles);
  const particlePositions = particleGeo.getAttribute(
    "position",
  ) as THREE.BufferAttribute;
  const particleArr = particlePositions.array as Float32Array;

  // --- Chunk-Manager ---
  const chunkConfig: ChunkManagerConfig = {
    chunkSize: WORLD_CONFIG.chunkSize,
    floorY: WORLD_CONFIG.floorY,
    duneHeight: WORLD_CONFIG.duneHeight,
    seegrassCount: WORLD_CONFIG.seegrassCount,
    renderDistance: WORLD_CONFIG.renderDistance,
  };
  const chunkManager = new ChunkManager(scene, chunkConfig);

  // --- Fisch-System ---
  const fishWorld = new FishWorld(scene, {
    floorY: WORLD_CONFIG.floorY,
    waterY: WORLD_CONFIG.waterY,
    worldRadius: WORLD_CONFIG.renderDistance * WORLD_CONFIG.chunkSize + 8,
  });
  await fishWorld.init(camera.position);

  // --- Quallen-System ---
  const jellyWorld = new JellyWorld(scene, {
    floorY: WORLD_CONFIG.floorY,
    waterY: WORLD_CONFIG.waterY,
  });
  await jellyWorld.init(camera.position);

  // --- Stadtmodelle ---
  const cityWorld = new CityWorld(scene, WORLD_CONFIG.floorY);
  await cityWorld.init();

  // --- Korallenriffe ---
  const coralReefWorld = new CoralReefWorld(scene, WORLD_CONFIG.floorY);
  await coralReefWorld.init();

  // --- Leitsystem ---
  const guidanceSystem = new GuidanceSystem(scene, WORLD_CONFIG.floorY);

  // --- Unterwasser-Scheinwerfer ---
  const submarineSpotlight = new SubmarineSpotlight(scene);

  // --- Biolumineszenz ---
  const bioParticles = new BioParticles(scene);

  // -------------------------------------------------------------------------
  // Globale Referenzen setzen (für disposeWorld-Kompatibilität)
  // -------------------------------------------------------------------------
  _renderer = renderer;
  _scene = scene;
  _camera = camera;
  _listener = listener;
  _ambientSound = ambientSound;
  _ambientLight = ambientLight;
  _sunLight = sunLight;
  _fillLight = fillLight;
  _waterSurface = waterSurface;
  _godRays = godRays;
  _particles = particles;
  _particlePositions = particlePositions;
  _particleArr = particleArr;
  _chunkManager = chunkManager;
  _fishWorld = fishWorld;
  _jellyWorld = jellyWorld;
  _cityWorld = cityWorld;
  _coralReefWorld = coralReefWorld;
  _guidanceSystem = guidanceSystem;
  _submarineSpotlight = submarineSpotlight;
  _bioParticles = bioParticles;

  return {
    scene,
    camera,
    renderer,
    chunkManager,
    fishWorld,
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
    ambientSound,
    listener,
    ambientLight,
    sunLight,
    fillLight,
    sceneFog: scene.fog as THREE.Fog,
  };
}

// ---------------------------------------------------------------------------
// updateWorld – Per-Frame-Updates (shared Standalone + Catalog)
// ---------------------------------------------------------------------------

export function updateWorld(
  state: UnderwaterWorldState,
  delta: number,
  elapsed: number,
): void {
  const {
    camera,
    chunkManager,
    fishWorld,
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
  } = state;

  // Tiefenabhängige Helligkeit
  const depthRange = WORLD_CONFIG.waterY - WORLD_CONFIG.floorY;
  const surfaceT = (camera.position.y - WORLD_CONFIG.floorY) / depthRange;
  const lightFactor = surfaceT * surfaceT;
  ambientLight.intensity = 0.6 + lightFactor * 1.2;
  sunLight.intensity = 0.8 + lightFactor * 2.7;
  fillLight.intensity = 0.3 + lightFactor * 0.9;
  sceneFog.near = 4 + lightFactor * 8;
  sceneFog.far = 24 + lightFactor * 40;

  // Chunks
  chunkManager.update(camera.position.x, camera.position.z);

  // Städte + Korallen
  cityWorld.update(delta, camera.position.x, camera.position.z);
  coralReefWorld.update(delta, camera.position.x, camera.position.z);

  // Leitsystem
  guidanceSystem.update(
    delta,
    elapsed,
    camera.position,
    cityWorld.getActiveCityPositions(),
  );

  // Scheinwerfer
  submarineSpotlight.update(camera);

  // Biolumineszenz
  bioParticles.update(camera.position);

  // Exklusionszonen
  const exclusionZones = cityWorld.getExclusionZones();
  fishWorld.setExclusionZones(exclusionZones, camera.position);
  jellyWorld.setExclusionZones(exclusionZones, camera.position);
  chunkManager.setExclusionZones(exclusionZones);
  coralReefWorld.setExclusionZones(exclusionZones);

  // Fische + Quallen
  fishWorld.update(delta, elapsed, camera.position, jellyWorld.getEchoTargets());
  jellyWorld.update(delta, elapsed, camera.position);

  // Wasser folgt der Kamera
  const distX = camera.position.x - waterSurface.position.x;
  const distZ = camera.position.z - waterSurface.position.z;
  const threshold = 2;
  if (Math.abs(distX) > threshold) {
    waterSurface.position.x += distX * 0.05;
  }
  if (Math.abs(distZ) > threshold) {
    waterSurface.position.z += distZ * 0.05;
  }

  // God Rays folgen dem Wasser
  for (const ray of godRays) {
    ray.mesh.position.x = waterSurface.position.x + ray.offsetX;
    ray.mesh.position.z = waterSurface.position.z + ray.offsetZ;
  }

  // Partikel-Wrap-Around
  const halfBox = PARTICLE_BOX / 2;
  const pp = particles.position;
  let particlesWrapped = false;
  const count = particleArr.length / 3;
  for (let i = 0; i < count; i++) {
    const idx = i * 3;
    const worldX = pp.x + particleArr[idx];
    const worldZ = pp.z + particleArr[idx + 2];
    const relX = worldX - camera.position.x;
    const relZ = worldZ - camera.position.z;
    if (relZ < -halfBox) {
      particleArr[idx + 2] += PARTICLE_BOX;
      particlesWrapped = true;
    }
    if (relZ > halfBox) {
      particleArr[idx + 2] -= PARTICLE_BOX;
      particlesWrapped = true;
    }
    if (relX < -halfBox) {
      particleArr[idx] += PARTICLE_BOX;
      particlesWrapped = true;
    }
    if (relX > halfBox) {
      particleArr[idx] -= PARTICLE_BOX;
      particlesWrapped = true;
    }
  }
  if (particlesWrapped) {
    particlePositions.needsUpdate = true;
  }

  // Periodisches Re-Centering der Partikel
  _frameCount++;
  if (_frameCount > 200) {
    _frameCount = 0;
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
// updatePlayer – ICAROS-Controller-Steuerung (Catalog-Pfad)
// ---------------------------------------------------------------------------

const PLAYER_LERP = 0.15;          // Glättungsfaktor für Pitch/Roll
const ROLL_HEADING_MULT = 1.0;     // Wie stark Roll die Richtung ändert
const FLOAT_SPEED_FACTOR = 0.25;   // Basis-Geschwindigkeit relativ zu moveSpeed (sanftes Floaten)
const ACCEL_BOOST = 2.0;           // Geschwindigkeits-Multiplikator bei Accelerate
const BRAKE_FACTOR = 0.25;         // Geschwindigkeits-Multiplikator bei Brake

export function updatePlayer(
  orientation: { pitch: number; roll: number },
  speed: { accelerate: boolean; brake: boolean },
  state: UnderwaterWorldState,
  delta: number,
): void {
  // Sanftes Interpolieren der Controller-Werte (Rauschunterdrückung)
  _playerPitch += (orientation.pitch - _playerPitch) * PLAYER_LERP;
  _playerRoll += (orientation.roll - _playerRoll) * PLAYER_LERP;

  // Roll in Heading umwandeln (Banking = Kurvenflug)
  _heading -= _playerRoll * THREE.MathUtils.DEG2RAD * ROLL_HEADING_MULT * delta;

  // Geschwindigkeit: sanft an Ziel annähern
  let targetSpeed = WORLD_CONFIG.moveSpeed * FLOAT_SPEED_FACTOR;
  if (speed.accelerate) targetSpeed *= ACCEL_BOOST;
  else if (speed.brake) targetSpeed *= BRAKE_FACTOR;
  _playerSpeed += (targetSpeed - _playerSpeed) * Math.min(1, 3 * delta);

  // Forward-Vektor aus Heading + Pitch (sphärische Koordinaten)
  const pitchRad = _playerPitch * THREE.MathUtils.DEG2RAD;
  const headingRad = _heading;
  const forward = new THREE.Vector3(
    -Math.sin(headingRad) * Math.cos(pitchRad),
    -Math.sin(pitchRad),
    -Math.cos(headingRad) * Math.cos(pitchRad),
  );
  forward.normalize();

  // Kamera bewegen
  state.camera.position.addScaledVector(forward, _playerSpeed * delta);

  // Kamera-Rotation setzen (für Non-VR-Modus)
  state.camera.rotation.set(-pitchRad, headingRad, -_playerRoll * THREE.MathUtils.DEG2RAD, "YXZ");

  // Y-Begrenzung (Meeresboden ↔ Wasseroberfläche)
  const minY = WORLD_CONFIG.floorY + 0.5;
  const maxY = WORLD_CONFIG.waterY - 0.3;
  if (state.camera.position.y < minY) state.camera.position.y = minY;
  if (state.camera.position.y > maxY) state.camera.position.y = maxY;
}

// ---------------------------------------------------------------------------
// destroyWorld – Räumt Weltobjekte auf (ohne Renderer/Canvas/Input)
// ---------------------------------------------------------------------------

export function destroyWorld(state: UnderwaterWorldState): void {
  state.chunkManager.dispose();
  state.fishWorld.dispose();
  state.jellyWorld.dispose();
  state.cityWorld.dispose();
  state.coralReefWorld.dispose();
  state.guidanceSystem.dispose();
  state.submarineSpotlight.dispose();
  state.bioParticles.dispose();

  state.ambientSound.stop();
  state.ambientSound.removeFromParent();

  state.particles.removeFromParent();
  state.particles.geometry?.dispose();
  (state.particles.material as any)?.dispose();

  state.waterSurface.removeFromParent();
  state.waterSurface.geometry?.dispose();
  (state.waterSurface.material as any)?.dispose();

  // Player-Status zurücksetzen
  _playerPitch = 0;
  _playerRoll = 0;
  _heading = 0;
  _playerSpeed = WORLD_CONFIG.moveSpeed;

  // Globals nullen (für disposeWorld-Kompatibilität)
  _godRays = [];
  _chunkManager = null;
  _fishWorld = null;
  _jellyWorld = null;
  _cityWorld = null;
  _coralReefWorld = null;
  _guidanceSystem = null;
  _submarineSpotlight = null;
  _bioParticles = null;
  _waterSurface = null;
  _particles = null;
  _particlePositions = null;
  _particleArr = null;
  _ambientSound = null;
  _listener = null;
  _ambientLight = null;
  _sunLight = null;
  _fillLight = null;
  _sceneFog = null;
  _scene = null;
  _camera = null;
  _renderer = null;
}
