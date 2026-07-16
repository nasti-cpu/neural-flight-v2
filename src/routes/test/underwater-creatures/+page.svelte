<script lang="ts">
/**
 * test-seite – Delfin, Hai und Fische im Größenvergleich
 *
 * Diese Testseite kombiniert Delfin, Hai und Fische in einer gemeinsamen
 * Unterwasser-Szene. So kannst du testen:
 *   1. Wie fügen sich Delfin und Hai in die Welt ein?
 *   2. Passt die Schwimm-Animation?
 *   3. Wie ist das Größenverhältnis zu den Fischen?
 *
 * Steuerung:
 *   - Linke Maustaste: Kamera drehen
 *   - Scrollen: Zoomen
 *   - Rechte Maustaste: Kamera verschieben
 */

import { onMount, onDestroy } from "svelte";
import * as THREE from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
	import TestNav from "$lib/components/TestNav.svelte";
import {
  createSwimParams,
  createSwimState,
  updateSwimState,
  computeOrbitPosition,
  computeOrbitTangent,
  computeTargetY,
} from "$lib/experiences/underwater-world-v5/animationen/fische/orbitSwimming";

// ---------------------------------------------------------------------------
// Svelte-Lifecycle
// ---------------------------------------------------------------------------

let canvas: HTMLCanvasElement;
let renderer: THREE.WebGPURenderer;
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let controls: OrbitControls;

