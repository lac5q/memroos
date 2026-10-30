import path from "path";

import { MEM0_URL } from "@/lib/constants";
import {
  classifyScalar,
  metricEnvelope,
  type MetricEnvelope,
  type MetricScope,
} from "@/lib/metric-status";
import { getDb } from "@/lib/db";
import { collectCollectionFiles, loadCollections } from "@/lib/knowledge-collections";
import { mem0HealthTimeoutMs, neo4jConfig, neo4jHttpQuery } from "@/lib/memory/backends";

export type MemoryInventoryCategoryId =
  | "vector_memory"
  | "ingested_message"
  | "consolidated_insight"
  | "episodic_write"
  | "graph_fact"
  | "knowledge_file";

export type MemoryInventoryStatus =
  | "live"
  | "zero"
  | "empty"
  | "stale"
  | "blocked"
  | "unavailable"
  | "degraded"
  | "error";

export interface MemoryInventoryCategory {
  id: MemoryInventoryCategoryId;
  label: string;
  description: string;
  count: number | null;
  backend: string;
  sourceOfTruth: string;
  status: MemoryInventoryStatus;
  lastUpdated: string | null;
  warnings: string[];
  /** Truthful metric envelope for the count/status pair. */
  metric: MetricEnvelope<number | null>;
}

export interface MemoryInventoryRow {
  id: string;
  category: MemoryInventoryCategoryId;
  label: string;
  content: string;
  backend: string;
  source: string;
  project: string | null;
  workspace: string | null;
  timestamp: string | null;
  securityLabel: {
    visibility: string | null;
    domain: string | null;
    sensitivity: string | null;
    policy: string | null;
  };
  consolidationState: "pending" | "consolidated" | "not_applicable" | "unknown";
  salienceScore: number | null;
  accessCount: number | null;
  evidencePointer: string | null;
  degradedReason: string | null;
  provenance: {
    sourceTable: string;
    sourceId: string | number;
    sourceTimestamp: string | null;
  };
}

export interface MemoryInventoryResponse {
  categories: MemoryInventoryCategory[];
  rows: MemoryInventoryRow[];
  filters: {
    categories: MemoryInventoryCategoryId[];
    backends: string[];
    agents: string[];
    projects: string[];
    sources: string[];
    workspaces: string[];
    consolidationStates: MemoryInventoryRow["consolidationState"][];
    degradedStates: MemoryInventoryStatus[];
  };
  definitions: Record<MemoryInventoryCategoryId, string>;
  timestamp: string;
}

interface InventoryFilters {
  category: MemoryInventoryCategoryId | null;
  backend: string | null;
  agent: string | null;
  project: string | null;
  source: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  label: string | null;
  consolidationState: MemoryInventoryRow["consolidationState"] | null;
  degraded: MemoryInventoryStatus | null;
}

const CATEGORY_DEFINITIONS: Record<MemoryInventoryCategoryId, string> = {
  vector_memory: "Durable semantic facts stored by mem0 in Qdrant-backed vector memory.",
  ingested_message: "Raw messages captured in the SQLite messages table before or after consolidation.",
  consolidated_insight: "LLM-extracted summaries, patterns, and contradictions stored in memory_meta_insights.",
  episodic_write: "Explicit agent memory-write audit rows stored in agent_memory_writes.",
  graph_fact: "Entity and relationship facts available through Neo4j graph memory.",
  knowledge_file: "Markdown, MDX, and text files in configured qmd or knowledge collections.",
};

const CATEGORY_LABELS: Record<MemoryInventoryCategoryId, string> = {
  vector_memory: "Vector memories",
  ingested_message: "Ingested messages",
  consolidated_insight: "Consolidated insights",
  episodic_write: "Episodic writes",
  graph_fact: "Graph facts",
  knowledge_file: "Knowledge files",
};

const CATEGORY_BACKENDS: Record<MemoryInventoryCategoryId, string> = {
  vector_memory: "mem0 / Qdrant",
  ingested_message: "SQLite messages",
  consolidated_insight: "SQLite memory_meta_insights",
  episodic_write: "SQLite agent_memory_writes",
  graph_fact: "Neo4j graph",
  knowledge_file: "qmd / knowledge collections",
};

