/**
 * shark-swim.ts – Schwimmender Hai (Experiment 06)
 *
 * Lädt das Shark.glb 3D-Modell und animiert einen realistischen
 * Schwimmzyklus basierend auf echter Hai-Biomechanik.
 *
 * Unterschiede zum Delfin (dorsoventrale Undulation):
 * - Haie schwimmen mit LATERALER Undulation (Yaw):
 *   Die Schwanzflosse schlägt horizontal (von links nach rechts),
 *   nicht vertikal wie beim Delfin.
 * - Die Körperwelle beginnt am Kopf (fast ruhig) und wird zum
 *   Schwanz hin immer stärker.
 * - Kein "Porpoising": Haie bleiben unter Wasser.
 * - Langsame, gleitende Cruising-Bewegungen auf weiten Bahnen.
 * - Heterozerke Schwanzflosse (oberer Lappen größer) erzeugt
 *   passiven Auftrieb.
 *
 * Technik: WebGPU + GLTFLoader + OrbitControls
 */

import * as THREE from "three/webgpu";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

// ---------------------------------------------------------------------------
// Haupt-Initialisierung (async wegen WebGPU)
// ---------------------------------------------------------------------------

async function init(): Promise<void> {
  // =========================================================================
  // 1. Szene, Kamera & Renderer
  // =========================================================================

  // Szene – unsere Unterwasserwelt
  const scene = new THREE.Scene();

  // Hintergrund: tiefes Ozean-Blau (etwas dunkler für Hai-Atmosphäre)
  scene.background = new THREE.Color(0x001428);

  // Dunst-Effekt (Fog) für Tiefenwirkung unter Wasser
  scene.fog = new THREE.Fog(0x001428, 30, 200);

  // Kamera: Perspektive für den Hai
  const camera = new THREE.PerspectiveCamera(
    55,
    window.innerWidth / window.innerHeight,
    0.5,
    500,
  );
  camera.position.set(0, 40, 120);
  camera.lookAt(0, 0, 0);

  // WebGPU-Renderer
  const renderer = new THREE.WebGPURenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0; // Etwas dunkler: Hai lebt in tieferen Gewässern
  document.body.appendChild(renderer.domElement);

  // WebGPU initialisieren (muss VOR dem ersten render() passieren!)
  await renderer.init();
  console.log("✅ WebGPU initialisiert!");

  // =========================================================================
  // 2. OrbitControls – Kamera mit Maus drehen/zoomen
  // =========================================================================

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, -10, 0); // Kamera schaut auf Hai-Tiefe (tiefer als Delfin)
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 15;
  controls.maxDistance = 300;
  controls.maxPolarAngle = Math.PI * 0.7;
  controls.update();

  // =========================================================================
  // 3. Beleuchtung (Düsterere Unterwasser-Atmosphäre)
  // =========================================================================

  // Ambient – weniger Streulicht, düsterer
  const ambientLight = new THREE.AmbientLight(0x1a3355, 0.8);
  scene.add(ambientLight);

  // Haupt-Licht von oben – weniger intensiv (tieferes Wasser)
  const sunLight = new THREE.DirectionalLight(0x88aacc, 3);
  sunLight.position.set(30, 80, 20);
  scene.add(sunLight);

  // Füll-Licht von der Seite für mehr Tiefe
  const fillLight = new THREE.DirectionalLight(0x224466, 1.2);
  fillLight.position.set(-20, -10, -30);
  scene.add(fillLight);

  // =========================================================================
  // 4. Unterwasser-Boden & Umgebung
  // =========================================================================

  // Großer Meeresboden
  const floorGeometry = new THREE.PlaneGeometry(400, 400);
  const floorMaterial = new THREE.MeshStandardMaterial({
    color: 0x0f2233,
    roughness: 0.9,
    metalness: 0.0,
  });
  const floor = new THREE.Mesh(floorGeometry, floorMaterial);
  floor.rotation.x = -Math.PI / 2; // Flach auf den Boden legen
  floor.position.y = -60;
  floor.receiveShadow = true;
  scene.add(floor);

  // Dezentes Gitter für räumliche Orientierung
  const gridHelper = new THREE.GridHelper(300, 40, 0x1a3355, 0x0f1a2a);
  gridHelper.position.y = -59;
  scene.add(gridHelper);

  // =========================================================================
  // 5. Wasseroberfläche – höher, da Hai tiefer schwimmt
  // =========================================================================

  const surfaceGeometry = new THREE.PlaneGeometry(400, 400);
  const surfaceMaterial = new THREE.MeshStandardMaterial({
    color: 0x225588,
    roughness: 0.3,
    metalness: 0.1,
    transparent: true,
    opacity: 0.2,
    side: THREE.DoubleSide,
  });
  const waterSurface = new THREE.Mesh(surfaceGeometry, surfaceMaterial);
  waterSurface.rotation.x = -Math.PI / 2;
  waterSurface.position.y = 40; // Wasseroberfläche höher, Hai tiefer drunter
  scene.add(waterSurface);

  // =========================================================================
  // 6. Hai-Modell laden
  // =========================================================================

  // Der Hai wird in diese Gruppe eingefügt
  const sharkGroup = new THREE.Group();
  scene.add(sharkGroup);

  let sharkModel: THREE.Group | null = null;

  const loader = new GLTFLoader();
  console.log("🦈 Lade Hai-Modell...");

  loader.load(
    "/3D Modelle/Shark.glb",
    (gltf) => {
      console.log("✅ Hai-Modell geladen!");
      sharkModel = gltf.scene;

      // Bounding-Box berechnen für exakte Skalierung
      // Der Hai aus der GLB: ~3.9 breit, ~1.1 hoch, ~6.5 tief (in etwa)
      const box = new THREE.Box3().setFromObject(sharkModel);
      const size = new THREE.Vector3();
      box.getSize(size);
      console.log(
        `   Original-Größe: ${size.x.toFixed(1)} × ${size.y.toFixed(1)} × ${size.z.toFixed(1)}`,
      );

      // Ziel-Länge: 25 Einheiten
      const targetLength = 25;
      const longestAxis = Math.max(size.x, size.y, size.z);
      const scaleFactor = targetLength / longestAxis;
      sharkModel.scale.setScalar(scaleFactor);

      // Hai zur Gruppe hinzufügen
      sharkGroup.add(sharkModel);

      // Schatten aktivieren
      sharkModel.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      console.log(
        `   Skaliert auf ~${targetLength} Einheiten (Faktor ${scaleFactor.toFixed(3)})`,
      );
    },
    (progress) => {
      if (progress.total > 0) {
        const pct = Math.round((progress.loaded / progress.total) * 100);
        console.log(`   Lade... ${pct}%`);
      }
    },
    (error) => {
      console.error("❌ Fehler beim Laden des Hai-Modells:", error);
    },
  );

  // =========================================================================
  // 7. Partikel (Plankton/Schwebeteilchen für Tiefsee-Atmosphäre)
  // =========================================================================

  const particleCount = 250;
  const particleGeo = new THREE.BufferGeometry();
  const particlePositions = new Float32Array(particleCount * 3);

  for (let i = 0; i < particleCount; i++) {
    particlePositions[i * 3] = (Math.random() - 0.5) * 250; // X
    particlePositions[i * 3 + 1] = Math.random() * 120 - 70; // Y: -70..50 (tieferer Bereich)
    particlePositions[i * 3 + 2] = (Math.random() - 0.5) * 250; // Z
  }

  particleGeo.setAttribute(
    "position",
    new THREE.BufferAttribute(particlePositions, 3),
  );

  const particleMat = new THREE.PointsMaterial({
    color: 0x667788,
    size: 0.25,
    transparent: true,
    opacity: 0.6,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const particles = new THREE.Points(particleGeo, particleMat);
  scene.add(particles);

  // =========================================================================
  // 8. Animations-Parameter (Hai-Schwimmverhalten)
  // =========================================================================

  /**
   * Haie schwimmen mit LATERALER Undulation:
   * - Die Körperwelle läuft horizontal (Yaw), nicht vertikal (Pitch)
   * - Der Kopf bleibt fast ruhig – die Amplitude steigt zum Schwanz hin
   * - Frequenz: ~0,5–1 Yaw-Schlag pro Sekunde (langsamer als Delfin)
   * - Lange Gleitphasen zwischen aktiven Schwimmbewegungen
   * - Kein Porpoising: Haie bleiben unter Wasser
   * - Cruising-Tiefe variiert langsam (wie ein patrouillierender Hai)
   *
   * Unsere Animation:
   * - Elliptische Cruising-Bahn mit großer Reichweite
   * - Sinusförmige Yaw-Oszillation für lateralen Schwanzschlag
   * - Sehr subtile Pitch-Variation (nur leichte Tiefenänderungen)
   * - Roll für natürliches Kurvenverhalten
   */

  // Schwimm-Parameter – angepasst für Hai-Verhalten
  const swimRadiusX = 70; // Größere Ellipse: Hai cruised weite Strecken
  const swimRadiusZ = 50; // Z-Radius
  const swimSpeed = 0.15; // Langsamer: Haie gleiten energiesparend
  const yawAmplitude = 0.09; // Stärke des lateralen Schwanzschlags (Yaw)
  const yawFrequency = 0.45; // ~1 Yaw-Schlag alle 2.2s (entspannter Rhythmus)
  const pitchAmplitude = 0.03; // Sehr dezente vertikale Kopfbewegung
  const pitchFrequency = 0.2; // Langsame Tiefenvariation
  const depthVariationAmplitude = 8; // Sanfter Tiefenwechsel beim Cruisen
  const depthVariationFrequency = 0.08; // Sehr langsame Tiefenwanderung
  const rollAmplitude = 0.1; // Etwas mehr Roll in Kurven (größerer Körper)

  // Lerp-Speicher – sanfte Übergänge
  let currentYaw = 0;
  let currentPitch = 0;
  let currentRoll = 0;
  let currentY = -10; // Hai schwimmt tiefer als Delfin (~15–20m unter Oberfläche)
  const lerpSpeed = 3.5; // Etwas langsameres Lerp = trägerer, massigerer Eindruck

  // =========================================================================
  // 9. Animation-Loop
  // =========================================================================

  // THREE.Timer ersetzt den veralteten THREE.Clock (Three.js >= 0.184)
  const timer = new THREE.Timer();

  function animate(): void {
    requestAnimationFrame(animate);

    timer.update();
    const delta = Math.min(timer.getDelta(), 0.1);
    const elapsed = performance.now() / 1000; // Gesamtzeit in Sekunden

    // --- OrbitControls updaten ---
    controls.update();

    // --- Hai animieren (nur wenn Modell geladen) ---
    if (sharkModel && sharkGroup) {
      // === Cruising-Bahn (große Ellipse) ===
      const angle = elapsed * swimSpeed;
      const posX = Math.cos(angle) * swimRadiusX;
      const posZ = Math.sin(angle) * swimRadiusZ;

      // === Tiefenvariation (langsame Cruising-Tiefe) ===
      // Haie wechseln beim Patrouillieren sanft die Tiefe
      const depthOffset =
        Math.sin(elapsed * depthVariationFrequency * Math.PI * 2) *
        depthVariationAmplitude;
      const targetY = currentY + depthOffset; // Basis-Tiefe ~-10

      // === Yaw (lateraler Schwanzschlag) – DIE zentrale Hai-Bewegung ===
      // Haie bewegen den Schwanz von links nach rechts
      // Die Bewegung ist eine Sinus-Welle, die am Kopf beginnt (kaum Bewegung)
      // und zum Schwanz hin stärker wird.
      // Wir simulieren das mit einer Yaw-Oszillation:
      const targetYaw =
        Math.sin(elapsed * yawFrequency * Math.PI * 2) * yawAmplitude;

      // === Pitch (leichte vertikale Kopfbewegung) ===
      // Minimal – nur für Tiefenwechsel, viel dezenter als beim Delfin
      const targetPitch =
        Math.sin(elapsed * pitchFrequency * Math.PI * 2) * pitchAmplitude;

      // === Roll (Seitenneigung in Kurven) ===
      // In der Kurve neigt sich der Hai etwas nach innen
      const targetRoll =
        Math.cos(angle) * Math.sin(elapsed * 0.4) * rollAmplitude;

      // --- Sanftes Lerp (gleitende Interpolation) ---
      // Der Hai ist ein großes, träges Tier – langsames Lerp passt perfekt
      const lerpFactor = 1 - Math.exp(-lerpSpeed * delta);
      currentYaw += (targetYaw - currentYaw) * lerpFactor;
      currentPitch += (targetPitch - currentPitch) * lerpFactor;
      currentRoll += (targetRoll - currentRoll) * lerpFactor;

      // === Yaw (Drehung zum Folgen der Bahn) – Schwimmrichtung ===
      // Tangente an die Ellipse gibt die Blickrichtung
      const tangentX = -Math.sin(angle) * swimRadiusX;
      const tangentZ = Math.cos(angle) * swimRadiusZ;
      const baseYaw = Math.atan2(tangentX, tangentZ);

      // --- Transformationen anwenden ---
      // Position setzen
      sharkGroup.position.set(posX, targetY, posZ);

      // Rotation:
      // 1. Erst die Basis-Schwimmrichtung (baseYaw)
      // 2. Dann die laterale Undulation (currentYaw) obendrauf
      // 3. Pitch und Roll für natürliches Aussehen
      sharkGroup.rotation.set(0, 0, 0);
      sharkGroup.rotateY(baseYaw + currentYaw);
      sharkGroup.rotateX(currentPitch);
      sharkGroup.rotateZ(currentRoll);
    }

    // --- Plankton-Partikel animieren (langsam sinken/treiben) ---
    const partPos = particles.geometry.attributes.position
      .array as Float32Array;
    for (let i = 0; i < particleCount; i++) {
      // Langsames Treiben (nicht so stark aufsteigend wie Bläschen)
      partPos[i * 3 + 1] += delta * (Math.random() * 1.5 - 1.0); // Treiben ±
      partPos[i * 3] += delta * (Math.random() * 0.6 - 0.3); // Leichte X-Drift
      partPos[i * 3 + 2] += delta * (Math.random() * 0.6 - 0.3); // Leichte Z-Drift
      // Wenn Partikel zu weit draußen, zurücksetzen
      if (Math.abs(partPos[i * 3 + 1]) > 65) {
        partPos[i * 3 + 1] = Math.random() * 100 - 60;
        partPos[i * 3] = (Math.random() - 0.5) * 250;
        partPos[i * 3 + 2] = (Math.random() - 0.5) * 250;
      }
    }
    particles.geometry.attributes.position.needsUpdate = true;

    // --- Szene rendern ---
    renderer.render(scene, camera);
  }

  // Ersten Frame starten
  animate();

  // =========================================================================
  // 10. Resize-Handler
  // =========================================================================

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // =========================================================================
  // 11. Debug-Zugriff
  // =========================================================================

  (window as any).__sharkScene = scene;
  (window as any).__sharkGroup = () => sharkGroup;

  console.log("🦈 Hai-Schwimm-Demo gestartet!");
  console.log(
    "   🖱️  Maus: Kamera drehen | Scroll: Zoomen | Rechtsklick: Schwenken",
  );
  console.log("   🌊 Der Hai gleitet mit lateraler Undulation durchs Wasser");
  console.log("   🌊 Kopf fast ruhig – Schwanz schlägt horizontal (Yaw)");
}

// Alles starten
init().catch((err) => {
  console.error("❌ Initialisierung fehlgeschlagen:", err);
});
