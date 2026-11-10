// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

import { buildSkillSuggestionAudit } from "../activity-suggestions";

const ROOT = path.join(os.tmpdir(), `act-sugg-b29e-${randomUUID()}`);

afterEach(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("activity-suggestions batch29e — walkRecentFiles edge branches", () => {
  it("handles empty stack pop (87) and stat failures (102, 110)", async () => {
    fs.mkdirSync(ROOT, { recursive: true });
    const activityRoot = path.join(ROOT, "memory");
    const sub = path.join(activityRoot, "nested");
    fs.mkdirSync(sub, { recursive: true });
    const skipPath = path.join(sub, `skip-${randomUUID().slice(0, 8)}.jsonl`);
    const jsonlPath = path.join(sub, `evt-${randomUUID().slice(0, 8)}.jsonl`);
    fs.writeFileSync(skipPath, "skip\n", "utf8");
    fs.writeFileSync(jsonlPath, '{"memory":"classification","policy":"vault"}\n', "utf8");

    vi.spyOn(fs, "statSync").mockImplementation((target) => {
      const p = target.toString();
      if (p === skipPath) {
        const err = new Error("EACCES batch29e");
        (err as NodeJS.ErrnoException).code = "EACCES";
        throw err;
      }
      return fs.statSync(p);
    });

    const suggestions = buildSkillSuggestionAudit({
      now: new Date(),
      days: 365,
      activityRoots: { harnessB29e: activityRoot },
      skillRoots: { memroos: path.join(ROOT, "skills") },
    });

    expect(suggestions.length).toBeGreaterThan(0);
  });
});