const EMPTY_LABEL = {
  visibility: null,
  domain: null,
  sensitivity: null,
  policy: null,
};

let categoryCountsCache:
  | { checkedAt: number; categories: MemoryInventoryCategory[]; complete: boolean }
  | null = null;
let knowledgeCategoryCache:
  | { checkedAt: number; category: MemoryInventoryCategory }
  | null = null;
let knowledgeCategoryInflight: Promise<MemoryInventoryCategory> | null = null;

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function cloneCategory(entry: MemoryInventoryCategory): MemoryInventoryCategory {
  return { ...entry, warnings: [...entry.warnings] };
}

function cloneCategories(categories: MemoryInventoryCategory[]): MemoryInventoryCategory[] {
  return categories.map(cloneCategory);
}

function countStatus(count: number | null, warnings: string[] = []): MemoryInventoryStatus {
  if (count !== null) return count > 0 ? "live" : "empty";
  if (warnings.length > 0) return "degraded";
  return "degraded";
}

function parseOptionalCategory(value: string | null): MemoryInventoryCategoryId | null {
  const ids = Object.keys(CATEGORY_DEFINITIONS) as MemoryInventoryCategoryId[];
  return ids.includes(value as MemoryInventoryCategoryId) ? (value as MemoryInventoryCategoryId) : null;
}

function parseOptionalState(value: string | null): MemoryInventoryRow["consolidationState"] | null {
  const states: MemoryInventoryRow["consolidationState"][] = ["pending", "consolidated", "not_applicable", "unknown"];
  return states.includes(value as MemoryInventoryRow["consolidationState"]) ? (value as MemoryInventoryRow["consolidationState"]) : null;
}

function parseOptionalStatus(value: string | null): MemoryInventoryStatus | null {
  const states: MemoryInventoryStatus[] = [
    "live",
    "zero",
    "empty",
    "stale",
    "blocked",
    "unavailable",
    "degraded",
    "error",
  ];
  return states.includes(value as MemoryInventoryStatus) ? (value as MemoryInventoryStatus) : null;
}

function parseFilters(url: URL): InventoryFilters {
  return {
    category: parseOptionalCategory(url.searchParams.get("category")),
    backend: url.searchParams.get("backend"),
    agent: url.searchParams.get("agent"),
    project: url.searchParams.get("project"),
    source: url.searchParams.get("source"),
    dateFrom: url.searchParams.get("dateFrom"),
    dateTo: url.searchParams.get("dateTo"),
    label: url.searchParams.get("label"),
    consolidationState: parseOptionalState(url.searchParams.get("consolidationState")),
    degraded: parseOptionalStatus(url.searchParams.get("degraded")),
  };
}

