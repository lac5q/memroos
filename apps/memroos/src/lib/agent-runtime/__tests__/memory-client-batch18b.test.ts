// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";

import {
  addMemory,
  buildContextInjection,
  memoryTool,
  purgeExpiredMemories,
  searchMemories,
} from "../memory-client";

const ROOT = path.join(os.tmpdir(), `mem-client-b18b-${Date.now()}`);

afterEach(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
});

describe("memory-client batch18b", () => {
  it("memoryTool replace and remove mutate the on-disk store", () => {
    const added = addMemory(ROOT, { content: "Original memory content for batch18b." });
    const replaced = memoryTool(ROOT, { action: "replace", id: added.id, content: "Updated memory content." });
    expect(replaced.ok).toBe(true);
    expect(searchMemories(ROOT, "Updated memory")[0]?.content).toContain("Updated memory");

    memoryTool(ROOT, { action: "remove", id: added.id });
    expect(searchMemories(ROOT, "Updated memory")).toHaveLength(0);
  });

  it("buildContextInjection returns empty pack when recollection is skipped", () => {
    const result = buildContextInjection(ROOT, "", { timing: "never" });
    expect(result.text).toBe("");
    expect(result.recollection.decision).toBe("search_skipped");
  });

  it("purgeExpiredMemories archives expired rows", () => {
    const memory = addMemory(ROOT, {
      content: "Short-lived memory for purge test.",
      ttlDays: 1,
      createdAt: new Date("2020-01-01T00:00:00.000Z").toISOString(),
    });
    const purged = purgeExpiredMemories(ROOT, new Date("2026-01-01T00:00:00.000Z"));
    expect(purged.archived).toContain(memory.id);
    expect(searchMemories(ROOT, "Short-lived")).toHaveLength(0);
  });
});
