/**
 * insect-world-v2 — Pheromonspuren.
 * Partikel-System für Duftspuren zu den Blüten.
 * Jede Spur hat die Farbe der Ziel-Blüte.
 *
 * Nutzt THREE.Sprite + SpriteMaterial (Points rendert map in WebGPU nicht).
 * Reduzierte Partikelanzahl für Performance.
 *
 * WebGPU-konform.
 */
import * as THREE from "three/webgpu";

export interface PheromonVariant {
  name: string;
  desc: string;
  particlesPerTrail: number;
  particleSize: number;
  opacity: number;
  trailLengthMin: number;
  trailLengthMax: number;
  windAmplitude: number;
  windFrequency: number;
  scatterWidth: number;
  scatterHeight: number;
  pulseSpeed: number;
  pulseAmount: number;
}

export const VARIANTS: PheromonVariant[] = [
  {
    name: "Glühwürmchen",
    desc: "Große leuchtende Punkte, verstreut – Spur reicht 20–35m weit",
    particlesPerTrail: 12,
    particleSize: 0.5,
    opacity: 0.9,
    trailLengthMin: 20,
    trailLengthMax: 35,
    windAmplitude: 0.4,
    windFrequency: 4,
    scatterWidth: 0.6,
    scatterHeight: 0.3,
    pulseSpeed: 2.0,
    pulseAmount: 0.35,
  },
];

export const PHEROMON = {
  EVERY_NTH_FLOWER: 8,
} as const;

export interface FlowerTarget {
  position: THREE.Vector3;
  color: THREE.Color;
}

function maxSaturate(color: THREE.Color): THREE.Color {
  const hsl = { h: 0, s: 0, l: 0 };
  color.getHSL(hsl);
  if (hsl.l > 0.7 && hsl.s < 0.4) {
    return new THREE.Color(0xffffff);
  }
  return new THREE.Color().setHSL(hsl.h, 1, 0.6);
}

function createGlowTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(
    size / 2, size / 2, 0,
    size / 2, size / 2, size / 2,
  );
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.08, "rgba(255,255,255,0.85)");
  gradient.addColorStop(0.25, "rgba(255,255,255,0.4)");
  gradient.addColorStop(0.5, "rgba(255,255,255,0.15)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

interface Trail {
  sprites: THREE.Sprite[];
  material: THREE.SpriteMaterial;
  phase: number;
}

export class PheromoneSystem {
  readonly group = new THREE.Group();
  private trails: Trail[] = [];
  private variantIndex = 0; // 0 = Glühwürmchen
  private glowTexture: THREE.CanvasTexture;

  constructor() {
    this.glowTexture = createGlowTexture();
  }

  get currentVariant(): number {
    return this.variantIndex;
  }

  get currentVariantName(): string {
    return VARIANTS[this.variantIndex].name;
  }

  get trailCount(): number {
    return this.trails.length;
  }

  setVariant(index: number): void {
    this.variantIndex = Math.max(0, Math.min(index, VARIANTS.length - 1));
  }

  addTrails(
    flowers: FlowerTarget[],
    playerPosition: THREE.Vector3 = new THREE.Vector3(0, 2, 0),
  ): void {
    this.clearTrails();
    const v = VARIANTS[this.variantIndex];
    for (let i = PHEROMON.EVERY_NTH_FLOWER - 1; i < flowers.length; i += PHEROMON.EVERY_NTH_FLOWER) {
      this.addTrail(flowers[i], v, playerPosition);
    }
  }

  rebuild(
    flowers: FlowerTarget[],
    playerPosition: THREE.Vector3 = new THREE.Vector3(0, 2, 0),
  ): void {
    this.addTrails(flowers, playerPosition);
  }

  private addTrail(
    flower: FlowerTarget,
    v: PheromonVariant,
    playerPosition: THREE.Vector3,
  ): void {
    const count = v.particlesPerTrail;
    const positions = new Float32Array(count * 3);

    const dirToPlayer = new THREE.Vector3().subVectors(playerPosition, flower.position);
    dirToPlayer.y = 0;
    dirToPlayer.normalize();

    const dist = v.trailLengthMin + Math.random() * (v.trailLengthMax - v.trailLengthMin);
    const startX = flower.position.x + dirToPlayer.x * dist;
    const startZ = flower.position.z + dirToPlayer.z * dist;
    const startY = 0.8 + Math.random() * 0.7;

    const steps = 80;
    const curve: THREE.Vector3[] = [];
    const windBaseAngle = Math.atan2(dirToPlayer.z, dirToPlayer.x);

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      let x = startX * (1 - t) + flower.position.x * t;
      let z = startZ * (1 - t) + flower.position.z * t;
      let y = startY * (1 - t) + flower.position.y * t;

      const windPhase = windBaseAngle + t * v.windFrequency * 2;
      const wind = v.windAmplitude * t * (1 - t) * 4;
      x += Math.sin(windPhase) * wind;
      z += Math.cos(windPhase * 0.8) * wind;
      y += Math.sin(windPhase * 1.2) * wind * 0.3;

      curve.push(new THREE.Vector3(x, y, z));
    }

    for (let i = 0; i < count; i++) {
      const t = Math.random();
      const idx = Math.floor(t * steps);
      const frac = t * steps - idx;
      const nextIdx = Math.min(idx + 1, steps);

      const p = new THREE.Vector3().lerpVectors(curve[idx], curve[nextIdx], frac);

      const dir = new THREE.Vector3()
        .subVectors(curve[Math.min(idx + 2, steps)], curve[Math.max(idx - 2, 0)])
        .normalize();

      const perp = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
      const scatterFactor = t * (1 - t) * 4;
      const sw = v.scatterWidth * scatterFactor;
      const sh = v.scatterHeight * scatterFactor;
      const oh = (Math.random() - 0.5) * sw;
      const ov = (Math.random() - 0.5) * sh;

      positions[i * 3] = p.x + perp.x * oh;
      positions[i * 3 + 1] = p.y + ov;
      positions[i * 3 + 2] = p.z + perp.z * oh;
    }

    const material = new THREE.SpriteMaterial({
      map: this.glowTexture,
      color: maxSaturate(flower.color),
      transparent: true,
      opacity: v.opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const sprites: THREE.Sprite[] = [];
    for (let i = 0; i < count; i++) {
      const sprite = new THREE.Sprite(material);
      sprite.position.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
      sprite.scale.set(v.particleSize, v.particleSize, 1);
      this.group.add(sprite);
      sprites.push(sprite);
    }

    this.trails.push({
      sprites,
      material,
      phase: Math.random() * Math.PI * 2,
    });
  }

  update(elapsed: number): void {
    const v = VARIANTS[this.variantIndex];
    for (const trail of this.trails) {
      const pulse = 1 - v.pulseAmount + v.pulseAmount * Math.sin(elapsed * v.pulseSpeed + trail.phase);
      trail.material.opacity = v.opacity * pulse;
    }
  }

  private clearTrails(): void {
    for (const trail of this.trails) {
      for (const sprite of trail.sprites) {
        this.group.remove(sprite);
      }
      trail.material.dispose();
    }
    this.trails = [];
  }

  dispose(): void {
    this.clearTrails();
    this.glowTexture.dispose();
  }
}