function parseCount(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.trunc(value));
  if (Array.isArray(value)) {
    for (const item of value) {
      const count = parseCount(item);
      if (count !== null) return count;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;

  // Neo4j HTTP transactional response: { results: [{ data: [{ row: [N] }] }] }
  if (Array.isArray(record.results)) {
    for (const result of record.results) {
      if (!result || typeof result !== "object") continue;
      const data = (result as Record<string, unknown>).data;
      if (!Array.isArray(data)) continue;
      for (const entry of data) {
        if (!entry || typeof entry !== "object") continue;
        const row = (entry as Record<string, unknown>).row;
        if (Array.isArray(row) && row.length > 0) {
          const count = parseCount(row[0]);
          if (count !== null) return count;
        }
      }
    }
  }

  for (const key of ["memory_count", "memories_count", "vector_count", "count", "points_count", "total"]) {
    const count = parseCount(record[key]);
    if (count !== null) return count;
  }
  for (const key of ["vector", "qdrant", "memory", "stats"]) {
    const count = parseCount(record[key]);
    if (count !== null) return count;
  }
  return null;
}

function timestampFrom(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  for (const key of ["last_write", "lastWrite", "last_updated", "lastUpdated", "timestamp"]) {
    if (typeof record[key] === "string") return record[key] as string;
  }
  return null;
}

async function vectorCategory(): Promise<MemoryInventoryCategory> {
  const warnings: string[] = [];
  let count: number | null = null;
  let lastUpdated: string | null = null;

  try {
    const response = await fetch(`${MEM0_URL}/health`, {
      signal: AbortSignal.timeout(mem0HealthTimeoutMs()),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) warnings.push(`mem0 health returned HTTP ${response.status}`);
    count = parseCount(body);
    lastUpdated = timestampFrom(body);
    const vectorStore =
      body && typeof body === "object" && typeof (body as Record<string, unknown>).vector_store === "string"
        ? String((body as Record<string, unknown>).vector_store)
        : null;
    if (count === null) {
      if (vectorStore === "connected") {
        warnings.push("Vector store connected but memory_count/points_count missing from mem0 health");
      } else {
        warnings.push("Vector memory count unavailable from mem0 health");
      }
    }
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : "mem0 health unavailable");
  }

  return category("vector_memory", count, lastUpdated, warnings);
}

async function graphCategory(): Promise<MemoryInventoryCategory> {
  const config = neo4jConfig();
  if (!config.password) return category("graph_fact", null, null, ["Neo4j password is not configured"]);

  try {
    const body = await neo4jHttpQuery("MATCH (n) RETURN count(n) AS count", {}, 5000);
    const count = parseCount(body);
    return category("graph_fact", count, null, count === null ? ["Neo4j count unavailable"] : []);
  } catch (error) {
    return category("graph_fact", null, null, [error instanceof Error ? error.message : "Neo4j unavailable"]);
  }
}

function category(
  id: MemoryInventoryCategoryId,
  count: number | null,
  lastUpdated: string | null,
  warnings: string[] = []
): MemoryInventoryCategory {
  const scope: MetricScope = { window: "all", workspace: "all" };
  const source = CATEGORY_BACKENDS[id];
  let metric: MetricEnvelope<number | null>;
  if (count !== null) {
    // Measured count wins even if soft warnings exist (e.g. disk advisory).
    const classification = classifyScalar({
      rowCount: count,
      sourceOk: true,
      latestAt: lastUpdated,
      freshnessMs: null,
    });
    metric = metricEnvelope<number | null>({
      value: count,
      status: classification.status,
      source,
      observedAt: lastUpdated,
      scope,
      reason:
        warnings.length > 0
          ? `${classification.status === "zero" ? "Measured zero" : "Live count"} with warnings: ${warnings.join("; ")}`
          : classification.status === "zero"
            ? `Successful ${source} measured exactly zero rows.`
            : `${count.toLocaleString()} rows from ${source}.`,
    });
  } else if (warnings.length > 0) {
    // Source failed or returned partial data — never coerce to zero.
    const classification = classifyScalar({
      rowCount: 0,
      sourceOk: false,
      latestAt: lastUpdated,
      freshnessMs: null,
    });
    metric = metricEnvelope<number | null>({
      value: null,
      status: classification.status === "live" || classification.status === "zero" ? "degraded" : classification.status,
      source,
      observedAt: lastUpdated,
      scope,
      reason: warnings.join("; "),
    });
  } else {
    // count === null and no warnings — honest unavailable (not zero).
    metric = metricEnvelope<number | null>({
      value: null,
      status: "unavailable",
      source,
      observedAt: lastUpdated,
      scope,
      reason: "Source did not return a countable measurement",
    });
  }
  return {
    id,
    label: CATEGORY_LABELS[id],
    description: CATEGORY_DEFINITIONS[id],
    count,
    backend: CATEGORY_BACKENDS[id],
    sourceOfTruth: CATEGORY_BACKENDS[id],
    status: countStatus(count, warnings),
    lastUpdated,
    warnings,
    metric,
  };
}

function addFilterClause(filters: InventoryFilters, alias: string, params: unknown[]): string {
  const clauses: string[] = [];
  if (filters.project) {
    clauses.push(`${alias}.project = ?`);
    params.push(filters.project);
  }
  if (filters.agent) {
    clauses.push(`${alias}.agent_id = ?`);
    params.push(filters.agent);
  }
  if (filters.source) {
    clauses.push(`${alias}.agent_id = ?`);
    params.push(filters.source);
  }
  if (filters.dateFrom) {
    clauses.push(`${alias}.timestamp >= ?`);
    params.push(filters.dateFrom);
  }
  if (filters.dateTo) {
    clauses.push(`${alias}.timestamp <= ?`);
    params.push(filters.dateTo);
  }
  if (filters.label) {
    clauses.push(`(${alias}.visibility = ? OR ${alias}.domain = ? OR ${alias}.sensitivity = ? OR ${alias}.policy = ?)`);
    params.push(filters.label, filters.label, filters.label, filters.label);
  }
  return clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
}

function messageRows(filters: InventoryFilters): MemoryInventoryRow[] {
  if (filters.category && filters.category !== "ingested_message") return [];
  const db = getDb();
  const params: unknown[] = [];
  const where = addFilterClause(filters, "m", params);
  const rows = db
    .prepare(
      `SELECT m.id, m.project, m.agent_id, m.content, m.timestamp, m.consolidated,
              m.visibility, m.domain, m.sensitivity, m.policy,
              ms.salience_score, ms.access_count
       FROM messages m
       LEFT JOIN memory_salience ms ON ms.message_id = m.id
       ${where}
       ORDER BY m.timestamp DESC
       LIMIT 50`
    )
    .all(...params) as Array<{
      id: number;
      project: string;
      agent_id: string;
      content: string;
      timestamp: string;
      consolidated: number;
      visibility: string | null;
      domain: string | null;
      sensitivity: string | null;
      policy: string | null;
      salience_score: number | null;
      access_count: number | null;
    }>;

  return rows
    .map((row) => ({
      id: `messages:${row.id}`,
      category: "ingested_message" as const,
      label: "Ingested message",
      content: row.content,
      backend: CATEGORY_BACKENDS.ingested_message,
      source: row.agent_id,
      project: row.project,
      workspace: row.project,
      timestamp: row.timestamp,
      securityLabel: {
        visibility: row.visibility,
        domain: row.domain,
        sensitivity: row.sensitivity,
        policy: row.policy,
      },
      consolidationState: row.consolidated ? "consolidated" as const : "pending" as const,
      salienceScore: row.salience_score,
      accessCount: row.access_count,
      evidencePointer: `messages:${row.id}`,
      degradedReason: null,
      provenance: { sourceTable: "messages", sourceId: row.id, sourceTimestamp: row.timestamp },
    }))
    .filter((row) => matchesRowFilters(row, filters));
}

function insightRows(filters: InventoryFilters): MemoryInventoryRow[] {
  if (filters.category && filters.category !== "consolidated_insight") return [];
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, insight_type, content, source_ids, created_at
       FROM memory_meta_insights
       ORDER BY created_at DESC
       LIMIT 30`
    )
    .all() as Array<{ id: number; insight_type: string; content: string; source_ids: string; created_at: string }>;

  return rows
    .map((row) => ({
      id: `memory_meta_insights:${row.id}`,
      category: "consolidated_insight" as const,
      label: `Consolidated ${row.insight_type}`,
      content: row.content,
      backend: CATEGORY_BACKENDS.consolidated_insight,
      source: "memory-consolidation",
      project: null,
      workspace: null,
      timestamp: row.created_at,
      securityLabel: EMPTY_LABEL,
      consolidationState: "not_applicable" as const,
      salienceScore: null,
      accessCount: null,
      evidencePointer: row.source_ids,
      degradedReason: null,
      provenance: { sourceTable: "memory_meta_insights", sourceId: row.id, sourceTimestamp: row.created_at },
    }))
    .filter((row) => matchesRowFilters(row, filters));
}

function episodicWriteRows(filters: InventoryFilters): MemoryInventoryRow[] {
  if (filters.category && filters.category !== "episodic_write") return [];
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, agent_id, memory_type, content_hash, metadata, result, written_at,
              visibility, domain, sensitivity, policy
       FROM agent_memory_writes
       ORDER BY written_at DESC
       LIMIT 30`
    )
    .all() as Array<{
      id: number;
      agent_id: string;
      memory_type: string | null;
      content_hash: string | null;
      metadata: string;
      result: string;
      written_at: string;
      visibility: string | null;
      domain: string | null;
      sensitivity: string | null;
      policy: string | null;
    }>;

  return rows
    .map((row) => {
      const metadata = safeJson(row.metadata);
      const project = typeof metadata.project === "string" ? metadata.project : null;
      return {
        id: `agent_memory_writes:${row.id}`,
        category: "episodic_write" as const,
        label: row.memory_type ? `Episodic ${row.memory_type}` : "Episodic write",
        content: row.content_hash ? `content_hash=${row.content_hash}` : row.result,
        backend: CATEGORY_BACKENDS.episodic_write,
        source: row.agent_id,
        project,
        workspace: project,
        timestamp: row.written_at,
        securityLabel: {
          visibility: row.visibility,
          domain: row.domain,
          sensitivity: row.sensitivity,
          policy: row.policy,
        },
        consolidationState: "not_applicable" as const,
        salienceScore: null,
        accessCount: null,
        evidencePointer: `agent_memory_writes:${row.id}`,
        degradedReason: null,
        provenance: { sourceTable: "agent_memory_writes", sourceId: row.id, sourceTimestamp: row.written_at },
      };
    })
    .filter((row) => matchesRowFilters(row, filters));
}

