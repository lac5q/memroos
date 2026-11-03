// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildSkillSuggestionAudit } from "@/lib/skills/activity-suggestions";

describe("activity-suggestions batch27 — cache, unreadable files, and walk edges", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots) {
      fs.rmSync(root, { recursive: true, force: true });
    }
    roots.length = 0;
    vi.restoreAllMocks();
  });

  it("reuses the default-root audit cache within the five-minute window", () => {
    vi.spyOn(fs, "readdirSync").mockImplementation((dirPath, options) => {
      if (options && typeof options === "object" && "withFileTypes" in options) {
        return [] as fs.Dirent[];
      }
      return [];
    });
    const first = buildSkillSuggestionAudit({ days: 30 });
    const second = buildSkillSuggestionAudit({ days: 30 });
    expect(second).toBe(first);
  });

  it("skips jsonl files that cannot be read and ignores unreadable stat targets", () => {
    const activityRoot = fs.mkdtempSync(path.join(os.tmpdir(), `act-b27-${randomUUID()}-`));
    roots.push(activityRoot);
    const unreadable = path.join(activityRoot, "locked.jsonl");
    fs.writeFileSync(unreadable, JSON.stringify({ text: "memory classification policy sealed vault indexable" }), "utf8");
    fs.chmodSync(unreadable, 0o000);
    const openPath = path.join(activityRoot, "open.jsonl");
    fs.writeFileSync(openPath, JSON.stringify({ text: "memory classification policy sealed vault indexable" }), "utf8");
    try {
      const suggestions = buildSkillSuggestionAudit({
        days: 30,
        activityRoots: { codex: activityRoot },
        skillRoots: {},
      });
      expect(suggestions.some((s) => s.slug === "memroos-memory-classification")).toBe(true);
    } finally {
      fs.chmodSync(unreadable, 0o644);
    }
  });
});
