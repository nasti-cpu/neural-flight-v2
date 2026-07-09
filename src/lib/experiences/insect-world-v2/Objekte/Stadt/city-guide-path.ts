/**
 * insect-world-v2 — City Guide Path.
 * Ein leuchtender Neon-Pfad (gestrichelt, Glow-Sprites),
 * der vom Startpunkt (0, 2, 0) zur Stadt führt und dem Gelände folgt.
 *
 * Nutzt THREE.Sprite (nicht Points – Points rendert map in WebGPU nicht).
 * Pfad auf 150m begrenzt (dahinter alles im Nebel).
 *
 * WebGPU-konform.
 */
import * as THREE from "three/webgpu";
import { getWorldHeight } from "../../Biome/Wiese/grass-manager";

// ── Standard-Konfiguration ──

export interface GuidePathConfig {
  neonColor?: number;
  dashLength?: number;
  gapLength?: number;
  pathHeightMin?: number;
  pathHeightMax?: number;
  spriteSizeMin?: number;
  spriteSizeMax?: number;
  spritesPerDash?: number;
}

const DEFAULTS: Required<GuidePathConfig> = {
  neonColor: 0x44ffff,
  dashLength: 1.2,
  gapLength: 0.6,
  pathHeightMin: 0.5,
  pathHeightMax: 1.8,
  spriteSizeMin: 0.6,
  spriteSizeMax: 1.2,
  spritesPerDash: 3,
};

export class CityGuidePath {
  readonly group = new THREE.Group();
  private active = false;
  private glowTexture: THREE.CanvasTexture;
  private phases: number[] = [];
  private config: Required<GuidePathConfig>;

  constructor(config?: GuidePathConfig) {
    this.config = { ...DEFAULTS, ...config };
    this.glowTexture = this.createGlowTexture();
  }

  setTarget(from: THREE.Vector3, to: THREE.Vector3): void {
    this.clear();

    // Pfad auf 150m begrenzen (Nebel-Sichtweite ~80m)
    const _dir = new THREE.Vector3().copy(to).sub(from);
    const dist = _dir.length();
    const maxDist = 150;
    if (dist > maxDist) {
      _dir.normalize().multiplyScalar(maxDist);
      to = new THREE.Vector3().copy(from).add(_dir);
    }

    const points = this.buildCurve(from, to);
    if (points.length < 2) return;

    this.buildGlowDashes(points);
    this.active = true;
  }

  clear(): void {
    this.disposeSprites();
    this.active = false;
  }

  update(elapsed: number): void {
    if (!this.active) return;

    let idx = 0;
    for (const child of this.group.children) {
      if (child instanceof THREE.Sprite && child.material instanceof THREE.SpriteMaterial) {
        const phase = this.phases[idx] ?? 0;
        child.material.opacity = 0.55 + 0.45 * Math.sin(elapsed * 1.8 + phase);
        idx++;
      }
    }
  }

  dispose(): void {
    this.clear();
    this.glowTexture.dispose();
  }

  // ── Privat ──

  private createGlowTexture(): THREE.CanvasTexture {
    const size = 64;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const g = ctx.createRadialGradient(
      size / 2, size / 2, 0,
      size / 2, size / 2, size / 2,
    );
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.12, "rgba(255,255,255,0.95)");
    g.addColorStop(0.3, "rgba(255,255,255,0.6)");
    g.addColorStop(0.55, "rgba(255,255,255,0.2)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
  }

  private buildCurve(
    from: THREE.Vector3,
    to: THREE.Vector3,
    numPoints: number = 50,
  ): THREE.Vector3[] {
    const pts: THREE.Vector3[] = [];
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    const midX = (from.x + to.x) / 2 + (Math.random() - 0.5) * dist * 0.15;
    const midZ = (from.z + to.z) / 2 + (Math.random() - 0.5) * dist * 0.15;
    const midY =
      (getWorldHeight(from.x, from.z) +
        getWorldHeight(to.x, to.z) +
        getWorldHeight(midX, midZ)) /
        3 +
      (this.config.pathHeightMin + this.config.pathHeightMax) / 2;

    const ctrlPts = [
      new THREE.Vector3(from.x, from.y, from.z),
      new THREE.Vector3(midX, midY, midZ),
      new THREE.Vector3(to.x, getWorldHeight(to.x, to.z) + 0.8, to.z),
    ];

    const curve = new THREE.CatmullRomCurve3(ctrlPts);

    for (let i = 0; i <= numPoints; i++) {
      const t = i / numPoints;
      const p = curve.getPoint(t);
      const groundY = getWorldHeight(p.x, p.z);
      const heightAbove = this.config.pathHeightMin + Math.sin(t * Math.PI) * (this.config.pathHeightMax - this.config.pathHeightMin);
      p.y = groundY + heightAbove;
      pts.push(p);
    }
    return pts;
  }

  private buildGlowDashes(points: THREE.Vector3[]): void {
    this.phases = [];

    const curve = new THREE.CatmullRomCurve3(points);
    const totalLength = curve.getLength();
    const segmentLen = this.config.dashLength + this.config.gapLength;
    const numDashes = Math.max(1, Math.floor(totalLength / segmentLen));

    const mat = new THREE.SpriteMaterial({
      map: this.glowTexture,
      color: new THREE.Color(this.config.neonColor),
      transparent: true,
      opacity: 1.0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    for (let d = 0; d < numDashes; d++) {
      const dashStart = d * segmentLen;
      const dashMid = dashStart + this.config.dashLength / 2;
      const t = dashMid / totalLength;
      if (t > 1) break;

      const p = curve.getPoint(t);
      const tangent = curve.getTangent(t);
      const groundY = getWorldHeight(p.x, p.z);
      p.y = groundY + (this.config.pathHeightMin + this.config.pathHeightMax) / 2;

      for (let s = 0; s < this.config.spritesPerDash; s++) {
        const offset = ((s / this.config.spritesPerDash) - 0.5) * this.config.dashLength * 0.8;
        const pos = new THREE.Vector3().copy(p);
        pos.addScaledVector(tangent, offset);
        pos.x += (Math.random() - 0.5) * 0.3;
        pos.z += (Math.random() - 0.5) * 0.3;
        pos.y += (Math.random() - 0.5) * 0.15;

        const sprite = new THREE.Sprite(mat);
        sprite.position.copy(pos);
        const size = this.config.spriteSizeMin + Math.random() * (this.config.spriteSizeMax - this.config.spriteSizeMin);
        sprite.scale.set(size, size, 1);

        this.phases.push(Math.random() * Math.PI * 2);
        this.group.add(sprite);
      }
    }
  }

  private disposeSprites(): void {
    let disposed = false;
    for (const child of this.group.children) {
      if (child instanceof THREE.Sprite) {
        if (!disposed) {
          child.material.dispose();
          disposed = true;
        }
        this.group.remove(child);
      }
    }
    this.group.clear();
    this.phases = [];
  }
}
