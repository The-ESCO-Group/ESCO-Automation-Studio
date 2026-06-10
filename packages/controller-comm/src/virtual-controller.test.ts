import { describe, expect, it } from "vitest";
import {
  ESCO_VIRTUAL_PATHS,
  VirtualControllerSession,
  type ProjectDownloadInput,
  type ProjectIdentity,
} from "./virtual-controller";

let clock = 0;
const now = () => `2026-06-02T12:00:${String(clock++).padStart(2, "0")}.000Z`;

function session() {
  clock = 0;
  return new VirtualControllerSession({ now });
}

const SUMMARY = { controllerName: "ESCO_Controller", taskCount: 1, programCount: 1, routineCount: 2, tagCount: 5 };
const project = (signature: string, valid = true, errors: string[] = []): ProjectDownloadInput => ({
  projectId: "proj-1",
  projectName: "Line A",
  signature,
  valid,
  errors,
  summary: SUMMARY,
});
const identity = (signature: string): ProjectIdentity => ({ projectId: "proj-1", projectName: "Line A", signature });

const EIP_PATH = ESCO_VIRTUAL_PATHS[0]!.id;

describe("initial state", () => {
  it("starts disconnected with default Program mode and no faults", () => {
    const snap = session().getSnapshot();
    expect(snap.state).toBe("disconnected");
    expect(snap.online).toBe(false);
    expect(snap.mode).toBe("program");
    expect(snap.faults).toEqual([]);
    expect(snap.path).toBeNull();
  });

  it("offers the offline ESCO virtualized paths", () => {
    const paths = session().availablePaths();
    expect(paths.map((p) => p.kind)).toEqual(expect.arrayContaining(["ethernet-ip", "local-emulation", "usb-virtual"]));
    expect(paths[0]!.label).toMatch(/EtherNet\/IP/);
  });
});

describe("Set Path", () => {
  it("selects a path, derives controller identity, and records it as recent", () => {
    const s = session();
    const res = s.selectPath(EIP_PATH);
    expect(res.ok).toBe(true);
    const snap = res.snapshot;
    expect(snap.state).toBe("path-selected");
    expect(snap.path?.id).toBe(EIP_PATH);
    expect(snap.identity?.vendor).toBe("ESCO Automation");
    expect(snap.recentPaths[0]!.id).toBe(EIP_PATH);
  });

  it("rejects an unknown path id", () => {
    const res = session().selectPath("does-not-exist");
    expect(res.ok).toBe(false);
    expect(res.level).toBe("error");
  });

  it("moves a re-selected path to the front of recents without duplicates", () => {
    const s = session();
    s.selectPath(EIP_PATH);
    s.selectPath(ESCO_VIRTUAL_PATHS[1]!.id);
    const snap = s.selectPath(EIP_PATH).snapshot;
    expect(snap.recentPaths[0]!.id).toBe(EIP_PATH);
    expect(snap.recentPaths.filter((p) => p.id === EIP_PATH).length).toBe(1);
  });

  it("refuses to change path while online", () => {
    const s = session();
    s.selectPath(EIP_PATH);
    s.goOnline(identity("sig"));
    const res = s.beginBrowsing();
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/Go Offline before changing/i);
  });
});

describe("Go Online", () => {
  it("blocks Go Online when no path is selected", () => {
    const res = session().goOnline(identity("sig"));
    expect(res.ok).toBe(false);
    expect(res.snapshot.online).toBe(false);
    expect(res.message).toMatch(/no communication path/i);
  });

  it("goes online but reports no-project when nothing was downloaded", () => {
    const s = session();
    s.selectPath(EIP_PATH);
    const res = s.goOnline(identity("sig-a"));
    expect(res.ok).toBe(true);
    expect(res.snapshot.online).toBe(true);
    expect(res.snapshot.matchStatus).toBe("no-project");
    expect(res.snapshot.faults.some((f) => f.code === "VC-NOPROJ")).toBe(true);
    expect(res.snapshot.lastOnlineAt).toBeDefined();
  });

  it("reports matched when the offline signature equals the downloaded image", () => {
    const s = session();
    s.selectPath(EIP_PATH);
    s.download(project("sig-match"));
    const res = s.goOnline(identity("sig-match"));
    expect(res.snapshot.matchStatus).toBe("matched");
    expect(res.snapshot.faults).toEqual([]);
  });

  it("reports mismatch and faults when the offline signature differs", () => {
    const s = session();
    s.selectPath(EIP_PATH);
    s.download(project("sig-controller"));
    const res = s.goOnline(identity("sig-offline"));
    expect(res.snapshot.matchStatus).toBe("mismatch");
    expect(res.snapshot.faults.some((f) => f.code === "VC-MISMATCH")).toBe(true);
  });
});

