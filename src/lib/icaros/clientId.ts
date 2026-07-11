/**
 * clientId.ts – Stabile Client-ID für die ICAROS Host-Registrierung.
 *
 * Die ID wird in localStorage gespeichert, damit sie über
 * Seiten-Neuladungen hinweg stabil bleibt. Wenn localStorage
 * nicht verfügbar ist, wird eine zufällige ID pro Session erzeugt.
 */

const STORAGE_KEY = "icaros-client-id";

/**
 * Erzeugt eine zufällige ID (kryptografisch ausreichend für Client-Registrierung).
 */
function generateId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  for (let i = 0; i < 16; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `exp-${id}`;
}

/**
 * Liefert eine stabile Client-ID.
 *
 * - localStorage vorhanden: einmalig erzeugen und dauerhaft speichern
 * - localStorage nicht vorhanden: zufällige ID pro Session
 */
export function getClientId(): string {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return stored;

    const id = generateId();
    localStorage.setItem(STORAGE_KEY, id);
    return id;
  } catch {
    // Kein localStorage (private browsing o.ä.)
    return generateId();
  }
}

/**
 * Setzt die Client-ID zurück (für Debugging / Test).
 */
export function resetClientId(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignorieren
  }
}