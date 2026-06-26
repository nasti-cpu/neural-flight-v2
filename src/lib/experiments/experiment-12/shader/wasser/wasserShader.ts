/**
 * wasserShader.ts
 *
 * TSL-basierte Shader für die Unterwasser-Szene:
 *
 * 1. Wasseroberfläche von unten:
 *    - 6-Oktaven-Wellenfeld mit Normalen-Berechnung
 *    - Fresnel-Reflexion (gleichmäßig, ohne Snell's-Fenster-Kreis)
 *    - Stimmungsabhängige Farben (surfaceColor, highlightColor)
 *
 * 2. God Rays (Lichtstrahlen):
 *    - Kaustische Lichtbänder (horizontale Streifen, die nach unten driften)
 *    - Extrem weiche Ränder (keine sichtbare Geometrie-Grenze)
 *    - Stimmungsabhängige Lichtfarbe (rayColor)
 *    - Additive Blending für volumetrischen Look
 *
 * 3. Wasserpartikel (Plankton, Sediment):
 *    - Sanftes Driften mit Turbulenz
 *    - Tiefenabhängige Helligkeit
 */

import {
  uniform,
  vec3,
  vec4,
  float,
  positionLocal,
  sin,
  cos,
  mix,
  time,
  length as tslLength,
  normalize,
  pow,
  smoothstep,
} from "three/tsl";
import { MeshBasicNodeMaterial, PointsNodeMaterial } from "three/webgpu";
import * as THREE from "three/webgpu";

// ---------------------------------------------------------------------------
// Typen
// ---------------------------------------------------------------------------

export interface WaterSurfaceOptions {
  waveAmplitude: number;
  waveSpeed: number;
  opacity: number;
  /** Farbe in den dunklen Bereichen (Täler, Ränder) */
  surfaceColor: THREE.Color;
  /** Farbe an den hellen Stellen (Wellenkämme, Kaustiken) */
  highlightColor: THREE.Color;
}

export interface GodRayOptions {
  brightness: number;
  softness: number;
  reach: number;
  wobble: number;
  /** Farbe des Lichtstrahls (z.B. golden für Tropen, blau für Tiefsee) */
  rayColor: THREE.Color;
}

// ===========================================================================
// 1. WASSEROBERFLÄCHE
// ===========================================================================

/**
 * 6-Oktaven-Wellenfeld.
 */
function waveHeightField(x: any, z: any, t: any, spd: any, amp: any): any {
  const w1 = sin(x.mul(0.7).add(t.mul(spd))).mul(amp.mul(0.35));
  const w2 = cos(z.mul(1.1).add(t.mul(spd.mul(0.85)))).mul(amp.mul(0.25));
  const w3 = sin(
    x
      .add(z)
      .mul(1.3)
      .add(t.mul(spd.mul(1.15))),
  ).mul(amp.mul(0.2));
  const w4 = cos(
    x
      .mul(-1.8)
      .add(z.mul(1.5))
      .add(t.mul(spd.mul(1.4))),
  ).mul(amp.mul(0.12));
  const w5 = sin(
    x
      .mul(3.2)
      .add(z.mul(0.6))
      .add(t.mul(spd.mul(2.0))),
  ).mul(amp.mul(0.06));
  const w6 = cos(
    x
      .mul(5.5)
      .sub(z.mul(3.8))
      .add(t.mul(spd.mul(2.8))),
  ).mul(amp.mul(0.03));
  return w1.add(w2).add(w3).add(w4).add(w5).add(w6);
}

/**
 * Wellennormale per finiter Differenz.
 */
function waveNormal(x: any, z: any, t: any, spd: any, amp: any): any {
  const eps = float(0.02);
  const h0 = waveHeightField(x, z, t, spd, amp);
  const hx = waveHeightField(x.add(eps), z, t, spd, amp);
  const hz = waveHeightField(x, z.add(eps), t, spd, amp);
  const dhdx = hx.sub(h0).div(eps);
  const dhdz = hz.sub(h0).div(eps);
  return normalize(vec3(dhdx.mul(-1.0), float(1.0), dhdz.mul(-1.0)));
}

/**
 * Wasseroberflächen-Material (von unten gesehen).
 *
 * Ein gleichmäßiges Fresnel-basiertes Wasser ohne Snell's-Fenster-Effekte
 * oder zitternde Kaustik-Muster.
 */
