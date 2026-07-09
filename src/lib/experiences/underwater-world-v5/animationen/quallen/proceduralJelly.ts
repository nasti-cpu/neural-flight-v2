/**
 * proceduralJelly.ts – Zwei selbstgebaute Quallen aus Three.js-Primitiven.
 *
 * Mondqualle (Variante 3):
 *   - Flache, tellerförmige Glocke wie Aurelia aurita
 *   - 4 Mundarme in Kleeblatt-Anordnung
 *   - Feine Tentakeln am gesamten Glockenrand
 *   - Farbe: Transparent weiß-bläulich
 *
 * Haarqualle (Variante 4):
 *   - Kugelig-gewölbte Glocke wie Cyanea capillata
 *   - 8 Tentakel-Büschel mit vielen langen Fangarmen
 *   - Große, lappige Mundarme
 *   - Farbe: Rötlich-orange mit Farbverlauf
 *
 * Beide werden aus einfachen Three.js-Geometrien aufgebaut
 * (kein GLTF-Modell) und haben eigene Animations-Funktionen.
 */

import * as THREE from "three/webgpu";

// ---------------------------------------------------------------------------
// Quallen-Muster-Textur (wird auf die Glocke gelegt)
// ---------------------------------------------------------------------------

/**
 * Erzeugt eine Canvas-Textur mit typischem Quallen-Muster:
 *   - 4-fach symmetrische Gonaden (Kleeblatt)
 *   - Ringkanal am Rand
 *   - Feine Radial-Streifen
 *   - Transparenter Hintergrund
 */
