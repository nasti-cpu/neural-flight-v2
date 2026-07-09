/**
 * orbitSwimming.ts – Solo-Fisch-Animation (Carangiform + Burst-and-Glide)
 *
 * Enthält die reine Bewegungsmathematik eines Einzelfisches auf einer
 * elliptischen Bahn: Orbit-Position, Yaw/Pitch/Roll-Animation,
 * Tiefen-Schwankung und Burst-and-Glide.
 *
 * Keine Abhängigkeit von Three.js-Meshes oder Szenen-Management.
 */

// ---------------------------------------------------------------------------
// Typen: Schwimm-Parameter und Animations-Zustand
// ---------------------------------------------------------------------------

export interface SwimParams {
  yawAmp: number;
  yawFreq: number;
  pitchAmp: number;
  pitchFreq: number;
  rollAmp: number;
  depthAmp: number;
  depthFreq: number;
  burstInt: number;
  burstDur: number;
  burstYawMul: number;
  phaseOffset: number;
}

export interface SwimState {
  yaw: number;
  pitch: number;
  roll: number;
  curY: number;
  smoothYawFreq: number;
  smoothYawAmp: number;
}

// ---------------------------------------------------------------------------
// Erzeugung zufälliger Parameter (unterschiedlich pro Fisch)
// ---------------------------------------------------------------------------

export function createSwimParams(): SwimParams {
  const rand = Math.random;
  return {
    yawAmp: 0.04 + rand() * 0.08,
    yawFreq: 0.4 + rand() * 0.4,
    pitchAmp: 0.02 + rand() * 0.03,
    pitchFreq: 0.3 + rand() * 0.3,
    rollAmp: 0.05 + rand() * 0.1,
    depthAmp: 0.5 + rand() * 1.0,
    depthFreq: 0.06 + rand() * 0.1,
    burstInt: 8 + rand() * 10,
    burstDur: 0.8 + rand() * 1.0,
    burstYawMul: 1.3 + rand() * 0.4,
    phaseOffset: rand() * Math.PI * 2,
  };
}

export function createSwimState(baseY: number): SwimState {
  return {
    yaw: 0,
    pitch: 0,
    roll: 0,
    curY: baseY,
    smoothYawFreq: 0,
    smoothYawAmp: 0,
  };
}

// ---------------------------------------------------------------------------
// Orbit-Position (Ellipsenbahn)
// ---------------------------------------------------------------------------

export function computeOrbitPosition(
  centerX: number, centerZ: number,
  radiusX: number, radiusZ: number,
  speed: number, startAngle: number,
  elapsed: number,
): { px: number; pz: number; ang: number } {
  const ang = elapsed * speed + startAngle;
  return {
    px: centerX + Math.cos(ang) * radiusX,
    pz: centerZ + Math.sin(ang) * radiusZ,
    ang,
  };
}

// ---------------------------------------------------------------------------
// Tangenten-Richtung (Blickrichtung des Fisches)
// ---------------------------------------------------------------------------

export function computeOrbitTangent(
  radiusX: number, radiusZ: number, ang: number,
): { tx: number; tz: number; baseYaw: number } {
  const tx = -Math.sin(ang) * radiusX;
  const tz = Math.cos(ang) * radiusZ;
  return {
    tx,
    tz,
    baseYaw: Math.atan2(tx, tz),
  };
}

// ---------------------------------------------------------------------------
// Animations-Zustand aktualisieren (Burst + Yaw/Pitch/Roll)
// ---------------------------------------------------------------------------

export function updateSwimState(
  params: SwimParams,
  state: SwimState,
  delta: number,
  elapsed: number,
  ang: number,
): void {
  const dt = Math.min(delta, 0.1);

  // Burst-and-Glide
  const bursting = elapsed % params.burstInt < params.burstDur;
  const tgtBurstFreq = bursting ? params.yawFreq * params.burstYawMul : params.yawFreq;
  const tgtBurstAmp = bursting ? params.yawAmp * 1.5 : params.yawAmp;
  const burstLerp = 1 - Math.exp(-3.0 * dt);
  state.smoothYawFreq += (tgtBurstFreq - state.smoothYawFreq) * burstLerp;
  state.smoothYawAmp += (tgtBurstAmp - state.smoothYawAmp) * burstLerp;

  // Zielwerte für Yaw, Pitch, Roll
  const tgtYaw =
    Math.sin(elapsed * state.smoothYawFreq * Math.PI * 2 + params.phaseOffset) *
    state.smoothYawAmp;
  const tgtPitch =
    Math.sin(elapsed * params.pitchFreq * Math.PI * 2 + params.phaseOffset * 0.7) *
    params.pitchAmp;
  const tgtRoll =
    Math.cos(ang + params.phaseOffset * 0.3) * Math.sin(elapsed * 0.6) * params.rollAmp;

  // Sanft interpolieren
  const lf = 1 - Math.exp(-5.0 * dt);
  state.yaw += (tgtYaw - state.yaw) * lf;
  state.pitch += (tgtPitch - state.pitch) * lf;
  state.roll += (tgtRoll - state.roll) * lf;
}

// ---------------------------------------------------------------------------
// Tiefen-Berechnung (vertikale Sinus-Oszillation)
// ---------------------------------------------------------------------------

export function computeTargetY(
  baseY: number,
  depthAmp: number,
  depthFreq: number,
  phaseOffset: number,
  elapsed: number,
  floorY: number,
): number {
  const rawY = baseY + Math.sin(elapsed * depthFreq * Math.PI * 2 + phaseOffset) * depthAmp;
  return Math.max(floorY + 2.0, rawY);
}