export function createWaterSurfaceMaterial(
  options: Partial<WaterSurfaceOptions> = {},
): MeshBasicNodeMaterial {
  const opts: WaterSurfaceOptions = {
    waveAmplitude: 0.6,
    waveSpeed: 0.6,
    opacity: 0.82,
    surfaceColor: new THREE.Color("#0a2a4a"),
    highlightColor: new THREE.Color("#5ab8f0"),
    ...options,
  };

  const waveAmp = uniform(opts.waveAmplitude);
  const waveSpd = uniform(opts.waveSpeed);
  const surfOpacity = uniform(opts.opacity);
  const surfColor = uniform(opts.surfaceColor);
  const highColor = uniform(opts.highlightColor);

  const material = new MeshBasicNodeMaterial();
  material.side = THREE.DoubleSide;
  material.transparent = true;
  material.blending = THREE.NormalBlending;
  material.depthWrite = true;

  // --- Vertex-Displacement ---
  material.positionNode = vec3(
    positionLocal.x,
    positionLocal.y.add(
      waveHeightField(positionLocal.x, positionLocal.z, time, waveSpd, waveAmp),
    ),
    positionLocal.z,
  );

  // --- Fragment-Shader ---
  const normal = waveNormal(
    positionLocal.x,
    positionLocal.z,
    time,
    waveSpd,
    waveAmp,
  );

  // --- Fresnel (flache Wellen = dunkler, steile = heller) ---
  // Gleichmäßige Oberfläche ohne kreisförmige Snell's-Fenster-Effekte.
  const fresnel = pow(normal.y.clamp(0.0, 1.0), float(2.0));

  // --- Gesamthelligkeit (nur Fresnel, keine Kaustiken oder Snell-Kreise) ---
  const totalBrightness = fresnel.clamp(0.08, 1.0);

  // --- Farbe ---
  const waterColor = mix(surfColor, highColor, totalBrightness);

  // --- Alpha ---
  const alpha = mix(surfOpacity, surfOpacity.sub(float(0.2)), totalBrightness);

  material.colorNode = vec4(waterColor, alpha);
  return material;
}

export function createWaterSurface(
  options: Partial<WaterSurfaceOptions> = {},
  size: number = 16,
  segments: number = 80,
): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
  const material = createWaterSurfaceMaterial(options);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}

// ===========================================================================
// 2. GOD RAYS
// ===========================================================================

/**
 * God-Ray-Material.
 *
 * Statt eines simplen Kegels erzeugt der Shader:
 * - Kaustische Lichtbänder: horizontale helle/dunkle Streifen,
 *   die langsam nach unten driften (wie Licht, das durch Wellen gebrochen wird)
 * - Extrem weiche Ränder: der Strahl verschwimmt komplett mit dem Wasser
 * - Stimmungsabhängige Farbe
 */
export function createGodRayMaterial(
  options: Partial<GodRayOptions> = {},
): MeshBasicNodeMaterial {
  const opts: GodRayOptions = {
    brightness: 0.5,
    softness: 0.8,
    reach: 0.75,
    wobble: 0.25,
    rayColor: new THREE.Color("#ffe8c0"),
    ...options,
  };

  const rayBrightness = uniform(opts.brightness);
  const raySoftness = uniform(opts.softness);
  const rayReach = uniform(opts.reach);
  const rayWobble = uniform(opts.wobble);
  const rayCol = uniform(opts.rayColor);

  const material = new MeshBasicNodeMaterial();
  material.transparent = true;
  material.blending = THREE.AdditiveBlending;
  material.depthWrite = false;
  material.side = THREE.DoubleSide;
  material.positionNode = positionLocal;

  // --- Dynamisches Wabern ---
  const wobbleX = sin(time.mul(1.3).add(positionLocal.y.mul(0.5))).mul(
    rayWobble,
  );
  const wobbleZ = cos(time.mul(1.1).add(positionLocal.y.mul(0.7))).mul(
    rayWobble,
  );

  // --- Radialer Fade (extrem weich) ---
  const radius = tslLength(
    vec3(positionLocal.x.sub(wobbleX), 0, positionLocal.z.sub(wobbleZ)),
  );
  // Sehr weicher Gauß-Abfall: exp(-softness * r^2)
  const radialFade = raySoftness
    .mul(pow(radius, float(2.0)))
    .mul(-1.0)
    .exp();

  // --- Vertikaler Fade ---
  const yNorm = positionLocal.y
    .mul(float(1.0).div(rayReach))
    .add(float(0.55))
    .clamp(0.0, 1.0);
  const bottomFade = pow(yNorm, float(1.5));
  // Fade-out an der Wasseroberfläche: blendet die oberen ~30% aus
  // → vermeidet harte Kanten wo der Kegel die Wasseroberfläche schneidet
  const topFade = float(1.0).sub(smoothstep(float(0.55), float(0.85), yNorm));
  const verticalFade = bottomFade.mul(topFade);

  // --- Kaustische Lichtbänder ---
  // Horizontale Streifen, die nach unten wandern.
  // Simuliert, wie Wellen das Licht in Bänder bündeln.
  const bandY = positionLocal.y.mul(float(3.0));
  const band1 = sin(bandY.add(time.mul(1.5)).add(wobbleX.mul(5.0)))
    .mul(float(0.5))
    .add(float(0.5));
  const band2 = sin(bandY.mul(1.7).sub(time.mul(1.1)).add(wobbleZ.mul(4.0)))
    .mul(float(0.5))
    .add(float(0.5));
  const band3 = sin(bandY.mul(2.3).add(time.mul(2.0)))
    .mul(float(0.5))
    .add(float(0.5));
  // Bänder multiplizieren für scharfe Übergänge
  const bands = band1.mul(band2).mul(band3);
  // Bänder nur im oberen Bereich stark (wo Licht einfällt)
  const bandIntensity = mix(float(0.3), float(1.0), yNorm);
  const causticBands = mix(float(1.0), bands, bandIntensity);

  // --- Zeitliches Flackern ---
  const flicker = sin(time.mul(2.5).add(wobbleX.mul(3.0)))
    .mul(float(0.1))
    .add(float(1.0));

  // --- Kombinierter Fade ---
  const combinedFade = verticalFade
    .mul(radialFade)
    .mul(causticBands)
    .mul(flicker);

  // --- Farbe ---
  const finalColor = rayCol.mul(combinedFade).mul(rayBrightness);

  material.colorNode = vec4(finalColor, combinedFade);
  return material;
}

