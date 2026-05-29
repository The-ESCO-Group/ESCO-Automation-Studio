import { createId, nowIso } from "@esco/shared";
import type { ConnectionAuditEvent, ConnectionState, TransportKind } from "./types";

/**
 * Audit-record factory for the connection lifecycle and guarded commands. Pure
 * and UI-free: it builds timestamped events; the host owns where the log lives.
 * Every guarded command — whether it ran or was blocked — produces one of these,
 * so there is always a tamper-evident trail of what was attempted.
 */
export function connectionAudit(
  type: ConnectionAuditEvent["type"],
  summary: string,
  state: ConnectionState,
  transportKind: TransportKind,
  details?: Record<string, unknown>,
): ConnectionAuditEvent {
  return {
    id: createId("conn"),
    at: nowIso(),
    type,
    summary,
    state,
    transportKind,
    ...(details ? { details } : {}),
  };
}