function createJellyPatternTexture(): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  // Basis: heller, leicht bläulicher Hintergrund
  ctx.fillStyle = "#e8f0f8";
  ctx.fillRect(0, 0, size, size);

  // Vertikaler Verlauf: oben heller (Glockenscheitel), unten etwas dunkler
  const grad = ctx.createLinearGradient(0, 0, 0, size);
  grad.addColorStop(0, "rgba(210, 235, 250, 0.5)");
  grad.addColorStop(0.3, "rgba(200, 225, 245, 0.2)");
  grad.addColorStop(0.7, "rgba(190, 215, 240, 0.3)");
  grad.addColorStop(1, "rgba(180, 205, 230, 0.4)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  const w = size;
  const h = size;

  // === Vertikale Streifen (Striae) – gleichmäßig über U ===
  for (let x = 0; x < w; x += w / 60) {
    ctx.strokeStyle = "rgba(150, 195, 230, 0.15)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }

  // === Vier Gonaden – gleichmäßig über U verteilt, im oberen Viertel (V 0.15–0.35) ===
  const gonadVStart = h * 0.15; // V=0.15
  const gonadVEnd = h * 0.35; // V=0.35
  const gonadH = gonadVEnd - gonadVStart;
  const gonadW = w * 0.06;
  const gonads = 4;
  for (let i = 0; i < gonads; i++) {
    const uCenter = (i / gonads) * w + w / (gonads * 2);
    const cx = uCenter;
    const cy = (gonadVStart + gonadVEnd) / 2;

    // Ovale Gonade
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(cx, cy, gonadW, gonadH * 0.5, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(170, 210, 245, 0.55)";
    ctx.fill();
    ctx.strokeStyle = "rgba(130, 175, 220, 0.65)";
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.restore();

    // Kleine helle Mitte
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(cx, cy, gonadW * 0.4, gonadH * 0.2, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(210, 235, 255, 0.5)";
    ctx.fill();
    ctx.restore();

    // Von jeder Gonade ausgehende Linien (nach unten ausstrahlend)
    for (let k = -2; k <= 2; k++) {
      const spreadX = cx + k * w * 0.04;
      ctx.strokeStyle = "rgba(150, 195, 230, 0.15)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(spreadX, gonadVEnd);
      ctx.lineTo(spreadX + k * w * 0.02, h * 0.75);
      ctx.stroke();
    }
  }

  // === Ringkanal: horizontale Bänder bei V ≈ 0.75 ===
  const ringY = h * 0.75;
  ctx.strokeStyle = "rgba(140, 185, 220, 0.4)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, ringY);
  ctx.lineTo(w, ringY);
  ctx.stroke();

  // Zweiter, dünnerer Ring
  ctx.strokeStyle = "rgba(130, 175, 210, 0.25)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, ringY + h * 0.04);
  ctx.lineTo(w, ringY + h * 0.04);
  ctx.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}

// ---------------------------------------------------------------------------
// Typen für die prozeduralen Quallen
// ---------------------------------------------------------------------------

export interface ProceduralJelly {
  group: THREE.Group;
  bell: THREE.Mesh;
  tentacleRoots: THREE.Object3D[]; // Eltern-Objekte der Tentakeln (für Schwenk)
  oralArms: THREE.Object3D[]; // Mundarme
  animState: {
    phase: number;
    pulseSpeed: number;
    liftStrength: number;
    driftSpeed: number;
  };
}

// ---------------------------------------------------------------------------
// Klon-Funktion für den Quallen-Pool
// ---------------------------------------------------------------------------

/**
 * Klont eine ProceduralJelly – viel günstiger als buildMoonJelly(),
 * weil Geometrien und Materialien NICHT neu erstellt, sondern referenziert werden.
 * Nur die Group-Struktur wird geklont.
 */
export function cloneJelly(template: ProceduralJelly): ProceduralJelly {
  const group = template.group.clone(false); // Nur die Group, keine Kinder

  // Bell (Mesh) klonen – das Mesh referenziert die gleiche Geometrie + Material
  const bell = template.bell.clone() as THREE.Mesh;
  group.add(bell);
  bell.position.copy(template.bell.position);

  // Tentakel-Roots klonen
  const tentacleRoots: THREE.Object3D[] = [];
  for (const root of template.tentacleRoots) {
    const clone = root.clone(true); // Mit Kindern (den TubeMeshes)
    group.add(clone);
    tentacleRoots.push(clone);
  }

  // Mundarme klonen
  const oralArms: THREE.Object3D[] = [];
  for (const arm of template.oralArms) {
    const clone = arm.clone(true);
    group.add(clone);
    oralArms.push(clone);
  }

  return {
    group,
    bell,
    tentacleRoots,
    oralArms,
    animState: {
      phase: Math.random() * Math.PI * 2,
      pulseSpeed: template.animState.pulseSpeed,
      liftStrength: template.animState.liftStrength,
      driftSpeed: template.animState.driftSpeed,
    },
  };
}

// ---------------------------------------------------------------------------
// Hilfsfunktion: Einzelnen Tentakel (Tube entlang einer Kurve)
// ---------------------------------------------------------------------------

function createTentacle(
  length: number,
  segments: number,
  radius: number,
  color: THREE.Color,
  opacity: number,
): THREE.Mesh {
  // Geschwungene Kurve – Tentakel fallen nie gerade, sondern wellig
  const spread = length * 0.2;
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    // Mehrere überlagerte Wellen für natürliche, unregelmäßige Form
    const wave1 =
      Math.sin(t * Math.PI * 2.5 + Math.random() * 6) * spread * 0.4;
    const wave2 =
      Math.cos(t * Math.PI * 1.3 + Math.random() * 6) * spread * 0.3;
    const x = wave1 + wave2;
    const z = Math.sin(t * Math.PI * 1.8 + Math.random() * 6) * spread * 0.35;
    points.push(new THREE.Vector3(x, -t * length, z));
  }
  const curve = new THREE.CatmullRomCurve3(points);
  const tubeGeo = new THREE.TubeGeometry(
    curve,
    segments,
    radius * 0.5,
    4,
    false,
  );
  const tubeMat = new THREE.MeshPhysicalMaterial({
    color: color,
    transparent: true,
    opacity: opacity,
    roughness: 0.3,
    metalness: 0.0,
    clearcoat: 0.2,
    side: THREE.DoubleSide,
  });
  return new THREE.Mesh(tubeGeo, tubeMat);
}

// ---------------------------------------------------------------------------
// Hilfsfunktion: Oral-Arm (breitere, kürzere Röhre)
// ---------------------------------------------------------------------------

function createOralArm(
  length: number,
  segments: number,
  radius: number,
  color: THREE.Color,
  opacity: number,
): THREE.Mesh {
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const spread = Math.sin(t * Math.PI) * 0.3; // Fransen-Effekt
    points.push(
      new THREE.Vector3(
        (Math.random() - 0.5) * spread,
        -t * length,
        (Math.random() - 0.5) * spread,
      ),
    );
  }
  const curve = new THREE.CatmullRomCurve3(points);
  const tubeGeo = new THREE.TubeGeometry(curve, segments, radius, 5, false);
  const tubeMat = new THREE.MeshPhysicalMaterial({
    color: color,
    transparent: true,
    opacity: opacity,
    roughness: 0.4,
    metalness: 0.0,
    clearcoat: 0.3,
    side: THREE.DoubleSide,
  });
  return new THREE.Mesh(tubeGeo, tubeMat);
}

// ---------------------------------------------------------------------------
// 1. Mondqualle (Aurelia aurita)
// ---------------------------------------------------------------------------

export function buildMoonJelly(): ProceduralJelly {
  const group = new THREE.Group();

  // === Glocke: runde Kuppel, UNTEN OFFEN – wie eine echte Quallenglocke ===
  //     thetaLength < PI → die Kugel wird unten abgeschnitten,
  //     sodass die Glocke einen offenen Rand hat.
  const bellGeo = new THREE.SphereGeometry(
    0.7,
    32,
    24,
    0,
    Math.PI * 2,
    0,
    Math.PI * 0.65,
  );
  const pos = bellGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    // Nur die obere Hälfte leicht strecken für eine runde Kuppel
    if (y > 0) {
      pos.setY(i, y * 0.9);
    }
  }
  bellGeo.computeVertexNormals();

  const patternTex = createJellyPatternTexture();
  const bellMat = new THREE.MeshPhysicalMaterial({
    color: 0xd8eaf5,
    map: patternTex,
    transparent: true,
    opacity: 0.85,
    roughness: 0.3,
    metalness: 0.0,
    clearcoat: 0.2,
    clearcoatRoughness: 0.4,
    side: THREE.DoubleSide,
  });
  const bell = new THREE.Mesh(bellGeo, bellMat);
  bell.position.y = 0.3;
  group.add(bell);

  // === Tentakeln: kommen AUS der offenen Glocke unten heraus ===
  const tentColor = new THREE.Color(0xddeeff);
  const tentacleRoots: THREE.Object3D[] = [];

  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2;
    const radius = 0.4 + Math.random() * 0.2;
    const root = new THREE.Object3D();
    root.position.set(
      Math.cos(angle) * radius,
      -0.2 - Math.random() * 0.1,
      Math.sin(angle) * radius,
    );
    group.add(root);

    const tentacle = createTentacle(
      0.4 + Math.random() * 1.2,
      5 + Math.floor(Math.random() * 4),
      0.02 + Math.random() * 0.02,
      tentColor,
      0.25 + Math.random() * 0.25,
    );
    root.add(tentacle);
    tentacleRoots.push(root);
  }

  // === 4 Mundarme (Kleeblatt-Anordnung) ===
  const armColor = new THREE.Color(0xaaddff);
  const oralArms: THREE.Object3D[] = [];

  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const armRoot = new THREE.Object3D();
    armRoot.position.set(Math.cos(angle) * 0.18, -0.12, Math.sin(angle) * 0.18);
    group.add(armRoot);

    const arm = createOralArm(
      0.4 + Math.random() * 0.3,
      6,
      0.04,
      armColor,
      0.5,
    );
    armRoot.add(arm);
    oralArms.push(armRoot);
  }

  return {
    group,
    bell,
    tentacleRoots,
    oralArms,
    animState: {
      phase: Math.random() * Math.PI * 2,
      pulseSpeed: 0.8,
      liftStrength: 0.5,
      driftSpeed: 0.15,
      // Die tatsächlichen Werte werden dynamisch von jellyfish-swim.ts gesetzt
    },
  };
}

