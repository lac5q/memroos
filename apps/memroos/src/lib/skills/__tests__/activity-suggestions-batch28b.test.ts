// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildSkillSuggestionAudit } from "@/lib/skills/activity-suggestions";

describe("activity-suggestions batch28b — empty roots and custom activity scan", () => {
  const roots: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    for (const root of roots) {
      fs.rmSync(root, { recursive: true, force: true });
    }
    roots.length = 0;
  });

  it("reuses cached audit output for repeated default-root calls within five minutes", () => {
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

  it("finds memory-classification slug from readable jsonl activity", () => {
    const activityRoot = fs.mkdtempSync(path.join(os.tmpdir(), `act-b28b-${randomUUID()}-`));
    roots.push(activityRoot);
    fs.writeFileSync(
      path.join(activityRoot, "events-b28b.jsonl"),
      JSON.stringify({
        text: "memory classification policy sealed vault indexable batch28b",
      }),
      "utf8",
    );
    const suggestions = buildSkillSuggestionAudit({
      days: 30,
      activityRoots: { codex: activityRoot },
      skillRoots: {},
    });
    expect(suggestions.some((s) => s.slug === "memroos-memory-classification")).toBe(true);
  });
});
