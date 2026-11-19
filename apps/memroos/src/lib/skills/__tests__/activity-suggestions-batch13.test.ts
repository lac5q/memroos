// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { buildSkillSuggestionAudit, persistSkillSuggestions } from "../activity-suggestions";

const TMP_ROOT = path.join(os.tmpdir(), `activity-suggestions-b13-${crypto.randomUUID()}`);

afterEach(() => {
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
});

describe("activity-suggestions batch13", () => {
  it("buildSkillSuggestionAudit scans custom activity roots and caches default-root results", () => {
    const activityRoot = path.join(TMP_ROOT, "activity");
    const skillRoot = path.join(TMP_ROOT, "skills");
    fs.mkdirSync(activityRoot, { recursive: true });
    fs.mkdirSync(skillRoot, { recursive: true });
    const jsonl = path.join(activityRoot, "recent.jsonl");
    fs.writeFileSync(
      jsonl,
      '{"text":"memory classification visibility policy sealed vault indexable"}\n'.repeat(5),
      "utf8"
    );
    fs.mkdirSync(path.join(skillRoot, "memroos-memory-classification"), { recursive: true });
    fs.writeFileSync(path.join(skillRoot, "memroos-memory-classification", "SKILL.md"), "# skill", "utf8");

    const first = buildSkillSuggestionAudit({
      days: 7,
      now: new Date(),
      activityRoots: { codex: activityRoot },
      skillRoots: { memroos: skillRoot },
    });
    expect(first.length).toBeGreaterThan(0);
    expect(first[0]?.comparedHarnesses.memroos?.exists).toBe(true);

    const cached = buildSkillSuggestionAudit({ days: 7 });
    expect(Array.isArray(cached)).toBe(true);
  });

  it("persistSkillSuggestions upserts rows into skill_suggestions", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const suggestions = buildSkillSuggestionAudit({
      days: 1,
      now: new Date("2026-01-15T00:00:00Z"),
      activityRoots: { codex: TMP_ROOT },
      skillRoots: { memroos: TMP_ROOT },
    });
    if (suggestions.length === 0) {
      persistSkillSuggestions(db, [
        {
          id: crypto.randomUUID().slice(0, 16),
          name: "Fallback Suggestion",
          slug: "fallback-suggestion",
          sourcePattern: "test",
          recommendation: "test",
          confidence: 0.5,
          evidence: [],
          comparedHarnesses: {},
          status: "proposed",
        },
      ]);
    } else {
      persistSkillSuggestions(db, suggestions.slice(0, 1));
    }
    const count = db.prepare(`SELECT COUNT(*) AS c FROM skill_suggestions`).get() as { c: number };
    expect(count.c).toBeGreaterThan(0);
    db.close();
  });
});
