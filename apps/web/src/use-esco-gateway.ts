/**
 * React hook over the ESCO Online Session Manager. Components get immutable
 * state plus bound read-only actions — never a driver, never a raw fetch.
 */

import { useCallback, useMemo, useSyncExternalStore } from "react";
import type {
  BatchTagReadResult,
  CompareResult,
  ConnectionConfig,
  ConnectionResult,
  ControllerIdentity,
  ProjectSnapshot,
  TagValue,
} from "./gateway-contract";
import type { PlcProject } from "@esco/core";
import {
  EscoOnlineSession,
  getDefaultEscoOnlineSession,
  type EscoOnlineSessionState,
} from "./esco-online-session";

export interface EscoGatewayApi {
  state: EscoOnlineSessionState;
  refreshAvailability(): Promise<void>;
  connect(
    driverId: string,
    config?: ConnectionConfig,
    localProject?: PlcProject,
  ): Promise<ConnectionResult | undefined>;
  disconnect(): Promise<void>;
  refreshIdentity(): Promise<ControllerIdentity | undefined>;
  refreshStatus(): Promise<void>;
  browseTags(): Promise<void>;
  readTag(tagName: string): Promise<TagValue | undefined>;
  readTags(tagNames: readonly string[]): Promise<BatchTagReadResult | undefined>;
  compareProject(localProject: PlcProject): Promise<CompareResult | undefined>;
  uploadSnapshot(): Promise<ProjectSnapshot | undefined>;
  startTagPolling(tagNames: readonly string[], intervalMs?: number): void;
  stopTagPolling(): void;
  startTagStream(tagNames: readonly string[]): void;
  stopTagStream(): void;
  refreshAudit(): Promise<void>;
}

export function useEscoGateway(session?: EscoOnlineSession): EscoGatewayApi {
  const active = session ?? getDefaultEscoOnlineSession();
  const subscribe = useCallback((listener: () => void) => active.subscribe(listener), [active]);
  const getSnapshot = useCallback(() => active.getState(), [active]);
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return useMemo(
    () => ({
      state,
      refreshAvailability: () => active.refreshAvailability(),
      connect: (driverId, config, localProject) => active.connect(driverId, config, localProject),
      disconnect: () => active.disconnect(),
      refreshIdentity: () => active.refreshIdentity(),
      refreshStatus: () => active.refreshStatus(),
      browseTags: () => active.browseTags(),
      readTag: (tagName) => active.readTag(tagName),
      readTags: (tagNames) => active.readTags(tagNames),
      compareProject: (localProject) => active.compareProject(localProject),
      uploadSnapshot: () => active.uploadSnapshot(),
      startTagPolling: (tagNames, intervalMs) => active.startTagPolling(tagNames, intervalMs),
      stopTagPolling: () => active.stopTagPolling(),
      startTagStream: (tagNames) => active.startTagStream(tagNames),
      stopTagStream: () => active.stopTagStream(),
      refreshAudit: () => active.refreshAudit(),
    }),
    [active, state],
  );
}
