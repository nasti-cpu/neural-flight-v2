/**
 * dolphin-swim.ts – Schwimmender Delfin (Experiment 05)
 *
 * Lädt das Dolphin.glb 3D-Modell und animiert einen realistischen
 * Schwimmzyklus basierend auf echter Delfin-Biomechanik.
 *
 * Delfine schwimmen mit dorsoventraler Undulation:
 * - Die Schwanzflosse (Fluke) bewegt sich vertikal auf und ab
 * - Der vordere Körper bleibt relativ starr
 * - Die Bewegung ist sinusförmig von Kopf bis Schwanz
 * - Sie "porpoisen": stoßen periodisch aus dem Wasser
 * - Die Flossen dienen der Steuerung, die Fluke dem Antrieb
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

  // Hintergrund: tiefes Ozean-Blau
  scene.background = new THREE.Color(0x001a33);

  // Dunst-Effekt (Fog) für Tiefenwirkung unter Wasser
  scene.fog = new THREE.Fog(0x001a33, 30, 200);

  // Kamera: etwas weiter weg für den großen Delfin
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
  renderer.toneMappingExposure = 1.2;
  document.body.appendChild(renderer.domElement);

  // WebGPU initialisieren (muss VOR dem ersten render() passieren!)
  await renderer.init();
  console.log("✅ WebGPU initialisiert!");

  // =========================================================================
  // 2. OrbitControls – Kamera mit Maus drehen/zoomen
  // =========================================================================

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 10, 0); // Kamera schaut auf Delfin-Höhe
  controls.enableDamping = true; // Sanftes Ausklingen der Bewegung
  controls.dampingFactor = 0.08;
  controls.minDistance = 20; // Nah ranzoomen
  controls.maxDistance = 300; // Weit rauszoomen
  controls.maxPolarAngle = Math.PI * 0.7; // Nicht komplett unter die Szene
  controls.update();

  // =========================================================================
  // 3. Beleuchtung (Unterwasser-Atmosphäre)
  // =========================================================================

  // Ambient – Grundhelligkeit wie Streulicht unter Wasser
  const ambientLight = new THREE.AmbientLight(0x224466, 1.0);
  scene.add(ambientLight);

  // Haupt-Licht von oben – wie Sonnenstrahlen, die ins Wasser fallen
  const sunLight = new THREE.DirectionalLight(0xaaddff, 4);
  sunLight.position.set(30, 80, 20);
  scene.add(sunLight);

  // Füll-Licht von der Seite für mehr Tiefe
  const fillLight = new THREE.DirectionalLight(0x335577, 1.5);
  fillLight.position.set(-20, 10, -30);
  scene.add(fillLight);

  // =========================================================================
  // 4. Unterwasser-Boden & Umgebung
  // =========================================================================

  // Großer, flacher "Meeresboden" als Referenz
  const floorGeometry = new THREE.PlaneGeometry(400, 400);
  const floorMaterial = new THREE.MeshStandardMaterial({
    color: 0x1a3344,
    roughness: 0.9,
    metalness: 0.0,
  });
  const floor = new THREE.Mesh(floorGeometry, floorMaterial);
  floor.rotation.x = -Math.PI / 2; // Flach auf den Boden legen
  floor.position.y = -60;
  floor.receiveShadow = true;
  scene.add(floor);

  // Dezentes Gitter für räumliche Orientierung
  const gridHelper = new THREE.GridHelper(300, 40, 0x224466, 0x112233);
  gridHelper.position.y = -59;
  scene.add(gridHelper);

  // =========================================================================
  // 5. "Wasseroberfläche" – halbtransparente Ebene
  // =========================================================================

  const surfaceGeometry = new THREE.PlaneGeometry(400, 400);
  const surfaceMaterial = new THREE.MeshStandardMaterial({
    color: 0x4488cc,
    roughness: 0.3,
    metalness: 0.1,
    transparent: true,
    opacity: 0.25,
    side: THREE.DoubleSide,
  });
  const waterSurface = new THREE.Mesh(surfaceGeometry, surfaceMaterial);
  waterSurface.rotation.x = -Math.PI / 2;
  waterSurface.position.y = 30; // Wasseroberfläche bei Y=30
  scene.add(waterSurface);

  // =========================================================================
  // 6. Delfin-Modell laden
  // =========================================================================

  // Der Delfin wird in diese Gruppe eingefügt
  const dolphinGroup = new THREE.Group();
  scene.add(dolphinGroup);

  let dolphinModel: THREE.Group | null = null;

  const loader = new GLTFLoader();
  console.log("🐬 Lade Delfin-Modell...");

  loader.load(
    "/3D Modelle/Dolphin.glb",
    (gltf) => {
      console.log("✅ Delfin-Modell geladen!");
      dolphinModel = gltf.scene;

      // Das Modell hat folgende Maße (aus der GLB-Datei):
      // Breite: ~80, Höhe: ~83, Tiefe: ~255 Einheiten
      // → Wir skalieren auf ~30 Einheiten Länge
      const targetLength = 30;
      // Bounding-Box berechnen für exakte Skalierung
      const box = new THREE.Box3().setFromObject(dolphinModel);
      const size = new THREE.Vector3();
      box.getSize(size);
      const scaleFactor = targetLength / size.z;
      dolphinModel.scale.setScalar(scaleFactor);

      // Der Delfin zeigt standardmäßig in -Z oder +Z – wir müssen
      // sicherstellen, dass er in +Z schaut (Schwimmrichtung)
      // obj2gltf-Modelle sind oft um 90° gedreht, wir korrigieren:
      // Erst mal so lassen und beim Animieren berücksichtigen

      // Delfin zur Gruppe hinzufügen
      dolphinGroup.add(dolphinModel);

      // Schatten aktivieren
      dolphinModel.traverse((child) => {
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
      console.error("❌ Fehler beim Laden des Delfin-Modells:", error);
    },
  );

  // =========================================================================
  // 7. Partikel (Bläschen) für Unterwasser-Atmosphäre
  // =========================================================================

  const bubbleCount = 200;
  const bubbleGeo = new THREE.BufferGeometry();
  const bubblePositions = new Float32Array(bubbleCount * 3);

  for (let i = 0; i < bubbleCount; i++) {
    bubblePositions[i * 3] = (Math.random() - 0.5) * 200; // X: -100..100
    bubblePositions[i * 3 + 1] = Math.random() * 100 - 60; // Y: -60..40
    bubblePositions[i * 3 + 2] = (Math.random() - 0.5) * 200; // Z: -100..100
  }

  bubbleGeo.setAttribute(
    "position",
    new THREE.BufferAttribute(bubblePositions, 3),
  );

  const bubbleMat = new THREE.PointsMaterial({
    color: 0x88bbdd,
    size: 0.3,
    transparent: true,
    opacity: 0.7,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const bubbles = new THREE.Points(bubbleGeo, bubbleMat);
  scene.add(bubbles);

  // =========================================================================
  // 8. Animations-Parameter (Delfin-Schwimmverhalten)
  // =========================================================================

  /**
   * Delfine schwimmen mit dorsoventraler Undulation:
   * - Die Fluke (Schwanzflosse) schlägt vertikal, nicht seitlich
   * - Die Bewegung verläuft wellenförmig von Kopf bis Schwanz
   * - Frequenz: ~1–2 Schläge pro Sekunde
   * - Porpoising: periodisches Durchbrechen der Wasseroberfläche
   *
   * Unsere Animation:
   * - Elliptische Bahn (großer Kreis) als primäre Bewegung
   * - Sinusförmige Pitch-Oszillation für Fluken-Schlag
   * - Periodisches Porpoising (Y-Welle)
   * - Roll-Bewegung für natürliches Aussehen
   */

  // Schwimm-Parameter
  const swimRadiusX = 60; // Ellipse: X-Radius
  const swimRadiusZ = 40; // Ellipse: Z-Radius
  const swimSpeed = 0.2; // Basis-Geschwindigkeit (langsamer = eleganter)
  const pitchAmplitude = 0.06; // Stärke des Fluken-Schlags (dezent)
  const pitchFrequency = 0.6; // ~1 Fluken-Schlag alle 1.7s (entspannt)
  const porpoiseAmplitude = 5; // Höhe des Porpoising-Sprungs
  const porpoiseFrequency = 0.12; // Auftauch-Frequenz
  const rollAmplitude = 0.06; // Leichte Seitenneigung in Kurven

  // Lerp-Speicher – sorgt für sanfte, natürliche Übergänge
  let currentPitch = 0; // Aktueller Pitch-Wert (gleitend interpoliert)
  let currentRoll = 0; // Aktueller Roll-Wert (gleitend interpoliert)
  let currentY = 5; // Aktuelle Y-Position (gleitend interpoliert)
  const lerpSpeed = 4.0; // Wie schnell folgt der Wert dem Ziel? (höher = schneller)

  // =========================================================================
  // 9. Animation-Loop
  // =========================================================================

  let lastTime = performance.now();
  // THREE.Timer ersetzt den veralteten THREE.Clock (Three.js >= 0.184)
  const timer = new THREE.Timer();

  function animate(): void {
    requestAnimationFrame(animate);

    timer.update();
    const delta = Math.min(timer.getDelta(), 0.1); // Sicherheits-Cap bei 0.1s
    const elapsed = performance.now() / 1000; // Gesamtzeit in Sekunden

    // --- OrbitControls updaten ---
    controls.update();

    // --- Delfin animieren (nur wenn Modell geladen) ---
    if (dolphinModel && dolphinGroup) {
      // === Bahn (elliptischer Kreis) ===
      // Winkel entlang der Ellipse
      const angle = elapsed * swimSpeed;
      const centerX = 0;
      const centerZ = 0;

      // Position auf der Ellipse
      const posX = centerX + Math.cos(angle) * swimRadiusX;
      const posZ = centerZ + Math.sin(angle) * swimRadiusZ;

      // === Porpoising (periodisches Auftauchen) ===
      // Nach ~3 Bahn-Umläufen taucht der Delfin auf
      // (porpoiseFrequency steuert, wie oft pro Sekunde)
      const porpoisePhase = elapsed * porpoiseFrequency * Math.PI * 2;
      // Nur positive Werte (Delfin springt NUR nach oben)
      const porpoiseRaw = Math.sin(porpoisePhase);
      // Abschneiden: nur positive Halbwelle → echter Sprung aus dem Wasser
      const porpoiseY = porpoiseRaw > 0 ? porpoiseRaw * porpoiseAmplitude : 0;

      // Basis-Y: Delfin schwimmt ~10 Einheiten unter der Oberfläche (Y=30)
      const baseY = 5;

      // === Pitch (vertikales Kippen = Fluken-Schlag) ===
      // Ziel-Pitch aus der Sinus-Welle berechnen
      const targetPitch =
        Math.sin(elapsed * pitchFrequency * Math.PI * 2) * pitchAmplitude;

      // === Roll (leichte Seitenneigung) ===
      const targetRoll =
        Math.cos(angle) * Math.sin(elapsed * 0.5) * rollAmplitude;

      // === Y-Position (Porpoising) ===
      const targetY = baseY + porpoiseY;

      // --- Sanftes Lerp (gleitende Interpolation) ---
      // Statt hart auf die Zielwerte zu springen, bewegen wir uns
      // sanft in Richtung Ziel. Das fühlt sich viel natürlicher an!
      const lerpFactor = 1 - Math.exp(-lerpSpeed * delta);
      currentPitch += (targetPitch - currentPitch) * lerpFactor;
      currentRoll += (targetRoll - currentRoll) * lerpFactor;
      currentY += (targetY - currentY) * lerpFactor;

      // === Yaw (Drehung zum Folgen der Bahn) ===
      // Der Delfin soll immer in Schwimmrichtung schauen
      // Tangente an die Ellipse: (-a*sin(t), b*cos(t)) für x=a*cos(t), z=b*sin(t)
      const tangentX = -Math.sin(angle) * swimRadiusX;
      const tangentZ = Math.cos(angle) * swimRadiusZ;
      // atan2 gibt den Winkel der Tangente – das ist die Yaw-Rotation
      const yaw = Math.atan2(tangentX, tangentZ);

      // --- Transformationen anwenden ---
      // Position setzen (mit geglättetem Y-Wert)
      dolphinGroup.position.set(posX, currentY, posZ);

      // Rotation: Yaw (Schwimmrichtung) + geglättete Pitch/Roll
      dolphinGroup.rotation.set(0, 0, 0);
      dolphinGroup.rotateY(yaw);
      dolphinGroup.rotateX(currentPitch);
      dolphinGroup.rotateZ(currentRoll);
    }

    // --- Bläschen animieren (langsam aufsteigen) ---
    const bubblePos = bubbles.geometry.attributes.position
      .array as Float32Array;
    for (let i = 0; i < bubbleCount; i++) {
      // Y langsam erhöhen (Aufsteigen)
      bubblePos[i * 3 + 1] += delta * 2;
      // Wenn Blase die Oberfläche erreicht, zurücksetzen
      if (bubblePos[i * 3 + 1] > 35) {
        bubblePos[i * 3 + 1] = -60;
        bubblePos[i * 3] = (Math.random() - 0.5) * 200;
        bubblePos[i * 3 + 2] = (Math.random() - 0.5) * 200;
      }
    }
    bubbles.geometry.attributes.position.needsUpdate = true;

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

  (window as any).__dolphinScene = scene;
  (window as any).__dolphinGroup = () => dolphinGroup;

  console.log("🐬 Delfin-Schwimm-Demo gestartet!");
  console.log(
    "   🖱️  Maus: Kamera drehen | Scroll: Zoomen | Rechtsklick: Schwenken",
  );
  console.log("   🌊 Der Delfin schwimmt elliptische Bahnen mit Fluken-Schlag");
  console.log("   🌊 Dorsoventrale Undulation + Porpoising");
}

// Alles starten
init().catch((err) => {
  console.error("❌ Initialisierung fehlgeschlagen:", err);
});
