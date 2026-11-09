// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";

import { addMemory, searchMemories } from "../memory-client";

const ROOT = path.join(os.tmpdir(), `memory-client-b31b-${randomUUID()}`);

afterEach(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
});

describe("memory-client batch31b — corrupt store and empty cosine", () => {
  it("readStore returns [] when memories.json is invalid JSON (line 110)", () => {
    const storeDir = path.join(ROOT, "memory", "v2");
    fs.mkdirSync(storeDir, { recursive: true });
    fs.writeFileSync(path.join(storeDir, "memories.json"), "{not-json", "utf8");

    const created = addMemory(ROOT, { content: "batch31b rebuilt store after corrupt json" });
    expect(created.content).toContain("batch31b rebuilt");
    const hits = searchMemories(ROOT, "batch31b rebuilt", { limit: 3, threshold: 0.1 });
    expect(hits).toHaveLength(1);
  });

  it("searchMemories returns no hits when query tokens are empty (line 142)", () => {
    addMemory(ROOT, { content: "unrelated runtime memory content for cosine guard" });
    expect(searchMemories(ROOT, "!!!", { limit: 5, threshold: 0.01 })).toEqual([]);
  });
});
