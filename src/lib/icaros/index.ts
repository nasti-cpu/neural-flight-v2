/**
 * index.ts – ICAROS Host Integration (Public API).
 *
 * Exportiert nur die öffentliche API:
 * - createIcarosHostIntegration() – Hauptfunktion
 * - getClientId() – stabile Client-ID
 */

export {
  createIcarosHostIntegration,
  type IcarosHostIntegration,
  type HostOrientationCallback,
} from "./host";

export { getClientId, resetClientId } from "./clientId";

// Für Debugging/Testing exportiert
export { buildWsUrl } from "./wsUrl";