onMount(async () => {
  if (!canvas) return;

  // =========================================================================
  // 1. Renderer (WebGPU – wie im ganzen Projekt)
  // =========================================================================
  renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  await renderer.init();

  // =========================================================================
  // 2. Szene & Kamera
  // =========================================================================
  scene = new THREE.Scene();
  scene.background = new THREE.Color("#0a2a4a");

  // Nebel – heller und weiter, damit man alle Tiere gut sieht
  scene.fog = new THREE.Fog("#0a2a4a", 25, 100);

  camera = new THREE.PerspectiveCamera(
    55,
    window.innerWidth / window.innerHeight,
    0.5,
    150,
  );
  camera.position.set(25, 15, 45);
  camera.lookAt(0, 0, 0);

  // =========================================================================
  // 3. OrbitControls – Kamera frei bewegen
  // =========================================================================
  controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 2, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 5;
  controls.maxDistance = 120;
  controls.maxPolarAngle = Math.PI * 0.8;
  controls.update();

  // =========================================================================
  // 4. Beleuchtung (heller als die Tiefsee – für gute Sichtbarkeit)
  // =========================================================================
  const ambientLight = new THREE.AmbientLight("#4488aa", 2.0);
  scene.add(ambientLight);

  const sunLight = new THREE.DirectionalLight("#88ccff", 4.0);
  sunLight.position.set(8, 20, 4);
  scene.add(sunLight);

  const fillLight = new THREE.DirectionalLight("#4488aa", 2.0);
  fillLight.position.set(-6, 4, -6);
  scene.add(fillLight);

  // =========================================================================
  // 5. Meeresboden (Sand-Ebene)
  // =========================================================================
  const floorGeo = new THREE.PlaneGeometry(120, 120);
  const floorMat = new THREE.MeshStandardMaterial({
    color: "#1a3a55",
    roughness: 0.9,
    metalness: 0.0,
  });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -4;
  floor.receiveShadow = true;
  scene.add(floor);

  // Gitter für Orientierung und Größenvergleich (heller)
  const grid = new THREE.GridHelper(80, 20, "#4488aa", "#2a5a7a");
  grid.position.y = -3.5;
  scene.add(grid);

  // =========================================================================
  // 6. Wasseroberfläche (sehr transparent, kaum sichtbar)
  // =========================================================================
  const waterGeo = new THREE.PlaneGeometry(100, 100);
  const waterMat = new THREE.MeshStandardMaterial({
    color: "#4a8abb",
    roughness: 0.3,
    metalness: 0.1,
    transparent: true,
    opacity: 0.12,
    side: THREE.DoubleSide,
  });
  const waterSurface = new THREE.Mesh(waterGeo, waterMat);
  waterSurface.rotation.x = -Math.PI / 2;
  waterSurface.position.y = 22;
  scene.add(waterSurface);

  // =========================================================================
  // 7. Modelle laden (Delfin, Hai, Fisch – parallel)
  // =========================================================================
  const loader = new GLTFLoader();

  // Zustand: Alle 3 Modelle müssen geladen sein, bevor die Animation startet
  let dolphinModel: THREE.Group | null = null;
  let sharkModel: THREE.Group | null = null;
  let fishModelTemplate: THREE.Group | null = null;
  let modelsLoaded = 0;
  const TOTAL_MODELS = 3;

  function onModelLoaded(): void {
    modelsLoaded++;
    if (modelsLoaded === TOTAL_MODELS) {
      startAnimation();
    }
  }

  // --- Delfin laden ---
  const dolphinGroup = new THREE.Group();
  scene.add(dolphinGroup);
  loader.load(
    "/3D Modelle/Dolphin.glb",
    (gltf) => {
      dolphinModel = gltf.scene;
      // Auf ~10 Einheiten Länge skalieren (deutlich kleiner, passend zum Test)
      const box = new THREE.Box3().setFromObject(dolphinModel);
      const size = new THREE.Vector3();
      box.getSize(size);
      const scaleFactor = 10 / size.z;
      dolphinModel.scale.setScalar(scaleFactor);
      dolphinModel.traverse((ch) => {
        if (ch instanceof THREE.Mesh) {
          ch.castShadow = true;
          ch.receiveShadow = true;
        }
      });
      dolphinGroup.add(dolphinModel);
      console.log("✅ Delfin geladen, Skalierung:", scaleFactor.toFixed(3));
      onModelLoaded();
    },
    undefined,
    (err) => {
      console.error("❌ Delfin-Fehler:", err);
      onModelLoaded();
    },
  );

  // --- Hai laden ---
  const sharkGroup = new THREE.Group();
  scene.add(sharkGroup);
  loader.load(
    "/3D Modelle/Shark.glb",
    (gltf) => {
      sharkModel = gltf.scene;
      // Auf ~12 Einheiten skalieren (etwas größer als der Delfin)
      const box = new THREE.Box3().setFromObject(sharkModel);
      const size = new THREE.Vector3();
      box.getSize(size);
      const longestAxis = Math.max(size.x, size.y, size.z);
      const scaleFactor = 12 / longestAxis;
      sharkModel.scale.setScalar(scaleFactor);
      sharkModel.traverse((ch) => {
        if (ch instanceof THREE.Mesh) {
          ch.castShadow = true;
          ch.receiveShadow = true;
        }
      });
      sharkGroup.add(sharkModel);
      console.log("✅ Hai geladen, Skalierung:", scaleFactor.toFixed(3));
      onModelLoaded();
    },
    undefined,
    (err) => {
      console.error("❌ Hai-Fehler:", err);
      onModelLoaded();
    },
  );

  // --- Fische laden (Template für mehrere Instanzen) ---
  loader.load(
    "/3D Modelle/fish/Fish(3).glb",
    (gltf) => {
      fishModelTemplate = gltf.scene;
      console.log("✅ Fisch-Modell geladen");
      onModelLoaded();
    },
    undefined,
    (err) => {
      console.error("❌ Fisch-Fehler:", err);
      onModelLoaded();
    },
  );

  // =========================================================================
  // 8. Fische erzeugen (8 Stück mit orbitSwimming.ts)
  // =========================================================================
  interface SoloFishInstance {
    group: THREE.Group;
    swimParams: ReturnType<typeof createSwimParams>;
    swimState: ReturnType<typeof createSwimState>;
    radiusX: number;
    radiusZ: number;
    speed: number;
    startAngle: number;
    centerX: number;
    centerZ: number;
    baseY: number;
    floorY: number;
  }

  const fishes: SoloFishInstance[] = [];
  let fishInitialized = false;

  function initFish(): void {
    if (!fishModelTemplate) return;
    if (fishInitialized) return;
    fishInitialized = true;

    const FISH_COUNT = 8;

    // Bounding-Box für Skalierung (wie in fishWorld.ts)
    const box = new THREE.Box3().setFromObject(fishModelTemplate);
    const size = new THREE.Vector3();
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z);

    for (let i = 0; i < FISH_COUNT; i++) {
      // Jeder Fisch bekommt eine eigene Kopie des Modells
      const clone = fishModelTemplate.clone(true);
      // Zufällige Größe zwischen 0.8 und 1.8 Einheiten (wie in fishWorld.ts)
      const fishScale = (0.8 + Math.random() * 1.0) / maxDim;
      clone.scale.setScalar(fishScale);
      clone.traverse((ch) => {
        if (ch instanceof THREE.Mesh) {
          ch.castShadow = true;
          ch.receiveShadow = true;
        }
      });

      // Erste Position im sichtbaren Bereich verteilen
      const angleOffset = (i / FISH_COUNT) * Math.PI * 2;
      const spreadRadius = 5 + Math.random() * 10;
      clone.position.set(
        Math.cos(angleOffset) * spreadRadius,
        (Math.random() - 0.5) * 8 + 4,
        Math.sin(angleOffset) * spreadRadius,
      );

      scene.add(clone);

      // Schwimm-Parameter (orbitSwimming.ts)
      const swimParams = createSwimParams();
      const swimState = createSwimState(0);

      // Kleine elliptische Bahnen um verschiedene Zentren
      const centerX = (Math.random() - 0.5) * 20;
      const centerZ = (Math.random() - 0.5) * 20;

      fishes.push({
        group: clone,
        swimParams,
        swimState,
        radiusX: 3 + Math.random() * 5,
        radiusZ: 3 + Math.random() * 5,
        speed: 0.3 + Math.random() * 0.4,
        startAngle: Math.random() * Math.PI * 2,
        centerX,
        centerZ,
        baseY: 2 + Math.random() * 8,
        floorY: -4,
      });
    }

    console.log(`🐟 ${FISH_COUNT} Fische erzeugt`);
  }

  // =========================================================================
  // 9. Animations-Parameter (aus dolphin-swim.ts & shark-swim.ts)
  // =========================================================================

  // --- Delfin ---
  const DOLPHIN = {
    radiusX: 25,
    radiusZ: 18,
    swimSpeed: 0.25,
    pitchAmplitude: 0.06,
    pitchFrequency: 0.6,
    porpoiseAmplitude: 4,
    porpoiseFrequency: 0.12,
    rollAmplitude: 0.06,
    lerpSpeed: 4.0,
    baseY: 5,
  };

  // Lerp-Speicher für Delfin (sanfte Übergänge)
  let dCurrentPitch = 0;
  let dCurrentRoll = 0;
  let dCurrentY = DOLPHIN.baseY;

  // --- Hai ---
  const SHARK = {
    radiusX: 30,
    radiusZ: 22,
    swimSpeed: 0.18,
    yawAmplitude: 0.09,
    yawFrequency: 0.45,
    pitchAmplitude: 0.03,
    pitchFrequency: 0.2,
    depthAmplitude: 5,
    depthFrequency: 0.08,
    rollAmplitude: 0.1,
    lerpSpeed: 3.5,
    baseY: -3,
  };

  // Lerp-Speicher für Hai
  let sCurrentYaw = 0;
  let sCurrentPitch = 0;
  let sCurrentRoll = 0;

  // =========================================================================
  // 10. Animation starten (wenn alle Modelle geladen sind)
  // =========================================================================
  let clock: THREE.Timer;

  function startAnimation(): void {
    // Fische initialisieren (auch wenn das Modell schon vorher da war)
    initFish();

    clock = new THREE.Timer();

    // Animation-Loop via requestAnimationFrame
    function animate(): void {
      requestAnimationFrame(animate);

      clock.update();
      const delta = Math.min(clock.getDelta(), 0.1);
      const elapsed = performance.now() / 1000;

      // OrbitControls aktualisieren
      controls.update();

      // ═══ Delfin animieren ═══════════════════════════════════════════════════
      if (dolphinModel) {
        const da = elapsed * DOLPHIN.swimSpeed;
        const dPosX = Math.cos(da) * DOLPHIN.radiusX;
        const dPosZ = Math.sin(da) * DOLPHIN.radiusZ;

        // Porpoising (periodisches Auftauchen – nur positive Halbwelle)
        const dPorpoisePhase = elapsed * DOLPHIN.porpoiseFrequency * Math.PI * 2;
        const dPorpoiseRaw = Math.sin(dPorpoisePhase);
        const dPorpoiseY = dPorpoiseRaw > 0 ? dPorpoiseRaw * DOLPHIN.porpoiseAmplitude : 0;

        // Pitch (vertikaler Fluken-Schlag = dorsoventrale Undulation)
        const dTargetPitch = Math.sin(elapsed * DOLPHIN.pitchFrequency * Math.PI * 2) * DOLPHIN.pitchAmplitude;

        // Roll
        const dTargetRoll = Math.cos(da) * Math.sin(elapsed * 0.5) * DOLPHIN.rollAmplitude;

        // Y-Position (Basis + Porpoising)
        const dTargetY = DOLPHIN.baseY + dPorpoiseY;

        // Sanftes Lerp
        const dLerp = 1 - Math.exp(-DOLPHIN.lerpSpeed * delta);
        dCurrentPitch += (dTargetPitch - dCurrentPitch) * dLerp;
        dCurrentRoll += (dTargetRoll - dCurrentRoll) * dLerp;
        dCurrentY += (dTargetY - dCurrentY) * dLerp;

        // Yaw (Tangenten-Richtung auf der Ellipse)
        const dTangentX = -Math.sin(da) * DOLPHIN.radiusX;
        const dTangentZ = Math.cos(da) * DOLPHIN.radiusZ;
        const dYaw = Math.atan2(dTangentX, dTangentZ);

        dolphinGroup.position.set(dPosX, dCurrentY, dPosZ);
        dolphinGroup.rotation.set(0, 0, 0);
        dolphinGroup.rotateY(dYaw);
        dolphinGroup.rotateX(dCurrentPitch);
        dolphinGroup.rotateZ(dCurrentRoll);
      }

      // ═══ Hai animieren ══════════════════════════════════════════════════════
      if (sharkModel) {
        const sa = elapsed * SHARK.swimSpeed;
        const sPosX = Math.cos(sa) * SHARK.radiusX;
        const sPosZ = Math.sin(sa) * SHARK.radiusZ;

        // Tiefenvariation (langsame Y-Änderung)
        const sDepthOffset =
          Math.sin(elapsed * SHARK.depthFrequency * Math.PI * 2) * SHARK.depthAmplitude;
        const sTargetY = SHARK.baseY + sDepthOffset;

        // Yaw (lateraler Schwanzschlag – DIE zentrale Hai-Bewegung)
        const sTargetYaw =
          Math.sin(elapsed * SHARK.yawFrequency * Math.PI * 2) * SHARK.yawAmplitude;

        // Pitch (sehr dezente vertikale Bewegung)
        const sTargetPitch =
          Math.sin(elapsed * SHARK.pitchFrequency * Math.PI * 2) * SHARK.pitchAmplitude;

        // Roll
        const sTargetRoll =
          Math.cos(sa) * Math.sin(elapsed * 0.4) * SHARK.rollAmplitude;

        // Sanftes Lerp
        const sLerp = 1 - Math.exp(-SHARK.lerpSpeed * delta);
        sCurrentYaw += (sTargetYaw - sCurrentYaw) * sLerp;
        sCurrentPitch += (sTargetPitch - sCurrentPitch) * sLerp;
        sCurrentRoll += (sTargetRoll - sCurrentRoll) * sLerp;

        // Yaw (Bahn-Richtung + laterale Undulation)
        const sTangentX = -Math.sin(sa) * SHARK.radiusX;
        const sTangentZ = Math.cos(sa) * SHARK.radiusZ;
        const sBaseYaw = Math.atan2(sTangentX, sTangentZ);

        sharkGroup.position.set(sPosX, sTargetY, sPosZ);
        sharkGroup.rotation.set(0, 0, 0);
        sharkGroup.rotateY(sBaseYaw + sCurrentYaw);
        sharkGroup.rotateX(sCurrentPitch);
        sharkGroup.rotateZ(sCurrentRoll);
      }

      // ═══ Fische animieren (orbitSwimming.ts) ═════════════════════════════════
      for (const fish of fishes) {
        const { group, swimParams, swimState, radiusX, radiusZ, speed, startAngle, centerX, centerZ, baseY, floorY } = fish;

        // Orbit-Position auf der Ellipse
        const { px, pz, ang } = computeOrbitPosition(
          centerX, centerZ,
          radiusX, radiusZ,
          speed, startAngle,
          elapsed,
        );

        // Tangenten-Richtung → Basis-Yaw
        const { baseYaw } = computeOrbitTangent(radiusX, radiusZ, ang);

        // Yaw/Pitch/Roll aktualisieren (Burst-and-Glide)
        updateSwimState(swimParams, swimState, delta, elapsed, ang);

        // Y-Position (Tiefe mit Sinus-Oszillation + Boden-Begrenzung)
        const targetY = computeTargetY(baseY, swimParams.depthAmp, swimParams.depthFreq, swimParams.phaseOffset, elapsed, floorY);

        // Sanfte Y-Interpolation
        const yLerp = 1 - Math.exp(-5.0 * delta);
        swimState.curY += (targetY - swimState.curY) * yLerp;

        // Position setzen
        group.position.set(px, swimState.curY, pz);

        // Rotation: Yaw (Bahn + Animation) → Pitch → Roll
        group.rotation.set(0, 0, 0);
        group.rotateY(baseYaw + swimState.yaw);
        group.rotateX(swimState.pitch);
        group.rotateZ(swimState.roll);
      }

      // Szene rendern
      renderer.render(scene, camera);
    }

    animate();
    console.log("🎬 Animation gestartet – alle Modelle geladen");
  }

  // Falls alle Modelle bereits geladen sind (Cache?), initFish direkt
  // (Der Svelte-Code läuft asynchron – initFish wird auch in startAnimation
  //  aufgerufen, aber fishInitialized verhindert doppelte Erzeugung)

  // =========================================================================
  // 11. Resize-Handler
  // =========================================================================
  const onResize = () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  };
  window.addEventListener("resize", onResize);
});

