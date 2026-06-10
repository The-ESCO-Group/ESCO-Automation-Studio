// E2E: ESCO Online panel against the REAL EtherNet/IP driver path —
// browser UI -> session manager -> gateway client -> HTTP -> API host ->
// gateway -> EtherNet/IP driver -> TCP -> standalone fake target
// (dist/fake-target.mjs from apps/api; TEST-ONLY, not a controller emulator).
//
// Requires:
//   E2E_URL          — vite dev server started with VITE_ESCO_API_URL
//   E2E_ENIP_TARGET  — host:port of the running fake target
import { createConnection } from "node:net";
import { chromium } from "playwright-core";
import { URL } from "./helpers.mjs";

const TARGET = process.env.E2E_ENIP_TARGET || "127.0.0.1:44991";
const TARGET_EXPLICIT = Boolean(process.env.E2E_ENIP_TARGET);

const results = [];
const check = (label, condition, detail = "") => {
  results.push(!!condition);
  console.log(`${condition ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + String(detail).replace(/\s+/g, " ").slice(0, 160) : ""}`);
};

const panel = (page) => page.locator(".eol-root");
const panelBtn = (page, text) => page.locator(`.eol-root button:has-text("${text}")`).first();

async function targetReachable(target) {
  const [host, rawPort] = target.split(":");
  const port = Number(rawPort);
  if (!host || !Number.isInteger(port) || port <= 0 || port > 65535) return false;
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    const done = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(1000);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

if (!(await targetReachable(TARGET))) {
  if (!TARGET_EXPLICIT) {
    console.log(`SKIP  EtherNet/IP fake target is not listening at ${TARGET}; start apps/api/dist/fake-target.mjs to enable this optional smoke.`);
    console.log("SUMMARY: 0/0");
    process.exit(0);
  }
  check("EtherNet/IP fake target is reachable", false, TARGET);
  console.log("\nSUMMARY: 0/1");
  process.exit(1);
}

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 980 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));

try {
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.locator('.esco-ribbon__tab:has-text("View")').click();
  await page.locator('.esco-ribbon-menu__item:has-text("ESCO Online (Gateway)")').click();
  await panel(page).waitFor({ timeout: 8000 });
  check("ESCO Online panel opens", true);

  // EtherNet/IP driver is the default selection; aim it at the fake target.
  const driverSelect = page.locator("#eol-driver");
  await page.waitForFunction(
    () => document.querySelectorAll("#eol-driver option").length >= 2,
    { timeout: 8000 },
  );
  await driverSelect.selectOption("ethernetip-cip-readonly");
  await page.locator("#eol-endpoint").fill(TARGET);
  await panelBtn(page, "Go Online (Read-Only)").click();
  await page.locator('.eol-badge:has-text("Online Read-Only")').waitFor({ timeout: 10000 });
  check("EtherNet/IP session reaches Online Read-Only (rule 7 default)", true);

  // Identity + keyswitch mode from the real wire path.
  await panelBtn(page, "Refresh status & faults").click();
  await page.waitForFunction(
    () => /1769-L33E/.test(document.querySelector(".eol-kv")?.textContent ?? ""),
    { timeout: 8000 },
  );
  const kv = await page.locator(".eol-kv").innerText();
  check("Identity shows the fake target's product", /1769-L33E/.test(kv), kv);
  check("Vendor decodes from the CIP identity", /Rockwell Automation\/Allen-Bradley/.test(kv));
  check("Keyswitch mode decodes to Run", /\bRun\b/.test(kv));

  // Browse + read through the real EtherNet/IP symbol table.
  await panelBtn(page, "Browse tags").click();
  await page.locator('.eol-root tr:has-text("Pump")').waitFor({ timeout: 8000 });
  const tagsText = await panel(page).innerText();
  check("Browse lists EtherNet/IP symbols", /Pump/.test(tagsText) && /Vals/.test(tagsText));
  check("Array tag shows its honest type", /DINT\[\]/.test(tagsText), tagsText.slice(0, 200));

  await page.locator('.eol-root tr:has-text("Pump") button:has-text("Read")').first().click();
  await page.waitForFunction(
    () => /1234/.test(document.querySelector(".eol-root")?.textContent ?? ""),
    { timeout: 8000 },
  );
  check("Tag read returns the wire value (1234)", true);

  // B4 watch-list monitor over the real EtherNet/IP driver path.
  await page.locator('.eol-root tr:has-text("Pump") button:has-text("Watch")').first().click();
  await page.locator('.eol-watch-panel:has-text("Pump")').waitFor({ timeout: 8000 });
  check("EtherNet/IP watch list accepts a browsed symbol", /Watch list 1/.test(await panel(page).innerText()));

  await panelBtn(page, "Watch selected").click();
  await page.locator('.eol-watch-panel .eol-state--live:has-text("live")').waitFor({ timeout: 10000 });
  let watchText = await page.locator(".eol-watch-panel").innerText();
  check(
    "EtherNet/IP watch poll shows value, type, quality, timestamp, and source",
    /Pump/.test(watchText) &&
      /1234/.test(watchText) &&
      /DINT/.test(watchText) &&
      /good/.test(watchText) &&
      /ethernetip/i.test(watchText),
    watchText,
  );
  check("EtherNet/IP watch table remains read-only", /Read-only/.test(watchText), watchText);

  await panelBtn(page, "Stop watch").click();
  await page.locator('.eol-watch-panel .eol-state--stale:has-text("stale: watch stopped")').waitFor({ timeout: 8000 });
  watchText = await page.locator(".eol-watch-panel").innerText();
  check("Stopping EtherNet/IP watch marks the row stale", /stale: watch stopped/.test(watchText), watchText);

  // Audit trail + read-only guarantees.
  await panelBtn(page, "Refresh audit").click();
  await page.waitForFunction(
    () => /connect/.test(document.querySelector(".eol-audit")?.textContent ?? ""),
    { timeout: 8000 },
  );
  check("Audit trail records the EtherNet/IP connect", true);
  const buttons = await page.locator(".eol-root button").allInnerTexts();
  check(
    "No write/download/force affordance in the panel",
    buttons.every((b) => !/write|download|force|mode change/i.test(b)),
  );

  await panelBtn(page, "Go Offline").click();
  await page.locator('.eol-badge:has-text("Disconnected")').waitFor({ timeout: 8000 });
  check("Session disconnects cleanly", true);
} catch (error) {
  console.log("ERROR:", error.message);
  results.push(false);
} finally {
  await browser.close();
}

const passed = results.filter(Boolean).length;
console.log(`\nSUMMARY: ${passed}/${results.length}`);
process.exit(passed === results.length ? 0 : 1);