function safeJson(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

async function knowledgeRows(filters: InventoryFilters): Promise<MemoryInventoryRow[]> {
  if (filters.category && filters.category !== "knowledge_file") return [];
  const rows: MemoryInventoryRow[] = [];
  for (const collection of loadCollections()) {
    const files = await collectCollectionFiles(collection);
    for (const file of files.slice(0, 50)) {
      const relative = path.relative(process.env.HOME ?? "", file.path);
      rows.push({
        id: `knowledge:${file.path}`,
        category: "knowledge_file",
        label: "Knowledge file",
        content: relative,
        backend: CATEGORY_BACKENDS.knowledge_file,
        source: collection.name,
        project: collection.category,
        workspace: collection.name,
        timestamp: file.mtime.toISOString(),
        securityLabel: EMPTY_LABEL,
        consolidationState: "not_applicable",
        salienceScore: null,
        accessCount: null,
        evidencePointer: file.path,
        degradedReason: null,
        provenance: { sourceTable: "knowledge_collection", sourceId: file.path, sourceTimestamp: file.mtime.toISOString() },
      });
    }
  }
  return rows.filter((row) => matchesRowFilters(row, filters));
}

function matchesRowFilters(row: MemoryInventoryRow, filters: InventoryFilters): boolean {
  if (filters.backend && row.backend !== filters.backend) return false;
  if (filters.agent && row.source !== filters.agent) return false;
  if (filters.project && row.project !== filters.project) return false;
  if (filters.source && row.source !== filters.source) return false;
  if (filters.dateFrom && row.timestamp && row.timestamp < filters.dateFrom) return false;
  if (filters.dateTo && row.timestamp && row.timestamp > filters.dateTo) return false;
  if (filters.label) {
    const labels = Object.values(row.securityLabel).filter(Boolean);
    if (!labels.includes(filters.label)) return false;
  }
  if (filters.consolidationState && row.consolidationState !== filters.consolidationState) return false;
  return true;
}

async function knowledgeCategory(): Promise<MemoryInventoryCategory> {
  let count = 0;
  let lastUpdated: Date | null = null;
  const warnings: string[] = [];
  for (const collection of loadCollections()) {
    try {
      const files = await collectCollectionFiles(collection);
      count += files.length;
      for (const file of files) {
        if (!lastUpdated || file.mtime > lastUpdated) lastUpdated = file.mtime;
      }
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : `Failed to scan ${collection.name}`);
    }
  }
  return category("knowledge_file", count, lastUpdated?.toISOString() ?? null, warnings);
}

