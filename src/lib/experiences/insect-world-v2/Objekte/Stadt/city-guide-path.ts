/**
 * insect-world-v2 — City Guide Path (Pheromon-Leitspur).
 *
 * Eine große, weithin sichtbare Leuchtspur aus Neon-Partikeln,
 * die vom Spieler zur nächsten Stadt führt.
 * Sieht aus wie eine Pheromon-Spur: Partikel fließen entlang des Pfads,
 * sind groß und leuchtend, und von weit sichtbar (400m).
 *
 * Nutzt THREE.Sprite (weil Points in WebGPU keine map rendern).
 *
 * WebGPU-konform.
 */
import * as THREE from "three/webgpu";
import { getWorldHeight } from "../../Biome/Wiese/grass-manager";

export interface GuidePathConfig {
  neonColor?: number;
  dashLength?: number;
  gapLength?: number;
  pathHeightMin?: number;
  pathHeightMax?: number;
  spriteSizeMin?: number;
  spriteSizeMax?: number;
  spritesPerDash?: number;
  maxDist?: number;
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
  maxDist: 150,
};

export class CityGuidePath {
  readonly group = new THREE.Group();
  private _active = false;

  get isActive(): boolean { return this._active; }
  private glowTexture: THREE.CanvasTexture;
  private phases: number[] = [];
  private config: Required<GuidePathConfig>;

  constructor(config?: GuidePathConfig) {
    this.config = { ...DEFAULTS, ...config };
    this.glowTexture = this.createGlowTexture();
  }

  setTarget(from: THREE.Vector3, to: THREE.Vector3): void {
    this.clear();

    const _dir = new THREE.Vector3().copy(to).sub(from);
    const dist = _dir.length();
    const hardMax = 400;
    const visibilityBuffer = 15;
    const len = dist > hardMax ? hardMax : dist - visibilityBuffer;
    const actualMax = Math.min(this.config.maxDist, len);
    if (dist > actualMax) {
      _dir.normalize().multiplyScalar(actualMax);
      to = new THREE.Vector3().copy(from).add(_dir);
    }

    const points = this.buildCurve(from, to);
    if (points.length < 2) return;

    this.buildGlowDashes(points);
    this._active = true;
  }

  clear(): void {
    this.disposeSprites();
    this._active = false;
  }

  update(elapsed: number): void {
    if (!this._active) return;

    let idx = 0;
    for (const child of this.group.children) {
      if (child instanceof THREE.Sprite && child.material instanceof THREE.SpriteMaterial) {
        const phase = this.phases[idx] ?? 0;
        // Stärkeres Pulsieren für bessere Sichtbarkeit
        child.material.opacity = 0.7 + 0.3 * Math.sin(elapsed * 2.0 + phase);
        idx++;
      }
    }
  }

  setConfig(config: GuidePathConfig): void {
    this.config = { ...DEFAULTS, ...config };
  }

  dispose(): void {
    this.clear();
    this.glowTexture.dispose();
  }

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
    g.addColorStop(0.08, "rgba(255,255,255,0.95)");
    g.addColorStop(0.2, "rgba(255,255,255,0.7)");
    g.addColorStop(0.4, "rgba(255,255,255,0.3)");
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

    const midX = (from.x + to.x) / 2 + (Math.random() - 0.5) * dist * 0.1;
    const midZ = (from.z + to.z) / 2 + (Math.random() - 0.5) * dist * 0.1;
    const midY =
      (getWorldHeight(from.x, from.z) +
        getWorldHeight(to.x, to.z) +
        getWorldHeight(midX, midZ)) / 3 + 1.5;

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
      p.y = groundY + 0.8 + Math.sin(t * Math.PI) * 1.2;
      pts.push(p);
    }
    return pts;
  }

  /** Erzeugt große, weithin sichtbare Neon-Dashes entlang der Kurve. */
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
      p.y = groundY + 1.2;

      for (let s = 0; s < this.config.spritesPerDash; s++) {
        const offset = ((s / this.config.spritesPerDash) - 0.5) * this.config.dashLength;
        const pos = new THREE.Vector3().copy(p);
        pos.addScaledVector(tangent, offset);
        pos.x += (Math.random() - 0.5) * 0.5;
        pos.z += (Math.random() - 0.5) * 0.5;
        pos.y += (Math.random() - 0.5) * 0.3;

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
