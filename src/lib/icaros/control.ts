/**
 * control.ts – ICAROS Host Control-WebSocket-Client.
 *
 * Verbindet sich mit wss://<host>/ws/control/main und empfängt
 * Orientierungsdaten (pitch, roll) vom ICAROS-Controller.
 *
 * Die Daten werden direkt in die updatePlayer()-Funktion der
 * Experience eingespeist. Wenn quality === 0, werden neutrale
 * Werte (pitch: 0, roll: 0) geliefert.
 *
 * Verwendet das native Browser-WebSocket-API.
 */

import { browser } from "$app/environment";
import { parseIcarosMessage, type IcarosOrientation } from "./types";
import { buildWsUrl } from "./wsUrl";

export interface OrientationInput {
  pitch: number;
  roll: number;
}

export type OrientationCallback = (input: OrientationInput) => void;

export interface ControlClient {
  /** Verbindungs-Status */
  connected: boolean;
  /** Verbindung trennen und Timer aufräumen */
  destroy: () => void;
}

/** Leerer Client für SSR / wenn keine Host-URL gesetzt ist */
const NOOP_CLIENT: ControlClient = {
  connected: false,
  destroy: () => {},
};

interface ControlClientOptions {
  hostOrigin: string;
  /** Wird bei jeder neuen Orientierung aufgerufen */
  onOrientation: OrientationCallback;
}

const MAX_RECONNECT_DELAY = 30000;

/**
 * Erstellt einen Control-WebSocket-Client zum ICAROS Host.
 *
 * Hört auf "control.orientation"-Nachrichten und extrahiert
 * pitch, roll, quality. Wenn quality > 0, werden die Werte
 * weitergereicht; bei quality === 0 werden neutrale Werte geliefert.
 */
export function createControlClient(
  opts: ControlClientOptions,
): ControlClient {
  if (!browser) return NOOP_CLIENT;

  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  const wsUrl = buildWsUrl(opts.hostOrigin, "/ws/control/main");

  function connect(attempt: number): void {
    if (closed) return;

    console.log(
      `[ICAROS Control] Verbinde zu ${wsUrl} (Versuch ${attempt + 1})`,
    );
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log("[ICAROS Control] ✅ Verbunden");
    };

    ws.onmessage = (event: MessageEvent) => {
      const msg = parseIcarosMessage(String(event.data));
      if (!msg) return;

      // Nur orientation-Nachrichten interessieren uns
      if (msg.type !== "control.orientation") return;

      const orientation = msg as IcarosOrientation;

      // Validiere alle Felder
      const { pitch, roll, quality, controllerType } = orientation.payload;
      if (
        typeof pitch !== "number" ||
        typeof roll !== "number" ||
        typeof quality !== "number"
      )
        return;
      if (controllerType !== "m5") return;

      // ICAROS Host sendet pitch/roll als -1..1, Experience erwartet Grad
      // (updatePlayer() multipliziert intern mit DEG2RAD)
      // Pitch und Roll sind vertauscht – Host-Pitch → Roll, Host-Roll → Pitch
      const pitchDeg = roll * 90;
      const rollDeg = pitch * 90;

      if (quality > 0) {
        // Echte Controller-Werte (in Grad, getauscht) durchreichen
        opts.onOrientation({ pitch: pitchDeg, roll: rollDeg });
      } else {
        // Qualität = 0 → neutral (kein Kontakt/Controller abgenommen)
        opts.onOrientation({ pitch: 0, roll: 0 });
      }
    };

    ws.onclose = (event: CloseEvent) => {
      console.log(
        `[ICAROS Control] Verbindung geschlossen (code=${event.code})`,
      );
      ws = null;
      if (!closed) {
        const delay = Math.min(1000 * 2 ** attempt, MAX_RECONNECT_DELAY);
        console.log(
          `[ICAROS Control] Neuverbindung in ${delay}ms (Versuch ${attempt + 1})`,
        );
        reconnectTimer = setTimeout(() => connect(attempt + 1), delay);
      }
    };

    ws.onerror = () => {
      // Wird von onclose gefolgt
    };
  }

  function destroy(): void {
    closed = true;
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (ws) {
      ws.onclose = null;
      ws.close();
      ws = null;
    }
  }

  connect(0);

  return {
    get connected(): boolean {
      return ws?.readyState === WebSocket.OPEN === true;
    },
    destroy,
  };
}