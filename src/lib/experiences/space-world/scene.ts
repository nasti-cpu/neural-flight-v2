/**
 * Space World Scene — WebGPU-native VR experience
 *
 * Infinite deep-space universe: the world is divided into a grid of
 * 500-unit cells. Each cell gets a deterministic star variant (classic,
 * milky, or nebula) via a hash function. A 3×3 grid of biomes surrounds
 * the player at all times. As you fly, new biomes stream in ahead and
 * old ones unload behind — you literally fly from one star region into
 * the next.
 *
 * All biome code is imported from ./welt/biome/sterne/ — changes are
 * picked up automatically.
 */

import * as THREE from "three/webgpu";
import {
  attribute,
  Fn,
  float,
  length,
  mix,
  pass,
  smoothstep,
  uv,
  vec3,
  vec4,
} from "three/tsl";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { film } from "three/addons/tsl/display/FilmNode.js";
import { PointsNodeMaterial } from "three/webgpu";
import type { ExperienceState, SetupContext, TickContext } from "../types";
import { createStarBiome } from "./welt/biome/sterne/index";
import type { StarBiomeSystem, StarVariant } from "./welt/biome/sterne/index";

// ── Constants ──────────────────────────────────────────────────────

/** Size of one biome cell in world units */
const BIOME_CELL_SIZE = 500;
/** Grid radius around player (1 = 3×3 grid) */
const BIOME_GRID_RADIUS = 1;
/** Auto-drift speed when not accelerating */
const AUTO_DRIFT_SPEED = 12;
/** How many background star layers (very distant, for depth) */
const BG_LAYER_COUNT = 3;

// ── State ──────────────────────────────────────────────────────────

interface BiomeCell {
  cx: number;
  cz: number;
  biome: StarBiomeSystem;
}

export interface SpaceWorldState extends ExperienceState {
  camera: THREE.PerspectiveCamera;
  playerGroup: THREE.Group;
  /** Active biome cells around the player */
  cells: Map<string, BiomeCell>;
  /** Last grid cell the player was in (for streaming detection) */
  lastCX: number;
  lastCZ: number;
  /** Very distant background layers (always classic dots, for depth) */
  bgLayers: THREE.Points[];
  /** Post-processing pipeline */
  postProcessing: THREE.PostProcessing;
  // Flight
  baseSpeed: number;
  lerpAlpha: number;
  rollYawMultiplier: number;
  boostEnabled: boolean;
  currentSpeed: number;
  targetSpeed: number;
  // Keyboard state
  keys: Set<string>;
  // PostFX
  bloomStrength: number;
  grainIntensity: number;
  vignetteIntensity: number;
}

// ── Biome Grid ─────────────────────────────────────────────────────

// Only classic for now. To re-add milky/nebula, replace "classic" with
// hashVariant(cx, cz) — see commented function below.

// const STAR_VARIANTS: StarVariant[] = ["classic", "milky", "nebula"];
// function hashVariant(cx: number, cz: number): StarVariant {
//   const h = ((cx * 374761393 + cz * 668265263) & 0x7fffffff) % 3;
//   return STAR_VARIANTS[Math.abs(h)];
// }

function cellKey(cx: number, cz: number): string {
  return `${cx},${cz}`;
}

function createBiomeCell(cx: number, cz: number): BiomeCell {
  // const variant = hashVariant(cx, cz); // Re-add for mixed biomes
  const variant: StarVariant = "classic";
  const biome = createStarBiome(variant);
  biome.group.position.set(cx * BIOME_CELL_SIZE, 0, cz * BIOME_CELL_SIZE);
  return { cx, cz, biome };
}

// ── Background Star Layers ─────────────────────────────────────────

function createBackgroundLayer(
  count: number,
  radius: number,
  colorMix: number,
): THREE.Points {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const r = radius * (0.85 + Math.random() * 0.15);

    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = r * Math.cos(phi);

    const b = 0.5 + Math.random() * 0.5;
    colors[i * 3] = b;
    colors[i * 3 + 1] = b * (0.85 + Math.random() * 0.15);
    colors[i * 3 + 2] = b * (0.7 + Math.random() * 0.3 * colorMix);

    sizes[i] = 0.1 + Math.random() * 0.4;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const sizeAttr = new THREE.BufferAttribute(sizes, 1);
  geo.setAttribute("aSize", sizeAttr);

  const mat = new PointsNodeMaterial();
  mat.sizeNode = attribute("aSize", "float");
  mat.sizeAttenuation = true;
  mat.transparent = true;
  mat.depthWrite = false;
  mat.blending = THREE.AdditiveBlending;
  mat.colorNode = vec4(attribute("color", "vec3"), float(1.0));

  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  return points;
}

