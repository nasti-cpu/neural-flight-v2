/**
 * cityStructures.ts – Kuppeln, Landschaft, Bäume und Gebäude-Färbung
 *
 * Enthält die Three.js-Konstruktionsfunktionen für alle visuellen
 * Elemente einer Stadt: Kuppel, Basisring, Grünfläche, Bäume,
 * Büsche und die zufällige Gebäude-Färbung.
 *
 * Das World-Management (Lebenszyklus, Sichtbarkeit, Fade) bleibt
 * in cityWorld.ts.
 */

import * as THREE from "three/webgpu";

// ---------------------------------------------------------------------------
// Gebäude einfärben
// ---------------------------------------------------------------------------

const BUILDING_COLORS: number[] = [
  0xd4c5a9, 0xc8b898, 0xddd5c0, 0xbfae8e, 0xd9ccb0,
  0xccbfa0, 0xe0d5ba, 0xe8e4d8, 0xdcd8cc, 0xd0ccc0,
  0xc8c4b8, 0xbfbab0, 0xb8c8a8, 0xa0b898, 0x8a9e7e,
  0x7a8e6e, 0x9aaa84, 0x6e7e5e, 0xc4a882, 0xb8956e,
  0xa08060, 0x8a6e4e, 0xcc9988, 0xb88470, 0x9e6e5e,
  0xd4b878, 0xc8a868, 0xbb9a5a, 0xa08848, 0x8a9aaa,
  0x7a8a9a, 0x9aaa9a, 0x6e7e8e,
];

const WINDOW_COLORS: number[] = [
  0xffdd88, 0xffeeaa, 0xffcc66, 0xffaa44, 0x88ccff, 0xaaddff,
];

/**
 * Färbt alle Meshes eines Stadt-Modells mit zufälligen Hausfarben.
 * ~60 % der Gebäude bekommen leuchtende Fenster (Emissive).
 */
export function colorBuildings(model: THREE.Object3D): void {
  model.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      const baseColor = new THREE.Color(
        BUILDING_COLORS[Math.floor(Math.random() * BUILDING_COLORS.length)],
      );
      const hasLights = Math.random() < 0.6;
      let emissive = new THREE.Color(0x000000);
      let emissiveIntensity = 0;
      if (hasLights) {
        emissive = new THREE.Color(
          WINDOW_COLORS[Math.floor(Math.random() * WINDOW_COLORS.length)],
        );
        emissiveIntensity = 0.15 + Math.random() * 0.4;
      }
      child.material = new THREE.MeshStandardMaterial({
        color: baseColor,
        roughness: 0.5,
        metalness: 0.05,
        emissive,
        emissiveIntensity,
        transparent: true,
        opacity: 1,
      });
    }
  });
}

// ---------------------------------------------------------------------------
// Kuppel + Ring
// ---------------------------------------------------------------------------

/**
 * Erzeugt eine gläserne Halbkugel (Kuppel) mit einem Torus-Ring
 * am Boden – das Markenzeichen jeder Stadt in der Tiefsee-Welt.
 */
