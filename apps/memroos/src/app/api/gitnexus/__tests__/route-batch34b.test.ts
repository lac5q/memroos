// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

const savedRegistry = process.env.GITNEXUS_REGISTRY;

afterEach(() => {
  if (savedRegistry === undefined) delete process.env.GITNEXUS_REGISTRY;
  else process.env.GITNEXUS_REGISTRY = savedRegistry;
  vi.restoreAllMocks();
});

describe("GET /api/gitnexus batch34b", () => {
  it("reads object registry entries with meta and entry stat fallbacks (45–55)", async () => {
    const root = path.join(os.tmpdir(), `gitnexus-b34b-${randomUUID()}`);
    fs.mkdirSync(path.join(root, ".gitnexus"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".gitnexus", "meta.json"),
      JSON.stringify({
        stats: { files: 9, nodes: 8, edges: 7, communities: 6, processes: 5 },
        indexedAt: "2026-11-10T00:00:00.000Z",
        symbols: 99,
        clusters: 4,
        edges: 3,
        processes: 2,
        files: 1,
      }),
      "utf8",
    );

    const registryPath = path.join(os.tmpdir(), `gitnexus-reg-b34b-${randomUUID()}.json`);
    fs.writeFileSync(
      registryPath,
      JSON.stringify({
        memroos: {
          name: "memroos",
          repoPath: root,
          stats: { files: 1, nodes: 2, edges: 3, communities: 4, processes: 5 },
        },
        other: {
          root: path.join(os.tmpdir(), `missing-meta-${randomUUID()}`),
        },
      }),
      "utf8",
    );
    process.env.GITNEXUS_REGISTRY = registryPath;
    vi.resetModules();

    const { GET } = await import("../route");
    const res = await GET();
    const body = (await res.json()) as { repos: Array<{ name: string; symbols: number; files: number }> };
    expect(res.status).toBe(200);
    expect(body.repos[0]?.name).toBe("memroos");
    expect(body.repos[0]?.symbols).toBe(8);
    expect(body.repos.some((repo) => repo.files === 0)).toBe(true);

    fs.rmSync(registryPath, { force: true });
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("returns 500 when NextResponse.json throws (73)", async () => {
    vi.doMock("next/server", async (importOriginal) => {
      const actual = await importOriginal<typeof import("next/server")>();
      return {
        ...actual,
        NextResponse: {
          ...actual.NextResponse,
          json: vi.fn(() => {
            throw new Error("forced gitnexus failure");
          }),
        },
      };
    });

    const registryPath = path.join(os.tmpdir(), `gitnexus-json-b34b-${randomUUID()}.json`);
    fs.writeFileSync(registryPath, "[]", "utf8");
    process.env.GITNEXUS_REGISTRY = registryPath;
    vi.resetModules();
    const { GET } = await import("../route");
    const res = await GET();
    expect(res.status).toBe(500);
    const payload = (await res.json()) as { error: string };
    expect(payload.error).toMatch(/forced gitnexus failure/i);
    vi.doUnmock("next/server");
    fs.rmSync(registryPath, { force: true });
  });
});
