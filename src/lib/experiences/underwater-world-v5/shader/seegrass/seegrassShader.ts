/**
 * seegrassShader.ts
 *
 * TSL-basierter Shader für Unterwasser-Seegras.
 *
 * Die Halme wiegen sich wellenförmig im Wasser.
 * Der Vertex-Shader verschiebt jeden Punkt abhängig von seiner Höhe (Y)
 * und der vergangenen Zeit – je höher der Punkt, desto stärker die Bewegung.
 *
 * Der Fragment-Shader färbt die Halme in einem Grün-Verlauf:
 *   unten dunkelgrün, oben hellgrün (Lichteinfall von oben).
 */

import {
  uniform,
  vec3,
  vec4,
  positionLocal,
  sin,
  cos,
  mix,
  time,
} from "three/tsl";
import { MeshBasicNodeMaterial } from "three/webgpu";
import * as THREE from "three/webgpu";

// ---------------------------------------------------------------------------
// Typen
// ---------------------------------------------------------------------------

/** Konfiguration für das Seegras-Material */
export interface SeegrassMaterialOptions {
  /** Farbe unten (dunkelgrün) */
  colorBottom: THREE.Color;
  /** Farbe oben (hellgrün) */
  colorTop: THREE.Color;
  /** Welligkeit / Amplitude der Bewegung – Standard: 0.15 */
  swayAmount: number;
  /** Geschwindigkeit der Bewegung – Standard: 1.5 */
  swaySpeed: number;
}

// ---------------------------------------------------------------------------
// Standard-Konfiguration
// ---------------------------------------------------------------------------

/** Vordefinierte, realistische Seegras-Farben */
const DEFAULT_OPTIONS: SeegrassMaterialOptions = {
  colorBottom: new THREE.Color("#0d3b0d"), // dunkles Waldgrün
  colorTop: new THREE.Color("#2d8c2d"), // helleres Grün
  swayAmount: 0.2,
  swaySpeed: 1.3,
};

// ---------------------------------------------------------------------------
// Shader-Erstellung
// ---------------------------------------------------------------------------

/**
 * Erstellt ein TSL-Node-Material für wiegendes Seegras.
 *
 * @param options  Konfiguration (Farben, Bewegungsparameter)
 * @returns        Ein MeshBasicNodeMaterial mit TSL-Shader
 */
export function createSeegrassMaterial(
  options: Partial<SeegrassMaterialOptions> = {},
): MeshBasicNodeMaterial {
  // Optionen mit Defaults zusammenführen
  const opts: SeegrassMaterialOptions = { ...DEFAULT_OPTIONS, ...options };

  // --- Uniforms für die Bewegung ---
  // Dies sind Werte, die von außen (JavaScript) gesetzt werden können,
  // aber im Shader als Konstante laufen. Wir nutzen sie, um die
  // Amplitude und Geschwindigkeit der Welle zu steuern.
  const swayAmount = uniform(opts.swayAmount);
  const swaySpeed = uniform(opts.swaySpeed);

  // --- Farb-Uniforms ---
  const colorBottom = uniform(opts.colorBottom);
  const colorTop = uniform(opts.colorTop);

  // --- Material erstellen ---
  const material = new MeshBasicNodeMaterial();

  // `time` ist die globale Shader-Zeit in Sekunden, automatisch vom Renderer
  // erhöht. Wir nutzen sie als Basis für die wellenförmige Bewegung.

  // positionLocal ist die ursprüngliche Position jedes Vertex im
  // lokalen Koordinatensystem des Meshs.
  // Wir verschieben die X- und Z-Koordinate abhängig von Y (Höhe)
  // und der Zeit – so entsteht eine wellenförmige Bewegung.
  material.positionNode = vec3(
    // X-Verschiebung: Sinus-Welle, Amplitude steigt mit der Höhe
    positionLocal.x.add(
      sin(positionLocal.y.mul(5.0).add(time.mul(swaySpeed)))
        .mul(swayAmount)
        .mul(positionLocal.y.add(0.5)), // y+0.5 = 0..1 über die Höhe
    ),
    // Y bleibt unverändert (kein Stauchen/Strecken)
    positionLocal.y,
    // Z-Verschiebung: Kosinus-Welle, etwas phasenverschoben für 3D-Effekt
    positionLocal.z.add(
      cos(positionLocal.y.mul(4.5).add(time.mul(swaySpeed.mul(0.7))))
        .mul(swayAmount.mul(0.6))
        .mul(positionLocal.y.add(0.5)),
    ),
  );

  // ---- Fragment-Shader: Farbverlauf (unten dunkel, oben hell) ----
  // Im Fragment-Shader können wir auf positionLocal zugreifen.
  // Da der Vertex-Shader die Geometrie verschoben hat, spiegelt
  // positionLocal hier die ursprüngliche (unverschobene) Y-Position wider.
  // ==> Der Farbverlauf hängt von der Blatthöhe ab, nicht von der Welle.
  const gradientFactor = positionLocal.y
    .add(0.5) // von [-0.5, 0.5] auf [0, 1] normalisieren
    .clamp(0.0, 1.0); // auf Wertebereich 0..1 begrenzen

  material.colorNode = vec4(
    mix(colorBottom, colorTop, gradientFactor),
    1.0, // volle Deckkraft
  );

  // Material ist beidseitig sichtbar (Seegras-Halme sind dünn)
  material.side = THREE.DoubleSide;

  return material;
}

