// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

import { loadSyntheticSmoke } from "../synthetic";

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("synthetic adapter batch31 — stamp branches on cloned tasks", () => {
  it("passes through non-object fixture entries unchanged (L94)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `syn-b31-${randomUUID()}-`));
    tmpDirs.push(dir);
    fs.writeFileSync(
      path.join(dir, "memroos-public-smoke.json"),
      JSON.stringify([null, "not-a-task"]),
      "utf8",
    );
    const loaded = loadSyntheticSmoke({ fixturesDir: dir, limit: 5 });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.tasks).toEqual([null, "not-a-task"]);
  });

  it("stamps provenance, license, and citation when absent (L100–101)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `syn-b31-stamp-${randomUUID()}-`));
    tmpDirs.push(dir);
    const task = {
      id: "memroos-b31-stamp",
      dataset: "memroos_public_synthetic",
      task_type: "single_hop",
      corpus: [{ id: "c-b31", text: "batch31 synthetic" }],
      question: "q?",
      expected_answer: "batch31 synthetic",
      evidence_spans: ["c-b31"],
    };
    fs.writeFileSync(path.join(dir, "memroos-public-smoke.json"), JSON.stringify([task]), "utf8");
    const loaded = loadSyntheticSmoke({ fixturesDir: dir });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const stamped = loaded.tasks?.[0];
    expect(stamped?.provenance?.dataset).toBe("memroos_public_synthetic");
    expect(stamped?.license).toBeTruthy();
    expect(stamped?.citation).toBeTruthy();
  });
});