async function getKnowledgeCategory(waitForKnowledge: boolean): Promise<MemoryInventoryCategory> {
  const now = Date.now();
  const ttlMs = positiveNumber(process.env.MEMORY_INVENTORY_CATEGORY_TTL_MS, 60_000);
  if (knowledgeCategoryCache && now - knowledgeCategoryCache.checkedAt < ttlMs) {
    return cloneCategory(knowledgeCategoryCache.category);
  }

  if (!waitForKnowledge) {
    return category("knowledge_file", null, null, ["Knowledge file count deferred until selected"]);
  }

  if (!knowledgeCategoryInflight) {
    knowledgeCategoryInflight = knowledgeCategory()
      .then((entry) => {
        knowledgeCategoryCache = { checkedAt: Date.now(), category: entry };
        categoryCountsCache = null;
        return entry;
      })
      .finally(() => {
        knowledgeCategoryInflight = null;
      });
  }

  return cloneCategory(await knowledgeCategoryInflight);
}

async function categoryCounts(waitForKnowledge = false): Promise<MemoryInventoryCategory[]> {
  const now = Date.now();
  const ttlMs = positiveNumber(process.env.MEMORY_INVENTORY_CATEGORY_TTL_MS, 60_000);
  if (
    categoryCountsCache &&
    now - categoryCountsCache.checkedAt < ttlMs &&
    (categoryCountsCache.complete || !waitForKnowledge)
  ) {
    return cloneCategories(categoryCountsCache.categories);
  }

  const db = getDb();
  const message = db.prepare("SELECT COUNT(*) AS count, MAX(timestamp) AS lastUpdated FROM messages").get() as { count: number; lastUpdated: string | null };
  const insights = db.prepare("SELECT COUNT(*) AS count, MAX(created_at) AS lastUpdated FROM memory_meta_insights").get() as { count: number; lastUpdated: string | null };
  const writes = db.prepare("SELECT COUNT(*) AS count, MAX(written_at) AS lastUpdated FROM agent_memory_writes").get() as { count: number; lastUpdated: string | null };

  const [vector, graph, knowledge] = await Promise.all([vectorCategory(), graphCategory(), getKnowledgeCategory(waitForKnowledge)]);

  const categories = [
    vector,
    category("ingested_message", message.count, message.lastUpdated),
    category("consolidated_insight", insights.count, insights.lastUpdated),
    category("episodic_write", writes.count, writes.lastUpdated),
    graph,
    knowledge,
  ];
  const complete = knowledge.count !== null || !knowledge.warnings.some((warning) => warning.includes("refresh still running"));
  categoryCountsCache = { checkedAt: now, categories, complete };
  return cloneCategories(categories);
}