// ---------------------------------------------------------------------------
// Geometrie-Hilfsfunktionen
// ---------------------------------------------------------------------------

/**
 * Erstellt eine sich verjüngende Geometrie für einen Seegras-Halm.
 *
 * Die Geometrie ist ein aufrecht stehendes Rechteck (Plane),
 * das unten breiter und oben schmaler ist – wie echtes Seegras.
 *
 * @param width    Breite an der Basis (unten)
 * @param height   Gesamthöhe des Halms
 * @param taper    Wie stark sich die Spitze verjüngt (0 = kein Taper, 1 = Spitze)
 * @param segments Unterteilungen in Y-Richtung (mehr = glattere Welle)
 * @returns        Eine BufferGeometry für einen Halm
 */
export function createSeegrassBladeGeometry(
  width: number = 0.15,
  height: number = 1.5,
  taper: number = 0.7,
  segments: number = 6,
): THREE.BufferGeometry {
  // Ein PlaneGeometry liegt standardmäßig in der XY-Ebene.
  // Das ist perfekt: X = Breite, Y = Höhe.
  // Wir nutzen widthSegments = 1, heightSegments = segments.
  const geo = new THREE.PlaneGeometry(width, height, 1, segments);

  // --- Geometrie verjüngen ---
  // Wir greifen auf das Positions-Attribut zu und verkleinern die
  // X-Koordinaten der oberen Vertices.
  const positions = geo.getAttribute("position") as THREE.BufferAttribute;
  const posArray = positions.array as Float32Array;

  // Über alle Vertices iterieren
  for (let i = 0; i < positions.count; i++) {
    const x = posArray[i * 3]; // X-Koordinate
    const y = posArray[i * 3 + 1]; // Y-Koordinate

    // Normalisiere Y von [-height/2, height/2] auf [0, 1]
    const t = y / height + 0.5; // 0 = unten, 1 = oben

    // Je höher der Vertex, desto schmaler (Taper-Effekt)
    const scale = 1.0 - t * taper;

    // X-Koordinate verkleinern
    posArray[i * 3] = x * scale;
  }

  // Three.js mitteilen, dass die Positionen aktualisiert wurden
  geo.getAttribute("position").needsUpdate = true;

  // Normalen neu berechnen (wichtig für korrekte Beleuchtung, falls später
  // auf MeshStandardNodeMaterial umgestellt wird)
  geo.computeVertexNormals();

  return geo;
}

/**
 * Erstellt einen einzelnen Seegras-Halm (Mesh + Material + Geometrie).
 *
 * Variante: Grasartig (Halodule/Cymodocea) – schmal, spitz zulaufend.
 *
 * @param options  Shader-Optionen (Farbe, Bewegung)
 * @param width    Breite des Halms
 * @param height   Höhe des Halms
 * @returns        Ein THREE.Mesh mit TSL-Shader-Material
 */
export function createSeegrassBlade(
  options: Partial<SeegrassMaterialOptions> = {},
  width: number = 0.15,
  height: number = 1.5,
): THREE.Mesh {
  const geometry = createSeegrassBladeGeometry(width, height);
  const material = createSeegrassMaterial(options);
  return new THREE.Mesh(geometry, material);
}

// --------------------------------------------------------------------------
// Variante B: Bandförmig (Eelgrass / Zostera marina)
// --------------------------------------------------------------------------

/**
 * Erstellt eine bandförmige Geometrie für Eelgrass.
 *
 * Eelgrass hat breite, lange Bänder (30-100cm in der Natur).
 * Die Geometrie ist ein breites, langes Band mit vielen Segmenten
 * für eine sanfte, fließende Wellenbewegung.
 *
 * @param width    Breite des Bands
 * @param height   Länge des Bands
 * @param segments Höhen-Unterteilungen
 */
export function createRibbonGeometry(
  width: number = 0.4,
  height: number = 2.5,
  segments: number = 12,
): THREE.BufferGeometry {
  // Breites Band mit vielen Segmenten für glatte Wellen
  const geo = new THREE.PlaneGeometry(width, height, 1, segments);

  // --- Band sanft verjüngen ---
  // Eelgrass-Bänder werden zur Spitze hin etwas schmaler,
  // aber nicht so extrem wie Gras-Halme.
  const positions = geo.getAttribute("position") as THREE.BufferAttribute;
  const posArray = positions.array as Float32Array;

  for (let i = 0; i < positions.count; i++) {
    const x = posArray[i * 3];
    const y = posArray[i * 3 + 1];
    const t = y / height + 0.5; // 0 = Basis, 1 = Spitze

    // Leichte Verjüngung: nur ~30% an der Spitze
    const scale = 1.0 - t * 0.3;
    posArray[i * 3] = x * scale;

    // Spitze leicht abrunden (Y leicht stauchen oben)
    if (t > 0.8) {
      const roundFactor = (t - 0.8) / 0.2; // 0..1 im oberen Bereich
      posArray[i * 3] = x * scale * (1.0 - roundFactor * 0.3);
    }
  }

  geo.getAttribute("position").needsUpdate = true;
  geo.computeVertexNormals();

  return geo;
}

