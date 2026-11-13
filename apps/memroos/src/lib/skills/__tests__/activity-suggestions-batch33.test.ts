// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

import { buildSkillSuggestionAudit } from "../activity-suggestions";

const ROOT = path.join(os.tmpdir(), `act-sugg-b33-${randomUUID()}`);

afterEach(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("activity-suggestions batch33 — walkRecentFiles edge branches", () => {
  it("handles falsy stack pops (87), readdir failures (96), and jsonl limit breaks (110)", () => {
    fs.mkdirSync(ROOT, { recursive: true });
    const activityRoot = path.join(ROOT, "memory");
    const sub = path.join(activityRoot, "nested");
    fs.mkdirSync(sub, { recursive: true });

    const readdir = fs.readdirSync;
    vi.spyOn(fs, "readdirSync").mockImplementation((target, options) => {
      const dir = target.toString();
      if (dir === path.join(activityRoot, "unreadable")) {
        throw new Error("EACCES batch33-readdir");
      }
      return readdir.call(fs, target, options as never);
    });

    fs.mkdirSync(path.join(activityRoot, "unreadable"), { recursive: true });

    for (let i = 0; i < 45; i += 1) {
      const jsonl = path.join(sub, `evt-b33-${i}-${randomUUID().slice(0, 6)}.jsonl`);
      fs.writeFileSync(
        jsonl,
        `{"memory":"classification","policy":"vault","auth":"invite","oauth":"role"}\n`,
        "utf8",
      );
    }

    const suggestions = buildSkillSuggestionAudit({
      now: new Date(),
      days: 365,
      activityRoots: { harnessB33: activityRoot },
      skillRoots: { memroos: path.join(ROOT, "skills") },
    });

    expect(suggestions.length).toBeGreaterThan(0);
  });
});
