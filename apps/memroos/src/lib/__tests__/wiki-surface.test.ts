/**
 * Wiki vault + digest unit coverage (v8.14 WIKISURF).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clusterKeyForMemory,
  readWikiDigestWatermark,
  redactSecrets,
  runWikiDigest,
  shouldSkipMemory,
  WIKI_DIGEST_CRON_ID,
} from "@/lib/wiki-digest";
import {
  extractWikilinks,
  getWikiRoot,
  listWikiTree,
  readWikiPage,
  resolveWikilink,
  resolveWikiPath,
  searchWikiPages,
  wikiRootExists,
} from "@/lib/wiki-vault";
import { loadWikiGraph } from "@/lib/wiki-graph";
import { listCronHealthJobs } from "@/lib/cron-health";
import { initSchema } from "@/lib/db-schema";
import Database from "better-sqlite3";

const tempDirs: string[] = [];

function makeVault(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "memroos-wiki-"));
  tempDirs.push(root);
  const wiki = path.join(root, "llm-wiki", "wiki");
  fs.mkdirSync(wiki, { recursive: true });
  fs.writeFileSync(path.join(wiki, "index.md"), "# Wiki Index\n\nSee [[memroos-digest/hello]].\n", "utf8");
  fs.mkdirSync(path.join(wiki, "memroos-digest"), { recursive: true });
  fs.writeFileSync(
    path.join(wiki, "memroos-digest", "hello.md"),
    "# Hello\n\nMemRoOS wiki reader smoke.\n",
    "utf8"
  );
  fs.mkdirSync(path.join(wiki, "graph"), { recursive: true });
  fs.writeFileSync(
    path.join(wiki, "graph", "knowledge-graph.json"),
    JSON.stringify({
      generatedAt: "2026-07-18T00:00:00.000Z",
      nodes: [{ id: "hello", label: "Hello", path: "memroos-digest/hello.md" }],
      edges: [],
    }),
    "utf8"
  );
  return root;
}

afterEach(() => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("wiki-vault", () => {
  it("lists tree, reads pages, resolves wikilinks, and searches", () => {
    const kb = makeVault();
    const wikiRoot = getWikiRoot({ knowledgeBasePath: kb });
    const tree = listWikiTree(wikiRoot);
    expect(tree.some((n) => n.name === "index.md")).toBe(true);

    const page = readWikiPage(wikiRoot, "index.md");
    expect(page?.title).toBe("Wiki Index");
    expect(extractWikilinks(page!.content)).toContain("memroos-digest/hello");
    expect(resolveWikilink(wikiRoot, "memroos-digest/hello")).toBe("memroos-digest/hello.md");
    expect(resolveWikiPath(wikiRoot, "../outside.md")).toBeNull();

    const hits = searchWikiPages(wikiRoot, "reader smoke");
    expect(hits[0]?.path).toBe("memroos-digest/hello.md");
    expect(resolveWikilink(wikiRoot, "hello")).toBe("memroos-digest/hello.md");
    expect(resolveWikilink(wikiRoot, "")).toBeNull();
    expect(resolveWikilink(wikiRoot, "does-not-exist-anywhere")).toBeNull();
    expect(searchWikiPages(wikiRoot, "   ")).toEqual([]);
    expect(searchWikiPages(wikiRoot, "reader smoke", 1)).toHaveLength(1);
    expect(wikiRootExists(wikiRoot)).toBe(true);
  });

  it("loads wiki graph and degrades when missing", () => {
    const kb = makeVault();
    const graph = loadWikiGraph({ knowledgeBasePath: kb });
    expect(graph.exists).toBe(true);
    expect(graph.nodes[0]?.path).toBe("memroos-digest/hello.md");

    const empty = loadWikiGraph({ knowledgeBasePath: path.join(os.tmpdir(), "missing-wiki-root") });
    expect(empty.exists).toBe(false);
  });
});

describe("wiki-digest", () => {
  it("registers wiki-digest in cron health defaults", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const jobs = listCronHealthJobs(db);
    expect(jobs.some((job) => job.id === WIKI_DIGEST_CRON_ID)).toBe(true);
  });

  it("skips secrets and high-sensitivity scraps", () => {
    expect(shouldSkipMemory({ id: "1", content: "api_key=abc123" }).skip).toBe(true);
    expect(
      shouldSkipMemory({ id: "2", content: "normal note", sensitivity: "legal" }).skip
    ).toBe(true);
    expect(shouldSkipMemory({ id: "3", content: "Ship wiki digest" }).skip).toBe(false);
  });

  it("dry-run digests without writing watermark/pages", async () => {
    const kb = makeVault();
    const before = readWikiDigestWatermark(kb);
    const summary = await runWikiDigest({
      knowledgeBasePath: kb,
      dryRun: true,
      now: new Date("2026-07-18T12:00:00.000Z"),
      fetchMemories: async () => [
        {
          id: "m1",
          content: "Luis shipped the human wiki surface on MemRoOS.",
          createdAt: "2026-07-18T11:00:00.000Z",
          agentId: "luis",
        },
      ],
      log: () => undefined,
    });
    expect(summary.status).toBe("completed");
    expect(summary.written).toBe(1);
    expect(summary.pages.length).toBe(1);
    expect(readWikiDigestWatermark(kb).lastId).toBe(before.lastId);
    const key = clusterKeyForMemory({
      id: "m1",
      content: "Luis shipped the human wiki surface on MemRoOS.",
    });
    expect(fs.existsSync(path.join(kb, "llm-wiki", "wiki", "memroos-digest", `${key}.md`))).toBe(
      false
    );
  });

  it("creates wiki index and log files on first non-dry-run digest", async () => {
    const kb = makeVault();
    const wikiRoot = path.join(kb, "llm-wiki", "wiki");
    fs.rmSync(path.join(wikiRoot, "index.md"), { force: true });
    fs.rmSync(path.join(wikiRoot, "log.md"), { force: true });

    await runWikiDigest({
      knowledgeBasePath: kb,
      dryRun: false,
      now: new Date("2026-07-18T12:00:00.000Z"),
      fetchMemories: async () => [
        {
          id: "m-index",
          content: "First digest creates index and log scaffolding.",
          createdAt: "2026-07-18T11:45:00.000Z",
        },
      ],
      log: () => undefined,
    });

    expect(fs.existsSync(path.join(wikiRoot, "index.md"))).toBe(true);
    expect(fs.readFileSync(path.join(wikiRoot, "index.md"), "utf8")).toContain("# Wiki Index");
    expect(fs.existsSync(path.join(wikiRoot, "log.md"))).toBe(true);
    expect(fs.readFileSync(path.join(wikiRoot, "log.md"), "utf8")).toContain("# Wiki Log");
  });

  it("merges graph nodes when the existing graph file is corrupt", async () => {
    const kb = makeVault();
    const graphPath = path.join(kb, "llm-wiki", "wiki", "graph", "knowledge-graph.json");
    fs.mkdirSync(path.dirname(graphPath), { recursive: true });
    fs.writeFileSync(graphPath, "{broken-json", "utf8");

    const summary = await runWikiDigest({
      knowledgeBasePath: kb,
      dryRun: false,
      now: new Date("2026-07-18T12:00:00.000Z"),
      fetchMemories: async () => [
        {
          id: "m-graph",
          content: "Graph merge should recover from invalid JSON on disk.",
          createdAt: "2026-07-18T11:50:00.000Z",
        },
      ],
      log: () => undefined,
    });

    expect(summary.written).toBe(1);
    const graph = JSON.parse(fs.readFileSync(graphPath, "utf8")) as { nodes: Array<{ id: string }> };
    expect(graph.nodes.some((n) => n.id.includes("memroos-digest"))).toBe(true);
  });

  it("writes pages, updates watermark, and refreshes graph", async () => {
    const kb = makeVault();
    const summary = await runWikiDigest({
      knowledgeBasePath: kb,
      dryRun: false,
      now: new Date("2026-07-18T12:00:00.000Z"),
      fetchMemories: async () => [
        {
          id: "m2",
          content: "Graph catchup and wiki digest work together.",
          createdAt: "2026-07-18T11:30:00.000Z",
          agentId: "luis",
        },
      ],
      log: () => undefined,
    });
    expect(summary.status).toBe("completed");
    expect(summary.written).toBe(1);
    expect(readWikiDigestWatermark(kb).lastId).toBe("m2");
    const pagePath = path.join(kb, "llm-wiki", "wiki", summary.pages[0]!);
    expect(fs.existsSync(pagePath)).toBe(true);
    const graph = loadWikiGraph({ knowledgeBasePath: kb });
    expect(graph.nodes.some((n) => n.path === summary.pages[0])).toBe(true);
  });

  it("falls back to sqlite episodic memories when mem0 fetch fails", async () => {
    const kb = makeVault();
    const db = new Database(":memory:");
    initSchema(db);
    db.prepare(
      `INSERT INTO messages (session_id, project, agent_id, role, content, timestamp)
       VALUES ('s1', 'p1', 'luis', 'user', 'Episodic fallback memory about wiki digest resilience.', '2026-07-18T11:00:00.000Z')`
    ).run();

    const summary = await runWikiDigest({
      knowledgeBasePath: kb,
      dryRun: false,
      agentId: "luis",
      now: new Date("2026-07-18T12:00:00.000Z"),
      db,
      fetchMemories: async () => {
        throw new Error("mem0_down");
      },
      log: () => undefined,
    });
    expect(summary.status).toBe("completed");
    expect(summary.written).toBe(1);
    expect(summary.pages[0]).toContain("memroos-digest/");
  });

  it("fails when mem0 is down and episodic fallback is disabled", async () => {
    const kb = makeVault();
    const summary = await runWikiDigest({
      knowledgeBasePath: kb,
      allowEpisodicFallback: false,
      fetchMemories: async () => {
        throw new Error("mem0_down");
      },
      log: () => undefined,
    });
    expect(summary.status).toBe("failed");
    expect(summary.errors).toBe(1);
    expect(summary.reason).toContain("mem0_down");
  });

  it("skips already-watermarked memories as nothing_new", async () => {
    const kb = makeVault();
    await runWikiDigest({
      knowledgeBasePath: kb,
      now: new Date("2026-07-18T12:00:00.000Z"),
      fetchMemories: async () => [
        {
          id: "m-old",
          content: "Older note that sets the watermark baseline.",
          createdAt: "2026-07-18T10:00:00.000Z",
        },
      ],
      log: () => undefined,
    });

    const second = await runWikiDigest({
      knowledgeBasePath: kb,
      now: new Date("2026-07-18T13:00:00.000Z"),
      fetchMemories: async () => [
        {
          id: "m-old",
          content: "Older note that sets the watermark baseline.",
          createdAt: "2026-07-18T10:00:00.000Z",
        },
      ],
      log: () => undefined,
    });
    expect(second.status).toBe("skipped");
    expect(second.reason).toBe("nothing_new");
    expect(second.written).toBe(0);
    expect(second.skipped).toBeGreaterThan(0);
  });

  it("uses hash cluster keys for short headings and skips empty content", async () => {
    expect(clusterKeyForMemory({ id: "short-1", content: "Hi" })).toMatch(/^memory-[a-f0-9]+$/);
    expect(shouldSkipMemory({ id: "e", content: "   " }).reason).toBe("empty");
    expect(
      shouldSkipMemory({ id: "legal", content: "attorney-client privileged note" }).reason
    ).toBe("personal_legal_scrap");
    expect(redactSecrets("Authorization: Bearer super-secret-token-value")).toMatch(
      /\[REDACTED\]/i
    );
  });

  it("skips secret memories during digest and marks write failures as partial", async () => {
    const kb = makeVault();
    const skipped = await runWikiDigest({
      knowledgeBasePath: kb,
      dryRun: true,
      now: new Date("2026-07-18T12:00:00.000Z"),
      fetchMemories: async () => [
        {
          id: "secret-1",
          content: "api_key=abc123 should be skipped",
          createdAt: "2026-07-18T11:00:00.000Z",
        },
      ],
      log: () => undefined,
    });
    expect(skipped.status).toBe("skipped");
    expect(skipped.skipped).toBeGreaterThan(0);
    expect(skipped.written).toBe(0);

    const realWrite = fs.writeFileSync.bind(fs);
    const writeSpy = vi.spyOn(fs, "writeFileSync").mockImplementation(((
      file: fs.PathOrFileDescriptor,
      data: string | NodeJS.ArrayBufferView,
      options?: fs.WriteFileOptions
    ) => {
      const target = String(file);
      if (target.includes(`${path.sep}memroos-digest${path.sep}`) && target.endsWith(".md")) {
        throw new Error("disk_full");
      }
      return realWrite(file, data, options);
    }) as typeof fs.writeFileSync);

    try {
      const partial = await runWikiDigest({
        knowledgeBasePath: kb,
        dryRun: false,
        now: new Date("2026-07-18T12:00:00.000Z"),
        fetchMemories: async () => [
          {
            id: "m-write-fail",
            content: "This cluster should fail to write because disk is full.",
            createdAt: "2026-07-18T11:15:00.000Z",
            agentId: "luis",
          },
        ],
        log: () => undefined,
      });
      expect(partial.errors).toBeGreaterThan(0);
      expect(["partial", "failed"]).toContain(partial.status);
    } finally {
      writeSpy.mockRestore();
    }
  });

  it("fails when episodic fallback itself throws", async () => {
    const kb = makeVault();
    const summary = await runWikiDigest({
      knowledgeBasePath: kb,
      allowEpisodicFallback: true,
      now: new Date("2026-07-18T12:00:00.000Z"),
      db: {
        prepare() {
          throw new Error("sqlite_boom");
        },
      } as never,
      fetchMemories: async () => {
        throw new Error("mem0_down");
      },
      log: () => undefined,
    });
    expect(summary.status).toBe("failed");
    expect(summary.reason).toContain("episodic_fallback_failed");
  });

  it("reports graph_missing and graph_parse_failed reasons", () => {
    const kb = makeVault();
    const wiki = path.join(kb, "llm-wiki", "wiki");
    fs.rmSync(path.join(wiki, "graph"), { recursive: true, force: true });
    const missing = loadWikiGraph({ knowledgeBasePath: kb });
    expect(missing.exists).toBe(false);
    expect(missing.reason).toBe("graph_missing");

    fs.mkdirSync(path.join(wiki, "graph"), { recursive: true });
    fs.writeFileSync(path.join(wiki, "graph", "knowledge-graph.json"), "{not-json", "utf8");
    const bad = loadWikiGraph({ knowledgeBasePath: kb });
    expect(bad.exists).toBe(false);
    expect(bad.reason).toBeTruthy();
  });

  it("filters path-traversal graph nodes and accepts from/to edges", () => {
    const kb = makeVault();
    const graphFile = path.join(kb, "llm-wiki", "wiki", "graph", "knowledge-graph.json");
    fs.writeFileSync(
      graphFile,
      JSON.stringify({
        generatedAt: "2026-07-18T00:00:00.000Z",
        nodes: [
          { id: "ok", label: "Ok", path: "index.md" },
          { id: "escape", label: "Nope", path: "../outside.md" },
          { id: "nolabel" },
        ],
        edges: [
          { from: "ok", to: "nolabel", type: "mentions" },
          { source: "", target: "x" },
        ],
      }),
      "utf8"
    );
    const graph = loadWikiGraph({ knowledgeBasePath: kb });
    expect(graph.exists).toBe(true);
    expect(graph.nodes.map((n) => n.id).sort()).toEqual(["nolabel", "ok"]);
    expect(graph.edges).toEqual([{ source: "ok", target: "nolabel", type: "mentions" }]);
  });
});
