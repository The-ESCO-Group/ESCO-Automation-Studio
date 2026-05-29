export type Selection =
  | { kind: "project"; id: string }
  | { kind: "controller"; id: string }
  | { kind: "task"; id: string }
  | { kind: "program"; id: string }
  | { kind: "routine"; id: string }
  | { kind: "tag"; id: string }
  | { kind: "rung"; routineId: string; rungId: string }
  | { kind: "instruction"; routineId: string; rungId: string; nodeId: string }
  | { kind: "aoi"; id: string }
  | { kind: "udt"; id: string }
  | { kind: "io"; controllerId: string; moduleId?: string }
  | { kind: "hmi"; id: string }
  | { kind: "hmi-screen"; id: string }
  | { kind: "hmi-popup"; id: string }
  | { kind: "hmi-banner"; id: string }
  | null;