// ── TSL Post-Processing ────────────────────────────────────────────

const vignetteFn = Fn(([color, intensity]: [THREE.Node, THREE.Node]) => {
  const dist = length(uv().sub(0.5));
  const factor = smoothstep(
    float(0.3),
    float(1.2),
    dist.mul(float(1.0).add(intensity)),
  );
  return mix(
    color,
    color.mul(float(1.0).sub(factor.mul(intensity))),
    float(1.0),
  );
});

function createPostFX(
  renderer: THREE.WebGPURenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  config: {
    bloomStrength: number;
    grainIntensity: number;
    vignetteIntensity: number;
  },
): THREE.PostProcessing {
  const pp = new THREE.PostProcessing(renderer);
  const scenePass = pass(scene, camera);
  let output: THREE.Node = scenePass.getTextureNode("output");

  output = output.add(bloom(output, config.bloomStrength, 0.4, 0.3));

  if (config.vignetteIntensity > 0) {
    output = vignetteFn(output, float(config.vignetteIntensity));
  }
  if (config.grainIntensity > 0) {
    output = film(output, float(config.grainIntensity));
  }

  pp.outputNode = output;
  return pp;
}

// ── Helpers ────────────────────────────────────────────────────────

function getWASD(keys: Set<string>): {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
} {
  return {
    forward: keys.has("KeyW") || keys.has("ArrowUp"),
    backward: keys.has("KeyS") || keys.has("ArrowDown"),
    left: keys.has("KeyA") || keys.has("ArrowLeft"),
    right: keys.has("KeyD") || keys.has("ArrowRight"),
    up: keys.has("KeyR"),
    down: keys.has("KeyF"),
  };
}

function gridCoord(worldPos: number): number {
  return Math.floor(worldPos / BIOME_CELL_SIZE);
}

// ── Setup ──────────────────────────────────────────────────────────

export async function setup(ctx: SetupContext): Promise<SpaceWorldState> {
  const renderer = ctx.renderer as THREE.WebGPURenderer;

  // ── Camera Rig ──
  const playerGroup = new THREE.Group();
  playerGroup.position.set(0, 0, 0);
  ctx.scene.add(playerGroup);

  const camera = new THREE.PerspectiveCamera(90, 1, 0.1, 10000);
  camera.position.set(0, 0, 0);
  playerGroup.add(camera);

  // ── Initial Biome Grid (3×3 around origin) ──
  const cells = new Map<string, BiomeCell>();
  const pcx = gridCoord(playerGroup.position.x);
  const pcz = gridCoord(playerGroup.position.z);

  for (let dx = -BIOME_GRID_RADIUS; dx <= BIOME_GRID_RADIUS; dx++) {
    for (let dz = -BIOME_GRID_RADIUS; dz <= BIOME_GRID_RADIUS; dz++) {
      const cx = pcx + dx;
      const cz = pcz + dz;
      const cell = createBiomeCell(cx, cz);
      cells.set(cellKey(cx, cz), cell);
      ctx.scene.add(cell.biome.group);
    }
  }

  // ── Background Star Layers (very distant, always classic) ──
  const bgLayers: THREE.Points[] = [];
  const bgRadii = [1200, 1800, 2800];
  for (const radius of bgRadii) {
    const layer = createBackgroundLayer(400, radius, radius / 3000);
    ctx.scene.add(layer);
    bgLayers.push(layer);
  }

  // ── Post-Processing ──
  const postProcessing = createPostFX(renderer, ctx.scene, camera, {
    bloomStrength: 1.2,
    grainIntensity: 0.04,
    vignetteIntensity: 0.15,
  });

  // ── Keyboard ──
  const keys = new Set<string>();
  const onKeyDown = (e: KeyboardEvent) => keys.add(e.code);
  const onKeyUp = (e: KeyboardEvent) => keys.delete(e.code);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);

  (playerGroup as THREE.Group & { _keyCleanup?: () => void })._keyCleanup =
    () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };

  return {
    camera,
    playerGroup,
    cells,
    lastCX: pcx,
    lastCZ: pcz,
    bgLayers,
    postProcessing,
    baseSpeed: 15,
    lerpAlpha: 0.08,
    rollYawMultiplier: 1.2,
    boostEnabled: true,
    currentSpeed: AUTO_DRIFT_SPEED,
    targetSpeed: AUTO_DRIFT_SPEED,
    keys,
    bloomStrength: 1.2,
    grainIntensity: 0.04,
    vignetteIntensity: 0.15,
  };
}