// ---------------------------------------------------------------------------
// 2. Haarqualle (Cyanea capillata / Lion's Mane)
// ---------------------------------------------------------------------------

export function buildHairJelly(): ProceduralJelly {
  const group = new THREE.Group();

  // === Glocke: hohe, runde Kuppel (kugelig, leicht gestaucht) ===
  const bellGeo = new THREE.SphereGeometry(0.8, 32, 24);
  const pos = bellGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y > 0) {
      pos.setY(i, y * 0.7); // Weniger Abflachung → runder
    } else {
      pos.setY(i, y * 0.15); // Unterseite fast flach
    }
  }
  bellGeo.computeVertexNormals();

  // Farbverlauf von orange-rot oben zu heller unten
  const bellMat = new THREE.MeshPhysicalMaterial({
    color: 0xe06633,
    transparent: true,
    opacity: 0.55,
    roughness: 0.3,
    metalness: 0.0,
    clearcoat: 0.2,
    clearcoatRoughness: 0.4,
    side: THREE.DoubleSide,
    emissive: 0x331100,
    emissiveIntensity: 0.1,
  });
  const bell = new THREE.Mesh(bellGeo, bellMat);
  bell.position.y = 0.15;
  group.add(bell);

  // === Tentakeln: 6 Büschel à 4-6 Fäden ===
  const tentColor1 = new THREE.Color(0xff8855);
  const tentColor2 = new THREE.Color(0xcc6644);
  const tentacleRoots: THREE.Object3D[] = [];

  for (let b = 0; b < 6; b++) {
    const angle = (b / 6) * Math.PI * 2;
    const radius = 0.7;

    for (let t = 0; t < 4 + Math.floor(Math.random() * 3); t++) {
      const root = new THREE.Object3D();
      const offsetAngle = angle + (Math.random() - 0.5) * 0.4;
      const offsetRadius = radius + (Math.random() - 0.5) * 0.2;
      root.position.set(
        Math.cos(offsetAngle) * offsetRadius,
        -0.1,
        Math.sin(offsetAngle) * offsetRadius,
      );
      root.rotation.z = (Math.random() - 0.5) * 0.3;
      group.add(root);

      const length = 0.8 + Math.random() * 1.2;
      const tentacle = createTentacle(
        length,
        5 + Math.floor(Math.random() * 3),
        0.025 + Math.random() * 0.02,
        Math.random() > 0.5 ? tentColor1 : tentColor2,
        0.3 + Math.random() * 0.25,
      );
      root.add(tentacle);
      tentacleRoots.push(root);
    }
  }

  // === Mundarme: 4 Fransen-Strukturen ===
  const armColor = new THREE.Color(0xff7744);
  const oralArms: THREE.Object3D[] = [];

  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2;
    const armRoot = new THREE.Object3D();
    armRoot.position.set(Math.cos(angle) * 0.2, -0.18, Math.sin(angle) * 0.2);
    group.add(armRoot);

    for (let f = 0; f < 3; f++) {
      const arm = createOralArm(
        0.4 + Math.random() * 0.3,
        6,
        0.03,
        armColor,
        0.45,
      );
      arm.position.x = (Math.random() - 0.5) * 0.15;
      arm.position.z = (Math.random() - 0.5) * 0.15;
      arm.rotation.x = (Math.random() - 0.5) * 0.3;
      arm.rotation.z = (Math.random() - 0.5) * 0.3;
      armRoot.add(arm);
    }
    oralArms.push(armRoot);
  }

  return {
    group,
    bell,
    tentacleRoots,
    oralArms,
    animState: {
      phase: Math.random() * Math.PI * 2,
      pulseSpeed: 0.5,
      liftStrength: 0.3,
      driftSpeed: 0.08,
    },
  };
}

