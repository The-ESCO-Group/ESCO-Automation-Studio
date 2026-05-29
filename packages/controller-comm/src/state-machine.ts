import type { ConnectionState, TransportCapabilities, TransportConnectResult } from "./types";

/**
 * The connection state machine. Transitions are explicit and the *only* path to a
 * "Connected" state runs through {@link resolveConnectState}, which refuses to
 * grant a real connection unless the transport is verified + real.
 */

export type ConnectionEvent =
  | { type: "select-transport" }
  | { type: "begin-connect" }
  | { type: "connect-result"; result: TransportConnectResult; capabilities: TransportCapabilities }
  | { type: "enter-monitor" }
  | { type: "exit-monitor" }
  | { type: "fault"; message?: string }
  | { type: "disconnect" };

/** Legal source → target transitions, used to reject illegal jumps. */
const ALLOWED: Record<ConnectionState, ConnectionState[]> = {
  "offline-simulation": ["offline-simulation", "connecting", "disconnected"],
  disconnected: ["disconnected", "connecting", "offline-simulation"],
  connecting: [
    "connected-readonly",
    "connected-monitor",
    "disconnected",
    "offline-simulation",
    "faulted",
    "safety-blocked",
  ],
  "connected-readonly": ["connected-monitor", "connected-readonly", "faulted", "disconnected"],
  "connected-monitor": ["connected-readonly", "connected-monitor", "faulted", "disconnected"],
  faulted: ["faulted", "disconnected", "offline-simulation"],
  "safety-blocked": ["safety-blocked", "disconnected", "offline-simulation"],
};

export function canTransition(from: ConnectionState, to: ConnectionState): boolean {
  return ALLOWED[from].includes(to);
}

/**
 * THE SAFETY GATE. Decide the legal state after a connect attempt. A transport's
 * own `reportedState` is advisory only — a connection to a real controller
 * ("connected-readonly" / "connected-monitor") is granted ONLY when the transport
 * has both real I/O and a verified, tested path. Otherwise:
 *   - a real-but-unverified transport collapses to "safety-blocked";
 *   - a simulation transport resolves to "offline-simulation";
 *   - anything else resolves to "disconnected".
 */
export function resolveConnectState(
  result: TransportConnectResult,
  capabilities: TransportCapabilities,
): ConnectionState {
  if (!result.ok) {
    return result.reportedState === "faulted" ? "faulted" : "disconnected";
  }

  const wantsConnected =
    result.reportedState === "connected-readonly" || result.reportedState === "connected-monitor";

  if (wantsConnected) {
    // Only a verified real transport may ever be reported as Connected.
    if (capabilities.realControllerIo && capabilities.verified) {
      return result.reportedState;
    }
    // A transport that claims a real link but is not verified is a safety risk —
    // surface it loudly instead of silently downgrading.
    if (capabilities.realControllerIo && !capabilities.verified) {
      return "safety-blocked";
    }
    // A non-real transport must never appear Connected.
    return capabilities.simulation ? "offline-simulation" : "disconnected";
  }

  if (result.reportedState === "offline-simulation") {
    return capabilities.simulation ? "offline-simulation" : "disconnected";
  }
  return result.reportedState;
}

/** Pure reducer: (state, event) → next state, rejecting illegal transitions. */
export function reduceConnection(state: ConnectionState, event: ConnectionEvent): ConnectionState {
  switch (event.type) {
    case "select-transport":
      // Selecting a transport always returns to a safe, non-connected baseline.
      return state === "offline-simulation" ? "offline-simulation" : "disconnected";
    case "begin-connect":
      return canTransition(state, "connecting") ? "connecting" : state;
    case "connect-result": {
      const next = resolveConnectState(event.result, event.capabilities);
      return canTransition(state, next) ? next : state;
    }
    case "enter-monitor":
      return canTransition(state, "connected-monitor") && state === "connected-readonly"
        ? "connected-monitor"
        : state;
    case "exit-monitor":
      return state === "connected-monitor" ? "connected-readonly" : state;
    case "fault":
      return canTransition(state, "faulted") ? "faulted" : "faulted";
    case "disconnect":
      return "disconnected";
    default:
      return state;
  }
}
