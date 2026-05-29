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
 *     edits, no .ACD access).
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
  mainWindow?.width === 758 && mainWindow?.height === 558 && mainWindow?.resizable === false,
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
  check("CSP must not allow 'unsafe-eval'.", !/unsafe-eval/.test(csp));
}

// 5. Capabilities must stay minimal — core permissions only. A broad fs/shell/http
//    grant would widen the attack surface of the offline shell.
const capabilities = JSON.parse(readFileSync(resolve(root, "src-tauri/capabilities/default.json"), "utf8"));
const permissions = Array.isArray(capabilities.permissions) ? capabilities.permissions : [];
const nonCore = permissions.filter((p) => typeof p === "string" && !p.startsWith("core:"));
check(`Desktop capabilities must grant core permissions only (found: ${nonCore.join(", ") || "none"}).`, nonCore.length === 0);

// 6. The desktop capability report and window-promotion command must stay honest.
const rustShell = readFileSync(resolve(root, "src-tauri/src/lib.rs"), "utf8");
check("Desktop shell must expose the startup-to-IDE window promotion command.", rustShell.includes("promote_desktop_window_to_ide"));
check('Desktop must report controller_connection as "offline-simulation".', rustShell.includes('"offline-simulation"'));
check("Desktop must report online_edits: false.", /online_edits:\s*false/.test(rustShell));
check("Desktop must report acd_access: false.", /acd_access:\s*false/.test(rustShell));

if (failures.length) {
  for (const failure of failures) console.error(`✗ ${failure}`);
  console.error(`\nSUMMARY: ${checks - failures.length}/${checks} desktop preflight checks passed`);
  process.exit(1);
}

console.log(`Desktop scaffold config OK. SUMMARY: ${checks}/${checks} desktop preflight checks passed`);
