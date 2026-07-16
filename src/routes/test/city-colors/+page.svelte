<script lang="ts">
/**
 * test/city-colors – Stadt-Farbtest mit 5 hellen Farbschemata
 *
 * Zeigt eine Stadt (Blocks Skyline) mit Kuppel, Licht und
 * Sandboden. Per Button können Bäume zugeschaltet werden.
 * 5 helle Farbschemata für die Gebäude + Fenster per Klick.
 *
 * Steuerung:
 *   - Links: Kamera drehen · Scrollen: Zoomen · Rechts: Kamera verschieben
 */

import { onMount, onDestroy } from "svelte";
import * as THREE from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
	import TestNav from "$lib/components/TestNav.svelte";
import {
  COLOR_THEMES,
  applyTheme,
  colorBuildings,
  createDome,
  createCityLights,
} from "$lib/experiences/underwater-world-v5/animationen/staedte/cityStructures";

// ---------------------------------------------------------------------------
// Konstanten
// ---------------------------------------------------------------------------
const DOME_RADIUS = 20;
const FLOOR_Y = 0;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let canvas: HTMLCanvasElement;
let renderer: THREE.WebGPURenderer;
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let controls: OrbitControls;

let activeThemeIndex = $state(0);
let showTrees = $state(false);

let cityModel: THREE.Object3D | null = null;
let cityGroup: THREE.Group | null = null;
let treeGroup: THREE.Group | null = null;
let modelLoaded = $state(false);

onMount(async () => {
  if (!canvas) return;

  // =========================================================================
  // 1. Renderer (WebGPU)
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
  scene.fog = new THREE.Fog("#0a2a4a", 30, 80);

  camera = new THREE.PerspectiveCamera(
    55,
    window.innerWidth / window.innerHeight,
    0.5,
    150,
  );
  camera.position.set(30, 18, 50);

  // =========================================================================
  // 3. OrbitControls
  // =========================================================================
  controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 4, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 8;
  controls.maxDistance = 120;
  controls.maxPolarAngle = Math.PI * 0.85;
  controls.update();

  // =========================================================================
  // 4. Beleuchtung
  // =========================================================================
  const ambientLight = new THREE.AmbientLight("#4488aa", 2.0);
  scene.add(ambientLight);

  const sunLight = new THREE.DirectionalLight("#88ccff", 3.0);
  sunLight.position.set(10, 25, 5);
  scene.add(sunLight);

  const fillLight = new THREE.DirectionalLight("#4488aa", 1.5);
  fillLight.position.set(-8, 5, -8);
  scene.add(fillLight);

  // =========================================================================
  // 5. Sandboden (immer sichtbar)
  // =========================================================================
  const floorMat = new THREE.MeshStandardMaterial({
    color: "#c4a87a",
    roughness: 0.9,
    metalness: 0.0,
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = FLOOR_Y;
  scene.add(floor);

  const grid = new THREE.GridHelper(80, 20, "#b8986a", "#a08050");
  grid.position.y = FLOOR_Y + 0.1;
  scene.add(grid);

  // =========================================================================
  // 6. Stadt aufbauen
  // =========================================================================
  cityGroup = new THREE.Group();
  scene.add(cityGroup);

  // Kuppel + Ring
  cityGroup.add(createDome(DOME_RADIUS, FLOOR_Y));

  // Stadt-Lichter
  const lightObjects = createCityLights(FLOOR_Y, DOME_RADIUS, DOME_RADIUS);
  for (const obj of lightObjects) {
    cityGroup.add(obj);
  }

  // Bäume + Büsche (nur auf Sand, ohne Wiese – erst per Toggle sichtbar)
  treeGroup = createVegetation(DOME_RADIUS, FLOOR_Y);
  treeGroup.visible = false;
  cityGroup.add(treeGroup);

  // =========================================================================
  // 7. City-Modell laden
  // =========================================================================
  const loader = new GLTFLoader();
  loader.load(
    "/3D Modelle/city/Blocks Skyline.glb",
    (gltf) => {
      cityModel = gltf.scene;

      // Standard-zufällige Färbung
      colorBuildings(cityModel);

      // Bounding-Box → skalieren
      const box = new THREE.Box3().setFromObject(cityModel);
      const size = new THREE.Vector3();
      box.getSize(size);
      const targetScale = 25 / Math.max(size.x, size.y, size.z);
      cityModel.scale.setScalar(targetScale);

      cityModel.traverse((ch) => {
        if (ch instanceof THREE.Mesh) {
          ch.castShadow = true;
          ch.receiveShadow = true;
        }
      });

      // Zentrieren: Boden auf FLOOR_Y
      const scaledBox = new THREE.Box3().setFromObject(cityModel);
      cityModel.position.set(
        -(scaledBox.min.x + scaledBox.max.x) / 2,
        FLOOR_Y - scaledBox.min.y,
        -(scaledBox.min.z + scaledBox.max.z) / 2,
      );
      cityGroup!.add(cityModel);
      modelLoaded = true;
    },
    undefined,
    (err) => console.error("❌ City-Fehler:", err),
  );

  // =========================================================================
  // 8. Animation-Loop
  // =========================================================================
  function animate(): void {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }
  animate();

  // =========================================================================
  // 9. Resize
  // =========================================================================
  const onResize = () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  };
  window.addEventListener("resize", onResize);
});

// =========================================================================
// 10. Gebäude-Theme wechseln
// =========================================================================
function switchTheme(index: number): void {
  if (!cityModel) return;
  activeThemeIndex = index;
  applyTheme(cityModel, COLOR_THEMES[index]);
}

// =========================================================================
// 11. Bäume an/aus
// =========================================================================
function toggleTrees(): void {
  showTrees = !showTrees;
  if (treeGroup) treeGroup.visible = showTrees;
}

// =========================================================================
// 12. Hilfsfunktion: Bäume + Büsche auf Sand (keine Wiese)
// =========================================================================
function createVegetation(domeRadius: number, groundY: number): THREE.Group {
  const group = new THREE.Group();

  const crownColors = [
    0x6a9a3a, 0x5a8a30, 0x7aaa48, 0x4a7a28, 0x8aba58,
    0x5e8e34, 0x6e9e40, 0x4e7e2c,
  ];
  const bushColors = [
    0x6a9a3a, 0x5a8a30, 0x7aaa48, 0x8aba58, 0x4a7a28,
  ];

  // Bäume
  const minDist = domeRadius * 0.15;
  const maxDist = domeRadius * 0.82;
  for (let i = 0; i < 25; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = minDist + Math.random() * (maxDist - minDist);

    const height = 1.2 + Math.random() * 1.8;
    const tree = new THREE.Group();

    const trunkMat = new THREE.MeshStandardMaterial({
      color: 0x6b4e3a,
      roughness: 0.9,
      metalness: 0.0,
    });
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.16, height * 0.5, 6),
      trunkMat,
    );
    trunk.position.y = height * 0.25;
    tree.add(trunk);

    const crownMat = new THREE.MeshStandardMaterial({
      color: crownColors[Math.floor(Math.random() * crownColors.length)],
      roughness: 0.8,
      metalness: 0.0,
    });
    const crown = new THREE.Mesh(
      new THREE.ConeGeometry(height * 0.35, height * 0.6, 6),
      crownMat,
    );
    crown.position.y = height * 0.65;
    tree.add(crown);

    tree.position.set(
      Math.cos(angle) * dist,
      groundY + 0.05,
      Math.sin(angle) * dist,
    );
    tree.rotation.y = Math.random() * Math.PI * 2;
    group.add(tree);
  }

  // Büsche
  for (let i = 0; i < 18; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = minDist + Math.random() * (maxDist - minDist);
    const bushSize = 0.3 + Math.random() * 0.5;

    const bushMat = new THREE.MeshStandardMaterial({
      color: bushColors[Math.floor(Math.random() * bushColors.length)],
      roughness: 0.85,
      metalness: 0.0,
    });
    const bush = new THREE.Mesh(
      new THREE.SphereGeometry(bushSize, 6, 6),
      bushMat,
    );
    bush.position.set(
      Math.cos(angle) * dist,
      groundY + bushSize * 0.4,
      Math.sin(angle) * dist,
    );
    group.add(bush);
  }

  return group;
}

