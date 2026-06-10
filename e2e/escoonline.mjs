// E2E: ESCO Online (Gateway) panel — Goal B visible surface.
//
// Drives the real UI chain: panel -> useEscoGateway -> EscoOnlineSession ->
// EscoGatewayClient -> HTTP -> apps/api GatewayHost -> ControllerGateway ->
// driver. The browser flow connects through the ESCO SIMULATOR driver (no
// hardware); the EtherNet/IP wire path is covered by the unit/integration
// suites (loopback fake target). Requires the apps/api host to be running and
// the dev server started with VITE_ESCO_API_URL pointing at it.
import { chromium } from "playwright-core";
import { URL, importStarterProject } from "./helpers.mjs";

const API_URL = process.env.E2E_API_URL || process.env.VITE_ESCO_API_URL || "http://localhost:4000";

const results = [];
const check = (label, condition, detail = "") => {
  results.push(!!condition);
  console.log(`${condition ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + String(detail).replace(/\s+/g, " ").slice(0, 160) : ""}`);
};

const panel = (page) => page.locator(".eol-root");
const panelBtn = (page, text) => page.locator(`.eol-root button:has-text("${text}")`).first();

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 980 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));

try {
  try {
    await fetch(`${API_URL}/api/gateway/session/disconnect`, { method: "POST" });
  } catch {
    // The panel itself reports API availability; this reset only prevents a
    // previous failed run from leaving the shared gateway session online.
  }
  await page.goto(URL, { waitUntil: "networkidle" });
  await importStarterProject(page);

  // 1. The panel is exposed from the View menu (Goal B entry point).
  await page.locator('.esco-ribbon__tab:has-text("View")').click();
  check(
    "ESCO Online (Gateway) is exposed from the View menu",
    (await page.locator('.esco-ribbon-menu__item:has-text("ESCO Online (Gateway)")').count()) === 1,
  );
  await page.locator('.esco-ribbon-menu__item:has-text("ESCO Online (Gateway)")').click();
  await panel(page).waitFor({ timeout: 8000 });
  check("ESCO Online panel opens", (await panel(page).count()) > 0);

  // 2. Read-only milestone boundary is stated up front.
  const banner = await panel(page).innerText();
  check("Read-only milestone banner is shown", /read-only milestone/i.test(banner));
  check(
    "Banner says no writes exist in this path",
    /no writes, downloads, mode changes, or forces/i.test(banner),
  );
  check(
    "Transport validation evidence is visible",
    /Software-wired, not field-validated/.test(banner) && /Hardware not validated/.test(banner),
    banner,
  );

  // 3. The backend registry is visible: real EtherNet/IP driver + simulator.
  const driverSelect = page.locator("#eol-driver");
  await page.waitForFunction(
    () => document.querySelectorAll("#eol-driver option").length >= 2,
    { timeout: 8000 },
  );
  const options = await driverSelect.locator("option").allInnerTexts();
  check(
    "EtherNet/IP read-only driver is listed from the backend",
    options.some((o) => /ESCO EtherNet\/IP CIP Read-Only Driver/.test(o)),
    options.join(" | "),
  );
  check(
    "ESCO simulator driver remains available for offline testing",
    options.some((o) => /Simulator/i.test(o)),
  );
  check(
    "Generic OPC UA read-only driver is listed from the backend",
    options.some((o) => /Generic OPC UA Read-Only Driver/.test(o)),
    options.join(" | "),
  );
  await driverSelect.selectOption("opcua-generic-readonly");
  let connectionText = await page.locator(".eol-card").first().innerText();
  check(
    "OPC UA path exposes endpoint, browse root, sampling, and node-map controls",
    /OPC UA endpoint URL/.test(connectionText) &&
      /Browse root node/.test(connectionText) &&
      /Sampling ms/.test(connectionText) &&
      /Node map JSON/.test(connectionText) &&
      (await page.locator("#eol-route").count()) === 0,
    connectionText,
  );
  await page.locator("#eol-opcua-node-map").fill("{bad json");
  await panelBtn(page, "Go Online").click();
  await page.locator('.eol-error:has-text("OPC UA node map must be valid JSON")').waitFor({ timeout: 8000 });
  check("OPC UA node-map validation stays local and read-only", true);
  await page.locator("#eol-opcua-node-map").fill('{"MotorRunning":"ns=2;s=Line.Running"}');
  await page.locator("#eol-opcua-sampling").fill("250");
  check("OPC UA node-map JSON can be entered for gateway connect config", true);
  await driverSelect.selectOption("l5x-sync");
  check(
    "L5X sync path is presented as an offline snapshot, not a controller endpoint",
    /Offline project snapshot/.test(await panel(page).innerText()) &&
      (await page.locator("#eol-endpoint").count()) === 0 &&
      /Open Snapshot/.test(await panelBtn(page, "Open Snapshot").innerText()),
  );
  await panelBtn(page, "Open Snapshot").click();
  await page.locator('.eol-badge:has-text("Online Read-Only")').waitFor({ timeout: 8000 });
  const l5xOnlineText = await panel(page).innerText();
  const l5xButtons = await page.locator(".eol-root button").allInnerTexts();
  check(
    "L5X online snapshot does not advertise live fault reads",
    /Fault reads are not available on this driver path/.test(l5xOnlineText) &&
      l5xButtons.includes("Refresh status") &&
      !l5xButtons.includes("Refresh status & faults"),
    l5xOnlineText,
  );
  await panelBtn(page, "Go Offline").click();
  await page.locator('.eol-badge:has-text("Disconnected")').waitFor({ timeout: 8000 });

  // 4. Go online through the gateway using the simulator driver.
  await driverSelect.selectOption("esco-simulator");
  await panelBtn(page, "Go Online (Read-Only)").click();
  await page.locator('.eol-badge:has-text("Online Mismatched")').waitFor({ timeout: 8000 });
  check("Session reaches Online Mismatched when local project identity does not match", true);
  check(
    "Read-Only chip stays on",
    (await page.locator('.eol-badge:has-text("Read-Only")').count()) >= 1,
  );

  // 5. Identity/status flow through the gateway.
  await panelBtn(page, "Refresh identity").click();
  await page.waitForFunction(
    () => /ESCO/.test(document.querySelector(".eol-kv")?.textContent ?? ""),
    { timeout: 8000 },
  );
  check("Identity refresh reads through the gateway", /ESCO/.test(await page.locator(".eol-kv").innerText()));
  await panelBtn(page, "Refresh status & faults").click();
  await page.waitForFunction(
    () => /Simulator/.test(document.querySelector(".eol-kv")?.textContent ?? ""),
    { timeout: 8000 },
  );
  const kv = await page.locator(".eol-kv").innerText();
  check("Status reads through the gateway (simulator mode visible)", /Simulator/.test(kv));
  check("Vendor identity is shown", /ESCO/.test(kv));

  // 6. B5 match check + B1 upload snapshot stay read-only and gateway-owned.
  await panelBtn(page, "Refresh identity & compare").click();
  await page.locator('.eol-root:has-text("writes stay blocked")').waitFor({ timeout: 8000 });
  const matchText = await panel(page).innerText();
  check("Refresh identity & compare reports mismatched/read-only evidence", /Mismatched/.test(matchText) && /writes stay blocked/.test(matchText), matchText);
  check(
    "Match evidence table shows B5 identity and ESCO signature proof",
    /Match evidence/.test(matchText) &&
      /Controller name/.test(matchText) &&
      /Project signature/.test(matchText) &&
      /Signature algorithm/.test(matchText) &&
      /esco-sha256-stable-project-v1/.test(matchText),
    matchText,
  );

  await panelBtn(page, "Upload snapshot").click();
  await page.locator('.eol-root:has-text("Tag values")').waitFor({ timeout: 8000 });
  check("Upload snapshot captures read-only simulator tag values", /Snapshot id/.test(await panel(page).innerText()) && /Tag values\s*4/.test(await panel(page).innerText()));

  // 7. Online Tag Monitor B4 surface: browse, filter, watched tags, save/restore, poll.
  await panelBtn(page, "Browse tags").click();
  await page.locator('.eol-root tr:has-text("Conveyor.RunFeedback")').waitFor({ timeout: 8000 });
  let tagsText = await panel(page).innerText();
  check("Browse tags loads simulator tags through the gateway", /Conveyor\.RunFeedback/.test(tagsText) && /Sorter\.BoxCount/.test(tagsText), tagsText);
  check("Tag table shows source driver and read-only write status", /simulator/i.test(tagsText) && /Read-only/.test(tagsText), tagsText);

  await page.locator("#eol-tag-filter").fill("Sorter");
  tagsText = await panel(page).innerText();
  check("Tag filter narrows browsed rows", /Sorter\.BoxCount/.test(tagsText) && /Sorter\.LastBarcode/.test(tagsText), tagsText);
  await page.locator("#eol-tag-filter").fill("");

  await page.locator('.eol-root tr:has-text("Conveyor.RunFeedback") button:has-text("Watch")').first().click();
  await page.locator('.eol-watch-panel:has-text("Conveyor.RunFeedback")').waitFor({ timeout: 8000 });
  check("Watch list supports adding a browsed tag", /Watch list 1/.test(await panel(page).innerText()));

  await panelBtn(page, "Save list").click();
  await page.locator('.eol-root:has-text("Saved 1 watched tag")').waitFor({ timeout: 8000 });
  await panelBtn(page, "Clear list").click();
  check("Watch list can be cleared", /Watch list 0/.test(await panel(page).innerText()));
  await panelBtn(page, "Restore saved").click();
  await page.locator('.eol-watch-panel:has-text("Conveyor.RunFeedback")').waitFor({ timeout: 8000 });
  check("Saved watch list restores from browser storage", /Restored 1 watched tag/.test(await panel(page).innerText()));

  await panelBtn(page, "Stream selected").click();
  await page.locator('.eol-badge:has-text("Streaming 1 tag")').waitFor({ timeout: 8000 });
  await page.locator('.eol-watch-panel .eol-state--live:has-text("live")').waitFor({ timeout: 8000 });
  let watchText = await page.locator(".eol-watch-panel").innerText();
  check("Stream selected receives subscription values with quality/timestamp/source", /true/.test(watchText) && /good/.test(watchText) && /simulator/i.test(watchText), watchText);
  await panelBtn(page, "Stop stream").click();
  await page.locator('.eol-badge:has-text("Streaming 1 tag")').waitFor({ state: "detached", timeout: 8000 });
  await page.locator('.eol-watch-panel .eol-state--stale:has-text("stale: watch stopped")').waitFor({ timeout: 8000 });
  watchText = await page.locator(".eol-watch-panel").innerText();
  check("Stopping stream marks the last value stale", /stale: watch stopped/.test(watchText), watchText);

  await panelBtn(page, "Watch selected").click();
  await page.locator('.eol-watch-panel .eol-state--live:has-text("live")').waitFor({ timeout: 8000 });
  watchText = await page.locator(".eol-watch-panel").innerText();
  check("Watch selected polls values with quality/timestamp/source", /true/.test(watchText) && /good/.test(watchText) && /simulator/i.test(watchText), watchText);
  check("Watch table shows read-only write status", /Read-only/.test(watchText), watchText);

  await page.locator('.eol-watch-panel button:has-text("Remove")').click();
  await page.locator('.eol-badge:has-text("Watch list 0")').waitFor({ timeout: 8000 });
  check("Watch list supports removing watched tags", /Watch list 0/.test(await panel(page).innerText()));

  await page.locator('input[aria-label="Import watch list JSON"]').setInputFiles({
    name: "simulator-watch-list.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({
      schema: "esco.online.watchList.v1",
      driverId: "esco-simulator",
      driverName: "ESCO Simulator Driver",
      tags: ["Sorter.BoxCount", "Sorter.LastBarcode", "Sorter.BoxCount"],
    })),
  });
  await page.locator('.eol-root:has-text("Imported 2 watched tag")').waitFor({ timeout: 8000 });
  check(
    "Watch list imports ESCO JSON and de-duplicates tags",
    /Watch list 2/.test(await panel(page).innerText()) &&
      /Sorter\.BoxCount/.test(await page.locator(".eol-watch-panel").innerText()) &&
      /Sorter\.LastBarcode/.test(await page.locator(".eol-watch-panel").innerText()),
  );
  await panelBtn(page, "Save list").click();
  await page.locator('.eol-root:has-text("Saved 2 watched tag")').waitFor({ timeout: 8000 });
  const savedWatchLists = await page.evaluate(() => JSON.parse(localStorage.getItem("esco.online.watchLists.v1") || "{}"));
  check(
    "Saved watch lists are scoped by driver path",
    Array.isArray(savedWatchLists["esco-simulator"]) &&
      savedWatchLists["esco-simulator"].length === 2 &&
      savedWatchLists["l5x-sync"] === undefined,
    JSON.stringify(savedWatchLists),
  );

  // 8. Audit trail records the session actions.
  await panelBtn(page, "Refresh audit").click();
  await page.waitForFunction(
    () => /connect/.test(document.querySelector(".eol-audit")?.textContent ?? ""),
    { timeout: 8000 },
  );
  const auditText = await page.locator(".eol-audit").innerText();
  check("Gateway audit trail shows the connect action", /connect/.test(auditText));
  check(
    "Gateway audit trail shows structured driver and validation details",
    /Details/.test(auditText) &&
      /driver name/.test(auditText) &&
      /connection evidence/.test(auditText) &&
      /software-wired/.test(auditText),
    auditText,
  );

  // 9. No write affordance exists anywhere in the panel.
  const buttons = await page.locator(".eol-root button").allInnerTexts();
  check(
    "No write/download/force affordance in the panel",
    buttons.every((b) => !/write|download|force|mode change/i.test(b)),
    buttons.join(" | "),
  );

  // 10. Go offline cleanly through the Online ribbon command.
  await page.locator('.esco-ribbon__button[aria-label="Go Offline"]').first().click();
  await page.locator('.eol-badge:has-text("Disconnected")').waitFor({ timeout: 8000 });
  check("Online toolbar Go Offline disconnects back to Disconnected", true);
} catch (error) {
  console.log("ERROR:", error.message);
  await page.screenshot({ path: new globalThis.URL("./escoonline-error.png", import.meta.url).pathname.slice(1), fullPage: true }).catch(() => {});
  results.push(false);
} finally {
  await browser.close();
}

const passed = results.filter(Boolean).length;
console.log(`\nSUMMARY: ${passed}/${results.length}`);
process.exit(passed === results.length ? 0 : 1);
