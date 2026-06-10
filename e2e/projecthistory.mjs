import { chromium } from "playwright-core";
import { acceptConfirmation, createBlankProject, dismissToasts, URL } from "./helpers.mjs";

const results = [];
const check = (label, cond, detail = "") => {
  results.push(!!cond);
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? "  - " + String(detail).replace(/\s+/g, " ").slice(0, 140) : ""}`);
};

const openMenuCommand = async (page, menu, command) => {
  await page.locator(`.esco-ribbon__tab:has-text("${menu}")`).click();
  await page.locator(`.esco-ribbon-menu__item:has-text("${command}")`).click();
};

const installFakeDesktopVcs = async (page) => {
  await page.evaluate(() => {
    const calls = [];
    const filesByRevision = {};
    const remotes = [];
    let currentBranch = "main";
    let history = [];

    const status = () => ({
      initialized: true,
      currentBranch,
      detached: false,
      hasCommits: history.length > 0,
      hasUncommittedChanges: false,
      changedFiles: [],
      branches: ["main", ...(currentBranch === "main" ? [] : [currentBranch])],
      remotes: [...remotes],
      ahead: 0,
      behind: 0,
    });

    window.__vcsCalls = calls;
    window.__TAURI__ = {
      core: {
        invoke: async (command, args = {}) => {
          calls.push({ command, args });
          switch (command) {
            case "git_available":
              return true;
            case "git_select_project_folder":
              return "C:\\ESCO\\ProjectHistoryE2E";
            case "git_init_repo":
            case "git_get_status":
              return status();
            case "git_get_history":
              return history;
            case "git_create_revision": {
              const id = `rev-${history.length + 1}`;
              filesByRevision[id] = { ...args.files };
              const revision = {
                id,
                shortId: id,
                message: args.message,
                authorName: "E2E",
                authorEmail: "e2e@example.invalid",
                timestamp: "2026-06-01T12:00:00+00:00",
              };
              history = [revision, ...history];
              return revision;
            }
            case "git_read_revision_files":
              return filesByRevision[args.rev] ?? filesByRevision[history[0]?.id] ?? {};
            case "git_restore_revision":
              return { backupBranch: "esco-backup/e2e", revision: history.find((rev) => rev.id === args.rev) ?? history[0] };
            case "git_create_branch":
              currentBranch = String(args.name || "work-copy").replace(/\s+/g, "-");
              return status();
            case "git_switch_branch":
              currentBranch = String(args.name || "main");
              return status();
            case "git_add_remote":
              remotes.splice(0, remotes.length, { name: args.name, url: args.url });
              return status();
            case "git_pull_remote":
              return { ok: true, conflicts: false, backupBranch: null, message: "The project is up to date with the remote." };
            case "git_push_remote":
              return { ok: true, conflicts: false, backupBranch: null, message: "Your versions were sent to the remote." };
            default:
              return undefined;
          }
        },
      },
    };
  });
};

const vcsCalls = async (page) => page.evaluate(() => window.__vcsCalls ?? []);
const waitForStudioShell = (page) => page.locator(".esco-titlebar").waitFor({ timeout: 30000 });

const browser = await chromium.launch({ channel: "msedge", headless: true });
let pageError = "";

try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
  page.setDefaultTimeout(10000);
  page.on("pageerror", (error) => {
    pageError = error.message;
    console.log("PAGEERROR:", error.message);
  });

  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await waitForStudioShell(page);
  await createBlankProject(page);
  await dismissToasts(page);

  await page.locator('.esco-ribbon__tab:has-text("View")').click();
  const historyItem = page.locator('.esco-ribbon-menu__item:has-text("Project History")');
  check("View menu lists Project History", (await historyItem.count()) > 0);

  await historyItem.first().click();
  await page.locator(".esco-vcs").waitFor({ timeout: 8000 });
  await page.locator(".esco-vcs", { hasText: /desktop app/i }).waitFor({ timeout: 8000 });
  check("Project History view renders", (await page.locator(".esco-vcs").count()) === 1);

  const heading = await page.locator(".esco-vcs h2").first().innerText().catch(() => "");
  check("Project History view shows its heading", /Project History/i.test(heading), heading);

  const bodyText = (await page.locator(".esco-vcs").innerText()).replace(/\s+/g, " ");
  check("explains it runs in the desktop app", /desktop app/i.test(bodyText), bodyText);
  check(
    "no raw Git terms in the main Project History surface",
    !/\bgit\b|\bcommit\b|\bbranch\b|\brepository\b/i.test(bodyText),
    bodyText,
  );
  check("browser build does not expose inert setup buttons", (await page.locator('.esco-vcs button:has-text("Set Up Project History")').count()) === 0);
  await page.locator('.esco-ribbon__tab:has-text("Tools")').click();
  await page.locator('.esco-ribbon-menu__item:has-text("Git")').click();
  await page.locator(".esco-toast", { hasText: /desktop app/i }).waitFor({ timeout: 8000 });
  check("browser Git terminal action shows an actionable guarded message", true);
  check("no runtime page errors", pageError === "", pageError);
  await page.close();

  pageError = "";
  const desktopPage = await browser.newPage({ viewport: { width: 1400, height: 950 } });
  desktopPage.setDefaultTimeout(10000);
  desktopPage.on("pageerror", (error) => {
    pageError = error.message;
    console.log("PAGEERROR:", error.message);
  });

  await desktopPage.goto(URL, { waitUntil: "domcontentloaded" });
  await waitForStudioShell(desktopPage);
  await createBlankProject(desktopPage);
  await installFakeDesktopVcs(desktopPage);

  await openMenuCommand(desktopPage, "View", "Project History");
  await desktopPage.locator('.esco-vcs button:has-text("Set Up Project History")').waitFor({ timeout: 8000 });
  await desktopPage.locator('.esco-vcs button:has-text("Set Up Project History")').click();
  await desktopPage.locator('.esco-vcs__actions button:has-text("Save Version")').waitFor({ timeout: 8000 });

  check("desktop setup initializes a local history folder", (await vcsCalls(desktopPage)).some((call) => call.command === "git_init_repo"));
  check(
    "compare is guarded before the first saved version",
    await desktopPage.locator('.esco-vcs__actions button:has-text("Compare Changes")').isDisabled(),
  );
  check(
    "work-copy creation is guarded before the first saved version",
    await desktopPage.locator('.esco-vcs__actions button:has-text("Create Work Copy")').isDisabled(),
  );
  await desktopPage.locator(".esco-vcs__notice", { hasText: /Save a first version/i }).waitFor({ timeout: 8000 });
  const guardedText = (await desktopPage.locator(".esco-vcs__notice").innerText()).replace(/\s+/g, " ");
  check("guarded state explains the next action", /Save a first version/i.test(guardedText), guardedText);

  await desktopPage.locator('.esco-vcs__actions button:has-text("Save Version")').click();
  await desktopPage.locator(".esco-vcs__inline-input").fill("Initial save");
  await desktopPage.locator('.esco-vcs__inline button:has-text("Save Version")').click();
  await desktopPage.locator('.esco-vcs__rev-msg:has-text("Initial save")').waitFor({ timeout: 8000 });

  const afterSaveCalls = await vcsCalls(desktopPage);
  const saveCall = afterSaveCalls.find((call) => call.command === "git_create_revision");
  check("Save Version invokes the desktop git-backed command", !!saveCall, JSON.stringify(afterSaveCalls.map((call) => call.command)));
  check(
    "Save Version sends the project bundle to the backend",
    !!(saveCall?.args?.files?.["project.json"] || saveCall?.args?.files?.["project.plcproj.json"]),
  );
  check(
    "compare unlocks after a saved version exists",
    !(await desktopPage.locator('.esco-vcs__actions button:has-text("Compare Changes")').isDisabled()),
  );

  await desktopPage.locator('.esco-vcs__actions button:has-text("Compare Changes")').click();
  await desktopPage.locator('.esco-empty:has-text("No engineering changes")').waitFor({ timeout: 8000 });
  check("Compare Changes reads saved revision files", (await vcsCalls(desktopPage)).some((call) => call.command === "git_read_revision_files"));

  await desktopPage.locator('.esco-vcs__rev-actions button:has-text("Restore")').first().click();
  await acceptConfirmation(desktopPage);
  await desktopPage.waitForFunction(() => (window.__vcsCalls ?? []).some((call) => call.command === "git_restore_revision"));
  check("Restore invokes the desktop git-backed command", true);

  const createWorkCopyButton = desktopPage.locator('.esco-vcs__actions button:has-text("Create Work Copy")');
  await desktopPage.waitForFunction(() => {
    const button = Array.from(document.querySelectorAll(".esco-vcs__actions button")).find((node) =>
      node.textContent?.includes("Create Work Copy"),
    );
    return !!button && !button.disabled;
  });
  await createWorkCopyButton.click();
  await desktopPage.locator(".esco-vcs__inline-input").fill("Trial Run");
  await desktopPage.locator('.esco-vcs__inline button:has-text("Create")').click();
  await desktopPage.locator('.esco-vcs__chip:has-text("Trial-Run")').waitFor({ timeout: 8000 });
  check("Create Work Copy invokes the branch command", (await vcsCalls(desktopPage)).some((call) => call.command === "git_create_branch"));

  await desktopPage.locator('.esco-vcs__actions button:has-text("Sync Project")').click();
  await desktopPage.locator('.esco-vcs__inline-label:has-text("Remote address")').waitFor({ timeout: 8000 });
  await desktopPage.locator(".esco-vcs__inline-input").fill("https://example.invalid/esco/project.git");
  await desktopPage.locator('.esco-vcs__inline button:has-text("Save Remote")').click();
  await desktopPage.locator('.esco-vcs__remotes:has-text("https://example.invalid/esco/project.git")').waitFor({ timeout: 8000 });
  check("remote setup invokes the add-remote command", (await vcsCalls(desktopPage)).some((call) => call.command === "git_add_remote"));

  await desktopPage.locator('.esco-vcs__actions button:has-text("Sync Project")').click();
  await desktopPage.waitForFunction(() => {
    const calls = window.__vcsCalls ?? [];
    return calls.some((call) => call.command === "git_pull_remote") && calls.some((call) => call.command === "git_push_remote");
  });
  check("Sync Project pulls then pushes through the backend", true);
  check("desktop VCS flow has no runtime page errors", pageError === "", pageError);
  await desktopPage.close();
} catch (error) {
  check("driver completed without throwing", false, error?.message ?? String(error));
} finally {
  await browser.close();
}

const passed = results.filter(Boolean).length;
console.log(`SUMMARY: ${passed}/${results.length}`);
process.exit(passed === results.length ? 0 : 1);
