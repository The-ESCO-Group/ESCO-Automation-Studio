import { describe, expect, it } from "vitest";
import { createModelCaller } from "./ai-online";

describe("ai-online model caller (opt-in, key safety)", () => {
  it("requires a user key for browser-key mode and gives a clear error", () => {
    expect(() => createModelCaller({ mode: "browser-key" })).toThrow(/API key/i);
    expect(() => createModelCaller({ mode: "browser-key", apiKey: "   " })).toThrow(/API key/i);
  });

  it("does not require a browser key for proxy mode (key lives on the server)", () => {
    expect(typeof createModelCaller({ mode: "proxy" })).toBe("function");
  });

  it("returns a caller function when a key is supplied", () => {
    expect(typeof createModelCaller({ mode: "browser-key", apiKey: "sk-ant-test" })).toBe("function");
  });
});
