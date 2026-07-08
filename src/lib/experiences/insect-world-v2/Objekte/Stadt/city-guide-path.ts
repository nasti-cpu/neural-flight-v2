/**
 * insect-world-v2 — City Guide Path.
 * Eine durchgehende leuchtende Neon-Röhre (TubeGeometry),
 * die vom Spieler zur Stadt führt und dem Gelände folgt.
 *
 * WebGPU-konform.
 */
import * as THREE from "three/webgpu";
import { getWorldHeight } from "../../Biome/Wiese/grass-manager";

const NEON_COLOR = new THREE.Color(0x44ffff);
const PATH_HEIGHT_MIN = 0.5;
const PATH_HEIGHT_MAX = 1.8;
const TUBE_RADIUS = 0.12;
const TUBE_SEGMENTS = 64;

export class CityGuidePath {
  readonly group = new THREE.Group();
  private active = false;
  private lastFrom = new THREE.Vector3();
  private lastTo = new THREE.Vector3();

  /**
   * Baut einen durchgehenden Neon-Pfad vom Spieler zur Ziel-Stadt.
   * Entfernt vorherige Pfade automatisch.
   */
  setTarget(from: THREE.Vector3, to: THREE.Vector3): void {
    this.clear();
    this.lastFrom.copy(from);
    this.lastTo.copy(to);

    const points = this.buildCurve(from, to);
    if (points.length < 2) return;

    this.buildTube(points);
    this.active = true;
  }

  /**
   * Aktualisiert nur bei neuem Ziel (Stadt bleibt gleich,
   * Player-Bewegung wird ignoriert – Pfad bleibt vom Startpunkt aus sichtbar).
   */
  updateTarget(from: THREE.Vector3, to: THREE.Vector3): void {
    if (!this.lastTo.equals(to)) {
      this.setTarget(from, to);
    }
  }

  /** Entfernt den aktuellen Pfad. */
  clear(): void {
    this.disposeMesh();
    this.active = false;
  }

  /** Pulsiert die Leuchtkraft. */
  update(elapsed: number): void {
    if (!this.active) return;

    for (const child of this.group.children) {
      if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshBasicMaterial) {
        const pulse = 0.7 + 0.3 * Math.sin(elapsed * 1.2);
        child.material.opacity = pulse;
      }
    }
  }

  /** Gibt alle Ressourcen frei. */
  dispose(): void {
    this.clear();
  }

  // ── Privat ──

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

  /** Baut eine leuchtende Tube entlang der Kurve. */
  private buildTube(points: THREE.Vector3[]): void {
    const curve = new THREE.CatmullRomCurve3(points);

    const tubeGeo = new THREE.TubeGeometry(curve, TUBE_SEGMENTS, TUBE_RADIUS, 6, false);

    const mat = new THREE.MeshBasicMaterial({
      color: NEON_COLOR,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(tubeGeo, mat);
    this.group.add(mesh);
  }

  /** Entfernt das Mesh aus der Gruppe. */
  private disposeMesh(): void {
    for (const child of this.group.children) {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        child.material.dispose();
        this.group.remove(child);
      }
    }
    this.group.clear();
  }
}
