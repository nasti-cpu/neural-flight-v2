/**
 * keyboard.ts – Einfaches Keyboard-Tracking für Tastatur-Steuerung.
 *
 * Merkt sich in einem Set<string>, welche Tasten gerade gedrückt sind.
 * isKeyDown(code) prüft, ob eine Taste gedrückt ist.
 * Initialisiert sich automatisch beim Import.
 */
const _pressed = new Set<string>();

function _onKeyDown(e: KeyboardEvent): void {
  _pressed.add(e.code);
}

function _onKeyUp(e: KeyboardEvent): void {
  _pressed.delete(e.code);
}

// Nur im Browser registrieren (SSR-Sicherheit)
if (typeof window !== "undefined") {
  window.addEventListener("keydown", _onKeyDown);
  window.addEventListener("keyup", _onKeyUp);
}

/**
 * Prüft, ob eine Taste gerade gedrückt ist.
 * @param code – KeyboardEvent.code, z. B. "KeyW", "KeyA", "ArrowUp"
 */
export function isKeyDown(code: string): boolean {
  return _pressed.has(code);
}

/**
 * Entfernt die Event-Listener und leert den Zustand.
 * Sollte beim Dispose einer Experience aufgerufen werden.
 */
export function disposeKeyboard(): void {
  if (typeof window !== "undefined") {
    window.removeEventListener("keydown", _onKeyDown);
    window.removeEventListener("keyup", _onKeyUp);
  }
  _pressed.clear();
}
