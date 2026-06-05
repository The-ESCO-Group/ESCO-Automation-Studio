import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Desktop production preflight.
 *
 * A static gate for the Windows desktop shell. It cannot replace a real
 * `tauri build` (that needs the Rust toolchain + WebView2), but it asserts the
 * production-safety properties we DO control from config + source text, so a
 * regression that weakens them fails CI without needing a compiler:
 *
 *   - the Tauri scaffold files exist;
 *   - the window opens at the compact startup-box size and promotes to the IDE;
 *   - a restrictive Content-Security-Policy is set (not null) and only opens
 *     connect-src to the opt-in AI hosts;
 *   - the capability set stays minimal (core permissions only — no broad
 *     fs/shell/http grants);
 *   - the desktop capability report stays honest (offline-simulation, no online
 *     edits, no proprietary binary controller-project access).
 *
 * It collects every failure and prints a SUMMARY line so the output reads like
 * the e2e runner.
 */

const root = resolve(import.meta.dirname, "..");
const failures = [];
let checks = 0;

/** Assert `cond`; record a failure (with `message`) if it does not hold. */
function check(message, cond) {
  checks += 1;
  if (!cond) failures.push(message);
}

// 1. The Tauri scaffold files must all exist.
const requiredFiles = [
  "package.json",
  "src-tauri/Cargo.toml",
  "src-tauri/build.rs",
  "src-tauri/tauri.conf.json",
  "src-tauri/src/main.rs",
  "src-tauri/src/lib.rs",
  "src-tauri/capabilities/default.json",
  "src-tauri/icons/icon.ico",
];
for (const file of requiredFiles) {
  check(`Missing desktop scaffold file: ${file}`, existsSync(resolve(root, file)));
}

const config = JSON.parse(readFileSync(resolve(root, "src-tauri/tauri.conf.json"), "utf8"));
const STARTUP_BOX_WIDTH = 760;
const STARTUP_BOX_HEIGHT = 560;

// 2. Product identity must stay correct for a signed, branded installer.
check("tauri.conf.json must keep productName as ESCO Automation Studio.", config.productName === "ESCO Automation Studio");
check(
  "tauri.conf.json must keep the com.scintilla.escogroup identifier.",
  String(config.identifier ?? "").startsWith("com.scintilla.escogroup"),
);
check("bundle.publisher must be set for the Windows installer.", Boolean(config.bundle?.publisher));
check("bundle must reference an .ico icon.", (config.bundle?.icon ?? []).some((i) => String(i).endsWith(".ico")));

// 3. The desktop window must open as the compact startup box and promote to the IDE.
check("Desktop dev URL must request the desktop-only startup screen.", String(config.build?.devUrl ?? "").includes("desktop-startup=1"));
const mainWindow = config.app?.windows?.[0];
check("Packaged desktop window must request the desktop-only startup screen.", String(mainWindow?.url ?? "").includes("desktop-startup=1"));
check(
  "Packaged desktop window must open at the compact startup-box size.",
  mainWindow?.width === STARTUP_BOX_WIDTH &&
    mainWindow?.height === STARTUP_BOX_HEIGHT &&
    mainWindow?.minWidth === STARTUP_BOX_WIDTH &&
    mainWindow?.minHeight === STARTUP_BOX_HEIGHT &&
    mainWindow?.center === true &&
    mainWindow?.resizable === false &&
    mainWindow?.decorations === false,
);

// 4. A restrictive Content-Security-Policy must be set (no longer null).
const csp = config.app?.security?.csp;
check("A Content-Security-Policy must be set for the packaged desktop build (was null).", typeof csp === "string" && csp.length > 0);
if (typeof csp === "string") {
  check("CSP must set default-src to 'self'.", /default-src\s+'self'/.test(csp));
  check("CSP must set object-src to 'none'.", /object-src\s+'none'/.test(csp));
  check("CSP must restrict frame-ancestors to 'none'.", /frame-ancestors\s+'none'/.test(csp));
  // connect-src must allow same-origin + the two opt-in AI hosts, and nothing wildcard.
  const connectMatch = csp.match(/connect-src\s+([^;]+)/);
  const connectSrc = connectMatch ? connectMatch[1] : "";
  check("CSP connect-src must include 'self'.", /'self'/.test(connectSrc));
  check("CSP connect-src must allow the opt-in Anthropic host.", connectSrc.includes("https://api.anthropic.com"));
  check("CSP connect-src must allow the opt-in OpenAI host.", connectSrc.includes("https://api.openai.com"));
  check("CSP connect-src must not be a wildcard.", !connectSrc.includes("*"));
  // Allowlist CEILING: connect-src must contain ONLY same-origin + the two opt-in
  // AI hosts. This stops a future change from silently adding a controller
  // gateway / online-edit host (e.g. an IP or LAN address) to the egress policy
  // while still passing the "includes the AI hosts, no wildcard" floor above.
  const ALLOWED_CONNECT_SRC = new Set(["'self'", "https://api.anthropic.com", "https://api.openai.com"]);
  const connectTokens = connectSrc.trim().split(/\s+/).filter(Boolean);
  const unexpectedConnect = connectTokens.filter((token) => !ALLOWED_CONNECT_SRC.has(token));
  check(
    `CSP connect-src must not add hosts beyond 'self' + the opt-in AI hosts (found: ${unexpectedConnect.join(", ") || "none"}).`,
    unexpectedConnect.length === 0,
  );
  check("CSP must not allow 'unsafe-eval'.", !/unsafe-eval/.test(csp));
}

