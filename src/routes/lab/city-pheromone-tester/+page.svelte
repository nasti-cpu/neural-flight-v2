<script lang="ts">
/**
 * LAB EXPERIMENT — City + Neon-Guide + Blumen-Pheromon (WebGPU)
 *
 * Vergleich: Neon-GuidePath (Fein & lang) vs. Blumen-Pheromonspur.
 * Stadt in Normalgröße (×1.0), per BoundingBox zentriert in der Clear-Zone.
 *
 * WebGPU + TSL.
 */
import { onDestroy, onMount } from "svelte";
import { browser } from "$app/environment";
import * as THREE from "three/webgpu";
import { vec3 } from "three/tsl";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { createMeadow, type MeadowPatch } from "$lib/experiences/insect-world-v2/Biome/Wiese/grass";
import { createSky } from "$lib/experiences/insect-world-v2/Biome/blauerHimmel/sky";
import { CityGuidePath } from "$lib/experiences/insect-world-v2/Objekte/Stadt/city-guide-path";
import { PheromoneSystem } from "$lib/experiences/insect-world-v2/Sinne/Pheromonspuren/pheromonspuren";
import type { FlowerTarget } from "$lib/experiences/insect-world-v2/Objekte/Blumen/blumen";

const CITY_BASE_SCALE = 0.00025;
const CITY_MODEL_URL = "/models/stadt/around_the_world_map_1.glb";
const CITY_SCALE = CITY_BASE_SCALE * 1.0;

function makeLabel(text: string, sub: string, color: number): THREE.Sprite {
  const c = document.createElement("canvas");
  c.width = 512; c.height = 100;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.beginPath(); ctx.roundRect(0, 0, 512, 100, 12); ctx.fill();
  ctx.fillStyle = "#" + color.toString(16).padStart(6, "0");
  ctx.font = "bold 26px system-ui, sans-serif";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(text, 256, 34);
  ctx.fillStyle = "#ccc"; ctx.font = "16px system-ui, sans-serif";
  ctx.fillText(sub, 256, 72);
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, sizeAttenuation: true });
  const s = new THREE.Sprite(mat);
  s.scale.set(8, 1.6, 1);
  return s;
}

let canvas: HTMLCanvasElement;
let renderer: THREE.WebGPURenderer;
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let controls: OrbitControls;
let meadow: MeadowPatch | null = null;
let skyMesh: THREE.Mesh | null = null;
let guidePath: CityGuidePath | null = null;
let pheromoneSystem: PheromoneSystem | null = null;
let cityGroup: THREE.Group | null = null;
let loading = $state(true);
let errorMsg = $state("");

onMount(async () => {
  renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  await renderer.init();

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 200);
  camera.position.set(18, 12, 24);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0);
  controls.maxPolarAngle = Math.PI / 2.1;
  controls.minDistance = 3;
  controls.maxDistance = 80;
  controls.update();

  const fogColor = new THREE.Color("#1a1a2e");
  scene.background = fogColor;
  scene.fog = new THREE.FogExp2(fogColor, 0.008);

  skyMesh = createSky("tief");
  scene.add(skyMesh);

  // Lichter für das Stadt-Modell (GLB braucht MeshStandardMaterial-Licht)
  const ambient = new THREE.AmbientLight(0x8899bb, 0.6);
  scene.add(ambient);
  const sun = new THREE.DirectionalLight(0xfff4e0, 2.5);
  sun.position.set(0.5, 0.8, 0.3).normalize();
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0x4488ff, 0.5);
  fill.position.set(-0.5, 0.3, -0.8).normalize();
  scene.add(fill);

  // Wiese
  meadow = createMeadow({ fieldSize: 30, grassCount: 20000, curvature: 0.0003, color: "#5a7a4c", groundColor: "#3a5a2c", minHeight: 0.4, maxHeight: 1.4, windStrength: 0.04, windSpeedMultiplier: 0.8 }, 0, 0);
  scene.add(meadow.group);
  meadow.clearCircle(0, 0, 4);

  // Stadt laden
  await loadCity();

  // Neon-GuidePath (Fein & lang, links)
  guidePath = new CityGuidePath({ neonColor: 0x44ffff, dashLength: 0.5, gapLength: 0.3, spriteSizeMin: 0.6, spriteSizeMax: 1.0, spritesPerDash: 3 });
  guidePath.setTarget(new THREE.Vector3(-10, 0.5, 0), new THREE.Vector3(0, 0.5, 0));
  scene.add(guidePath.group);
  const l1 = makeLabel("🔹 Neon-GuidePath", "Fein & lang — Dash 0.5m · Gap 0.3m", 0x44ffff);
  l1.position.set(-10, 2.8, 0);
  scene.add(l1);

  // Blumen-Pheromon (rechts)
  const pStart = new THREE.Vector3(10, 0.5, 0);
  const targets: FlowerTarget[] = [];
  for (let j = 0; j < 8; j++) {
    targets.push({ position: new THREE.Vector3((Math.random() - 0.5) * 1.0, 0.3, (Math.random() - 0.5) * 1.0), color: new THREE.Color(0xff44ff) });
  }
  pheromoneSystem = new PheromoneSystem();
  pheromoneSystem.addTrails(targets, pStart);
  scene.add(pheromoneSystem.group);
  const l2 = makeLabel("🌸 Blumen-Pheromon", "Glühwürmchen — Particle 0.5 · 20–35m", 0xff44ff);
  l2.position.set(10, 2.8, 0);
  scene.add(l2);

  loading = false;

  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const elapsed = clock.getElapsedTime();
    if (meadow) meadow.tick(elapsed);
    guidePath?.update(elapsed);
    pheromoneSystem?.update(elapsed);
    controls.update();
    renderer.render(scene, camera);
  });

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
});

