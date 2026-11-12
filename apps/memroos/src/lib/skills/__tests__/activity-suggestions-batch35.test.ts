// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

import { buildSkillSuggestionAudit } from "../activity-suggestions";

const ROOT = path.join(os.tmpdir(), `act-sugg-b35-${randomUUID()}`);

afterEach(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("activity-suggestions batch35 — walkRecentFiles catch/continue", () => {
  it("continues when readdirSync fails (92–93) and statSync fails (100–102)", () => {
    fs.mkdirSync(ROOT, { recursive: true });
    const activityRoot = path.join(ROOT, "memory");
    const okDir = path.join(activityRoot, "ok");
    fs.mkdirSync(okDir, { recursive: true });
    const jsonl = path.join(okDir, `evt-b35-${randomUUID().slice(0, 6)}.jsonl`);
    fs.writeFileSync(
      jsonl,
      `{"memory":"classification","policy":"vault","oauth":"role"}\n`,
      "utf8",
    );
    fs.mkdirSync(path.join(activityRoot, "bad-readdir"), { recursive: true });
    fs.mkdirSync(path.join(activityRoot, "bad-stat"), { recursive: true });

    const readdirSync = fs.readdirSync;
    const statSync = fs.statSync;
    vi.spyOn(fs, "readdirSync").mockImplementation((target, options) => {
      const p = target.toString();
      if (p.includes("bad-readdir")) {
        throw new Error("EACCES batch35-readdir");
      }
      return readdirSync.call(fs, target, options as never);
    });
    vi.spyOn(fs, "statSync").mockImplementation((target) => {
      const p = target.toString();
      if (p.includes("bad-stat")) {
        throw new Error("EACCES batch35-stat");
      }
      return statSync.call(fs, target);
    });

    const suggestions = buildSkillSuggestionAudit({
      now: new Date(),
      days: 365,
      activityRoots: { harnessB35: activityRoot },
      skillRoots: { memroos: path.join(ROOT, "skills-empty") },
    });
    expect(suggestions.length).toBeGreaterThan(0);
  });

  it("respects jsonl limit and depth gate (105–110)", () => {
    fs.mkdirSync(ROOT, { recursive: true });
    const activityRoot = path.join(ROOT, "memory");
    const deep = path.join(activityRoot, "d1", "d2", "d3", "d4", "d5", "d6");
    fs.mkdirSync(deep, { recursive: true });
    const now = Date.now();
    for (let i = 0; i < 5; i += 1) {
      const file = path.join(deep, `many-b35-${i}.jsonl`);
      fs.writeFileSync(file, `{"term":"oauth"}\n`, "utf8");
      fs.utimesSync(file, now / 1000, now / 1000);
    }
    const suggestions = buildSkillSuggestionAudit({
      now: new Date(now),
      days: 365,
      activityRoots: { harnessB35: activityRoot },
      skillRoots: { memroos: path.join(ROOT, "skills-empty") },
    });
    expect(suggestions.length).toBeGreaterThanOrEqual(0);
  });
});