/**
 * Erstellt einen God-Ray-Kegel.
 */
export function createGodRay(
  options: Partial<GodRayOptions> = {},
  topRadius: number = 0.5,
  bottomRadius: number = 0.12,
  height: number = 7,
): THREE.Mesh {
  const geometry = new THREE.CylinderGeometry(
    topRadius,
    bottomRadius,
    height,
    16,
    1,
    false,
  );
  const material = createGodRayMaterial(options);
  return new THREE.Mesh(geometry, material);
}

// ===========================================================================
// 3. WASSERPARTIKEL
// ===========================================================================

export function createParticleMaterial(
  particleSize: number = 0.03,
  particleColor: THREE.Color = new THREE.Color("#cceeff"),
): PointsNodeMaterial {
  const material = new PointsNodeMaterial();
  material.transparent = true;
  material.blending = THREE.AdditiveBlending;
  material.depthWrite = false;

  material.positionNode = vec3(
    positionLocal.x.add(
      sin(time.mul(0.4).add(positionLocal.y.mul(2.5))).mul(0.08),
    ),
    positionLocal.y
      .add(cos(time.mul(0.3).add(positionLocal.x.mul(1.8))).mul(0.05))
      .add(time.mul(0.02)),
    positionLocal.z.add(
      cos(time.mul(0.35).add(positionLocal.z.mul(2.2))).mul(0.08),
    ),
  );

  material.sizeNode = float(particleSize);

  const depthFactor = positionLocal.y.mul(0.1).add(0.7).clamp(0.5, 1.0);
  const col = uniform(particleColor);
  material.colorNode = vec4(col.mul(depthFactor), 0.6);

  return material;
}

export function createParticleSystem(
  count: number = 2000,
  spreadXZ: number = 10,
  minY: number = -2.5,
  maxY: number = 4.5,
  particleSize: number = 0.03,
  particleColor: THREE.Color = new THREE.Color("#cceeff"),
): THREE.Points {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (Math.random() - 0.5) * spreadXZ;
    positions[i * 3 + 1] = minY + Math.random() * (maxY - minY);
    positions[i * 3 + 2] = (Math.random() - 0.5) * spreadXZ;
  }
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = createParticleMaterial(particleSize, particleColor);
  return new THREE.Points(geometry, material);
}

// ===========================================================================
// 4. SANDBODEN
// ===========================================================================

export function createSandyFloor(
  size: number = 14,
  y: number = -3,
): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(size, size);
  const material = new THREE.MeshStandardNodeMaterial({
    color: new THREE.Color("#c2a66b"),
    roughness: 0.9,
    metalness: 0.0,
  });
  const floor = new THREE.Mesh(geometry, material);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = y;
  floor.receiveShadow = true;
  return floor;
}
