import * as THREE from "three/webgpu";
import type { ExperienceState } from "../types";
import type { SpaceWorldState } from "./scene";
import type { StarVariant } from "./welt/biome/sterne/index";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { film } from "three/addons/tsl/display/FilmNode.js";
import { float, length, mix, pass, smoothstep, uv } from "three/tsl";

const STAR_VARIANTS: StarVariant[] = ["classic", "milky", "nebula"];

export function applySettings(
  id: string,
  value: number | boolean | string,
  state: ExperienceState,
  _scene: THREE.Scene,
): void {
  const s = state as SpaceWorldState;

  switch (id) {
    // ── Flight ──────────────────────────────────────
    case "flightSpeed":
      s.baseSpeed = value as number;
      break;

    case "smoothing":
      s.lerpAlpha = value as number;
      break;

    case "turnSensitivity":
      s.rollYawMultiplier = value as number;
      break;

    case "boostEnabled":
      s.boostEnabled = value === true || value === 1;
      break;

    // ── Visual ──────────────────────────────────────
    case "starDensity":
      // Density is baked at creation — handled via variant changes
      break;

    case "bloomIntensity":
      s.bloomStrength = value as number;
      rebuildPostFX(s);
      break;

    case "grainIntensity":
      s.grainIntensity = value as number;
      rebuildPostFX(s);
      break;

    case "vignetteIntensity":
      s.vignetteIntensity = value as number;
      rebuildPostFX(s);
      break;

    // ── Stars ───────────────────────────────────────
    case "starVariant": {
      const idx = Math.round(value as number);
      const variant = STAR_VARIANTS[Math.max(0, Math.min(2, idx))];
      s.starBiome.setVariant(variant);
      break;
    }

    // "galaxyVariant" parameter kept for backward compat — now aliased to starVariant
    case "galaxyVariant": {
      const idx = Math.round(value as number);
      const variant = STAR_VARIANTS[Math.max(0, Math.min(2, idx))];
      s.starBiome.setVariant(variant);
      break;
    }
  }
}

function rebuildPostFX(s: SpaceWorldState): void {
  const pp = s.postProcessing;
  const scene = s.playerGroup.parent!;
  const camera = s.camera;

  const scenePass = pass(scene, camera);
  let output: THREE.Node = scenePass.getTextureNode("output");

  if (s.bloomStrength > 0) {
    output = output.add(bloom(output, s.bloomStrength, 0.4, 0.3));
  }

  if (s.vignetteIntensity > 0) {
    const dist = length(uv().sub(0.5));
    const factor = smoothstep(
      float(0.3),
      float(1.2),
      dist.mul(float(1.0).add(float(s.vignetteIntensity))),
    );
    output = mix(
      output,
      output.mul(float(1.0).sub(factor.mul(float(s.vignetteIntensity)))),
      float(1.0),
    );
  }

  if (s.grainIntensity > 0) {
    output = film(output, float(s.grainIntensity));
  }

  pp.outputNode = output;
}
