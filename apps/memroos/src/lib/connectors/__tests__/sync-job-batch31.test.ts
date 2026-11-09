// @vitest-environment node
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tool-auth/nango-client", () => ({
  listNangoConnections: vi.fn(),
  fetchNangoCredentials: vi.fn(),
}));

vi.mock("../mcp-client", () => ({
  callTool: vi.fn(),
  callRest: vi.fn(),
  initialize: vi.fn(),
}));

import { listNangoConnections } from "@/lib/tool-auth/nango-client";

const mockListConnections = vi.mocked(listNangoConnections);

describe("connector sync-job batch31", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    delete process.env.NANGO_SECRET_KEY;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.NANGO_SECRET_KEY;
    vi.resetModules();
  });

  it("fires interval callback that invokes runConnectorCycle (lines 327–328)", async () => {
    process.env.NANGO_SECRET_KEY = "nango-key-b31";
    mockListConnections.mockResolvedValue([]);
    let captured: (() => void) | undefined;
    const intervalSpy = vi.spyOn(global, "setInterval").mockImplementation((fn) => {
      captured = fn as () => void;
      return { unref: vi.fn() } as never;
    });
    const { startConnectorJob } = await import("../sync-job");
    startConnectorJob();
    expect(intervalSpy).toHaveBeenCalled();
    await captured?.();
    expect(mockListConnections).toHaveBeenCalled();
    intervalSpy.mockRestore();
    vi.resetModules();
    await import("../sync-job");
  });

  it("startConnectorJob is a no-op when NANGO_SECRET_KEY is unset (line 322)", async () => {
    const intervalSpy = vi.spyOn(global, "setInterval");
    const { startConnectorJob } = await import("../sync-job");
    startConnectorJob();
    expect(intervalSpy).not.toHaveBeenCalled();
    intervalSpy.mockRestore();
  });
});
