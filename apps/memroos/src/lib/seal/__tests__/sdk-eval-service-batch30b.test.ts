// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SdkBackedEvalService } from "../sdk-eval-service";

describe("SdkBackedEvalService batch30b — HTTP error JSON fallbacks", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("runForTrace throws when trace POST returns non-JSON body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: "trace post failed b30b" }, { status: 502 })),
    );
    const service = new SdkBackedEvalService({
      baseUrl: "http://localhost:3000",
      apiKey: "explicit-batch30b-key-not-default",
    });
    let error: unknown;
    try {
      await service.runForTrace("trace-b30b");
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("Public API error 502");
  });

  it("rescoreForProposal throws when baseline GET fails with malformed JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: "baseline unavailable b30b" }, { status: 503 })),
    );
    const service = new SdkBackedEvalService({
      baseUrl: "http://localhost:3000",
      apiKey: "explicit-batch30b-key-not-default",
    });
    let rescoreError: unknown;
    try {
      await service.rescoreForProposal({
        traceId: "t",
        agentId: "a",
        baselineRunId: "run-missing",
        proposalType: "noop",
        diff: {},
        forecastWDelta: 0,
      });
    } catch (e) {
      rescoreError = e;
    }
    expect(rescoreError).toBeInstanceOf(Error);
    expect((rescoreError as Error).message).toContain("Public API error 503");
  });
});
