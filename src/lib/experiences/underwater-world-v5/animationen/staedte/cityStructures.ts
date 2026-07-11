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
// 5 Farbschemata für Gebäude + Fenster
// ---------------------------------------------------------------------------

export interface ColorTheme {
  name: string;
  buildings: number[];
  windows: number[];
  windowChance: number;
  windowIntensity: number;
}

export const COLOR_THEMES: ColorTheme[] = [
  {
    name: "Standard",
    buildings: [
      0xe8dcc8, 0xddd0b8, 0xf0e8d8, 0xd4c8a8, 0xe8dcc0,
      0xddd0b0, 0xf0e0c8, 0xf0ece0, 0xe8e4d8, 0xe0dcd0,
      0xd8d4c8, 0xd0ccc0, 0xc8d8b8, 0xb8c8a8, 0xa8b898,
      0x98a888, 0xb8c8a0, 0x889878, 0xd4b898, 0xc8a880,
      0xb89870, 0xa08060, 0xd8a898, 0xc89080, 0xb07868,
      0xe0c888, 0xd4b878, 0xc8a868, 0xb89858, 0xa8b8c8,
      0x98a8b8, 0xb8c8b8, 0x8898a8,
    ],
    windows: [0xffeebb, 0xffeeaa, 0xffdd88, 0xffcc66, 0xaaddff, 0xbbddff],
    windowChance: 0.75,
    windowIntensity: 1.0,
  },
  {
    name: "Eisblau",
    buildings: [
      0x98b8d0, 0xa8c0d8, 0x88a8c0, 0xb8d0e0, 0x78a0b8,
      0xa0c0d0, 0x98b8c8, 0x88a8b8, 0xa8c4d4, 0xb8d0e0,
      0x8098b0, 0x7090a8, 0x98b8cc, 0x88a8bc, 0xa8c8dc,
      0xb8d8ec, 0x7898b0, 0x6888a0, 0x98b8d0, 0x88a8c0,
      0xa8c8d8, 0xb8d8e8, 0x80a0b8, 0x7090a8, 0x98b8cc,
      0xa8c8dc, 0x88a8c0, 0x8098b0, 0x7090a8, 0x98b8d0,
      0xa8c0d8, 0x88a8c0, 0x78a0b8,
    ],
    windows: [0x88ccff, 0xaaddff, 0x66aadd, 0x4499cc, 0x99ddff, 0x77bbee],
    windowChance: 0.8,
    windowIntensity: 1.0,
  },
  {
    name: "Terracotta",
    buildings: [
      0xdc9a78, 0xd08a68, 0xe0a888, 0xd49a7e, 0xc8886a,
      0xdc9e7e, 0xe8ae8e, 0xd09272, 0xc89a82, 0xb88870,
      0xac7a62, 0xa06e56, 0xd49a7a, 0xc8886c, 0xbc7c5e,
      0xb07052, 0xdaa280, 0xce9674, 0xc28a66, 0xb67e5a,
      0xaa7250, 0x9e6646, 0xd89a82, 0xcc8a6e, 0xbe7a5e,
      0xe0a888, 0xd49a7a, 0xc88e6e, 0xbc8262, 0xdc9a78,
      0xd08a68, 0xe0a888, 0xd49a7e,
    ],
    windows: [0xffdd88, 0xffcc77, 0xffeebb, 0xffbb66, 0xfff0d0, 0xffaa55],
    windowChance: 0.8,
    windowIntensity: 1.0,
  },
  {
    name: "Nachtviolett",
    buildings: [
      0x8870a8, 0x7860a0, 0x9880b8, 0xa890c8, 0x6858a0,
      0x8870a8, 0xa088c0, 0x584898, 0x8878a8, 0x7868a0,
      0xa090c0, 0x9888b8, 0x8870a8, 0x7860a0, 0xa088c0,
      0xb098d0, 0x6858a0, 0x584898, 0x8870b0, 0x7860a8,
      0xa088c0, 0xb098d0, 0x7860a0, 0x685898, 0x8870a8,
      0xa088c0, 0x7868a0, 0x685898, 0x584890, 0x8870a8,
      0x7860a0, 0x9880b8, 0x6858a0,
    ],
    windows: [0xff88cc, 0xff66bb, 0xee55aa, 0xff99dd, 0xee77cc, 0xdd55aa],
    windowChance: 0.85,
    windowIntensity: 1.0,
  },
  {
    name: "Smaragd",
    buildings: [
      0x68a868, 0x58a058, 0x78b878, 0x88c888, 0x50a050,
      0x68b068, 0x78c078, 0x489848, 0x60b060, 0x50a850,
      0x70c070, 0x60b860, 0x68b068, 0x58a858, 0x78c078,
      0x88d088, 0x489848, 0x389038, 0x68b868, 0x58a858,
      0x78c878, 0x88d888, 0x58a858, 0x48a048, 0x68b068,
      0x78c078, 0x60a860, 0x50a050, 0x489848, 0x68a868,
      0x58a058, 0x78b878, 0x50a050,
    ],
    windows: [0x88ffaa, 0x77ee99, 0x66dd88, 0x99ffbb, 0xaaffcc, 0x55cc77],
    windowChance: 0.75,
    windowIntensity: 1.0,
  },
];