// =========================================================================
// 13. Cleanup
// =========================================================================
onDestroy(() => {
  renderer?.setAnimationLoop(null);

  scene?.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry?.dispose();
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of mats) m.dispose();
    }
  });

  renderer?.dispose();
  controls?.dispose();
});
</script>

<svelte:head>
  <title>Test – Stadt-Farbschemata</title>
</svelte:head>

<canvas bind:this={canvas}></canvas>

<!-- ─── Button-Leiste oben: Gebäude-Theme ─── -->
<div class="bar bar-top">
  {#each COLOR_THEMES as theme, i}
    <button
      class="btn"
      class:active={activeThemeIndex === i}
      onclick={() => switchTheme(i)}
    >
      {theme.name}
    </button>
  {/each}
</div>

<!-- ─── Button-Leiste unten: Bäume ─── -->
<div class="bar bar-bottom">
  <button class="btn" class:active={showTrees} onclick={toggleTrees}>
    🌳 {showTrees ? "An" : "Aus"}
  </button>
</div>

<!-- Info -->
<div class="info">
  <strong>Stadt-Farbtest</strong> ·
  {COLOR_THEMES[activeThemeIndex].name} ·
  Bäume: {showTrees ? "An" : "Aus"}<br />
  🖱️ Links = Drehen · Scrollen = Zoomen · Rechts = Schwenken
</div>

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

  .bar {
    position: fixed;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    gap: 8px;
    z-index: 20;
    background: rgba(0, 10, 30, 0.7);
    backdrop-filter: blur(8px);
    padding: 8px 16px;
    border-radius: 12px;
    border: 1px solid rgba(60, 120, 200, 0.25);
    align-items: center;
  }
  .bar-top {
    bottom: 82px;
  }
  .bar-bottom {
    bottom: 28px;
  }

  .btn {
    padding: 6px 14px;
    border: 1px solid rgba(100, 180, 255, 0.25);
    border-radius: 8px;
    background: rgba(20, 50, 90, 0.5);
    color: #8ab8e0;
    font-family: system-ui, sans-serif;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
    user-select: none;
    white-space: nowrap;
  }
  .btn:hover {
    background: rgba(40, 80, 140, 0.6);
    border-color: rgba(100, 180, 255, 0.5);
    color: #b0d8ff;
  }
  .btn.active {
    background: rgba(60, 140, 220, 0.5);
    border-color: #5aaeff;
    color: #ffffff;
    box-shadow: 0 0 12px rgba(60, 140, 220, 0.3);
  }

  .info {
    position: fixed;
    top: 16px;
    left: 16px;
    color: rgba(160, 200, 240, 0.8);
    font-family: system-ui, sans-serif;
    font-size: 13px;
    pointer-events: none;
    z-index: 10;
    text-shadow: 0 0 8px rgba(0, 60, 120, 0.4);
    line-height: 1.7;
  }
  .info strong {
    color: #7ec8ff;
  }
</style>