// 5. Capabilities must stay minimal — core permissions only. A broad fs/shell/http
//    grant would widen the attack surface of the offline shell.
const capabilities = JSON.parse(readFileSync(resolve(root, "src-tauri/capabilities/default.json"), "utf8"));
const permissions = Array.isArray(capabilities.permissions) ? capabilities.permissions : [];
const nonCore = permissions.filter((p) => typeof p === "string" && !p.startsWith("core:"));
check(`Desktop capabilities must grant core permissions only (found: ${nonCore.join(", ") || "none"}).`, nonCore.length === 0);

// 6. The desktop capability report and window-promotion command must stay honest.
const cargoToml = readFileSync(resolve(root, "src-tauri/Cargo.toml"), "utf8");
const rustShell = readFileSync(resolve(root, "src-tauri/src/lib.rs"), "utf8");
const webApp = readFileSync(resolve(root, "../web/src/App.tsx"), "utf8");
const desktopStartup = readFileSync(resolve(root, "../web/src/components/DesktopStartup.tsx"), "utf8");
const topAppBar = readFileSync(resolve(root, "../web/src/components/TopAppBar.tsx"), "utf8");
const webCss = readFileSync(resolve(root, "../web/src/index.css"), "utf8");
check("Desktop shell must expose the startup-to-IDE window promotion command.", rustShell.includes("promote_desktop_window_to_ide"));
check("Desktop shell must expose the painted titlebar window command.", rustShell.includes("desktop_window_action"));
for (const action of ["minimize", "toggle-maximize", "close"]) {
  check(`Desktop titlebar command must support ${action}.`, rustShell.includes(`"${action}"`));
}
check('Desktop must report controller_connection as "offline-simulation".', rustShell.includes('"offline-simulation"'));
check("Desktop must report online_edits: false.", /online_edits:\s*false/.test(rustShell));
check("Desktop must report binary_project_access: false.", /binary_project_access:\s*false/.test(rustShell));
check("Desktop shell must depend on the Windows-native keyring backend.", /keyring\s*=/.test(cargoToml) && /windows-native/.test(cargoToml));
check('Desktop must report secure_key_storage as "windows-credential-manager".', rustShell.includes('"windows-credential-manager"'));
for (const command of ["secure_key_available", "secure_key_get", "secure_key_set", "secure_key_delete"]) {
  check(`Desktop shell must expose ${command}.`, rustShell.includes(command));
}
check(
  "Desktop startup must show whenever the desktop startup route is requested.",
  webApp.includes("useState(() => isDesktopStartupRequested())") &&
    !webApp.includes("isDesktopStartupRequested() && !isFirstRunComplete()"),
);
check("EXE startup must use the Figma Make startup screen.", desktopStartup.includes("esco-desktop-startup--figma"));
check("EXE startup card must be draggable in the undecorated shell.", desktopStartup.includes("data-tauri-drag-region"));
check("EXE startup must show the Figma Make loading state.", desktopStartup.includes("INITIALIZING WORKSPACE"));
check("EXE startup progress must begin at 0%.", desktopStartup.includes("useState(0)"));
check(
  "EXE startup must require login until a saved workstation profile exists.",
  desktopStartup.includes("requiresLogin") && webApp.includes("!firstRunComplete || !aiProfile"),
);
check(
  "EXE startup must automatically prompt the sign-in setup after loading.",
  desktopStartup.includes("autoPrompted") && desktopStartup.includes("onSignIn();"),
);
check("EXE startup CSS must not paint the old black outer stage.", !/background:\s*#1d1f22\s*!important/.test(webCss));
check("Packaged startup window must not use the broken transparent Windows shell.", mainWindow?.transparent !== true);
check("IDE titlebar must be draggable in the undecorated shell.", topAppBar.includes("data-tauri-drag-region"));
check(
  "Painted IDE titlebar controls must call the desktop window bridge.",
  topAppBar.includes("controlDesktopWindow") && topAppBar.includes("esco-window-control"),
);
check("EXE startup CSS must include the Figma Make startup stage.", webCss.includes(".esco-desktop-startup--figma"));

if (failures.length) {
  for (const failure of failures) console.error(`✗ ${failure}`);
  console.error(`\nSUMMARY: ${checks - failures.length}/${checks} desktop preflight checks passed`);
  process.exit(1);
}

console.log(`Desktop scaffold config OK. SUMMARY: ${checks}/${checks} desktop preflight checks passed`);
