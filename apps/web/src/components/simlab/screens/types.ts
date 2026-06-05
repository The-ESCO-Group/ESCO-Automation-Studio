import type { SimViewSource } from "@esco/sim-lab";
import type { SimLabApi } from "../useSimLab";

export type OnsiteScreenId =
  | "overview"
  | "cabinet"
  | "device"
  | "pid"
  | "logic"
  | "alarms"
  | "trends"
  | "fat"
  | "field"
  | "report";

export interface ScreenProps {
  api: SimLabApi;
  src: SimViewSource;
  selectedDeviceId: string | null;
  onSelectDevice: (id: string) => void;
  goTo: (screen: OnsiteScreenId) => void;
}

/** Operator helpers that pulse a momentary input and advance the virtual scan. */
export function pulse(api: SimLabApi, tag: string, scans = 2): void {
  api.setBool(tag, true);
  api.runScans(scans);
  api.setBool(tag, false);
  api.clearForce(tag);
  api.runScans(1);
}
