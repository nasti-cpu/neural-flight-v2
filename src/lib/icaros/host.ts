/**
 * host.ts – ICAROS Host Integration.
 *
 * Diese Datei verbindet den Client mit dem ICAROS Host:
 * - Runtime-WebSocket (Registrierung & Heartbeat)
 * - Control-WebSocket (Orientierungsdaten)
 *
 * Wenn PUBLIC_ICAROS_HOST_ORIGIN nicht gesetzt ist, wird das
 * bestehende lokale Controller-Verhalten verwendet (keine Änderung).
 *
 * Public-Umgebungsvariablen aus $env/static/public:
 *   PUBLIC_ICAROS_HOST_ORIGIN    – z. B. "https://192.168.50.170:5183"
 *   PUBLIC_ICAROS_EXPERIENCE_ID  – Stabile Client-ID für den Host
 *   PUBLIC_ICAROS_EXPERIENCE_TITLE – Anzeigename im Host-Launcher
 */

import { browser } from "$app/environment";
import {
  PUBLIC_ICAROS_HOST_ORIGIN,
  PUBLIC_ICAROS_EXPERIENCE_ID,
  PUBLIC_ICAROS_EXPERIENCE_TITLE,
} from "$env/static/public";
import { createRuntimeClient, type RuntimeClient } from "./runtime";
import {
  createControlClient,
  type ControlClient,
  type OrientationInput,
} from "./control";

/** Callback für eingehende Orientierungsdaten vom Host */
export type HostOrientationCallback = (input: OrientationInput) => void;

export interface IcarosHostIntegration {
  /** Ob die Host-Verbindung aktiv ist */
  active: boolean;
  /** Verbindungen trennen und Timer aufräumen */
  destroy: () => void;
}

interface HostIntegrationOptions {
  /** Stabile Client-ID (aus localStorage) */
  clientId: string;
  /** Experience-ID – Fallback, wenn PUBLIC_ICAROS_EXPERIENCE_ID leer ist */
  experienceId: string;
  /** Anzeigename – Fallback, wenn PUBLIC_ICAROS_EXPERIENCE_TITLE leer ist */
  title: string;
  /** Wird bei jeder neuen Orientierung vom Host aufgerufen */
  onOrientation: HostOrientationCallback;
}

/**
 * Erzeugt eine HTTPS-URL, die der Host erreichen kann.
 *
 * Der Host lehnt http://-URLs ab. Wenn die Seite über http:// geladen wurde
 * (weil die Zertifikate nicht geladen werden konnten), wird die URL manuell
 * auf https:// umgeschrieben.
 */
function getClientUrl(): string {
  const href = window.location.href;
  if (href.startsWith("https://")) return href;
  // http:// → https:// umschreiben (Host lehnt HTTP ab)
  return href.replace(/^http:\/\//, "https://");
}

/**
 * ICAROS Host-Integration erstellen.
 *
 * Liest PUBLIC_ICAROS_HOST_ORIGIN aus $env/static/public.
 * Wenn die Variable leer ist → Noop-Client, lokales Verhalten bleibt erhalten.
 * Sonst: Verbindung zu Host-Runtime- und Control-WebSockets.
 */
export function createIcarosHostIntegration(
  opts: HostIntegrationOptions,
): IcarosHostIntegration {
  if (!browser) {
    return { active: false, destroy: () => {} };
  }

  const hostOrigin = PUBLIC_ICAROS_HOST_ORIGIN;
  if (!hostOrigin) {
    console.log("[ICAROS] Keine Host-URL – verwende lokales Controller");
    return { active: false, destroy: () => {} };
  }

  // Public-Vars überschreiben ggf. die Fallback-Werte
  const expId = PUBLIC_ICAROS_EXPERIENCE_ID || opts.experienceId;
  const expTitle = PUBLIC_ICAROS_EXPERIENCE_TITLE || opts.title;

  // Die Client-URL muss HTTPS sein, sonst lehnt der Host ab.
  const clientUrl = getClientUrl();

  console.log(`[ICAROS] Verbinde zu Host: ${hostOrigin}`);
  console.log(`[ICAROS] Experience: ${expId} – "${expTitle}"`);
  console.log(`[ICAROS] Client-URL: ${clientUrl}`);

  let runtimeClient: RuntimeClient;
  let controlClient: ControlClient;

  try {
    runtimeClient = createRuntimeClient({
      hostOrigin,
      clientId: opts.clientId,
      experienceId: expId,
      title: expTitle,
      clientUrl,
      onRejected: (reason) => {
        console.error("[ICAROS] ❌ Host hat Registrierung abgelehnt:", reason);
      },
    });

    controlClient = createControlClient({
      hostOrigin,
      onOrientation: opts.onOrientation,
    });
  } catch (err) {
    console.error("[ICAROS] Fehler beim Verbinden:", err);
    return { active: false, destroy: () => {} };
  }

  return {
    get active(): boolean {
      return runtimeClient.connected || controlClient.connected;
    },
    destroy: () => {
      console.log("[ICAROS] Trenne Verbindungen");
      runtimeClient.destroy();
      controlClient.destroy();
    },
  };
}