function filterOptions(rows: MemoryInventoryRow[], categories: MemoryInventoryCategory[]) {
  const sorted = (values: Array<string | null>) => Array.from(new Set(values.filter((value): value is string => Boolean(value)))).sort();
  return {
    categories: categories.map((entry) => entry.id),
    backends: sorted(rows.map((row) => row.backend)),
    agents: sorted(rows.map((row) => row.source)),
    projects: sorted(rows.map((row) => row.project)),
    sources: sorted(rows.map((row) => row.source)),
    workspaces: sorted(rows.map((row) => row.workspace)),
    consolidationStates: Array.from(new Set(rows.map((row) => row.consolidationState))).sort(),
    degradedStates: Array.from(new Set(categories.map((entry) => entry.status))).sort(),
  };
}

/** Test-only: reset module caches between Vitest cases. */
export function _resetMemoryInventoryCacheForTest(): void {
  knowledgeCategoryCache = null;
  knowledgeCategoryInflight = null;
  categoryCountsCache = null;
}

/** Test-only: invoke categoryCounts with optional knowledge wait flag. */
export async function _categoryCountsForTest(
  waitForKnowledge = false,
): Promise<MemoryInventoryCategory[]> {
  return categoryCounts(waitForKnowledge);
}

export async function buildMemoryInventory(url: URL): Promise<MemoryInventoryResponse> {
  const filters = parseFilters(url);
  // Always resolve knowledge counts so notebooks/inventory surfaces show live
  // file totals when collections are configured (not permanently deferred).
  const categories = await categoryCounts(true);
  const rows = [
    ...messageRows(filters),
    ...insightRows(filters),
    ...episodicWriteRows(filters),
    ...(filters.category === "knowledge_file" ? await knowledgeRows(filters) : []),
  ]
    .filter((row) => !filters.degraded || categories.find((entry) => entry.id === row.category)?.status === filters.degraded)
    .sort((a, b) => (b.timestamp ?? "").localeCompare(a.timestamp ?? ""))
    .slice(0, 100);

  return {
    categories,
    rows,
    filters: filterOptions(rows, categories),
    definitions: CATEGORY_DEFINITIONS,
    timestamp: new Date().toISOString(),
  };
}
