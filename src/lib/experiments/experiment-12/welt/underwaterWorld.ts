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
  waterY: 15, // Deutlich höher – mehr Tiefe zwischen Boden und Oberfläche
  waterSize: 100,
  waterSegments: 70, // Von 100 reduziert – ~50% weniger Vertex-Arbeit im Wellenshader

  // --- God Rays ---
  godRayCount: 6, // Von 10 reduziert – weniger additive Overlays = weniger Ruckeln
  godRayHeight: 20, // Vom Wasser bis fast zum Boden (angepasst an höheres Wasser)

  // --- Partikel ---
  particleCount: 400, // Weniger Partikel = schöner, performanter

  // --- Kamera & Bewegung ---
  cameraFov: 65, // Wie exp-11
  cameraNear: 0.1,
  cameraFar: 45, // Leicht über renderDistance=2 (40 Einheiten) für weichen Übergang
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

// ---------------------------------------------------------------------------
// Initialisierung
// ---------------------------------------------------------------------------

export async function initWorld(container: HTMLElement): Promise<void> {
  // =========================================================================
  // 1. Szene – Tiefsee-Hintergrund & Nebel (wie exp-11 deepsea)
  // =========================================================================
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#000814"); // Fast schwarz-blau
  const sceneFog = new THREE.Fog("#000a1a", 4, 16); // Kurze Sicht: 4-16 Einheiten
  scene.fog = sceneFog;

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
  // 3. Audio – Unterwasser-Atmosphäre (loopend, dezent)
  // =========================================================================
  const listener = new THREE.AudioListener();
  camera.add(listener);

  const ambientSound = new THREE.Audio(listener);
  const audioLoader = new THREE.AudioLoader();
  let audioStarted = false;
  audioLoader.load("/sounds/ambiente unterwasser.mp3", (buffer) => {
    ambientSound.setBuffer(buffer);
    ambientSound.setLoop(true);
    ambientSound.setVolume(0.4);
    // play() wird beim ersten Mausklick aufgerufen (Autoplay-Policy)
  });

  // =========================================================================
  // 4. WebGPU-Renderer – mit ACES Tone-Mapping (wie exp-11)
  // =========================================================================
  const renderer = new THREE.WebGPURenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping; // Wie exp-11
  renderer.toneMappingExposure = 1.0; // Heller als pure Tiefsee (0.7), damit Boden sichtbar
  renderer.shadowMap.enabled = false;
  container.appendChild(renderer.domElement);

  await renderer.init();

  // =========================================================================
  // 5. WASD + Maus-Steuerung
  // =========================================================================
  _keys = {};
  _euler = new THREE.Euler(0, 0, 0, "YXZ");

  window.addEventListener("keydown", (e) => {
    _keys[e.code] = true;
  });
  window.addEventListener("keyup", (e) => {
    _keys[e.code] = false;
  });

  renderer.domElement.addEventListener("click", () => {
    renderer.domElement.requestPointerLock();
    // AudioContext nach User-Interaktion starten (Autoplay-Policy)
    listener.context.resume();
    if (!audioStarted) {
      audioStarted = true;
      ambientSound.play();
    }
  });

  document.addEventListener("mousemove", (e) => {
    if (document.pointerLockElement !== renderer.domElement) return;
    _euler.setFromQuaternion(camera.quaternion);
    _euler.y -= e.movementX * WORLD_CONFIG.mouseSensitivity;
    _euler.x -= e.movementY * WORLD_CONFIG.mouseSensitivity;
    _euler.x = Math.max(-Math.PI * 0.45, Math.min(Math.PI * 0.45, _euler.x));
    camera.quaternion.setFromEuler(_euler);
  });

  // =========================================================================
  // 6. Beleuchtung – Tiefsee: extrem dunkel (wie exp-11 deepsea)
  // =========================================================================

  // Ambient: angehoben, damit der Sandboden sichtbar ist
  const ambientLight = new THREE.AmbientLight("#1a3355", 1.2);
  scene.add(ambientLight);

  // Sun: etwas heller für den Boden
  const sunLight = new THREE.DirectionalLight("#3366aa", 1.5);
  sunLight.position.set(4, 10, 2);
  scene.add(sunLight);

  // Fill: etwas heller
  const fillLight = new THREE.DirectionalLight("#223355", 0.6);
  fillLight.position.set(-4, 2, -3);
  scene.add(fillLight);

  // =========================================================================
  // 7. Wasseroberfläche – Tiefsee: fast schwarz, hohe Opazität (wie exp-11)
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
  scene.add(waterSurface);

  // =========================================================================
  // 8. God Rays – Tiefsee: sehr schwach, kaltes Blau (wie exp-11)
  // =========================================================================
  const godRays: GodRayInstance[] = [];

  for (let i = 0; i < WORLD_CONFIG.godRayCount; i++) {
    const angle = (i / WORLD_CONFIG.godRayCount) * Math.PI * 2;
    const radius = 2 + Math.random() * 4;
    const offsetX = Math.cos(angle) * radius;
    const offsetZ = Math.sin(angle) * radius;

    const rayMesh = createGodRay(
      {
        brightness: 0.08 + Math.random() * 0.15, // Sehr schwach (exp-11: 0.15)
        softness: 1.2 + Math.random() * 0.6, // Sehr weich (exp-11: 1.5)
        reach: 0.3 + Math.random() * 0.2, // Kurz (exp-11: 0.4)
        wobble: 0.05 + Math.random() * 0.1, // Kaum wobble (exp-11: 0.1)
        rayColor: new THREE.Color("#3366aa"), // Kaltes Blau (wie exp-11)
      },
      0.15 + Math.random() * 0.2,
      0.03 + Math.random() * 0.05,
      WORLD_CONFIG.godRayHeight,
    );

    // 1.5 Einheiten unter Wasseroberfläche – vermeidet hartes Durchscheinen
    // durch die Wasseroberfläche (AdditiveBlending + depthWrite=false)
    rayMesh.position.set(
      offsetX,
      WORLD_CONFIG.waterY - WORLD_CONFIG.godRayHeight / 2 - 1.5,
      offsetZ,
    );
    scene.add(rayMesh);
    godRays.push({ mesh: rayMesh, offsetX, offsetZ });
  }

  // =========================================================================
  // 9. Partikel – Eigenes Material ohne Y-Drift, mit Wrap-Around
  // =========================================================================
  const PARTICLE_BOX = 40;
  const PARTICLE_COUNT = WORLD_CONFIG.particleCount;

  // Eigenes Partikel-Material – KEIN Y-Drift (kein time.mul(0.02)!).
  // Nur sanftes Wabern in X und Z, Y bleibt wo es ist.
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

  // Partikel-Geometrie
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

  // Referenz auf das Positions-Attribut für Wrap-Around
  const particlePositions = particleGeo.getAttribute(
    "position",
  ) as THREE.BufferAttribute;
  const particleArr = particlePositions.array as Float32Array;

  // =========================================================================
  // 10. Chunk-Manager – Tiefsee-Boden: dunkel, fast schwarz (wie exp-11)
  // =========================================================================
  //
  // WICHTIG: Das Boden-Material wird in terrainChunk.ts erstellt.
  // Wir überschreiben die Farbe NACH dem ersten Chunk-Load, damit
  // sie der Tiefsee-Vorlage entspricht.
  const chunkConfig: ChunkManagerConfig = {
    chunkSize: WORLD_CONFIG.chunkSize,
    floorY: WORLD_CONFIG.floorY,
    duneHeight: WORLD_CONFIG.duneHeight,
    seegrassCount: WORLD_CONFIG.seegrassCount,
    renderDistance: WORLD_CONFIG.renderDistance,
  };

  const chunkManager = new ChunkManager(scene, chunkConfig);

  // =========================================================================
  // 11. Fisch-System (Einzelfische + Boids-Schwärme)
  // =========================================================================
  const fishWorld = new FishWorld(scene, {
    floorY: WORLD_CONFIG.floorY,
    waterY: WORLD_CONFIG.waterY,
    worldRadius: WORLD_CONFIG.renderDistance * WORLD_CONFIG.chunkSize + 8,
  });
  await fishWorld.init(camera.position);

  // =========================================================================
  // 11b. Quallen-System (Mondquallen – einzeln oder in Gruppen)
  // =========================================================================
  const jellyWorld = new JellyWorld(scene, {
    floorY: WORLD_CONFIG.floorY,
    waterY: WORLD_CONFIG.waterY,
  });
  await jellyWorld.init(camera.position);

  // =========================================================================
  // 12. Stadtmodelle (dynamisch spawnen/despawnen wie Fische)
  // =========================================================================
  const cityWorld = new CityWorld(scene, WORLD_CONFIG.floorY);
  await cityWorld.init();

  // =========================================================================
  // 12b. Korallenriffe – zufällig außerhalb von Städten und Sichtfeld
  // =========================================================================
  const coralReefWorld = new CoralReefWorld(scene, WORLD_CONFIG.floorY);
  await coralReefWorld.init();

  // =========================================================================
  // 12c. Leitsystem – zeigt den Weg von einer Stadt zur nächsten
  // =========================================================================
  const guidanceSystem = new GuidanceSystem(scene, WORLD_CONFIG.floorY);

  // =========================================================================
  // 12d. Unterwasser-Scheinwerfer – folgt der Kamera (wie Bootsscheinwerfer)
  // =========================================================================
  const submarineSpotlight = new SubmarineSpotlight(scene);

  // =========================================================================
  // 12e. Biolumineszenz-Partikel – schweben um den Spieler herum
  // =========================================================================
  const bioParticles = new BioParticles(scene);

  // =========================================================================
  // Referenzen für disposeWorld speichern
  // =========================================================================
  _renderer = renderer;
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
  _sceneFog = sceneFog;
  _canvas = renderer.domElement;

  // =========================================================================
  // 13. Animation und Render-Loop
  // =========================================================================
  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  let lastTime = performance.now();
  let _frameCount = 0; // Für periodisches Partikel-Zentrieren
  const moveDir = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const startTime = performance.now(); // Für FishWorld-Elapsed

  function animate(): void {
    requestAnimationFrame(animate);

    const now = performance.now();
    const delta = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;
    const elapsed = (now - startTime) / 1000; // Gesamtzeit in Sekunden

    // --- Konstantes Vorwärts-Floaten (wie Unterwasser-Strömung) ---
    //     Der Spieler driftet immer sanft in Blickrichtung.
    //     Wird SEPARAT von WASD angewendet, damit normalize()
    //     den Float-Wert nicht zerstört.
    camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    right.crossVectors(forward, camera.up).normalize();

    // Sanftes Floaten: unabhängig von WASD
    camera.position.add(forward.clone().multiplyScalar(0.9 * delta));

    // WASD-Bewegung
    moveDir.set(0, 0, 0);

    if (_keys["KeyW"]) moveDir.add(forward);
    if (_keys["KeyS"]) moveDir.sub(forward);
    if (_keys["KeyA"]) moveDir.sub(right);
    if (_keys["KeyD"]) moveDir.add(right);
    if (_keys["KeyQ"]) moveDir.y -= 1;
    if (_keys["KeyE"] || _keys["Space"]) moveDir.y += 1;

    let speed = WORLD_CONFIG.moveSpeed;
    if (_keys["ShiftLeft"] || _keys["ShiftRight"]) {
      speed *= WORLD_CONFIG.sprintMultiplier;
    }

    if (moveDir.lengthSq() > 0) {
      moveDir.normalize().multiplyScalar(speed * delta);
      camera.position.add(moveDir);
    }

    // --- Grenzen ---
    if (camera.position.y < WORLD_CONFIG.floorY + 0.5) {
      camera.position.y = WORLD_CONFIG.floorY + 0.5;
    }
    if (camera.position.y > WORLD_CONFIG.waterY - 0.3) {
      camera.position.y = WORLD_CONFIG.waterY - 0.3;
    }

    // --- Tiefenabhängige Helligkeit (Auftauchen) ---
    //     Je näher an der Wasseroberfläche, desto heller wird die Szene.
    //     Simuliert, wie Sonnenlicht durchs Wasser dringt – je tiefer,
    //     desto mehr Licht wird absorbiert.
    const depthRange = WORLD_CONFIG.waterY - WORLD_CONFIG.floorY;
    const surfaceT = (camera.position.y - WORLD_CONFIG.floorY) / depthRange;
    // 0 = am Boden, 1 = an der Wasseroberfläche
    // Quadratische Kurve: unten bleibt es länger dunkel, oben hellt es schnell auf
    const lightFactor = surfaceT * surfaceT;
    ambientLight.intensity = 0.6 + lightFactor * 1.2;
    sunLight.intensity = 0.8 + lightFactor * 2.7;
    fillLight.intensity = 0.3 + lightFactor * 0.9;
    // Nebel lichtet sich: je höher, desto weiter siehst du
    sceneFog.near = 4 + lightFactor * 10;
    sceneFog.far = 16 + lightFactor * 24;

    // --- Chunks ---
    chunkManager.update(camera.position.x, camera.position.z);

    // --- Debug ---
    const debugEl = document.getElementById("debug");
    if (debugEl) {
      debugEl.textContent =
        `Chunks: ${chunkManager.loadedCount} | ` +
        `XZ: ${camera.position.x.toFixed(0)},${camera.position.z.toFixed(0)} | ` +
        `Y: ${camera.position.y.toFixed(1)}`;
    }

    // --- Partikel-Wrap: hinten rausgefallene vorne einfügen ---
    //     WICHTIG: particleArr sind LOKALE Koordinaten (relativ zu
    //     particles.position). Wir müssen sie in WELT-Koordinaten
    //     umrechnen, bevor wir den Abstand zur Kamera prüfen.
    //     Sonst stimmt der Vergleich nach einem Re-Centering nicht mehr!
    //     needsUpdate wird NUR gesetzt wenn sich wirklich was geändert hat,
    //     sonst wird der GPU-Buffer unnötig jeden Frame neu geladen (→ Ruckeln).
    const halfBox = PARTICLE_BOX / 2;
    const pp = particles.position; // Welt-Position des Points-Objekts
    let particlesWrapped = false;
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      // Welt-Koordinaten des Partikels berechnen
      const worldX = pp.x + particleArr[i * 3];
      const worldZ = pp.z + particleArr[i * 3 + 2];
      const relX = worldX - camera.position.x;
      const relZ = worldZ - camera.position.z;

      // Partikel im lokalen Koordinatensystem wrappen
      if (relZ < -halfBox) { particleArr[i * 3 + 2] += PARTICLE_BOX; particlesWrapped = true; }
      if (relZ > halfBox) { particleArr[i * 3 + 2] -= PARTICLE_BOX; particlesWrapped = true; }
      if (relX < -halfBox) { particleArr[i * 3] += PARTICLE_BOX; particlesWrapped = true; }
      if (relX > halfBox) { particleArr[i * 3] -= PARTICLE_BOX; particlesWrapped = true; }
    }
    if (particlesWrapped) {
      particlePositions.needsUpdate = true;
    }

    // Periodisch das Points-Objekt + Partikel auf die Kamera zentrieren.
    // Verhindert, dass positionLocal im TSL-Shader ins Unermessliche wächst.
    _frameCount++;
    if (_frameCount > 200) {
      _frameCount = 0;
      const cx = Math.round(camera.position.x);
      const cz = Math.round(camera.position.z);
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        particleArr[i * 3] -= cx;
        particleArr[i * 3 + 2] -= cz;
      }
      particlePositions.needsUpdate = true;
      particles.position.x += cx;
      particles.position.z += cz;
    }

    // --- Städte: dynamisch spawnen/despawnen ---
    cityWorld.update(delta, camera.position.x, camera.position.z);

    // --- Korallenriffe: dynamisch spawnen/despawnen + Fische animieren ---
    coralReefWorld.update(delta, camera.position.x, camera.position.z);

    // --- Leitsystem: Pfad vom Spieler zur nächsten Stadt ---
    guidanceSystem.update(delta, elapsed, camera.position, cityWorld.getActiveCityPositions());

    // --- Scheinwerfer: folgt der Kamera-Blickrichtung ---
    submarineSpotlight.update(camera);

    // --- Biolumineszenz: Partikel folgen der Kamera ---
    bioParticles.update(camera.position);

    // Exklusionszonen für Fische + Chunks + Korallen aktualisieren
    // WICHTIG: Das muss VOR fishWorld.update() passieren, damit neu gespawnte
    // Städte sofort ihre ExclusionZones haben und Fische nicht durch Kuppeln schwimmen.
    // Die Kameraposition wird für sofortige Repositionierung von Fischen in Zonen benötigt.
    const exclusionZones = cityWorld.getExclusionZones();
    fishWorld.setExclusionZones(exclusionZones, camera.position);
    jellyWorld.setExclusionZones(exclusionZones, camera.position);
    chunkManager.setExclusionZones(exclusionZones);
    coralReefWorld.setExclusionZones(exclusionZones);

    // --- Fische aktualisieren (mit Kameraposition für Respawn) ---
    fishWorld.update(delta, elapsed, camera.position);

    // --- Quallen aktualisieren (einzeln oder in Gruppen) ---
    jellyWorld.update(delta, elapsed, camera.position);

    // --- Wasser & Rays: sanft folgen wie bisher ---
    const distX = camera.position.x - waterSurface.position.x;
    const distZ = camera.position.z - waterSurface.position.z;
    const threshold = 2;

    if (Math.abs(distX) > threshold) {
      waterSurface.position.x += distX * 0.05;
    }
    if (Math.abs(distZ) > threshold) {
      waterSurface.position.z += distZ * 0.05;
    }

    for (const ray of godRays) {
      ray.mesh.position.x = waterSurface.position.x + ray.offsetX;
      ray.mesh.position.z = waterSurface.position.z + ray.offsetZ;
    }

    renderer.render(scene, camera);
  }

  animate();

  // =========================================================================
  // Debug
  // =========================================================================
  (window as any).__scene = scene;
  (window as any).__chunkManager = chunkManager;
  (window as any).__camera = camera;
  (window as any).__fishWorld = fishWorld;
  (window as any).__jellyWorld = jellyWorld;
  (window as any).__cityWorld = cityWorld;
  (window as any).__guidanceSystem = guidanceSystem;
  (window as any).__coralReefWorld = coralReefWorld;
  (window as any).__submarineSpotlight = submarineSpotlight;
  (window as any).__bioParticles = bioParticles;

  console.log("🌑 Tiefsee-Unterwasserwelt gestartet!");
  console.log("   WASD = bewegen | Maus = schauen | Q/E = hoch/runter");
  console.log("   Shift = sprinten | Klick = Maus sperren");
  console.log(`   Chunks: ${chunkManager.loadedCount}`);
  console.log(`   🐟 Fische: Einzelfische + Schwärme (Boids)`);
  console.log(`   🪼 Quallen: Mondquallen (einzeln oder in Gruppen)`);
  console.log(`   🏙️ Städte: dynamisch per Spawn-Punkte`);
  console.log(`   🪸 Korallenriffe: zufällig außerhalb von Kuppeln`);
  console.log(`   🧭 Leitsystem: Pfad zwischen Städten aktiv`);
  console.log(`   🔦 Scheinwerfer: Kamera-SpotLight aktiv`);
  console.log(`   ✨ Biolumineszenz-Partikel um den Spieler aktiv`);
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

export function disposeWorld(): void {
  if (_animFrameId !== null) {
    cancelAnimationFrame(_animFrameId);
    _animFrameId = null;
  }

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
