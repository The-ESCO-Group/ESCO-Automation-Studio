import { describe, expect, it } from "vitest";

/**
 * REGRESSION GUARD — Goal B read-only milestone.
 *
 * This package must not grow controller-mutating request builders without an
 * explicit, separately-reviewed write-path design (confirmation, permission,
 * audit, read-back verification). If this test fails, that review has not
 * happened — do not "fix" the test; remove the export.
 */
describe("read-only by construction", () => {
  it("the package exports no controller-mutating builders", async () => {
    const pkg = await import("./index");
    const mutating = Object.keys(pkg).filter((name) =>
      /(writeTag|readModifyWrite|writeFragmented|download|onlineEdit|modeChange|clearFault|forceTag|setAttribute)/i.test(
        name,
      ),
    );
    expect(mutating).toEqual([]);
  });

  it("the package opens no sockets (no transport in this slice)", async () => {
    const pkg = await import("./index");
    // "Unconnected Send" / Connection Manager / TRANSPORT_CLASS_3_SERVER are
    // CIP codec names and protocol constants, not transports — match actual
    // transport ENTRY POINTS only (classes/factories/sockets).
    const transportLike = Object.keys(pkg).filter(
      (name) =>
        /(socket|dial|createConnection|tcp)/i.test(name) ||
        /Transport$/.test(name) ||
        /^create.*Transport/i.test(name),
    );
    expect(transportLike).toEqual([]);
  });
});
