// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";

import {
  buildMemroosMcpConfig,
  createAgentOnboardingToken,
  shellQuote,
  verifyAgentOnboardingToken,
} from "@/lib/agent-onboarding";

const ORIGINAL_SECRET = process.env.MEMROOS_ONBOARDING_SECRET;

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) {
    delete process.env.MEMROOS_ONBOARDING_SECRET;
  } else {
    process.env.MEMROOS_ONBOARDING_SECRET = ORIGINAL_SECRET;
  }
});

describe("agent-onboarding", () => {
  it("creates and verifies a token with normalized URLs", () => {
    process.env.MEMROOS_ONBOARDING_SECRET = "test-onboarding-secret";
    const { token, payload } = createAgentOnboardingToken({
      memroosUrl: "https://memroos.example/",
      mcpUrl: "https://memroos.example/mcp/",
      ttlSeconds: 3600,
      allowedAgentIds: ["agent-a"],
    });

    expect(payload.memroosUrl).toBe("https://memroos.example");
    expect(payload.mcpUrl).toBe("https://memroos.example/mcp");
    expect(payload.allowedAgentIds).toEqual(["agent-a"]);

    const verified = verifyAgentOnboardingToken(token);
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.payload.memroosUrl).toBe("https://memroos.example");
    }
  });

  it("rejects tampered signatures and malformed tokens", () => {
    process.env.MEMROOS_ONBOARDING_SECRET = "test-onboarding-secret";
    const { token } = createAgentOnboardingToken({
      memroosUrl: "https://memroos.example",
    });
    const [body, sig] = token.split(".");
    const badSig = `${body}.${sig!.slice(0, -1)}x`;
    expect(verifyAgentOnboardingToken(badSig)).toEqual({
      ok: false,
      error: "Invalid onboarding token signature",
    });
    expect(verifyAgentOnboardingToken("not-a-jwt")).toEqual({
      ok: false,
      error: "Invalid onboarding token",
    });
  });

  it("rejects expired tokens", () => {
    process.env.MEMROOS_ONBOARDING_SECRET = "test-onboarding-secret";
    const { token } = createAgentOnboardingToken({
      memroosUrl: "https://memroos.example",
      ttlSeconds: -10,
    });
    const result = verifyAgentOnboardingToken(token);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("Onboarding token expired");
    }
  });

  it("buildMemroosMcpConfig and shellQuote", () => {
    expect(buildMemroosMcpConfig("https://host/mcp/")).toEqual({
      mcpServers: { memroos: { url: "https://host/mcp" } },
    });
    expect(shellQuote("it's fine")).toBe("'it'\\''s fine'");
  });
});
