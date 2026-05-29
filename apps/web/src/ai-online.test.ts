import { afterEach, describe, expect, it, vi } from "vitest";
import { createModelCaller } from "./ai-online";

describe("ai-online model caller (opt-in, key safety)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requires a user key for browser-key mode and gives a clear error", () => {
    expect(() => createModelCaller({ mode: "browser-key" })).toThrow(/API key/i);
    expect(() => createModelCaller({ mode: "browser-key", apiKey: "   " })).toThrow(/API key/i);
  });

  it("does not require a browser key for proxy mode (key lives on the server)", () => {
    expect(typeof createModelCaller({ mode: "proxy" })).toBe("function");
  });

  it("returns a caller function when a key is supplied", () => {
    expect(typeof createModelCaller({ mode: "browser-key", apiKey: "sk-ant-test" })).toBe("function");
    expect(typeof createModelCaller({ mode: "browser-key", provider: "openai", modelId: "gpt-4.1", apiKey: "sk-test" })).toBe("function");
  });

  it("sends OpenAI keys to the OpenAI chat-completions transport with the selected model", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { model: string; tools: unknown[]; messages: unknown[] };
      expect(_url).toBe("https://api.openai.com/v1/chat/completions");
      expect((init.headers as Record<string, string>).authorization).toBe("Bearer sk-openai");
      expect(body.model).toBe("gpt-4.1");
      expect(body.tools).toHaveLength(1);
      expect(body.messages[0]).toMatchObject({ role: "system" });
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }] }),
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const caller = createModelCaller({
      mode: "browser-key",
      provider: "openai",
      modelId: "gpt-4.1",
      apiKey: "sk-openai",
    });
    const result = await caller({
      model: "ignored",
      max_tokens: 100,
      system: "system",
      tools: [{ name: "get_project_overview", description: "read", input_schema: { type: "object" } }],
      messages: [{ role: "user", content: "hello" }],
    });
    expect(result.content[0]?.text).toBe("ok");
  });
});
