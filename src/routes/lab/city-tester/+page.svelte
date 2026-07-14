<script lang="ts">
/**
 * LAB EXPERIMENT — City Tester (WebGPU)
 *
 * Zeigt 4 Stadtgrößen-Varianten in einer großen Frühlingswiese.
 * Jede Stadt hat eine grasfreie Clear-Zone und eine eigene Pheromonspur-Farbe.
 * OrbitControls zum Erkunden der Größenverhältnisse.
 *
 * WebGPU + TSL (siehe AGENTS.md).
 */
import { onDestroy, onMount } from "svelte";
import { browser } from "$app/environment";
import * as THREE from "three/webgpu";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  createMeadow,
  type MeadowPatch,
} from "$lib/experiences/insect-world-v2/Biome/Wiese/grass";
import {
  createSky,
} from "$lib/experiences/insect-world-v2/Biome/blauerHimmel/sky";
import {
  createFlowers,
  type FlowerTarget,
} from "$lib/experiences/insect-world-v2/Objekte/Blumen/blumen";
import { PheromoneSystem } from "$lib/experiences/insect-world-v2/Sinne/Pheromonspuren/pheromonspuren";

// ─── Stadt-Varianten ───────────────────────────────────────────────────

interface CityVariant {
  name: string;
  /** Multiplikator der Basis-Skala (0.00025) */
  scaleFactor: number;
  /** Radius der grasfreien Zone um die Stadt (in Metern) */
  clearRadius: number;
  x: number;
  z: number;
}

const CITY_BASE_SCALE = 0.00025;
const CITY_MODEL_URL = "/models/stadt/around_the_world_map_1.glb";

/**
 * 4 Varianten im Kreis um die Mitte herum – alle innerhalb der Wiese (40×40m).
 * Abstand von der Mitte: ~10m → genug Platz für Clear-Zonen.
 */
const VARIANTS: CityVariant[] = [
  { name: "Winzig (×0.25)", scaleFactor: 0.25, clearRadius: 4,   x: 10, z: 0 },
  { name: "Klein (×0.5)",   scaleFactor: 0.5,  clearRadius: 6,   x: 0,  z: 10 },
  { name: "Normal (×1.0)",  scaleFactor: 1.0,  clearRadius: 9,   x: -10, z: 0 },
  { name: "Groß (×2.0)",    scaleFactor: 2.0,  clearRadius: 14,  x: 0,  z: -10 },
];

// Farben für Pheromonspuren und Labels
const CITY_COLORS = [0xff8844, 0xffcc44, 0x44ddff, 0xff66aa];

// ─── Labels (Sprite-Beschriftung) ──────────────────────────────────────

function makeLabel(text: string, color: number): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 96;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = "rgba(0,0,0,0.55)";
  const r = 12;
  ctx.beginPath();
  ctx.roundRect(0, 0, 512, 96, r);
  ctx.fill();

  const hex = "#" + color.toString(16).padStart(6, "0");
  ctx.fillStyle = hex;
  ctx.font = "bold 28px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 256, 48);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    sizeAttenuation: true,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(7, 1.3, 1);
  return sprite;
}

// ─── Komponente ────────────────────────────────────────────────────────

let canvas: HTMLCanvasElement;
let renderer: THREE.WebGPURenderer;
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let controls: OrbitControls;
let meadow: MeadowPatch | null = null;
let skyMesh: THREE.Mesh | null = null;
let pheromones: PheromoneSystem | null = null;
let flowers: Awaited<ReturnType<typeof createFlowers>> | null = null;
let cityInstances: THREE.Group[] = [];
let labels: THREE.Sprite[] = [];
let loading = $state(true);
let errorMsg = $state("");

