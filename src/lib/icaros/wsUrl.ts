/**
 * wsUrl.ts – Hilfsfunktion für ICAROS Host WebSocket-URLs.
 *
 * Baut aus einer HTTPS-Host-Origin eine korrekte WSS-URL mit Pfad.
 * Setzt Default-Port 5183, falls keiner angegeben ist.
 */

/**
 * Erzeugt eine WebSocket-URL aus einer Host-Origin (HTTPS oder HTTP).
 *
 * Beispiele:
 *   "https://192.168.50.170:5183" + "/ws/runtime" → "wss://192.168.50.170:5183/ws/runtime"
 *   "192.168.50.170" + "/ws/control/main"       → "wss://192.168.50.170:5183/ws/control/main"
 */
export function buildWsUrl(hostOrigin: string, path: string): string {
  const url = new URL(
    hostOrigin.includes("://") ? hostOrigin : `https://${hostOrigin}`,
  );
  url.protocol = url.protocol === "http:" || url.protocol === "ws:" ? "ws:" : "wss:";
  url.pathname = path;
  url.port ||= "5183";
  return url.toString();
}