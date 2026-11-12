// @vitest-environment node
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { randomUUID } from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let root: string;
let configPath: string;

function touch(filePath: string, date: Date) {
  writeFileSync(filePath, `batch33 ${randomUUID().slice(0, 4)}`);
  utimesSync(filePath, date, date);
}

async function loadRoute() {
  vi.resetModules();
  vi.stubEnv("KNOWLEDGE_BASE_PATH", root);
  vi.stubEnv("COLLECTIONS_CONFIG_PATH", configPath);
  return import("../route");
}

describe("GET /api/knowledge/trends batch33", () => {
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), `trends-b33-${randomUUID()}-`));
    configPath = path.join(root, "collections.config.json");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  });

  it("parseLimit falls back when limit is not finite (L74)", async () => {
    writeFileSync(configPath, JSON.stringify({ collections: [{ name: "skills", category: "agents" }] }));
    mkdirSync(path.join(root, "skills"), { recursive: true });
    touch(path.join(root, "skills", "one.md"), new Date());

    const { GET } = await loadRoute();
    const res = await GET(
      new Request("http://localhost/api/knowledge/trends?window=week&limit=NaN") as never,
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.collections.length).toBeLessThanOrEqual(12);
  });

  it("buildPoints skips mtimes that map outside configured buckets (L83)", async () => {
    mkdirSync(path.join(root, "skills"), { recursive: true });
    const future = new Date();
    future.setUTCDate(future.getUTCDate() + 10);
    touch(path.join(root, "skills", "future.md"), future);
    touch(path.join(root, "skills", "today.md"), new Date());
    writeFileSync(
      configPath,
      JSON.stringify({
        collections: [{ name: "skills", category: "agents" }],
      }),
    );

    const { GET } = await loadRoute();
    const res = await GET(new Request("http://localhost/api/knowledge/trends?window=week&limit=5") as never);
    const body = await res.json();
    expect(res.status).toBe(200);
    const skills = body.collections.find((c: { name: string }) => c.name === "skills");
    expect(skills.totalFiles).toBe(2);
    expect(skills.recentFiles).toBe(1);
  });
});