onMount(async () => {
  renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  await renderer.init();

  scene = new THREE.Scene();

  // Kamera: Vogelperspektive auf das gesamte Feld
  camera = new THREE.PerspectiveCamera(
    45,
    window.innerWidth / window.innerHeight,
    0.1,
    200,
  );
  camera.position.set(18, 16, 18);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0);
  controls.maxPolarAngle = Math.PI / 2.1;
  controls.minDistance = 3;
  controls.maxDistance = 60;
  controls.update();

  // ── Atmosphäre ──
  const fogColor = new THREE.Color("#4a90d9");
  scene.background = fogColor;
  scene.fog = new THREE.FogExp2(fogColor, 0.012); // weiter Sicht für Test

  // ── Himmel ──
  skyMesh = createSky("klassisch");
  scene.add(skyMesh);

  // ── Eine große Wiese (40×40m) mit 30.000 Halmen ──
  // Die Wiese wird bei (0, 0) zentriert.
  // fieldSize=40 → 20m Radius → deckt alle Städte (max 14m Clear-Radius) gut ab.
  const meadowCfg = {
    fieldSize: 40,
    grassCount: 30000,
    curvature: 0.0003,
    color: "#6aaf4c",
    groundColor: "#4a8a2c",
    minHeight: 0.6,
    maxHeight: 1.8,
    windStrength: 0.05,
    windSpeedMultiplier: 0.8,
  };
  meadow = createMeadow(meadowCfg, 0, 0);
  scene.add(meadow.group);

  // Clear-Regionen für jede Stadt (Gras entfernen)
  for (const v of VARIANTS) {
    meadow.clearCircle(v.x, v.z, v.clearRadius);
  }

  // ── Wiesen-Mitte markieren ──
  scene.add(makeLabel("🌾 Wiesen-Mitte", 0x88dd88));

  // ── Städte und Labels laden ──
  await loadCities();
  await loadFlowers();

  // ── Pheromonspuren ──
  // Ziele: 8 Targets pro Stadt (für EVERY_NTH_FLOWER=8)
  const pheromoneTargets: FlowerTarget[] = [];
  for (let ci = 0; ci < VARIANTS.length; ci++) {
    const v = VARIANTS[ci];
    const color = new THREE.Color(CITY_COLORS[ci]);
    for (let j = 0; j < 8; j++) {
      const scatter = v.clearRadius * 0.6;
      const x = v.x + (Math.random() - 0.5) * scatter;
      const z = v.z + (Math.random() - 0.5) * scatter;
      pheromoneTargets.push({
        position: new THREE.Vector3(x, 0.3, z),
        color: color.clone(),
      });
    }
  }

  pheromones = new PheromoneSystem();
  // "playerPosition" = Mitte → Spur geht von Mitte zur Stadt
  pheromones.addTrails(pheromoneTargets, new THREE.Vector3(0, 2, 0));
  scene.add(pheromones.group);

  loading = false;

  // ── Animation Loop ──
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const elapsed = clock.getElapsedTime();
    if (meadow) meadow.tick(elapsed);
    if (pheromones) pheromones.update(elapsed);
    controls.update();
    renderer.render(scene, camera);
  });

  const onResize = () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  };
  window.addEventListener("resize", onResize);
});

/** Lädt Blumen in der Wiese (außerhalb der Clear-Zonen). */
async function loadFlowers() {
  try {
    const getHeightAt = meadow?.getHeightAt ?? undefined;

    // Blumen nur in der Wiesenmitte platzieren – die Städte haben Clear-Zonen
    flowers = await createFlowers(
      0,
      0,
      { count: 60, fieldSize: 30 },
      getHeightAt,
    );
    scene.add(flowers.group);
  } catch (e) {
    console.warn("Blumen konnten nicht geladen werden:", e);
  }
}

