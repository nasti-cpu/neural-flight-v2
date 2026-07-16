/**
 * gamepad.ts – Liest den ersten angeschlossenen Gamepad/Joystick aus.
 *
 * Nutzt die Browser Gamepad API (navigator.getGamepads()).
 * Liefert pitch und roll aus dem linken Stick – mit Deadzone.
 * SSR-sicher: Greift nur im Browser auf navigator zu.
 */
const DEADZONE = 0.15; // Kleine Auslenkungen ignorieren (verhindert Drift)

/**
 * Wendet eine Deadzone auf einen Achsenwert [-1..+1] an.
 * Werte unterhalb der Deadzone werden auf 0 gesetzt,
 * oberhalb werden von 0..1 linear hochskaliert (kein Sprung).
 */
function applyDeadzone(value: number): number {
  const abs = Math.abs(value);
  if (abs < DEADZONE) return 0;
  return Math.sign(value) * (abs - DEADZONE) / (1 - DEADZONE);
}

/**
 * Pollt den ersten verbundenen Gamepad und gibt pitch/roll zurück.
 * Stick Y-Achse → pitch  (-1 = oben, +1 = unten)
 * Stick X-Achse → roll   (-1 = links, +1 = rechts)
 * Wenn kein Gamepad angeschlossen ist, wird { pitch: 0, roll: 0 } zurückgegeben.
 */
export function pollGamepad(): { pitch: number; roll: number } {
  if (typeof navigator === "undefined") return { pitch: 0, roll: 0 };

  const gamepads = navigator.getGamepads();
  const gp = gamepads?.[0];
  if (!gp) return { pitch: 0, roll: 0 };

  return {
    pitch: -applyDeadzone(gp.axes[1] ?? 0), // negiert: Stick nach vorne → Nase runter
    roll:  applyDeadzone(gp.axes[0] ?? 0),
  };
}
