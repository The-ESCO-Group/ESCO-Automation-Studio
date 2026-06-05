/**
 * @esco/sim-lab — ESCO Simulation Lab.
 *
 * An offline, virtual, deterministic simulation toolkit: ESCO-native project
 * state (controllers, devices, virtual tags, logic, HMI, scenarios), a
 * SoftController scan engine, device/fault/signal simulation, a native alarm
 * engine, a FAT/SAT scenario runner, validation, reporting, and ESCO-owned
 * compatibility review/export helpers. Nothing here communicates with hardware.
 */

export * from "./boundary";
export * from "./types";
export * from "./ids";
export * from "./catalog";
export * from "./tags";
export * from "./devices";
export * from "./project";
export * from "./logic-templates";
export * from "./signal-generator";
export * from "./alarm-engine";
export * from "./fault-injection";
export * from "./engine";
export * from "./scenarios";
export * from "./validation";
export * from "./report";
export * from "./compat";
export * from "./view-models";
export * from "./candy-sorter";