// ---------------------------------------------------------------------------
// Animations-Funktion für beide Quallen
// ---------------------------------------------------------------------------

export function animateProceduralJelly(
  jelly: ProceduralJelly,
  elapsed: number,
  delta: number,
  params: {
    pulseSpeed: number;
    liftStrength: number;
    driftSpeed: number;
  },
  wander: boolean = true,
): void {
  const { group, bell, tentacleRoots, oralArms, animState } = jelly;
  const { phase } = animState;
  const { pulseSpeed, liftStrength, driftSpeed } = params;

  // =========================================================================
  // 1. Asymmetrischer Puls: schnell kontrahieren, langsam entspannen
  // =========================================================================

  const pulsePhase = elapsed * pulseSpeed * Math.PI * 2 + phase;
  const rawSin = Math.sin(pulsePhase);

  // Verzerrung: negative Halbwelle (Relaxation) wird flacher
  const shaped = rawSin < 0 ? rawSin * 0.4 : rawSin;
  const pulseNorm = (shaped + 0.4) / 1.4; // 0 = entspannt, 1 = kontrahiert

  // Glocken-Puls: asymmetrische Verformung
  // X und Z leicht unterschiedlich für organischeren Eindruck
  const xScale = 1 + pulseNorm * 0.05 + Math.sin(elapsed * 0.3 + phase) * 0.008;
  const yScale = 1 - pulseNorm * 0.14;
  const zScale =
    1 + pulseNorm * 0.05 + Math.cos(elapsed * 0.25 + phase * 0.7) * 0.008;
  bell.scale.set(xScale, yScale, zScale);

  // Glocke neigt sich sanft (wie eine echte Qualle, die nie perfekt
  // symmetrisch pulsiert)
  const bellTilt = pulseNorm * 0.03;
  bell.rotation.x =
    Math.sin(elapsed * 0.18 + phase * 0.7) * 0.03 + bellTilt * 0.3;
  bell.rotation.z =
    Math.cos(elapsed * 0.15 + phase * 0.4) * 0.03 + bellTilt * 0.2;

  // =========================================================================
  // 2. Vertikale Bewegung – sanftes Auf und Ab
  // =========================================================================

  const lift = (0.5 - pulseNorm) * 2 * liftStrength;
  const depthWave = Math.sin(elapsed * 0.04 + phase * 0.5) * 0.15;
  group.position.y = lift + depthWave;

  if (wander) {
    // =======================================================================
    // 3. Wandering durch die Szene (nur im Standalone-Modus – jellyWorld
    //    steuert die Position via Orbits selbst)
    // =======================================================================

    const d = driftSpeed;
    const wanderX = Math.sin(elapsed * d * 0.1 + phase * 0.1) * 12;
    const wanderZ = Math.cos(elapsed * d * 0.08 + phase * 0.2) * 12;
    const midX = Math.sin(elapsed * d * 0.5 + phase * 0.3) * 4;
    const midZ = Math.cos(elapsed * d * 0.45 + phase * 0.4) * 4;
    const localX = Math.sin(elapsed * d * 1.2 + phase * 0.7) * 1.5;
    const localZ = Math.cos(elapsed * d * 1.1 + phase * 0.6) * 1.5;

    group.position.x = wanderX + midX + localX;
    group.position.z = wanderZ + midZ + localZ;

    // =======================================================================
    // 4. Yaw – der Bewegungsrichtung folgen
    // =======================================================================

    const dvx =
      Math.cos(elapsed * d * 0.1 + phase * 0.1) * 12 * d * 0.1 +
      Math.cos(elapsed * d * 0.5 + phase * 0.3) * 4 * d * 0.5 +
      Math.cos(elapsed * d * 1.2 + phase * 0.7) * 1.5 * d * 1.2;
    const dvz =
      -Math.sin(elapsed * d * 0.08 + phase * 0.2) * 12 * d * 0.08 -
      Math.sin(elapsed * d * 0.45 + phase * 0.4) * 4 * d * 0.45 -
      Math.sin(elapsed * d * 1.1 + phase * 0.6) * 1.5 * d * 1.1;
    const moveDir = Math.atan2(dvx, dvz);
    const yawNoise = Math.sin(elapsed * 0.08 + phase * 0.2) * 0.15;
    group.rotation.y = moveDir + yawNoise;
  }

  // =========================================================================
  // 5. Sanftes Rollen & Nicken – wie von Wasserströmung getrieben
  // =========================================================================

  group.rotation.x = Math.sin(elapsed * 0.06 + phase * 0.3) * 0.03;
  group.rotation.z = Math.sin(elapsed * 0.07 + phase * 0.4) * 0.03;

  // =========================================================================
  // 6. Tentakeln – schwer, träge, fließend
  //    Echte Tentakeln sind kein starres Gebilde – sie reagieren träge
  //    auf den Puls, schwingen in eigenem Rhythmus und hängen schwer
  //    im Wasser. Die Amplitude ist bewusst klein gehalten.
  // =========================================================================

  const tentCount = tentacleRoots.length;
  for (let i = 0; i < tentCount; i++) {
    const root = tentacleRoots[i];

    // Jeder Tentakel hat eine eigene, kleine Verzögerung zum Puls
    const delay = (i / tentCount) * Math.PI * 0.3;
    const localPulse = Math.sin(pulsePhase - Math.PI * 0.4 + delay);

    // Bei Kontraktion werden Tentakeln sanft eingezogen
    const pullInward = -localPulse * 0.12;

    // Ganz langsame Wasserströmung (dominant)
    const flowZ = Math.sin(elapsed * 0.06 + i * 0.5 + phase * 0.4) * 0.03;
    const flowX = Math.cos(elapsed * 0.05 + i * 0.6 + phase * 0.3) * 0.025;

    root.rotation.z = flowZ + pullInward;
    root.rotation.x = flowX + pullInward * 0.5;
  }

  // =========================================================================
  // 7. Mundarme – träges, fließendes Wogen
  // =========================================================================

  for (let i = 0; i < oralArms.length; i++) {
    const arm = oralArms[i];
    const freq = 0.3 + i * 0.08;
    arm.rotation.x = Math.sin(elapsed * freq + phase + i * 1.5) * 0.06;
    arm.rotation.z =
      Math.cos(elapsed * freq * 0.8 + phase * 0.7 + i * 1.1) * 0.05;
  }
}