describe("Download", () => {
  it("blocks download without a path", () => {
    const res = session().download(project("sig"));
    expect(res.ok).toBe(false);
    expect(res.snapshot.snapshot).toBeNull();
  });

  it("blocks download when validation has hard errors and seeds validation faults", () => {
    const s = session();
    s.selectPath(EIP_PATH);
    const res = s.download(project("sig", false, ["Tag X has no data type", "Rung 2 malformed"]));
    expect(res.ok).toBe(false);
    expect(res.snapshot.state).toBe("faulted");
    expect(res.snapshot.faults.filter((f) => f.source === "validation").length).toBe(2);
    expect(res.snapshot.snapshot).toBeNull();
  });

  it("stores a snapshot + signature and goes online in Program mode on success", () => {
    const s = session();
    s.selectPath(EIP_PATH);
    const res = s.download(project("sig-dl"));
    expect(res.ok).toBe(true);
    expect(res.snapshot.online).toBe(true);
    expect(res.snapshot.mode).toBe("program");
    expect(res.snapshot.snapshot?.signature).toBe("sig-dl");
    expect(res.snapshot.onlineSignature).toBe("sig-dl");
    expect(res.snapshot.lastDownloadAt).toBeDefined();
    expect(res.snapshot.matchStatus).toBe("matched");
  });

  it("clears prior validation faults on a clean re-download", () => {
    const s = session();
    s.selectPath(EIP_PATH);
    s.download(project("sig", false, ["bad"]));
    const res = s.download(project("sig-ok"));
    expect(res.snapshot.faults.filter((f) => f.source === "validation")).toEqual([]);
  });
});

describe("Upload", () => {
  it("warns when there is no downloaded image to upload", () => {
    const s = session();
    s.selectPath(EIP_PATH);
    const res = s.upload();
    expect(res.ok).toBe(false);
    expect(res.uploaded).toBeNull();
    expect(res.message).toMatch(/nothing to upload/i);
  });

  it("returns the stored snapshot and records the upload timestamp", () => {
    const s = session();
    s.selectPath(EIP_PATH);
    s.download(project("sig-up"));
    const res = s.upload();
    expect(res.ok).toBe(true);
    expect(res.uploaded?.signature).toBe("sig-up");
    expect(res.uploaded?.summary.controllerName).toBe("ESCO_Controller");
    expect(res.snapshot.lastUploadAt).toBeDefined();
  });
});

describe("Mode changes", () => {
  it("requires an online session to change mode", () => {
    const s = session();
    s.selectPath(EIP_PATH);
    const res = s.setMode("run");
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/Go Online before changing/i);
  });

  it("allows Program mode online and reports edits allowed", () => {
    const s = session();
    s.selectPath(EIP_PATH);
    s.download(project("sig"));
    const res = s.setMode("program");
    expect(res.ok).toBe(true);
    expect(res.snapshot.editsLocked).toBe(false);
  });

  it("blocks Run mode without a downloaded project", () => {
    const s = session();
    s.selectPath(EIP_PATH);
    s.goOnline(null);
    const res = s.setMode("run");
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/requires a downloaded project/i);
  });

  it("allows Run mode with a matching downloaded project and locks edits", () => {
    const s = session();
    s.selectPath(EIP_PATH);
    s.download(project("sig-run"));
    const res = s.setMode("run");
    expect(res.ok).toBe(true);
    expect(res.snapshot.mode).toBe("run");
    expect(res.snapshot.editsLocked).toBe(true);
  });

  it("blocks Run mode when the online image mismatches the offline project", () => {
    const s = session();
    s.selectPath(EIP_PATH);
    s.download(project("sig-ctrl"));
    s.goOnline(identity("sig-other")); // -> mismatch
    const res = s.setMode("remote-run");
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/differs from the controller/i);
  });
});

describe("Faults", () => {
  it("clears clearable faults and recovers from the faulted state", () => {
    const s = session();
    s.selectPath(EIP_PATH);
    s.download(project("sig", false, ["bad"])); // -> faulted with validation fault
    const res = s.clearFaults();
    expect(res.ok).toBe(true);
    expect(res.snapshot.faults).toEqual([]);
    expect(res.snapshot.state).not.toBe("faulted");
  });

  it("reports when there are no faults to clear", () => {
    const res = session().clearFaults();
    expect(res.message).toMatch(/no active faults/i);
  });
});

describe("activity log", () => {
  it("records an ordered, branded activity log across a full session", () => {
    const s = session();
    s.selectPath(EIP_PATH);
    s.download(project("sig-log"));
    s.setMode("run");
    s.upload();
    s.goOffline();
    const actions = s.getSnapshot().log.map((entry) => entry.action);
    expect(actions).toEqual(
      expect.arrayContaining(["set-path", "download", "mode", "upload", "go-offline"]),
    );
    expect(s.getSnapshot().log.every((entry) => typeof entry.message === "string" && entry.message.length > 0)).toBe(true);
  });
});