// ── Tick ───────────────────────────────────────────────────────────

export function tick(
  state: ExperienceState,
  ctx: TickContext,
): { state: ExperienceState; outputs?: Record<string, number> } {
  const s = state as SpaceWorldState;
  const delta = ctx.delta;

  // ── WASD Keyboard Flight ──
  const wasd = getWASD(s.keys);
  const turnRate = s.rollYawMultiplier * 1.5;

  if (wasd.left) s.playerGroup.rotateY(turnRate * delta);
  if (wasd.right) s.playerGroup.rotateY(-turnRate * delta);
  if (wasd.up) s.playerGroup.rotateX(-turnRate * delta * 0.7);
  if (wasd.down) s.playerGroup.rotateX(turnRate * delta * 0.7);

  s.playerGroup.rotation.x = Math.max(
    -Math.PI * 0.44,
    Math.min(Math.PI * 0.44, s.playerGroup.rotation.x),
  );

  const speedFromKeyboard = (wasd.forward ? 1 : 0) - (wasd.backward ? 1 : 0);
  if (speedFromKeyboard !== 0) {
    s.targetSpeed = s.baseSpeed * speedFromKeyboard;
  }

  s.currentSpeed += (s.targetSpeed - s.currentSpeed) * s.lerpAlpha * 60 * delta;

  const forward = new THREE.Vector3(0, 0, -1);
  forward.applyQuaternion(s.playerGroup.quaternion);
  s.playerGroup.position.addScaledVector(forward, s.currentSpeed * delta);

  // ── Biome Grid Streaming ──
  const pcx = gridCoord(s.playerGroup.position.x);
  const pcz = gridCoord(s.playerGroup.position.z);

  if (pcx !== s.lastCX || pcz !== s.lastCZ) {
    // Player crossed into a new grid cell — stream biomes
    const needed = new Set<string>();
    for (let dx = -BIOME_GRID_RADIUS; dx <= BIOME_GRID_RADIUS; dx++) {
      for (let dz = -BIOME_GRID_RADIUS; dz <= BIOME_GRID_RADIUS; dz++) {
        needed.add(cellKey(pcx + dx, pcz + dz));
      }
    }

    // Remove cells that are no longer needed
    for (const [key, cell] of s.cells) {
      if (!needed.has(key)) {
        cell.biome.dispose();
        ctx.camera.parent?.parent?.remove(cell.biome.group);
        s.cells.delete(key);
      }
    }

    // Add new cells
    for (const key of needed) {
      if (!s.cells.has(key)) {
        const [cxStr, czStr] = key.split(",");
        const cx = Number.parseInt(cxStr);
        const cz = Number.parseInt(czStr);
        const cell = createBiomeCell(cx, cz);
        s.cells.set(key, cell);
        ctx.camera.parent?.parent?.add(cell.biome.group);
      }
    }

    s.lastCX = pcx;
    s.lastCZ = pcz;
  }

  // ── Update all active biomes ──
  for (const cell of s.cells.values()) {
    cell.biome.update(delta, ctx.elapsed);
  }

  // ── Center background layers on player ──
  for (const layer of s.bgLayers) {
    layer.position.copy(s.playerGroup.position);
  }

  // ── Render via post-processing ──
  s.postProcessing.render();

  return { state: s };
}

// ── Dispose ────────────────────────────────────────────────────────

export function dispose(state: ExperienceState, scene: THREE.Scene): void {
  const s = state as SpaceWorldState;

  const pg = s.playerGroup as THREE.Group & { _keyCleanup?: () => void };
  pg._keyCleanup?.();

  s.postProcessing.dispose();

  for (const cell of s.cells.values()) {
    cell.biome.dispose();
    scene.remove(cell.biome.group);
  }
  s.cells.clear();

  for (const layer of s.bgLayers) {
    layer.geometry.dispose();
    (layer.material as THREE.Material).dispose();
    scene.remove(layer);
  }

  scene.remove(s.playerGroup);
  while (s.playerGroup.children.length > 0) {
    s.playerGroup.remove(s.playerGroup.children[0]);
  }
}
