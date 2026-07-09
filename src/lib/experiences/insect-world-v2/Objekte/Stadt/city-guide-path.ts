/**
 * insect-world-v2 — City Guide Path.
 * Ein leuchtender Neon-Pfad (gestrichelt, Glow-Punkte),
 * der vom Startpunkt (0, 2, 0) zur Stadt führt und dem Gelände folgt.
 *
 * Nutzt THREE.Points statt einzelner Sprites → nur 1 Draw Call.
 *
 * WebGPU-konform.
 */
import * as THREE from "three/webgpu";
import { getWorldHeight } from "../../Biome/Wiese/grass-manager";

const NEON_GLOW = new THREE.Color(0x44ffff);
const DASH_LENGTH = 1.2;
const GAP_LENGTH = 0.6;
const PATH_HEIGHT_MIN = 0.5;
const PATH_HEIGHT_MAX = 1.8;
const POINT_SIZE = 0.9;

export class CityGuidePath {
  readonly group = new THREE.Group();
  private active = false;
  private glowTexture: THREE.CanvasTexture;
  private points: THREE.Points | null = null;

  constructor() {
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

    const pts = this.buildCurve(from, to);
    if (pts.length < 2) return;

    this.buildPoints(pts);
    this.active = true;
  }

  clear(): void {
    if (this.points) {
      this.group.remove(this.points);
      this.points.geometry.dispose();
      this.points = null;
    }
    this.active = false;
  }

  update(elapsed: number): void {
    if (!this.active || !this.points) return;
    const mat = this.points.material as THREE.PointsMaterial;
    mat.opacity = 0.55 + 0.45 * Math.sin(elapsed * 1.8);
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
      (PATH_HEIGHT_MIN + PATH_HEIGHT_MAX) / 2;

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
      const heightAbove = PATH_HEIGHT_MIN + Math.sin(t * Math.PI) * (PATH_HEIGHT_MAX - PATH_HEIGHT_MIN);
      p.y = groundY + heightAbove;
      pts.push(p);
    }
    return pts;
  }

  private buildPoints(pts: THREE.Vector3[]): void {
    const curve = new THREE.CatmullRomCurve3(pts);
    const totalLength = curve.getLength();
    const segmentLen = DASH_LENGTH + GAP_LENGTH;
    const numDashes = Math.max(1, Math.floor(totalLength / segmentLen));

    const positions: number[] = [];

    for (let d = 0; d < numDashes; d++) {
      const dashMid = d * segmentLen + DASH_LENGTH / 2;
      const t = dashMid / totalLength;
      if (t > 1) break;

      const p = curve.getPoint(t);
      const tangent = curve.getTangent(t);
      const groundY = getWorldHeight(p.x, p.z);
      p.y = groundY + (PATH_HEIGHT_MIN + PATH_HEIGHT_MAX) / 2;

      // 3 Punkte pro Dash (einfach statt 3 Sprites)
      for (let s = 0; s < 3; s++) {
        const offset = ((s / 3) - 0.5) * DASH_LENGTH * 0.8;
        p.x += tangent.x * offset;
        p.y += tangent.y * offset;
        p.z += tangent.z * offset;
        positions.push(p.x, p.y, p.z);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));

    const mat = new THREE.PointsMaterial({
      map: this.glowTexture,
      color: NEON_GLOW,
      transparent: true,
      opacity: 1.0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      size: POINT_SIZE,
      sizeAttenuation: true,
    });

    this.points = new THREE.Points(geo, mat);
    this.group.add(this.points);
  }
}
