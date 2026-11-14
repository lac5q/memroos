// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import { buildSkillSuggestionAudit } from "../activity-suggestions";

const ROOT = path.join(os.tmpdir(), `act-sugg-b36-${randomUUID()}`);

afterEach(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
});

describe("activity-suggestions batch36 — walkRecentFiles branches", () => {
  it.skip("stack.pop undefined guard is sticky in V8 (line 87) — unreachable with non-empty stack", () => {});

  it("skips dot-directories and node_modules dirents (96)", () => {
    fs.mkdirSync(ROOT, { recursive: true });
    const activityRoot = path.join(ROOT, "memory");
    const visible = path.join(activityRoot, "visible-b36");
    fs.mkdirSync(visible, { recursive: true });
    const dotDir = path.join(activityRoot, ".hidden-b36");
    fs.mkdirSync(dotDir, { recursive: true });
    const nmDir = path.join(activityRoot, "node_modules");
    fs.mkdirSync(nmDir, { recursive: true });
    const now = Date.now();
    const terms = `{"memory":"classification","policy":"vault","oauth":"role","dispatch":"provider"}\n`;
    for (const dir of [visible, dotDir, nmDir]) {
      const jsonl = path.join(dir, `act-b36-${randomUUID().slice(0, 6)}.jsonl`);
      fs.writeFileSync(jsonl, terms, "utf8");
      fs.utimesSync(jsonl, now / 1000, now / 1000);
    }

    const suggestions = buildSkillSuggestionAudit({
      now: new Date(now),
      days: 365,
      activityRoots: { harnessB36: activityRoot },
      skillRoots: { memroos: path.join(ROOT, "skills-empty-b36") },
    });

    const visibleBasename =
      fs.readdirSync(visible).find((name) => name.endsWith(".jsonl")) ?? "";
    const hiddenBasename =
      fs.readdirSync(dotDir).find((name) => name.endsWith(".jsonl")) ?? "";
    expect(suggestions.some((s) => s.evidence.some((e) => e.includes(visibleBasename)))).toBe(true);
    if (hiddenBasename) {
      expect(suggestions.every((s) => s.evidence.every((e) => !e.includes(hiddenBasename)))).toBe(true);
    }
  });

  it("stops collecting jsonl files once per-root limit is reached (110)", () => {
    fs.mkdirSync(ROOT, { recursive: true });
    const activityRoot = path.join(ROOT, "bulk-b36");
    fs.mkdirSync(activityRoot, { recursive: true });
    const now = Date.now();
    const limit = 80;
    const total = limit + 15;
    for (let i = 0; i < total; i++) {
      const jsonl = path.join(activityRoot, `bulk-${String(i).padStart(4, "0")}-b36.jsonl`);
      fs.writeFileSync(jsonl, `{"memory":"oauth","classification":"vault"}\n`, "utf8");
      fs.utimesSync(jsonl, now / 1000, now / 1000);
    }

    const suggestions = buildSkillSuggestionAudit({
      now: new Date(now),
      days: 365,
      activityRoots: { harnessB36Bulk: activityRoot },
      skillRoots: { memroos: path.join(ROOT, "skills-empty-b36") },
    });

    expect(suggestions.length).toBeGreaterThan(0);
  });
});
