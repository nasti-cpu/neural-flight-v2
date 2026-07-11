/**
 * runtime.ts – ICAROS Host Runtime-WebSocket-Client.
 *
 * Verbindet sich mit wss://<host>/ws/runtime und registriert die
 * Experience beim Host. Sendet heartbeat alle 4 Sekunden nach
 * erfolgreicher Registrierung. Verbindet sich bei Verlust mit
 * exponentiellem Backoff neu.
 *
 * Verwendet das native Browser-WebSocket-API – keine externe
 * Abhängigkeit nötig.
 */

import { browser } from "$app/environment";
import type { IcarosHello, IcarosHeartbeat } from "./types";
import { parseIcarosMessage } from "./types";
import { buildWsUrl } from "./wsUrl";

export interface RuntimeClient {
  /** Verbindungs-Status */
  connected: boolean;
  /** Verbindung trennen und Timer aufräumen */
  destroy: () => void;
}

/** Leerer Client für SSR / wenn keine Host-URL gesetzt ist */
const NOOP_CLIENT: RuntimeClient = {
  connected: false,
  destroy: () => {},
};

interface RuntimeClientOptions {
  hostOrigin: string;
  clientId: string;
  experienceId: string;
  title: string;
  /** Öffentlich erreichbare HTTPS-URL des Clients (für Host-Registrierung) */
  clientUrl: string;
  /** Wird aufgerufen, wenn der Host die Registrierung ablehnt */
  onRejected?: (reason: string) => void;
}

const HEARTBEAT_INTERVAL_MS = 4000; // 4 Sekunden
const MAX_RECONNECT_DELAY = 30000; // Maximal 30 Sekunden Backoff

/**
 * Erstellt einen Runtime-WebSocket-Client zum ICAROS Host.
 *
 * Ablauf:
 * 1. Verbinden zu wss://<host>/ws/runtime
 * 2. Beim Öffnen: client.hello-Nachricht senden
 * 3. client.registered empfangen → Heartbeat-Timer starten
 * 4. Alle 4s client.heartbeat senden
 * 5. Bei unerwartetem Close: mit Backoff neu verbinden
 */
export function createRuntimeClient(
  opts: RuntimeClientOptions,
): RuntimeClient {
  if (!browser) return NOOP_CLIENT;

  let ws: WebSocket | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let registered = false;
  let closed = false;

  const wsUrl = buildWsUrl(opts.hostOrigin, "/ws/runtime");

  function buildHello(): IcarosHello {
    return {
      protocol: "neural-flight.v1",
      type: "client.hello",
      stationId: "station-a",
      source: { role: "experience", id: opts.clientId },
      timestamp: Date.now(),
      payload: {
        role: "experience",
        clientId: opts.clientId,
        experienceId: opts.experienceId,
        title: opts.title,
        // Wichtig: Der Host akzeptiert nur HTTPS-URLs.
        // Die clientUrl wird von host.ts bereitgestellt und ist
        // immer HTTPS (auch wenn die Seite über HTTP geladen wurde).
        url: opts.clientUrl,
        userAgent: window.navigator.userAgent,
      },
    };
  }

  function buildHeartbeat(): IcarosHeartbeat {
    return {
      protocol: "neural-flight.v1",
      type: "client.heartbeat",
      stationId: "station-a",
      source: { role: "experience", id: opts.clientId },
      timestamp: Date.now(),
      payload: { clientId: opts.clientId },
    };
  }

  function startHeartbeat(): void {
    stopHeartbeat();
    // Startet sofort einen Heartbeat, dann alle 4s
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(buildHeartbeat()));
    }
    heartbeatTimer = setInterval(() => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(buildHeartbeat()));
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  function stopHeartbeat(): void {
    if (heartbeatTimer !== null) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  function connect(attempt: number): void {
    if (closed) return;

    console.log(
      `[ICAROS Runtime] Verbinde zu ${wsUrl} (Versuch ${attempt + 1})`,
    );
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log("[ICAROS Runtime] ✅ Verbunden, sende hello");
      ws!.send(JSON.stringify(buildHello()));
    };

    ws.onmessage = (event: MessageEvent) => {
      const msg = parseIcarosMessage(String(event.data));
      if (!msg) return;

      if (msg.type === "client.rejected") {
        console.error("[ICAROS Runtime] ❌ Abgewiesen:", msg.payload.reason);
        opts.onRejected?.(msg.payload.reason);
        closed = true;
        ws?.close();
        return;
      }

      if (msg.type === "client.registered" && !registered) {
        registered = true;
        console.log("[ICAROS Runtime] ✅ Registriert – starte Heartbeat");
        startHeartbeat();
      }
    };

    ws.onclose = (event: CloseEvent) => {
      console.log(
        `[ICAROS Runtime] Verbindung geschlossen (code=${event.code})`,
      );
      ws = null;
      stopHeartbeat();
      registered = false;

      // Nur neu verbinden, wenn wir nicht absichtlich geschlossen haben
      if (!closed) {
        const delay = Math.min(1000 * 2 ** attempt, MAX_RECONNECT_DELAY);
        console.log(
          `[ICAROS Runtime] Neuverbindung in ${delay}ms (Versuch ${attempt + 1})`,
        );
        reconnectTimer = setTimeout(() => connect(attempt + 1), delay);
      }
    };

    ws.onerror = () => {
      // Fehler werden von onclose gefolgt
    };
  }

  function destroy(): void {
    closed = true;
    stopHeartbeat();
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (ws) {
      ws.onclose = null; // onclose nicht feuern lassen
      ws.close();
      ws = null;
    }
  }

  // Verbindung starten
  connect(0);

  return {
    get connected(): boolean {
      return ws?.readyState === WebSocket.OPEN === true;
    },
    destroy,
  };
}