/** Lädt das Stadt-GLB und platziert alle 4 Varianten. */
async function loadCities() {
  try {
    const loader = new GLTFLoader();
    const gltf = await new Promise<THREE.Group>((resolve, reject) => {
      loader.load(
        CITY_MODEL_URL,
        (g) => resolve(g.scene),
        undefined,
        (err) => reject(err),
      );
    });

    for (let i = 0; i < VARIANTS.length; i++) {
      const v = VARIANTS[i];
      const group = new THREE.Group();

      const clone = gltf.clone(true);
      const scale = CITY_BASE_SCALE * v.scaleFactor;
      clone.scale.setScalar(scale);
      clone.position.set(0, 0, 0);
      clone.rotation.y = Math.random() * Math.PI * 2;

      group.add(clone);
      group.position.set(v.x, 0, v.z);

      scene.add(group);
      cityInstances.push(group);

      // Label über der Stadt platzieren
      const labelY = scale * 40 + 1.5; // über der Stadt schweben
      const label = makeLabel(v.name, CITY_COLORS[i]);
      label.position.set(v.x, labelY, v.z);
      scene.add(label);
      labels.push(label);
    }
  } catch (e) {
    console.error("Stadt-Modell konnte nicht geladen werden:", e);
    errorMsg = "⚠️ Stadt-Modell nicht gefunden. Zeige nur Wiese + Pheromonspuren.";
  }
}

onDestroy(() => {
  if (!browser) return;
  renderer?.setAnimationLoop(null);
  controls?.dispose();
  meadow?.dispose();
  if (skyMesh) {
    skyMesh.geometry.dispose();
    (skyMesh.material as THREE.Material).dispose();
  }
  flowers?.dispose();
  pheromones?.dispose();
  for (const g of cityInstances) {
    scene.remove(g);
    g.traverse((child) => {
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
  for (const l of labels) {
    scene.remove(l);
    (l.material as THREE.SpriteMaterial).map?.dispose();
    (l.material as THREE.SpriteMaterial).dispose();
  }
  renderer?.dispose();
});
</script>

<canvas bind:this={canvas}></canvas>

<div class="overlay">
  <h1>🏙️ Stadt-Größen im Wiesen-Vergleich</h1>

  <div class="legend">
    {#each VARIANTS as v, i}
      <div class="entry">
        <span class="dot" style="background: #{CITY_COLORS[i].toString(16).padStart(6, "0")}"></span>
        <span>{v.name}</span>
        <span class="detail">Clear-Radius: {v.clearRadius}m</span>
      </div>
    {/each}
  </div>

  {#if loading}
    <p class="hint">🔄 Lade Szene...</p>
  {/if}
  {#if errorMsg}
    <p class="error">{errorMsg}</p>
  {/if}
  <p class="hint">🖱️ Ziehen zum Drehen · Scrollen zum Zoomen · Farbige Pheromonspuren von der Mitte zu jeder Stadt</p>
</div>

<style>
  canvas {
    display: block;
    width: 100vw;
    height: 100vh;
  }
  :global(body) {
    margin: 0;
    overflow: hidden;
    background: #000;
  }

  .overlay {
    position: fixed;
    top: 1.5rem;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
    z-index: 10;
    font-family: system-ui, sans-serif;
    pointer-events: none;
    max-width: 90vw;
  }

  h1 {
    color: #fff;
    font-size: 1.1rem;
    font-weight: 600;
    margin: 0;
    text-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
    text-align: center;
  }

  .legend {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 0.5rem 1.2rem;
    background: rgba(0, 0, 0, 0.55);
    backdrop-filter: blur(8px);
    padding: 0.6rem 1.2rem;
    border-radius: 12px;
    color: #fff;
    font-size: 0.8rem;
    user-select: none;
    pointer-events: auto;
  }

  .entry {
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }

  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    display: inline-block;
    flex-shrink: 0;
  }

  .detail {
    color: #888;
    font-size: 0.65rem;
  }

  .error {
    color: #ff9966;
    font-size: 0.85rem;
    margin: 0;
    text-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
  }

  .hint {
    color: rgba(255, 255, 255, 0.5);
    font-size: 0.7rem;
    margin: 0;
    text-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
  }
</style>
