// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/recollection-policy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/recollection-policy")>();
  return {
    ...actual,
    decideRecollection: vi.fn(() => ({
      decision: "search",
      queries: [{ text: "batch27 topic", limit: 5 }],
    })),
    assembleRecollectionContextPack: vi.fn((_candidates, _opts) => ({
      injected: [{ id: "missing-memory-id-b27", content: "orphan injected item", caveatReason: null }],
      ignored: [],
    })),
  };
});

import { addMemory, buildContextInjection } from "../memory-client";

const ROOT = path.join(os.tmpdir(), `memory-client-b27-${crypto.randomUUID()}`);

afterEach(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
});

describe("memory-client batch27 — context injection orphan ids", () => {
  it("buildContextInjection skips injected items that are not present in search results", () => {
    addMemory(ROOT, { content: "batch27 stored memory content for search" });
    const result = buildContextInjection(ROOT, "batch27 topic", { maxChars: 500, limit: 5 });
    expect(result.memories).toHaveLength(0);
    expect(result.text).toBe("");
  });
});
