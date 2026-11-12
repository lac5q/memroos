// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import { buildSkillSuggestionAudit } from "../activity-suggestions";

const ROOT = path.join(os.tmpdir(), `act-sugg-b35b-${randomUUID()}`);

afterEach(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
});

describe("activity-suggestions batch35b — walkRecentFiles via public API", () => {
  it("tolerates unreadable dirs, broken symlinks, and recent jsonl activity (92–93, 101–102, 109–110)", () => {
    fs.mkdirSync(ROOT, { recursive: true });
    const activityRoot = path.join(ROOT, "memory");
    const okDir = path.join(activityRoot, "ok");
    fs.mkdirSync(okDir, { recursive: true });
    const now = Date.now();
    const jsonl = path.join(okDir, `activity-b35b-${randomUUID().slice(0, 6)}.jsonl`);
    fs.writeFileSync(
      jsonl,
      `{"memory":"classification","policy":"vault","oauth":"role","dispatch":"provider"}\n`,
      "utf8",
    );
    fs.utimesSync(jsonl, now / 1000, now / 1000);

    const blocked = path.join(activityRoot, "blocked");
    fs.mkdirSync(blocked);
    let blockedUnreadable = false;
    try {
      fs.chmodSync(blocked, 0);
      blockedUnreadable = true;
    } catch {
      blockedUnreadable = false;
    }

    const brokenLink = path.join(activityRoot, "broken-link");
    try {
      fs.symlinkSync(path.join(activityRoot, "does-not-exist-b35b"), brokenLink);
    } catch {
      // Symlinks may be disallowed in some sandboxes.
    }

    const suggestions = buildSkillSuggestionAudit({
      now: new Date(now),
      days: 365,
      activityRoots: { harnessB35b: activityRoot },
      skillRoots: { memroos: path.join(ROOT, "skills-empty") },
    });

    expect(suggestions.some((s) => s.evidence.length > 0)).toBe(true);

    if (blockedUnreadable) {
      try {
        fs.chmodSync(blocked, 0o755);
      } catch {
        /* restore best-effort */
      }
    }
  });
});
