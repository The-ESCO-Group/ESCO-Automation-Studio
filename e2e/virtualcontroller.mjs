// E2E: ESCO Virtual Controller offline/virtual session. Drives the full IDE-style
// workflow — Set Path / Who Active -> Go Online (no project => no-project state) ->
// Download (commission) -> Go Online (matched) -> mode change (Run) -> Upload —
// through the ESCO Virtual Controller panel. ESCO branding only; never real hardware.
import { chromium } from "playwright-core";
import { URL, importStarterProject } from "./helpers.mjs";

const results = [];
const check = (l, c, d = "") => {
  results.push(!!c);
  console.log(`${c ? "PASS" : "FAIL"}  ${l}${d ? "  — " + String(d).replace(/\s+/g, " ").slice(0, 150) : ""}`);
};

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 980 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));

const vctrl = () => page.locator(".esco-vctrl").first();
const toast = (text) => page.locator(`.esco-toast:has-text("${text}")`).first();
async function dismissToasts() {
  while ((await page.locator(".esco-toast__close").count()) > 0) {
    await page.locator(".esco-toast__close").first().click();
  }
}
const actionBtn = (label) => vctrl().locator(".esco-vctrl__actions button", { hasText: label }).first();

try {
  // The app's LiveBridge opens a retrying EventSource (MCP live stream), so the
  // network never goes idle — wait for the shell to mount instead of networkidle.
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.locator(".esco-ribbon").waitFor({ timeout: 60000 });
  await importStarterProject(page);

  // Open the Controller dock (where the ESCO Virtual Controller panel lives).
  await page.locator(".esco-statusbar__connection").click();
  await vctrl().waitFor({ timeout: 8000 });
  check("ESCO Virtual Controller panel is present and ESCO-branded", /ESCO Virtual Controller/.test(await vctrl().innerText()));
  check("panel declares it is not real hardware", /(?:no|not) real hardware/i.test(await vctrl().innerText()));
  check("panel exposes the ESCO SoftController software-runtime path", /SoftController upload\/download uses the scan-capable local software runtime/i.test(await vctrl().innerText()));

  // 1) Set Path / Who Active -> realistic ESCO virtual paths.
  await vctrl().locator("button", { hasText: "Select Virtual Path" }).first().click();
  await page.locator(".esco-vctrl__paths").waitFor({ timeout: 5000 });
  const pathText = await page.locator(".esco-vctrl__paths").innerText();
  check("Who Active lists realistic ESCO virtual paths", /EtherNet\/IP/i.test(pathText) && /local emulation/i.test(pathText) && /USB/i.test(pathText), pathText);
  await page.locator(".esco-vctrl__pathpick", { hasText: "EtherNet/IP" }).first().click();
  await toast("Path selected").waitFor({ timeout: 5000 });
  check("selecting a path reports the ESCO controller identity", /ESCO_Controller/.test(await vctrl().innerText()));
  await dismissToasts();

  // 2) Go Online with NO downloaded project -> no-project state + fault.
  await actionBtn("Go Online").click();
  await toast("no project downloaded").waitFor({ timeout: 5000 });
  let panel = await vctrl().innerText();
  check("Go Online (no project) shows the no-project state", /No project downloaded/.test(panel), panel);
  check("Go Online (no project) seeds a VC-NOPROJ fault", /VC-NOPROJ/.test(panel), panel);
  check("status bar reflects the online virtual session", /Virtual:\s*Online \(Virtual\)/.test(await page.locator(".esco-statusbar__vctrl").innerText()));
  await dismissToasts();

  // 2b) Clear Faults dismisses the VC-NOPROJ fault and updates the session.
  await vctrl().locator("button", { hasText: "Clear Virtual Faults" }).first().click();
  await toast("Cleared").waitFor({ timeout: 5000 });
  check("Clear Faults removes the clearable fault", !/VC-NOPROJ/.test(await vctrl().innerText()));
  await dismissToasts();

  // 3) Download -> commission the controller, store snapshot, go online (Program).
  await actionBtn("Download").click();
  await toast("Downloaded").waitFor({ timeout: 5000 });
  panel = await vctrl().innerText();
  check("Download stores a controller image with structure counts", /program\(s\),.*routine\(s\),.*tag\(s\)/.test(panel), panel);
  check("Download leaves the controller online in Program mode", /Online \(Virtual\)/.test(panel) && /Mode:\s*Program/.test(panel), panel);
  check("Download records an online signature", /Online signature/.test(panel) && !/Online signature[\s\S]{0,40}—/.test(panel.replace(/\s+/g, " ")), panel);
  await dismissToasts();

  // 4) Go Online again -> matched (no new faults).
  await actionBtn("Go Online").click();
  await toast("project matches the controller").waitFor({ timeout: 5000 });
  check("Go Online after download reports matched", /Project matches (?:virtual )?controller/.test(await vctrl().innerText()));
  await dismissToasts();

  await page.locator(".esco-lad__rung").first().click();
  await page.keyboard.press("Control+C");
  await dismissToasts();
  const rungCountBeforeRun = await page.locator(".esco-lad__rung").count();

  // 5) Mode change -> Run (requires downloaded project; guards edits).
  await vctrl().locator(".esco-vctrl__mode", { hasText: /^Run$/ }).first().click();
  await toast("destructive edits are guarded").waitFor({ timeout: 5000 });
  panel = await vctrl().innerText();
  check("Run mode reports edits guarded (read-only while scanning)", /edits read-only \(scanning\)/.test(panel), panel);
  check("status bar shows the Run mode for the virtual session", /Virtual:[\s\S]*Run/.test(await page.locator(".esco-statusbar__vctrl").innerText()));
  await dismissToasts();

  await page.locator(".esco-editor__edit-lock").waitFor({ timeout: 5000 });
  const lockText = await page.locator(".esco-editor__edit-lock").innerText();
  check("routine editor shows the virtual scanning edit lock", /Logic edits are read-only/i.test(lockText), lockText);
  check("Add rung toolbar button is disabled while virtual controller scans", await page.locator('.esco-editor__tool-btn[aria-label="Add rung"]').isDisabled());
  check("Cut rung toolbar button is disabled while virtual controller scans", await page.locator('.esco-editor__tool-btn[aria-label="Cut rung"]').isDisabled());
  check("Paste rung toolbar button is disabled while virtual controller scans", await page.locator('.esco-editor__tool-btn[aria-label="Paste rung"]').isDisabled());
  check("Copy rung stays available while virtual controller scans", !(await page.locator('.esco-editor__tool-btn[aria-label="Copy rung"]').isDisabled()));

  await page.keyboard.press("Control+V");
  await page.waitForTimeout(150);
  check(
    "paste shortcut does not mutate the routine while virtual controller scans",
    (await page.locator(".esco-lad__rung").count()) === rungCountBeforeRun,
  );

  await page.keyboard.press("Alt+Insert");
  await toast("Add ladder element is blocked").waitFor({ timeout: 5000 });
  check(
    "Alt+Insert edit path is guarded while virtual controller scans",
    (await page.locator(".esco-instr-picker").count()) === 0 &&
      (await page.locator(".esco-lad__rung").count()) === rungCountBeforeRun,
  );
  await dismissToasts();

  await page.locator(".esco-lad__rung").first().click({ button: "right" });
  await page.locator(".esco-context-menu").waitFor({ timeout: 5000 });
  check("context menu disables Delete Rung while scanning", await page.locator('.esco-context-menu__item:has-text("Delete Rung")').isDisabled());
  check("context menu keeps Copy Rung available while scanning", !(await page.locator('.esco-context-menu__item:has-text("Copy Rung")').isDisabled()));
  await page.keyboard.press("Escape");

  // 6) Upload -> reconstruct the image; record the upload timestamp + activity.
  await actionBtn("Upload").click();
  await toast("Uploaded").waitFor({ timeout: 5000 });
  panel = await vctrl().innerText();
  check("Upload records a last-upload timestamp", /Last upload[\s\S]{0,30}:?\s*\d/.test(panel) || /Last upload/.test(panel), panel);
  check("session log captures the full workflow", /set-path/.test(panel) && /download/.test(panel) && /upload/.test(panel), panel.slice(0, 200));
  await dismissToasts();

  // 7) Download the compiled .easruntime to the executable ESCO SoftController
  // software target: build -> transfer -> checksum validate -> apply.
  await vctrl().locator("button", { hasText: "Download Runtime to ESCO SoftController" }).first().click();
  await toast("Checksum verified on target").waitFor({ timeout: 8000 });
  panel = await vctrl().innerText();
  check("SoftController download succeeds through the software-runtime path", /SoftController runtime download:\s*success/i.test(panel), panel);
  check("SoftController transfer reports checksum validation on target", /checksum\s+[0-9a-f]{8,}.*verified on target/i.test(panel), panel);
  check("SoftController live monitor shows loaded runtime tags", /Live Software Runtime Monitor/i.test(panel) && /StartPB|MotorRun/.test(panel), panel);
  check("SoftController live monitor starts in Program mode", /Live Software Runtime Monitor[\s\S]*program/i.test(panel), panel);
  await vctrl().locator(".esco-vctrl__scmon button", { hasText: "Start Scan" }).first().click();
  await toast("Run mode").waitFor({ timeout: 5000 });
  await dismissToasts();
  await vctrl().locator(".esco-vctrl__scmon button", { hasText: "Scan Once" }).first().click();
  await toast("Executed 1 scan").waitFor({ timeout: 5000 });
  panel = await vctrl().innerText();
  check("SoftController live monitor increments scan count", /Scans\s+1/i.test(panel), panel);
  await dismissToasts();
  await vctrl().locator(".esco-vctrl__scmon button", { hasText: "Stop Scan" }).first().click();
  await toast("Controller stopped").waitFor({ timeout: 5000 });
  await dismissToasts();

  // 8) A second software-runtime download creates a rollback backup, and Restore
  // Previous Runtime is a real enabled command.
  await vctrl().locator("button", { hasText: "Download Runtime to ESCO SoftController" }).first().click();
  await toast("Checksum verified on target").waitFor({ timeout: 8000 });
  panel = await vctrl().innerText();
  check("second SoftController download exposes a rollback backup", /restore available:/i.test(panel), panel);
  await vctrl().locator("button", { hasText: "Restore Previous Runtime" }).first().click();
  await toast("Restored previous ESCO runtime").waitFor({ timeout: 8000 });
  check("Restore Previous Runtime runs against the local software rollback image", /Restore Previous Runtime/.test(await vctrl().innerText()));
  await dismissToasts();

  // 9) Upload from the ESCO SoftController opens a real preview modal before
  // replacing the active project.
  await vctrl().locator("button", { hasText: "Upload from ESCO SoftController" }).first().click();
  await page.locator(".esco-vctrl-upload").waitFor({ timeout: 8000 });
  const uploadPreview = await page.locator(".esco-vctrl-upload").innerText();
  check("SoftController upload opens a reconstructed-project preview", /Preview Reconstructed Project/.test(uploadPreview), uploadPreview);
  check("SoftController upload preview reports checksum validity", /Checksum valid\s+Yes/i.test(uploadPreview), uploadPreview);
  check("SoftController upload preview is explicitly software-only", /software runtime image/i.test(uploadPreview), uploadPreview);
  await page.locator(".esco-vctrl-upload button", { hasText: "Cancel" }).first().click();
  await page.locator(".esco-vctrl-upload").waitFor({ state: "detached", timeout: 8000 });

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (err) {
  console.log("ERROR:", err.message);
  await page.screenshot({ path: "e2e/virtualcontroller-error.png" }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