export function createDome(radius: number, floorY: number): THREE.Group {
  const group = new THREE.Group();
  const domeY = floorY + 0.1;

  const domeGeom = new THREE.SphereGeometry(
    radius, 64, 32, 0, Math.PI * 2, 0, Math.PI / 2,
  );
  const dome = new THREE.Mesh(
    domeGeom,
    new THREE.MeshPhysicalMaterial({
      color: 0xccddff,
      transparent: true,
      opacity: 0.03,
      roughness: 0.0,
      metalness: 0.0,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  dome.position.y = domeY;
  group.add(dome);

  const ringGeom = new THREE.TorusGeometry(radius, 0.2, 16, 128);
  const ring = new THREE.Mesh(
    ringGeom,
    new THREE.MeshStandardMaterial({
      color: 0x889999,
      roughness: 0.3,
      metalness: 0.8,
    }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = domeY;
  group.add(ring);

  return group;
}

// ---------------------------------------------------------------------------
// Stadt-Lichter
// ---------------------------------------------------------------------------

/**
 * Erzeugt drei warme Punktlichter rund um die Stadt.
 */
export function createCityLights(
  groundY: number,
  domeRadius: number,
  height: number,
): THREE.PointLight[] {
  const lights: THREE.PointLight[] = [];
  const positions = [
    new THREE.Vector3(0, groundY + height * 0.3, 0),
    new THREE.Vector3(
      domeRadius * 0.3,
      groundY + height * 0.2,
      domeRadius * 0.3,
    ),
    new THREE.Vector3(
      -domeRadius * 0.3,
      groundY + height * 0.2,
      -domeRadius * 0.3,
    ),
  ];
  for (const lp of positions) {
    const light = new THREE.PointLight(0xffaa44, 0.4, domeRadius * 1.5);
    light.position.copy(lp);
    lights.push(light);
  }
  return lights;
}

// ---------------------------------------------------------------------------
// Pittsburgh-Landschaft (Grünfläche + Bäume + Büsche)
// ---------------------------------------------------------------------------

/**
 * Erzeugt eine grüne Wiese mit Bäumen und Büschen unter der Kuppel.
 */
export function createLandscape(
  domeRadius: number,
  groundY: number,
  exclusionRadius: number,
): THREE.Group {
  const group = new THREE.Group();

  // Wiese (großer Kreis)
  const meadowGeom = new THREE.CircleGeometry(domeRadius, 48);
  const meadowMat = new THREE.MeshStandardMaterial({
    color: 0x5a7a3a,
    roughness: 0.9,
    metalness: 0.0,
    side: THREE.DoubleSide,
  });
  const meadow = new THREE.Mesh(meadowGeom, meadowMat);
  meadow.rotation.x = -Math.PI / 2;
  meadow.position.y = groundY + 0.05;
  group.add(meadow);

  // Wiese (innerer, dunklerer Kreis)
  const meadow2Geom = new THREE.CircleGeometry(domeRadius * 0.85, 48);
  const meadow2Mat = new THREE.MeshStandardMaterial({
    color: 0x4e6e30,
    roughness: 0.85,
    metalness: 0.0,
    side: THREE.DoubleSide,
  });
  const meadow2 = new THREE.Mesh(meadow2Geom, meadow2Mat);
  meadow2.rotation.x = -Math.PI / 2;
  meadow2.position.y = groundY + 0.06;
  group.add(meadow2);

  // Bäume
  const treeColors = [0x4a6e2a, 0x3d5e1e, 0x557a30, 0x3a5a18, 0x4e7230];
  const treeMinDist = Math.max(exclusionRadius, domeRadius * 0.2);
  const treeMaxDist = domeRadius * 0.85;
  for (let i = 0; i < 35; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = treeMinDist + Math.random() * (treeMaxDist - treeMinDist);
    const tree = createTree(
      1.2 + Math.random() * 1.8,
      0x6b4e3a,
      treeColors[Math.floor(Math.random() * treeColors.length)],
    );
    tree.position.set(
      Math.cos(angle) * dist,
      groundY + 0.05,
      Math.sin(angle) * dist,
    );
    tree.rotation.y = Math.random() * Math.PI * 2;
    group.add(tree);
  }

  // Büsche
  const bushColors = [0x5a7e2a, 0x4e7230, 0x628a32, 0x3e5e1e, 0x6a8a3a];
  const bushMinDist = Math.max(exclusionRadius * 0.9, domeRadius * 0.1);
  for (let i = 0; i < 25; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist =
      bushMinDist + Math.random() * (domeRadius * 0.85 - bushMinDist);
    const bush = createBush(
      0.25 + Math.random() * 0.4,
      bushColors[Math.floor(Math.random() * bushColors.length)],
    );
    bush.position.set(
      Math.cos(angle) * dist,
      groundY + 0.06,
      Math.sin(angle) * dist,
    );
    group.add(bush);
  }

  return group;
}

// ---------------------------------------------------------------------------
// Baum
// ---------------------------------------------------------------------------

/**
 * Erzeugt einen einfachen Kegel-Baum (Stamm + 2 Kronen).
 */
function createTree(
  height: number,
  trunkColor: number,
  crownColor: number,
): THREE.Group {
  const tree = new THREE.Group();

  const trunkGeom = new THREE.CylinderGeometry(0.15, 0.2, height * 0.5, 6);
  const trunkMat = new THREE.MeshStandardMaterial({
    color: trunkColor,
    roughness: 0.9,
    metalness: 0.0,
  });
  const trunk = new THREE.Mesh(trunkGeom, trunkMat);
  trunk.position.y = height * 0.25;
  tree.add(trunk);

  const crownMat = new THREE.MeshStandardMaterial({
    color: crownColor,
    roughness: 0.8,
    metalness: 0.0,
  });

  const crownGeom = new THREE.ConeGeometry(0.7, height * 0.65, 7);
  const crown = new THREE.Mesh(crownGeom, crownMat);
  crown.position.y = height * 0.5 + height * 0.65 * 0.4;
  tree.add(crown);

  const crown2Geom = new THREE.ConeGeometry(0.45, height * 0.65 * 0.7, 7);
  const crown2 = new THREE.Mesh(crown2Geom, crownMat);
  crown2.position.y = height * 0.5 + height * 0.65 * 0.75;
  tree.add(crown2);

  return tree;
}

// ---------------------------------------------------------------------------
// Busch
// ---------------------------------------------------------------------------

/**
 * Erzeugt einen einfachen Halbkugel-Busch.
 */
function createBush(radius: number, color: number): THREE.Mesh {
  const geom = new THREE.SphereGeometry(
    radius, 6, 4, 0, Math.PI * 2, 0, Math.PI / 2,
  );
  const mat = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.85,
    metalness: 0.0,
  });
  const bush = new THREE.Mesh(geom, mat);
  bush.scale.y = 0.6;
  return bush;
}