// =========================================================================
// 12. Cleanup (Svelte-OnDestroy)
// =========================================================================
onDestroy(() => {
  // Renderer stoppen
  renderer?.setAnimationLoop(null);

  // Disposal: Geometrien, Materialien, Texturen
  scene?.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry?.dispose();
      if (obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) m.dispose();
      }
    }
  });

  renderer?.dispose();
  controls?.dispose();
});
</script>

<!-- =========================================================================
     HTML-Template
     ========================================================================= -->

<svelte:head>
  <title>Test – Delfin &amp; Hai Größenvergleich</title>
</svelte:head>

<!-- Info-Overlay -->
<div class="info">
  🐬 <strong>Delfin</strong> (~10 Einheiten) · dorsoventrale Undulation (vertikaler Fluken-Schlag) · Porpoising<br />
  🦈 <strong>Hai</strong> (~12 Einheiten) · laterale Undulation (horizontaler Schwanzschlag) · gleitendes Cruisen<br />
  🐟 <strong>Fische</strong> (~0.8–1.8 Einheiten) · Burst-and-Glide auf Ellipsenbahnen<br /><br />
  🖱️ Links = Drehen · Scrollen = Zoomen · Rechts = Schwenken
</div>

<!-- Canvas für Three.js -->
<canvas bind:this={canvas}></canvas>

<style>
  :global(body) {
    margin: 0;
    overflow: hidden;
    background: #000814;
    cursor: grab;
  }
  :global(body:active) {
    cursor: grabbing;
  }
  canvas {
    display: block;
    width: 100vw;
    height: 100vh;
  }
  .info {
    position: fixed;
    top: 16px;
    left: 16px;
    color: rgba(200, 230, 255, 0.85);
    font-family: system-ui, sans-serif;
    font-size: 13px;
    pointer-events: none;
    z-index: 10;
    text-shadow: 0 0 8px rgba(0, 100, 180, 0.4);
    line-height: 1.7;
  }
  .info strong {
    color: #7ec8ff;
  }
</style>