// ---------------------------------------------------------------------------
// Gebäude einfärben (Standard-zufällig)
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
 * ~75 % der Gebäude bekommen leuchtende Fenster (Emissive) – höhere
 * Intensität, damit Städte im Dunkeln wie lebendige Metropolen wirken.
 */
/**
 * Wendet ein Farbschema (Theme) auf bestehende Gebäude-Meshes an.
 * Ändert color/emissive direkt, ohne neue Materialien zu erzeugen.
 */
export function applyTheme(
  model: THREE.Object3D,
  theme: ColorTheme,
): void {
  model.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      const baseColor = new THREE.Color(
        theme.buildings[Math.floor(Math.random() * theme.buildings.length)],
      );
      const hasLights = Math.random() < theme.windowChance;
      let emissiveColor = new THREE.Color(0x000000);
      let emissiveIntensity = 0;
      if (hasLights) {
        emissiveColor = new THREE.Color(
          theme.windows[
            Math.floor(Math.random() * theme.windows.length)
          ],
        );
        emissiveIntensity = theme.windowIntensity + Math.random() * 0.5;
      }
      if (child.material instanceof THREE.MeshStandardMaterial) {
        child.material.color.copy(baseColor);
        child.material.emissive.copy(
          hasLights ? emissiveColor : baseColor.clone().multiplyScalar(0.12),
        );
        child.material.emissiveIntensity = hasLights
          ? emissiveIntensity
          : 0.25;
      }
    }
  });
}

export function colorBuildings(model: THREE.Object3D): void {
  model.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      const baseColor = new THREE.Color(
        BUILDING_COLORS[Math.floor(Math.random() * BUILDING_COLORS.length)],
      );
      const hasLights = Math.random() < 0.75;
      let emissive = new THREE.Color(0x000000);
      let emissiveIntensity = 0;
      if (hasLights) {
        emissive = new THREE.Color(
          WINDOW_COLORS[Math.floor(Math.random() * WINDOW_COLORS.length)],
        );
        emissiveIntensity = 0.6 + Math.random() * 1.4;
      }
      child.material = new THREE.MeshStandardMaterial({
        color: baseColor,
        roughness: 0.5,
        metalness: 0.05,
        emissive: hasLights
          ? emissive
          : baseColor.clone().multiplyScalar(0.12),
        emissiveIntensity: hasLights
          ? emissiveIntensity
          : 0.25,
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
      color: 0x88bbff,
      transparent: true,
      opacity: 0.1,
      roughness: 0.0,
      metalness: 0.0,
      emissive: 0x224488,
      emissiveIntensity: 0.3,
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
      color: 0x66ddff,
      emissive: 0x2288cc,
      emissiveIntensity: 1.0,
      roughness: 0.2,
      metalness: 0.9,
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
 * Erzeugt ein Glühbirnen-Sprite (weicher Glow) als sichtbare Lichtquelle.
 * Canvas-Textur mit radialem Gradient – einmalig erstellt, kein Per-Frame-Code.
 * Additive Blending lässt den Glow im Dunkeln strahlen.
 */
function createGlowSprite(color: number, intensity: number): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.3, "rgba(255,255,200,0.5)");
  gradient.addColorStop(1, "rgba(255,200,100,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);

  const texture = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({
    map: texture,
    color: color,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    opacity: Math.min(1, intensity * 0.8),
  });
  return new THREE.Sprite(mat);
}

/**
 * Erzeugt warme Punktlichter + sichtbare Glühbirnen-Glows rund um die Stadt.
 * 5 Lichter mit höherer Intensität und Reichweite als zuvor,
 * damit Städte von weitem als leuchtende Metropolen erkennbar sind.
 */
export function createCityLights(
  groundY: number,
  domeRadius: number,
  height: number,
): THREE.Object3D[] {
  const objects: THREE.Object3D[] = [];

  // 5 Licht-Positionen: 1× zentral + 4× diagonal am Kuppelrand
  const lightConfigs = [
    { pos: new THREE.Vector3(0, groundY + height * 0.3, 0), intensity: 1.5 },
    {
      pos: new THREE.Vector3(
        domeRadius * 0.3,
        groundY + height * 0.2,
        domeRadius * 0.3,
      ),
      intensity: 1.0,
    },
    {
      pos: new THREE.Vector3(
        -domeRadius * 0.3,
        groundY + height * 0.2,
        -domeRadius * 0.3,
      ),
      intensity: 1.0,
    },
    {
      pos: new THREE.Vector3(
        domeRadius * 0.3,
        groundY + height * 0.1,
        -domeRadius * 0.3,
      ),
      intensity: 0.8,
    },
    {
      pos: new THREE.Vector3(
        -domeRadius * 0.3,
        groundY + height * 0.1,
        domeRadius * 0.3,
      ),
      intensity: 0.8,
    },
  ];

  for (const cfg of lightConfigs) {
    // Warmes Punktlicht (höhere Intensität + größere Reichweite)
    const light = new THREE.PointLight(
      0xffaa44,
      cfg.intensity,
      domeRadius * 2,
    );
    light.position.copy(cfg.pos);
    objects.push(light);

    // Sichtbarer Glühbirnen-Glow (Billboard – immer zur Kamera)
    const glow = createGlowSprite(0xffcc66, cfg.intensity);
    glow.position.copy(cfg.pos);
    glow.scale.setScalar(1.5 + cfg.intensity * 0.5);
    objects.push(glow);
  }

  return objects;
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
