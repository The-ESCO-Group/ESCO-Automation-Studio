import { describe, expect, it } from "vitest";
import { createSimProject } from "./project";
import {
  buildCompatReview,
  COMPAT_HELPERS,
  compatExportFindings,
  compatReviewToCsv,
  compatReviewToJson,
} from "./compat";
import { collectAllTags } from "./tags";

const NOW = () => "2026-01-01T00:00:00.000Z";

function project() {
  return createSimProject({ name: "Compat Test", processType: "skid", now: NOW });
}

describe("compatibility review/export helpers", () => {
  it.each(COMPAT_HELPERS.map((h) => h.id))("builds an offline review for '%s'", (id) => {
    const p = project();
    const review = buildCompatReview(p, id);
    expect(review.offline.realControllerIo).toBe(false);
    expect(review.offline.proprietaryBinaryTouched).toBe(false);
    expect(review.notice).toMatch(/offline/i);
    expect(review.items.length).toBe(collectAllTags(p).length);
    expect(review.readiness.total).toBe(review.items.length);
    expect(review.connectionLog.length).toBeGreaterThan(0);
  });

  it("uses copyright-safe ESCO labels", () => {
    expect(buildCompatReview(project(), "ignitionReview").label).toBe("Ignition Gateway Export Review");
    expect(buildCompatReview(project(), "optixReview").label).toBe("Optix Migration Review");
    expect(buildCompatReview(project(), "opcUa").label).toBe("OPC UA Simulator");
  });

  it("reports unsupported items and never opens a real endpoint", () => {
    const review = buildCompatReview(project(), "modbusTcp");
    expect(review.unsupported.some((u) => /no socket|offline simulator/i.test(u))).toBe(true);
    expect(review.connectionLog.some((l) => /no socket opened/i.test(l))).toBe(true);
    const findings = compatExportFindings(review);
    expect(findings.some((f) => f.ruleId === "compat-unsupported")).toBe(true);
  });

  it("maps Modbus BOOL to coils and numeric to holding registers", () => {
    const review = buildCompatReview(project(), "modbusTcp");
    expect(review.items.some((i) => i.dataType === "BOOL" && i.mapped.startsWith("coil"))).toBe(true);
    expect(review.items.some((i) => i.dataType !== "BOOL" && i.mapped.startsWith("holding"))).toBe(true);
  });

  it("serializes to JSON and CSV", () => {
    const review = buildCompatReview(project(), "opcUa");
    expect(JSON.parse(compatReviewToJson(review)).helper).toBe("opcUa");
    const csv = compatReviewToCsv(review);
    expect(csv.split("\r\n")[0]).toContain("Source Tag");
    expect(csv).toContain("ns=2;s=ESCO.Sim.");
  });
});
