// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  chatRuntimeStatus,
  isProviderLimitError,
  normalizeModel,
  recordChatRuntimeFailure,
  recordChatRuntimeSuccess,
} from "../chat-runtime";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("chat-runtime batch28d — provider limits and model aliases", () => {
  it("isProviderLimitError detects rate limit and quota messages", () => {
    expect(isProviderLimitError("rate_limit_error: slow down batch28d")).toBe(true);
    expect(isProviderLimitError("HTTP 429 too many requests")).toBe(true);
    expect(isProviderLimitError("plain failure batch28d")).toBe(false);
  });

  it("normalizeModel strips quotes and applies aliases", () => {
    expect(normalizeModel('"claude-3-5-sonnet-20241022"')).toBe("claude-3-5-sonnet-20241022");
    expect(normalizeModel("unknown-model-batch28d")).toBe("unknown-model-batch28d");
  });

  it("recordChatRuntimeFailure and success update runtime status", () => {
    vi.stubEnv("MEMROOS_ENABLE_OPENCODE", "true");
    const runtime = { runner: "opencode" as const, model: "qwen/batch28d" };
    recordChatRuntimeFailure(runtime, "usage limit exceeded batch28d");
    expect(chatRuntimeStatus(runtime).status).toBe("blocked");
    recordChatRuntimeSuccess(runtime);
    expect(chatRuntimeStatus(runtime).status).toBe("ready");
  });
});
