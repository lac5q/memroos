// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import { SdkBackedEvalService } from "../sdk-eval-service";

describe("SdkBackedEvalService batch33b", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("publicApiPost surfaces statusText when error body is not JSON (45)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("plain-text-batch33b", { status: 500, statusText: "Server Error B33B" })),
    );
    const service = new SdkBackedEvalService({
      baseUrl: "http://localhost:3000",
      apiKey: "explicit-batch33b-key-not-default",
    });
    let error: unknown;
    try {
      await service.runForTrace("trace-b33b");
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("Public API error 500");
    expect((error as Error).message).toContain("Server Error B33B");
  });

  it("publicApiGet surfaces statusText when error body is not JSON (65)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("plain-text-batch33b", { status: 502, statusText: "Bad Gateway B33B" })),
    );
    const service = new SdkBackedEvalService({
      baseUrl: "http://localhost:3000",
      apiKey: "explicit-batch33b-key-not-default",
    });
    let error: unknown;
    try {
      await service.rescoreForProposal({
        traceId: "trace-b33b",
        agentId: "agent-b33b",
        baselineRunId: "run-b33b",
        proposalType: "noop",
        diff: {},
        forecastWDelta: 0,
      });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("Public API error 502");
    expect((error as Error).message).toContain("Bad Gateway B33B");
  });
});
