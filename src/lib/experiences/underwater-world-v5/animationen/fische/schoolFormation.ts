/**
 * schoolFormation.ts – Schulformation für Fischschwärme
 *
 * Erzeugt eine V-förmige Aufstellung und berechnet pro Frame die
 * korrekte Position und Rotation jedes Fisches im Schwarm.
 *
 * Keine Three.js-Abhängigkeit – reine Vektormathematik.
 */

// ---------------------------------------------------------------------------
// Typen
// ---------------------------------------------------------------------------

export interface FormationOffset {
  /** Seitlicher Versatz relativ zur Schwarm-Mitte */
  offsetX: number;
  /** Vertikaler Versatz */
  offsetY: number;
  /** Tiefen-Versatz (negativ = weiter vorne) */
  offsetZ: number;
  /** Phasenversatz für die Schwimm-Animation dieses Fisches */
  phaseOffset: number;
  /** Amplituden-Faktor (0.3 – 1.0) für etwas natürliche Variation */
  ampFactor: number;
  /** Geschwindigkeits-Faktor (0.85 – 1.15) für individuelle Ellipsen-Geschwindigkeit */
  speedFactor: number;
}

export interface SchoolFrameFish {
  /** Welt-Position X */
  fx: number;
  /** Welt-Position Y */
  fy: number;
  /** Welt-Position Z */
  fz: number;
  /** Individuelle Yaw-Variation (wird zu baseYaw addiert) */
  yawVariation: number;
  /** Pitch (Nick) */
  pitch: number;
  /** Roll (Wanken) */
  roll: number;
}

// ---------------------------------------------------------------------------
// V-förmige Formation erzeugen (2er-Reihen, nach hinten breiter)
// ---------------------------------------------------------------------------

export function generateVFormation(size: number): FormationOffset[] {
  const offsets: FormationOffset[] = [];

  for (let i = 0; i < size; i++) {
    const rand = Math.random;
    const row = Math.floor(i / 2);
    const side = i % 2 === 0 ? -1 : 1;

    const spreadX = (row + 1) * 0.6;
    const spreadZ = row * 0.25;

    offsets.push({
      offsetX: spreadX * side,
      offsetY: (rand() - 0.5) * 0.4,
      offsetZ: -spreadZ,
      phaseOffset: rand() * Math.PI * 2,
      ampFactor: 0.3 + rand() * 0.7,
      speedFactor: 0.85 + rand() * 0.3,
    });
  }
  return offsets;
}

// ---------------------------------------------------------------------------
// Pro-Frame: Positionen + Rotationen für den gesamten Schwarm berechnen
// ---------------------------------------------------------------------------

export function computeSchoolFrame(
  formation: FormationOffset[],
  elapsed: number,
  centerX: number,
  centerZ: number,
  baseY: number,
  swimRadiusX: number,
  swimRadiusZ: number,
  speed: number,
  startAngle: number,
  depthAmp: number,
  depthFreq: number,
  floorY: number,
  outFish: SchoolFrameFish[],
): number {
  // Winkel des Schwarm-Zentrums auf der Ellipse
  const ang = elapsed * speed + startAngle;

  // Schwarm-Mitte
  const cx = centerX + Math.cos(ang) * swimRadiusX;
  const cz = centerZ + Math.sin(ang) * swimRadiusZ;

  // Tangenten-Richtung → Basis-Yaw
  const tx = -Math.sin(ang) * swimRadiusX;
  const tz = Math.cos(ang) * swimRadiusZ;
  const baseYaw = Math.atan2(tx, tz);

  const cosA = Math.cos(baseYaw);
  const sinA = Math.sin(baseYaw);

  // Vertikale Tiefe des Schwarms
  const rawCy = baseY + Math.sin(elapsed * depthFreq * Math.PI * 2) * depthAmp;
  const cy = Math.max(floorY + 2.0, rawCy);

  // outFish ist vorab alloziiert – keine new-Objekte im Loop!
  for (let i = 0; i < formation.length; i++) {
    const f = formation[i];
    const out = outFish[i];

    // Individuelle Position auf der Ellipse (eigene Geschwindigkeit)
    const fishAng = elapsed * speed * f.speedFactor;
    const fishPx = centerX + Math.cos(fishAng) * swimRadiusX;
    const fishPz = centerZ + Math.sin(fishAng) * swimRadiusZ;

    // V-Formation-Offset in Schwimmrichtung drehen
    out.fx = fishPx + f.offsetX * cosA - f.offsetZ * sinA;
    out.fz = fishPz + f.offsetX * sinA + f.offsetZ * cosA;

    // Vertikale Position: Schwarm-Tiefe + Offset + kleine Sinus-Welle
    out.fy = cy + f.offsetY + Math.sin(elapsed * 0.5 + f.phaseOffset) * 0.2;

    // Rotation: Yaw-Variation, Pitch, Roll
    out.yawVariation = Math.sin(elapsed * 1.2 * Math.PI * 2 + f.phaseOffset) * 0.15 * f.ampFactor;
    out.pitch = Math.sin(elapsed * 0.9 * Math.PI * 2 + f.phaseOffset * 0.7) * 0.05 * f.ampFactor;
    out.roll = Math.cos(fishAng + f.phaseOffset * 0.3) * Math.sin(elapsed * 0.6) * 0.2 * f.ampFactor;
  }

  return baseYaw;
}