/** Stadt laden: skalieren → Geometrie zentrieren (Vertices verschieben) → in Szene setzen */
async function loadCity() {
  try {
    const gltf = await new Promise<THREE.Group>((resolve, reject) => {
      new GLTFLoader().load(CITY_MODEL_URL, (g) => resolve(g.scene), undefined, (err) => reject(err));
    });
    const clone = gltf.clone(true);

    // 1. Skalieren
    clone.scale.setScalar(CITY_SCALE);

    // 2. Bounding Box des skalierten Modells berechnen
    const box = new THREE.Box3().setFromObject(clone);
    const center = new THREE.Vector3();
    box.getCenter(center);
    console.log("Stadt BBox Center:", center, "Size:", box.getSize(new THREE.Vector3()));

    // 3. Wrapper-Gruppe: Modell reinsetzen, WRAPPER um -center verschieben
    //    Nur XZ zentrieren, Y so dass der tiefste Punkt (box.min.y) auf Y=0 liegt
    clone.position.set(0, 0, 0);
    const group = new THREE.Group();
    group.add(clone);
    group.position.set(-center.x, -box.min.y, -center.z);
    scene.add(group);
    cityGroup = group;

    // 4. Kleiner roter Punkt bei (0,0,0) zur Kontrolle
    const markerGeo = new THREE.SphereGeometry(0.2, 8, 8);
    const markerMat = new THREE.MeshBasicNodeMaterial();
    markerMat.colorNode = vec3(1, 0, 0);
    const marker = new THREE.Mesh(markerGeo, markerMat);
    marker.position.set(0, 0.2, 0);
    scene.add(marker);
  } catch (e) {
    console.error("Stadt-Modell nicht geladen:", e);
    errorMsg = "⚠️ Stadt-Modell nicht gefunden.";
  }
}

onDestroy(() => {
  if (!browser) return;
  renderer?.setAnimationLoop(null);
  controls?.dispose();
  meadow?.dispose();
  if (skyMesh) { skyMesh.geometry.dispose(); (skyMesh.material as THREE.Material).dispose(); }
  guidePath?.dispose();
  pheromoneSystem?.dispose();
  if (cityGroup) {
    scene.remove(cityGroup);
    cityGroup.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
        else child.material.dispose();
      }
    });
  }
  renderer?.dispose();
});
</script>

<canvas bind:this={canvas}></canvas>

<div class="overlay">
  <h1>🏙️ Stadt Normal ×1.0 — Neon-Guide vs. Blumen-Pheromon</h1>
  <div class="legend">
    <div class="entry">
      <span class="dot" style="background:#44ffff"></span>
      <span>🔹 Neon-GuidePath (Fein & lang)</span>
      <span class="detail">Gestrichelte Glow-Sprites · Dash 0.5m · Gap 0.3m</span>
    </div>
    <div class="entry">
      <span class="dot" style="background:#ff44ff"></span>
      <span>🌸 PheromoneSystem (Glühwürmchen)</span>
      <span class="detail">Leucht-Partikel · Particle 0.5 · 20-35m Spur</span>
    </div>
  </div>
  {#if loading}<p class="hint">🔄 Lade Szene...</p>{/if}
  {#if errorMsg}<p class="error">{errorMsg}</p>{/if}
  <p class="hint">🖱️ Ziehen · Scrollen · Stadt zentriert im graslosen Radius (12m) · Neon gestrichelt vs. Partikel-Pheromon</p>
</div>

<style>
  canvas { display: block; width: 100vw; height: 100vh; }
  :global(body) { margin: 0; overflow: hidden; background: #000; }
  .overlay { position: fixed; top: 1.5rem; left: 50%; transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; gap: 0.75rem; z-index: 10; font-family: system-ui, sans-serif; pointer-events: none; max-width: 95vw; }
  h1 { color: #fff; font-size: 1rem; font-weight: 600; margin: 0; text-shadow: 0 2px 8px rgba(0,0,0,0.5); text-align: center; }
  .legend { display: flex; flex-wrap: wrap; justify-content: center; gap: 0.35rem 0.8rem; background: rgba(0,0,0,0.6); backdrop-filter: blur(8px); padding: 0.5rem 1rem; border-radius: 12px; color: #fff; font-size: 0.7rem; user-select: none; pointer-events: auto; }
  .entry { display: flex; align-items: center; gap: 0.3rem; }
  .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
  .detail { color: #888; font-size: 0.6rem; }
  .error { color: #ff9966; font-size: 0.85rem; margin: 0; text-shadow: 0 1px 4px rgba(0,0,0,0.5); }
  .hint { color: rgba(255,255,255,0.5); font-size: 0.65rem; margin: 0; text-shadow: 0 1px 4px rgba(0,0,0,0.3); }
</style>