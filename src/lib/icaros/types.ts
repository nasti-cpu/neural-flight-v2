/**
 * types.ts – ICAROS Host Protocol Message Types.
 *
 * Diese Datei definiert die Nachrichten-Formate, die zwischen
 * dem ICAROS Host und dem Experience-Client ausgetauscht werden.
 * Das Protokoll heißt "neural-flight.v1".
 */

/** Nachricht, die der Client beim Verbinden an den Host sendet */
export interface IcarosHelloPayload {
  role: "experience";
  clientId: string;
  experienceId: string;
  title: string;
  url: string;
  userAgent: string;
}

export interface IcarosHello {
  protocol: "neural-flight.v1";
  type: "client.hello";
  stationId: string;
  source: { role: "experience"; id: string };
  timestamp: number;
  payload: IcarosHelloPayload;
}

/** Regelmäßiger Heartbeat, damit der Host weiß, dass der Client noch lebt */
export interface IcarosHeartbeat {
  protocol: "neural-flight.v1";
  type: "client.heartbeat";
  stationId: string;
  source: { role: "experience"; id: string };
  timestamp: number;
  payload: { clientId: string };
}

/** Host lehnt die Verbindung ab */
export interface IcarosRejected {
  protocol: "neural-flight.v1";
  type: "client.rejected";
  stationId: string;
  source: { role: string; id: string };
  timestamp: number;
  payload: { reason: string };
}

/** Host bestätigt die Registrierung */
export interface IcarosRegistered {
  protocol: "neural-flight.v1";
  type: "client.registered";
  [key: string]: unknown;
}

/** Orientierungsdaten vom ICAROS-Controller (vom Host weitergeleitet) */
export interface IcarosOrientation {
  protocol: "neural-flight.v1";
  type: "control.orientation";
  stationId: string;
  source: { role: string; id: string };
  timestamp: number;
  payload: {
    pitch: number;
    roll: number;
    quality: number;
    controllerType: 'm5';
  };
}

/** Alle möglichen Host->Client-Nachrichten */
export type IcarosHostMessage = IcarosRegistered | IcarosOrientation | IcarosRejected;

/** Hilfsfunktion: Erkennt den Nachrichtentyp anhand des "type"-Felds */
export function parseIcarosMessage(
  raw: string,
): IcarosHostMessage | null {
  try {
    const data = JSON.parse(raw) as Record<string, unknown>;
    if (typeof data.type !== "string") return null;
    // Validiere, dass das Protokoll und die Station übereinstimmen
    if (data.protocol !== "neural-flight.v1") return null;
    if (data.stationId !== "station-a") return null;
    return data as IcarosHostMessage;
  } catch {
    return null;
  }
}