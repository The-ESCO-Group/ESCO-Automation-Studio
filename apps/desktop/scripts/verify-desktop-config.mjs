import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const required = [
  "package.json",
  "src-tauri/Cargo.toml",
  "src-tauri/build.rs",
  "src-tauri/tauri.conf.json",
  "src-tauri/src/main.rs",
  "src-tauri/src/lib.rs",
  "src-tauri/capabilities/default.json",
];

const missing = required.filter((file) => !existsSync(resolve(root, file)));
if (missing.length) {
  console.error(`Missing desktop scaffold file(s): ${missing.join(", ")}`);
  process.exit(1);
}

const config = JSON.parse(readFileSync(resolve(root, "src-tauri/tauri.conf.json"), "utf8"));
if (config.productName !== "ESCO Automation Studio") {
  console.error("tauri.conf.json must keep productName as ESCO Automation Studio.");
  process.exit(1);
}

if (!String(config.build?.devUrl ?? "").includes("desktop-startup=1")) {
  console.error("Desktop dev URL must request the desktop-only startup screen.");
  process.exit(1);
}

const mainWindow = config.app?.windows?.[0];
if (!String(mainWindow?.url ?? "").includes("desktop-startup=1")) {
  console.error("Packaged desktop window must request the desktop-only startup screen.");
  process.exit(1);
}

if (mainWindow?.width !== 758 || mainWindow?.height !== 558 || mainWindow?.resizable !== false) {
  console.error("Packaged desktop window must open at the compact startup-box size.");
  process.exit(1);
}

const rustShell = readFileSync(resolve(root, "src-tauri/src/lib.rs"), "utf8");
if (!rustShell.includes("promote_desktop_window_to_ide")) {
  console.error("Desktop shell must expose the startup-to-IDE window promotion command.");
  process.exit(1);
}

console.log("Desktop scaffold config OK.");
