// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";

import { addMemory, memoryTool, purgeExpiredMemories, searchMemories } from "../memory-client";

const ROOT = path.join(os.tmpdir(), `mem-client-b19-${Date.now()}`);

afterEach(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
});

describe("memory-client batch19", () => {
  it("readStore returns empty list when store JSON is corrupted", () => {
    fs.mkdirSync(path.join(ROOT, "memory"), { recursive: true });
    fs.writeFileSync(path.join(ROOT, "memory", "store.json"), "{not-json", "utf8");
    expect(searchMemories(ROOT, "anything")).toEqual([]);
  });

  it("purgeExpiredMemories keeps ttlDays=0 memories regardless of age", () => {
    const memory = addMemory(ROOT, {
      content: "Permanent memory batch19.",
      ttlDays: 0,
      createdAt: new Date("2000-01-01T00:00:00.000Z").toISOString(),
    });
    const purged = purgeExpiredMemories(ROOT, new Date("2030-01-01T00:00:00.000Z"));
    expect(purged.archived).not.toContain(memory.id);
    expect(searchMemories(ROOT, "Permanent memory")).toHaveLength(1);
  });

  it("memoryTool rejects unsupported actions", () => {
    const result = memoryTool(ROOT, { action: "explode" as "add" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("unsupported action");
  });
});
