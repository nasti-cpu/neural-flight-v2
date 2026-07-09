/**
 * insect-world-v2 — Pheromonspuren.
 * Partikel-System für Duftspuren zu den Blüten.
 * Jede Spur hat die Farbe der Ziel-Blüte.
 *
 * Nutzt THREE.Points mit per-vertex Farben → nur 1 Draw Call.
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
    name: "Leuchtpfad",
    desc: "Dichter, schmaler Pfad aus hellen Partikeln",
    particlesPerTrail: 40,
    particleSize: 0.18,
    opacity: 0.85,
    trailLengthMin: 2.5,
    trailLengthMax: 6,
    windAmplitude: 0.25,
    windFrequency: 3,
    scatterWidth: 0.3,
    scatterHeight: 0.15,
    pulseSpeed: 1.5,
    pulseAmount: 0.25,
  },
  {
    name: "Glühwürmchen",
    desc: "Große leuchtende Punkte, verstreut – Spur reicht 20–35m weit",
    particlesPerTrail: 12,
    particleSize: 0.35,
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
  {
    name: "Funkelspur",
    desc: "Viele feine helle Funken, schmal",
    particlesPerTrail: 60,
    particleSize: 0.08,
    opacity: 0.75,
    trailLengthMin: 3,
    trailLengthMax: 7,
    windAmplitude: 0.2,
    windFrequency: 2,
    scatterWidth: 0.2,
    scatterHeight: 0.1,
    pulseSpeed: 3.0,
    pulseAmount: 0.4,
  },
  {
    name: "Lichtstrahl",
    desc: "Sehr dichter, gerader leuchtender Strahl",
    particlesPerTrail: 30,
    particleSize: 0.25,
    opacity: 0.95,
    trailLengthMin: 2,
    trailLengthMax: 4,
    windAmplitude: 0.1,
    windFrequency: 1.5,
    scatterWidth: 0.1,
    scatterHeight: 0.05,
    pulseSpeed: 1.0,
    pulseAmount: 0.15,
  },
  {
    name: "Schwebestaub",
    desc: "Ganz feine Partikel, breit schwebend",
    particlesPerTrail: 50,
    particleSize: 0.06,
    opacity: 0.5,
    trailLengthMin: 3,
    trailLengthMax: 8,
    windAmplitude: 0.6,
    windFrequency: 5,
    scatterWidth: 1.0,
    scatterHeight: 0.5,
    pulseSpeed: 1.2,
    pulseAmount: 0.2,
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

export class PheromoneSystem {
  readonly group = new THREE.Group();
  private variantIndex = 1; // 1 = Glühwürmchen
  private glowTexture: THREE.CanvasTexture;
  private points: THREE.Points | null = null;

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
    if (!this.points) return 0;
    return this.points.geometry.getAttribute("position").count;
  }

  setVariant(index: number): void {
    this.variantIndex = Math.max(0, Math.min(index, VARIANTS.length - 1));
  }

  addTrails(
    flowers: FlowerTarget[],
    playerPosition: THREE.Vector3 = new THREE.Vector3(0, 2, 0),
  ): void {
    this.clearPoints();
    const v = VARIANTS[this.variantIndex];
    const allPositions: number[] = [];
    const allColors: number[] = [];

    for (let i = PHEROMON.EVERY_NTH_FLOWER - 1; i < flowers.length; i += PHEROMON.EVERY_NTH_FLOWER) {
      this.collectTrailParticles(flowers[i], v, playerPosition, allPositions, allColors);
    }

    if (allPositions.length === 0) return;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(allPositions, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(allColors, 3));

    const mat = new THREE.PointsMaterial({
      map: this.glowTexture,
      transparent: true,
      opacity: v.opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      size: v.particleSize,
      sizeAttenuation: true,
      vertexColors: true,
    });

    this.points = new THREE.Points(geo, mat);
    this.group.add(this.points);
  }

  rebuild(
    flowers: FlowerTarget[],
    playerPosition: THREE.Vector3 = new THREE.Vector3(0, 2, 0),
  ): void {
    this.addTrails(flowers, playerPosition);
  }

  update(elapsed: number): void {
    if (!this.points) return;
    const v = VARIANTS[this.variantIndex];
    const pulse = 1 - v.pulseAmount + v.pulseAmount * Math.sin(elapsed * v.pulseSpeed);
    (this.points.material as THREE.PointsMaterial).opacity = v.opacity * pulse;
  }

  private collectTrailParticles(
    flower: FlowerTarget,
    v: PheromonVariant,
    playerPosition: THREE.Vector3,
    outPos: number[],
    outCol: number[],
  ): void {
    const count = v.particlesPerTrail;
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

    const saturated = maxSaturate(flower.color);
    const cr = saturated.r;
    const cg = saturated.g;
    const cb = saturated.b;

    for (let i = 0; i < count; i++) {
      const t = Math.random();
      const idx = Math.floor(t * steps);
      const frac = t * steps - idx;
      const nextIdx = Math.min(idx + 1, steps);
      const p = new THREE.Vector3().lerpVectors(curve[idx], curve[nextIdx], frac);

      const dir = new THREE.Vector3().subVectors(
        curve[Math.min(idx + 2, steps)],
        curve[Math.max(idx - 2, 0)],
      ).normalize();

      const perp = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
      const scatterFactor = t * (1 - t) * 4;
      const sw = v.scatterWidth * scatterFactor;
      const sh = v.scatterHeight * scatterFactor;
      const oh = (Math.random() - 0.5) * sw;
      const ov = (Math.random() - 0.5) * sh;

      outPos.push(
        p.x + perp.x * oh,
        p.y + ov,
        p.z + perp.z * oh,
      );
      outCol.push(cr, cg, cb);
    }
  }

  private clearPoints(): void {
    if (this.points) {
      this.group.remove(this.points);
      this.points.geometry.dispose();
      (this.points.material as THREE.PointsMaterial).dispose();
      this.points = null;
    }
  }

  dispose(): void {
    this.clearPoints();
    this.glowTexture.dispose();
  }
}
