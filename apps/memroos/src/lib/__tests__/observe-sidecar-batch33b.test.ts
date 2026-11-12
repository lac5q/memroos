// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import { listSessionJsonlFiles } from "../observe-sidecar";

const ROOT = path.join(os.tmpdir(), `observe-b33b-${randomUUID()}`);

afterEach(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
});

describe("observe-sidecar batch33b", () => {
  it("listSessionJsonlFiles respects maxDepth (153)", () => {
    const home = path.join(ROOT, "home-depth");
    const deep = path.join(home, "l0", "l1", "l2");
    fs.mkdirSync(deep, { recursive: true });
    fs.writeFileSync(path.join(deep, "deep.jsonl"), "{}\n");
    fs.writeFileSync(path.join(home, "l0", "shallow.jsonl"), "{}\n");
    expect(listSessionJsonlFiles(home, 1).some((p) => p.endsWith("shallow.jsonl"))).toBe(true);
    expect(listSessionJsonlFiles(home, 1).some((p) => p.endsWith("deep.jsonl"))).toBe(false);
  });

  it("listSessionJsonlFiles tolerates unreadable directories (158)", () => {
    const home = path.join(ROOT, "home-unreadable");
    const open = path.join(home, "open");
    const secret = path.join(home, "secret");
    fs.mkdirSync(open, { recursive: true });
    fs.mkdirSync(secret);
    fs.writeFileSync(path.join(open, "visible.jsonl"), "{}\n");
    try {
      fs.chmodSync(secret, 0);
    } catch {
      expect(listSessionJsonlFiles(home, 4).length).toBeGreaterThanOrEqual(1);
      return;
    }
    const files = listSessionJsonlFiles(home, 4);
    expect(files.some((p) => p.endsWith("visible.jsonl"))).toBe(true);
    fs.chmodSync(secret, 0o755);
  });
});
