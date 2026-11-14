// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

const getDb = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  getDb: () => getDb(),
  closeDb: () => {},
}));

vi.mock("@/lib/tool-auth/nango-client", () => ({
  listNangoConnections: vi.fn(),
  fetchNangoCredentials: vi.fn(),
}));

vi.mock("../mcp-client", () => ({
  callTool: vi.fn(),
  callRest: vi.fn(),
  initialize: vi.fn(),
}));

describe("sync-job batch36 — interval error handler (329)", () => {
  const envSnapshot = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    getDb.mockImplementation(() => {
      throw new Error(`db-b36-${randomUUID().slice(0, 6)}`);
    });
  });

  afterEach(() => {
    process.env = { ...envSnapshot };
    vi.restoreAllMocks();
  });

  it("startConnectorJob logs when runConnectorCycle rejects before try/catch", async () => {
    process.env.NANGO_SECRET_KEY = `nango-b36-${randomUUID()}`;
    let tick: (() => void) | undefined;
    const intervalSpy = vi.spyOn(global, "setInterval").mockImplementation((fn) => {
      tick = fn as () => void;
      return { unref: vi.fn() } as never;
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { startConnectorJob } = await import("../sync-job");
    startConnectorJob();
    await Promise.resolve(tick?.());
    expect(errSpy).toHaveBeenCalledWith(
      "[connectors] unhandled sync error:",
      expect.objectContaining({ message: expect.stringMatching(/^db-b36-/) }),
    );
    intervalSpy.mockRestore();
    errSpy.mockRestore();
  });
});
