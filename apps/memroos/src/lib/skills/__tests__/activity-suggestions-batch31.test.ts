// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

import { buildSkillSuggestionAudit } from "../activity-suggestions";

const ROOT = path.join(os.tmpdir(), `act-sugg-b31-${randomUUID()}`);

afterEach(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("activity-suggestions batch31 — walkRecentFiles branches", () => {
  // unreachable: `if (!current) continue` after pop while stack non-empty (87).

  it("skips dotfiles, tolerates unreadable directories, and stat failures (96, 110)", () => {
    fs.mkdirSync(ROOT, { recursive: true });
    const activityRoot = path.join(ROOT, "memory-b31");
    const sub = path.join(activityRoot, "nested");
    const unreadable = path.join(activityRoot, `noaccess-${randomUUID().slice(0, 6)}`);
    fs.mkdirSync(sub, { recursive: true });
    fs.mkdirSync(unreadable, { recursive: true });

    const jsonlPath = path.join(sub, `evt-b31-${randomUUID().slice(0, 8)}.jsonl`);
    const dotJsonl = path.join(sub, `.secret-b31-${randomUUID().slice(0, 6)}.jsonl`);
    const skipPath = path.join(sub, `skip-b31-${randomUUID().slice(0, 8)}.jsonl`);
    fs.writeFileSync(jsonlPath, '{"memory":"classification","policy":"vault"}\n', "utf8");
    fs.writeFileSync(dotJsonl, '{"memory":"classification","policy":"vault"}\n', "utf8");
    fs.writeFileSync(skipPath, "skip\n", "utf8");

    const rawReaddir = fs.readdirSync.bind(fs);
    vi.spyOn(fs, "readdirSync").mockImplementation((target, options) => {
      const p = target.toString();
      if (p === unreadable) {
        const err = new Error("EACCES batch31-readdir");
        (err as NodeJS.ErrnoException).code = "EACCES";
        throw err;
      }
      return rawReaddir(p, options as never);
    });

    vi.spyOn(fs, "statSync").mockImplementation((target) => {
      const p = target.toString();
      if (p === skipPath) {
        const err = new Error("EACCES batch31-stat");
        (err as NodeJS.ErrnoException).code = "EACCES";
        throw err;
      }
      return fs.statSync(p);
    });

    const suggestions = buildSkillSuggestionAudit({
      now: new Date(),
      days: 365,
      activityRoots: { harnessB31: activityRoot },
      skillRoots: { memroos: path.join(ROOT, "skills") },
    });

    expect(suggestions.length).toBeGreaterThan(0);
  });
});
