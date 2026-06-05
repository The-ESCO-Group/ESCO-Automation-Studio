import { chromium } from "playwright-core";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const baseUrl = process.env.E2E_URL || "http://localhost:5173/";
const startupUrl = new URL(baseUrl);
startupUrl.searchParams.set("desktop-startup", "1");

const results = [];
const check = (label, cond, detail = "") => {
  results.push(!!cond);
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? "  - " + String(detail).replace(/\s+/g, " ").slice(0, 120) : ""}`);
};

const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const firstRunPage = await browser.newPage({ viewport: { width: 760, height: 560 } });
  firstRunPage.setDefaultTimeout(10000);
  firstRunPage.on("pageerror", (error) => console.log("PAGEERROR:", error.message));
  await firstRunPage.goto(startupUrl.toString(), { waitUntil: "domcontentloaded" });
  await firstRunPage.locator(".esco-desktop-startup--figma .esco-desktop-startup__window").waitFor();
  const initialProgress = await firstRunPage.locator(".esco-desktop-startup__progress-track").getAttribute("aria-valuenow");
  check("first-run startup progress begins at zero", Number(initialProgress) <= 5, initialProgress ?? "");
  await firstRunPage.waitForFunction(() => Number(document.querySelector(".esco-desktop-startup__progress-track")?.getAttribute("aria-valuenow") ?? 0) >= 100);
  await firstRunPage.locator(".esco-setup").waitFor();
  const firstRunGate = await firstRunPage.evaluate(() => ({
    hasSignIn: document.querySelectorAll(".esco-desktop-startup__signin-required").length === 1,
    signInText: document.querySelector(".esco-desktop-startup__signin-required")?.textContent?.trim() ?? "",
    setupOpen: document.querySelectorAll(".esco-setup").length === 1,
    setupTitle: document.querySelector("#esco-setup-title")?.textContent?.trim() ?? "",
    stillStartup: document.querySelectorAll(".esco-desktop-startup--figma").length === 1,
    ideHidden: document.querySelectorAll(".esco-titlebar, .esco-ribbon, .esco-statusbar, .esco-left").length === 0,
  }));
  check(
    "first-run startup prompts sign-in before the IDE opens",
    firstRunGate.setupOpen &&
      /Set up ESCO Automation Studio/i.test(firstRunGate.setupTitle) &&
      firstRunGate.stillStartup &&
      firstRunGate.ideHidden,
    JSON.stringify(firstRunGate),
  );
  await firstRunPage.locator('.esco-setup [aria-label="Close setup"]').click();
  await firstRunPage.locator(".esco-setup").waitFor({ state: "detached" });
  const firstRunButtonGate = await firstRunPage.evaluate(() => ({
    hasSignIn: document.querySelectorAll(".esco-desktop-startup__signin-required").length === 1,
    signInText: document.querySelector(".esco-desktop-startup__signin-required")?.textContent?.trim() ?? "",
    stillStartup: document.querySelectorAll(".esco-desktop-startup--figma").length === 1,
    ideHidden: document.querySelectorAll(".esco-titlebar, .esco-ribbon, .esco-statusbar, .esco-left").length === 0,
  }));
  check(
    "closing first-run setup leaves the sign-in gate in front of the IDE",
    firstRunButtonGate.hasSignIn &&
      /Sign in to continue/i.test(firstRunButtonGate.signInText) &&
      firstRunButtonGate.stillStartup &&
      firstRunButtonGate.ideHidden,
    JSON.stringify(firstRunButtonGate),
  );
  await firstRunPage.close();

  const staleFlagPage = await browser.newPage({ viewport: { width: 760, height: 560 } });
  staleFlagPage.setDefaultTimeout(10000);
  staleFlagPage.on("pageerror", (error) => console.log("PAGEERROR:", error.message));
  await staleFlagPage.addInitScript(() => {
    window.localStorage.setItem("esco.app.firstRunComplete.v1", JSON.stringify(true));
  });
  await staleFlagPage.goto(startupUrl.toString(), { waitUntil: "domcontentloaded" });
  await staleFlagPage.waitForFunction(() => Number(document.querySelector(".esco-desktop-startup__progress-track")?.getAttribute("aria-valuenow") ?? 0) >= 100);
  await staleFlagPage.locator(".esco-setup").waitFor();
  const staleFlagGate = await staleFlagPage.evaluate(() => ({
    setupOpen: document.querySelectorAll(".esco-setup").length === 1,
    stillStartup: document.querySelectorAll(".esco-desktop-startup--figma").length === 1,
    ideHidden: document.querySelectorAll(".esco-titlebar, .esco-ribbon, .esco-statusbar, .esco-left").length === 0,
  }));
  check(
    "stale first-run flag without a saved profile still prompts sign-in",
    staleFlagGate.setupOpen && staleFlagGate.stillStartup && staleFlagGate.ideHidden,
    JSON.stringify(staleFlagGate),
  );
  await staleFlagPage.close();

  const page = await browser.newPage({ viewport: { width: 760, height: 560 } });
  page.setDefaultTimeout(10000);
  page.on("pageerror", (error) => console.log("PAGEERROR:", error.message));
  await page.addInitScript(() => {
    window.localStorage.setItem("esco.app.firstRunComplete.v1", JSON.stringify(true));
    window.localStorage.setItem(
      "esco.ai.profile.v2",
      JSON.stringify({
        displayName: "Controls Engineer",
        email: "engineer@esco.local",
        provider: "anthropic",
        modelId: "claude-sonnet-4-20250514",
        savedAt: "2026-06-01T00:00:00.000Z",
      }),
    );
    window.localStorage.setItem("esco.ai.profile.secret.v1", JSON.stringify("sk-ant-test"));
  });
  await page.goto(startupUrl.toString(), { waitUntil: "networkidle" });
  await page.locator(".esco-desktop-startup--figma .esco-desktop-startup__window").waitFor();

  const startup = await page.evaluate(() => {
    const rect = (selector, styleProps = []) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const bounds = element.getBoundingClientRect();
      const styles = window.getComputedStyle(element);
      return {
        x: Math.round(bounds.x),
        y: Math.round(bounds.y),
        width: Math.round(bounds.width),
        height: Math.round(bounds.height),
        text: element.textContent?.replace(/\s+/g, " ").trim() ?? "",
        styles: Object.fromEntries(styleProps.map((prop) => [prop, styles.getPropertyValue(prop)])),
      };
    };
    const progress = document.querySelector(".esco-desktop-startup__progress-track");
    return {
      stage: rect(".esco-desktop-startup--figma", ["background-color", "place-items"]),
      card: rect(".esco-desktop-startup__window", ["background-color", "border-radius", "box-shadow"]),
      header: rect(".esco-desktop-startup__header"),
      appMark: rect(".esco-desktop-startup__app-mark", ["background-color", "border-radius"]),
      brand: rect(".esco-desktop-startup__brand-text", ["color"]),
      wordmark: rect(".esco-desktop-startup__wordmark"),
      divider: rect(".esco-desktop-startup__divider", ["background-color"]),
      prompt: rect(".esco-desktop-startup__prompt", ["letter-spacing", "color", "font-family"]),
      progressTrack: rect(".esco-desktop-startup__progress-track", ["background-color"]),
      progressValue: rect(".esco-desktop-startup__progress-value", ["color"]),
      footer: rect(".esco-desktop-startup__footer", ["border-top-color", "font-family"]),
      appChromeHidden:
        document.querySelectorAll(".esco-titlebar, .esco-ribbon, .esco-statusbar, .esco-left").length === 0,
      dialogRole:
        document.querySelectorAll('[role="dialog"][aria-modal="true"][aria-labelledby="desktop-startup-title"]').length === 1,
      cardDraggable: document.querySelectorAll(".esco-desktop-startup__window[data-tauri-drag-region]").length === 1,
      legacyErrorHidden:
        !/Error launching app|Unable to find Electron app|WindowsApps|Cannot find module/i.test(document.body.innerText),
      progressNow: Number(progress?.getAttribute("aria-valuenow") ?? 0),
      body: document.body.innerText.replace(/\s+/g, " ").trim(),
    };
  });

  check("desktop startup route shows only the Figma Make launch screen", startup.appChromeHidden, startup.body);
  check(
    "startup route does not paint the old black outer box",
    startup.stage?.width === 760 &&
      startup.stage?.height === 560 &&
      startup.stage.styles["background-color"] === "rgba(0, 0, 0, 0)",
    JSON.stringify(startup.stage),
  );
  check(
    "startup card is the whole popup, matching the Figma panel",
    startup.card?.width === 760 &&
      startup.card?.height === 560 &&
      startup.card?.x === 0 &&
      startup.card?.y === 0 &&
      startup.card.styles["background-color"] === "rgb(251, 247, 239)" &&
      startup.card.styles["border-radius"] === "8px",
    JSON.stringify(startup.card),
  );
  check("startup dialog keeps accessible modal semantics", startup.dialogRole);
  check("startup card is draggable for undecorated desktop shell", startup.cardDraggable);
  check("startup removes the old Windows error-box content", startup.legacyErrorHidden, startup.body);
  check(
    "startup header uses ESCO Automation Studio app identity",
    /ESCO Automation Studio/.test(startup.brand?.text ?? "") &&
      /PLC ENGINEERING IDE/.test(startup.brand?.text ?? "") &&
      startup.appMark?.width === 28 &&
      startup.appMark?.height === 28 &&
      startup.appMark.styles["background-color"] === "rgb(29, 43, 96)",
    JSON.stringify({ brand: startup.brand, appMark: startup.appMark }),
  );
  check(
    "startup centers the Scintilla ESCO Group wordmark",
    /SCINTILLA/.test(startup.wordmark?.text ?? "") &&
      /ESCOGROUP/.test((startup.wordmark?.text ?? "").replace(/\s+/g, "")) &&
      startup.wordmark?.width &&
      startup.wordmark.width >= 220,
    JSON.stringify(startup.wordmark),
  );
  check(
    "startup includes the Figma gold divider",
    startup.divider?.width === 56 &&
      startup.divider?.height === 1 &&
      startup.divider.styles["background-color"] === "rgb(213, 166, 70)",
    JSON.stringify(startup.divider),
  );
  check(
    "startup shows initializing workspace progress",
    /INITIALIZING WORKSPACE/.test(startup.prompt?.text ?? "") &&
      startup.progressTrack?.width === 320 &&
      startup.progressTrack?.height === 3 &&
      startup.progressNow >= 0 &&
      startup.progressNow <= 100 &&
      /%/.test(startup.progressValue?.text ?? ""),
    JSON.stringify({ prompt: startup.prompt, progressTrack: startup.progressTrack, progressNow: startup.progressNow }),
  );
  check(
    "startup footer matches Figma loading/status strip",
    /Loading workspace/.test(startup.footer?.text ?? "") &&
      /No controller connection active/.test(startup.footer?.text ?? "") &&
      startup.footer?.height === 44 &&
      startup.footer.styles["border-top-color"] === "rgb(224, 215, 199)",
    JSON.stringify(startup.footer),
  );

  await page.screenshot({ path: join(here, "desktop-startup.png"), fullPage: false });

  await page.locator(".esco-titlebar").waitFor({ timeout: 6000 });
  await page.locator(".esco-ribbon").waitFor();
  const promoted = await page.evaluate(() => ({
    startupGone: document.querySelectorAll(".esco-desktop-startup--figma").length === 0,
    title: document.querySelector(".esco-titlebar__name")?.textContent ?? "",
    organizer: document.querySelector(".esco-left")?.textContent?.replace(/\s+/g, " ").trim() ?? "",
    rungs: document.querySelectorAll(".esco-lad__rung").length,
  }));
  check("startup automatically promotes into the IDE shell", promoted.startupGone && /Untitled Project/.test(promoted.title), JSON.stringify(promoted));
  check("promoted IDE opens the controller organizer and starter routine", /Controller_1/.test(promoted.organizer) && /MainRoutine/.test(promoted.organizer) && promoted.rungs >= 1, JSON.stringify(promoted));
  await page.close();

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (error) {
  console.log("ERROR:", error.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