/**
 * Erstellt einen Eelgrass-Band (Mesh + Material + Geometrie).
 *
 * Variante: Bandförmig (Zostera marina) – breite, lange Bänder.
 */
export function createRibbonBlade(
  options: Partial<SeegrassMaterialOptions> = {},
  width: number = 0.4,
  height: number = 2.5,
): THREE.Mesh {
  // Eelgrass hat kräftigere Farben (mehr Chlorophyll)
  const ribbonOpts: SeegrassMaterialOptions = {
    colorBottom: new THREE.Color("#0e4a0e"),
    colorTop: new THREE.Color("#3ab03a"),
    swayAmount: 0.3, // stärkere Bewegung (längeres Band)
    swaySpeed: 0.9, // langsamere, majestätische Bewegung
    ...options,
  };
  const geometry = createRibbonGeometry(width, height);
  const material = createSeegrassMaterial(ribbonOpts);
  return new THREE.Mesh(geometry, material);
}

// --------------------------------------------------------------------------
// Variante C: Paddelförmig (Halophila – "paddle grass")
// --------------------------------------------------------------------------

/**
 * Erstellt eine paddelförmige Geometrie (Stiel + ovales Blatt).
 *
 * Halophila hat dünne Stiele mit einem ovalen Blatt am Ende,
 * ähnlich wie ein Mini-Seerosenblatt an einem Stiel.
 *
 * @param stemHeight  Höhe des Stiels
 * @param leafWidth   Breite des ovalen Blatts
 * @param leafHeight  Höhe des ovalen Blatts
 * @param segments    Unterteilungen pro Einheit
 */
export function createPaddleGeometry(
  stemHeight: number = 1.2,
  leafWidth: number = 0.5,
  leafHeight: number = 0.7,
  segments: number = 8,
): THREE.BufferGeometry {
  // Gesamthöhe = Stiel + Blatt
  const totalHeight = stemHeight + leafHeight;

  // PlaneGeometry als Basis: heightSegments = segments für Blattbereich,
  // plus 2 Segmente für den Stiel
  const totalSegments = segments + 2;
  const geo = new THREE.PlaneGeometry(leafWidth, totalHeight, 1, totalSegments);

  const positions = geo.getAttribute("position") as THREE.BufferAttribute;
  const posArray = positions.array as Float32Array;

  // Stiel-Mitte (Y-Koordinate)
  const stemTop = stemHeight - totalHeight / 2; // oberer Stielpunkt

  for (let i = 0; i < positions.count; i++) {
    const x = posArray[i * 3];
    const y = posArray[i * 3 + 1];

    if (y <= stemTop) {
      // --- Stiel-Bereich (untere Hälfte) ---
      // Sehr schmal machen (dünner Stiel)
      posArray[i * 3] = x * 0.08;
    } else {
      // --- Blatt-Bereich (obere Hälfte) ---
      // Oval-Form: X wird basierend auf Y ein- und ausgeblendet
      // t_blatt: 0 = Blattanfang (am Stiel), 1 = Blattspitze
      const tBlatt = (y - stemTop) / leafHeight;

      // Ellipsen-Funktion: sqrt(t * (1-t)) erzeugt eine ovale Form
      // Maximum in der Mitte (t=0.5), schmal an den Rändern
      const ovalFactor = Math.sqrt(Math.max(0, tBlatt * (1.0 - tBlatt))) * 2.0; // *2 damit die volle Breite in der Mitte erreicht wird

      posArray[i * 3] = x * ovalFactor;
    }
  }

  geo.getAttribute("position").needsUpdate = true;
  geo.computeVertexNormals();

  return geo;
}

/**
 * Erstellt ein Paddel-Seegras (Stiel + ovales Blatt).
 *
 * Variante: Paddelförmig (Halophila) – dünner Stiel, ovales Blatt.
 */
export function createPaddleBlade(
  options: Partial<SeegrassMaterialOptions> = {},
  stemHeight: number = 1.2,
  leafWidth: number = 0.5,
  leafHeight: number = 0.7,
): THREE.Mesh {
  // Halophila hat hellgrüne, fast transparent wirkende Blätter
  const paddleOpts: SeegrassMaterialOptions = {
    colorBottom: new THREE.Color("#1a5c1a"),
    colorTop: new THREE.Color("#4cd64c"),
    swayAmount: 0.15, // sanfte Bewegung (kürzere Pflanze)
    swaySpeed: 1.6, // schnellere, zittrige Bewegung
    ...options,
  };
  const geometry = createPaddleGeometry(stemHeight, leafWidth, leafHeight);
  const material = createSeegrassMaterial(paddleOpts);
  return new THREE.Mesh(geometry, material);
}
