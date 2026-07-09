/**
 * insect-world-v2 — City Guide Path.
 * Ein leuchtender Neon-Pfad (gestrichelt, Glow-Sprites wie Pheromonspuren),
 * der vom Startpunkt (0, 2, 0) zur Stadt führt und dem Gelände folgt.
 *
 * Es existiert immer nur ein Pfad gleichzeitig.
 * Sobald die Stadt erreicht ist, wird der Pfad gelöscht.
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
const SPRITE_SIZE_MIN = 0.6;
const SPRITE_SIZE_MAX = 1.2;
const SPRITES_PER_DASH = 3; // 8→3: von ~4440 auf ~1660 Sprites (−63%), optisch kaum Unterschied

export class CityGuidePath {
  readonly group = new THREE.Group();
  private active = false;
  private glowTexture: THREE.CanvasTexture;
  private phases: number[] = [];

  constructor() {
    this.glowTexture = this.createGlowTexture();
  }

  /**
   * Baut einen Pfad vom Startpunkt zur Ziel-Stadt.
   * Begrenzt die Länge auf 150m – alles dahinter ist im Nebel unsichtbar.
   * Entfernt vorherige Pfade automatisch.
   */
  setTarget(from: THREE.Vector3, to: THREE.Vector3): void {
    this.clear();

    // Pfad auf 150m begrenzen (Nebel-Sichtweite ~80m, Puffer für Annäherung)
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

  /** Entfernt den aktuellen Pfad. */
  clear(): void {
    this.disposeSprites();
    this.active = false;
  }

  /** Pulsiert die Leuchtkraft der Sprites. */
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

  /** Gibt alle Ressourcen frei. */
  dispose(): void {
    this.clear();
    this.glowTexture.dispose();
  }

  // ── Privat ──

  /** Erzeugt die Radiale-Gradient-Glow-Textur (wie Pheromonspuren). */
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

  /** Baut eine CatmullRom-Kurve vom Player zur Stadt, die dem Gelände folgt. */
  private buildCurve(
    from: THREE.Vector3,
    to: THREE.Vector3,
    numPoints: number = 50,
  ): THREE.Vector3[] {
    const pts: THREE.Vector3[] = [];
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    // Mittelpunkt leicht versetzen für sanfte Kurve
    const midX = (from.x + to.x) / 2 + (Math.random() - 0.5) * dist * 0.15;
    const midZ = (from.z + to.z) / 2 + (Math.random() - 0.5) * dist * 0.15;
    const midY =
      (getWorldHeight(from.x, from.z) +
        getWorldHeight(to.x, to.z) +
        getWorldHeight(midX, midZ)) /
        3 +
      (PATH_HEIGHT_MIN + PATH_HEIGHT_MAX) / 2;

    // Erster Punkt: exakt am Startpunkt
    // Letzter Punkt: nah am Boden bei der Stadt
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

  /** Baut gestrichelte Glow-Dashes aus Sprites entlang der Kurve. */
  private buildGlowDashes(points: THREE.Vector3[]): void {
    this.phases = [];

    // Kurve aus den Punkten bauen
    const curve = new THREE.CatmullRomCurve3(points);
    const totalLength = curve.getLength();

    const segmentLen = DASH_LENGTH + GAP_LENGTH;
    const numDashes = Math.max(1, Math.floor(totalLength / segmentLen));

    // Material (einmal für alle Sprites)
    const mat = new THREE.SpriteMaterial({
      map: this.glowTexture,
      color: NEON_GLOW,
      transparent: true,
      opacity: 1.0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    // Für jeden Dash: Position auf der Kurve sampeln, Sprites platzieren
    for (let d = 0; d < numDashes; d++) {
      const dashStart = d * segmentLen;
      const dashMid = dashStart + DASH_LENGTH / 2;
      const t = dashMid / totalLength;

      const p = curve.getPoint(t);
      const tangent = curve.getTangent(t);

      // Korrekte Geländehöhe an dieser Stelle
      const groundY = getWorldHeight(p.x, p.z);
      p.y = groundY + (PATH_HEIGHT_MIN + PATH_HEIGHT_MAX) / 2;

      // Mehrere Sprites pro Dash für dichten Glow
      for (let s = 0; s < SPRITES_PER_DASH; s++) {
        const offset = ((s / SPRITES_PER_DASH) - 0.5) * DASH_LENGTH * 0.8;
        const pos = new THREE.Vector3().copy(p);

        // Entlang der Tangente verschieben
        pos.addScaledVector(tangent, offset);

        // Leichte zufällige Streuung für organischen Look
        pos.x += (Math.random() - 0.5) * 0.3;
        pos.z += (Math.random() - 0.5) * 0.3;
        pos.y += (Math.random() - 0.5) * 0.15;

        const sprite = new THREE.Sprite(mat);
        sprite.position.copy(pos);
        const size = SPRITE_SIZE_MIN + Math.random() * (SPRITE_SIZE_MAX - SPRITE_SIZE_MIN);
        sprite.scale.set(size, size, 1);

        this.phases.push(Math.random() * Math.PI * 2);
        this.group.add(sprite);
      }
    }
  }

  /** Entfernt alle Sprites aus der Gruppe. */
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
