/**
 * RELREC-01 — turn a human utterance into the query retrieval actually needs.
 *
 * Ask Memmy and MCP callers speak in sentences. BM25, ANN, and the local
 * reranker were scoring "what did we decide about billing" as six tokens of
 * which five are filler. Content tokens + quoted phrases are what should
 * hit the index.
 *
 * Deterministic and offline. No hosted rewrite. tokenCount() must NOT use
 * this tokenizer — CTXREF-04 pins budget to tokensFor in recall-v2.
 */

const STOPWORDS = new Set([
  "a", "an", "and", "any", "are", "as", "at", "be", "been", "being", "but", "by",
  "can", "could", "did", "do", "does", "for", "from", "had", "has", "have",
  "how", "i", "if", "in", "into", "is", "it", "its", "just", "like", "me",
  "my", "no", "not", "of", "on", "or", "our", "please", "really", "should",
  "so", "than", "that", "the", "their", "them", "then", "there", "these",
  "this", "those", "to", "too", "us", "very", "was", "we", "were", "what",
  "when", "where", "which", "who", "why", "will", "with", "would", "you",
  "your", "about", "give", "tell", "know", "need", "want", "make",
]);

const RECORD_TYPE_TERMS = new Set(["meeting", "meetings", "call", "calls"]);
const MEETING_QUERY_FILLER = new Set(["show", "find", "list", "recent", "recently"]);
const SUBJECT_CONNECTORS = new Set(["with", "about", "between", "from", "for", "on"]);

const unique = (values: string[]): string[] => Array.from(new Set(values));

const SUBJECT_NAME_WORD = "[A-Z][A-Za-z0-9]*(?:[-._/][A-Za-z0-9]+)*";
const SUBJECT_NAME = `${SUBJECT_NAME_WORD}(?:\\s+${SUBJECT_NAME_WORD}){0,3}`;
const GENERIC_SUBJECT_WORDS = new Set([
  "prepare", "compare", "show", "find", "list", "review", "discuss", "summarize", "plan",
  "company", "companies", "competitor", "competitors", "customer", "customers", "product", "products", "project", "projects",
  "board", "team", "daily", "weekly", "monthly", "quarterly", "annual", "standup", "status", "planning", "sales", "support", "success", "kickoff", "sync",
  "notes", "roadmap", "meeting", "meetings", "call", "calls", "what", "when", "where", "which", "who", "how", "our", "their", "your", "the", "this", "that", "next", "recent", "latest",
  "today", "tomorrow", "yesterday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december", "q1", "q2", "q3", "q4",
]);

/** Tokens that should participate in retrieval and rerank. Case is preserved. */
export function contentTokens(text: string): string[] {
  const raw = text.match(/[A-Za-z0-9][A-Za-z0-9_./-]{0,}/g) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const rawToken of raw) {
    // A sentence-ending period is punctuation, while dots inside versions,
    // hostnames and file paths remain part of the identifier.
    const token = rawToken.replace(/\.+$/, "");
    const lower = token.toLocaleLowerCase();
    if (STOPWORDS.has(lower)) continue;
    if (token.length < 3 && !/\d/.test(token)) continue;
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(token);
  }
  return out;
}

/**
 * Count complete query tokens in evidence, including contiguous identifiers
 * within a domain or path. Query identifiers stay intact: v1.2.3 cannot match
 * v1.2.30, and a word cannot match an arbitrary prefix or a different stem.
 * FTS tokenizes compound punctuation, so requiring whole evidence-token
 * equality would discard valid keyword hits such as cobalt in cobalt.example.
 */
export function countEvidenceTokenMatches(queryTokens: readonly string[], evidenceTokens: readonly string[]): number {
  const candidates = evidenceTokens.map((token) => token.toLocaleLowerCase());
  const exact = new Set(candidates);
  return queryTokens.filter((token) => {
    const term = token.toLocaleLowerCase();
    if (exact.has(term)) return true;
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const bounded = new RegExp(`(?:^|[-._/])${escaped}(?:$|[-._/])`);
    return candidates.some((candidate) => bounded.test(candidate));
  }).length;
}

/** Explicit named subjects only; this is a conservative cue parser, not NER. */
function explicitSubjectAnchors(text: string): string[] {
  const anchors: string[] = [];
  const namePattern = new RegExp('^["`]?(' + SUBJECT_NAME + ')');
  const collectNames = (suffix: string) => {
    let remaining = suffix.trimStart();
    while (remaining) {
      const match = namePattern.exec(remaining);
      if (!match) break;
      const words = match[1].split(/\s+/);
      while (words.length && GENERIC_SUBJECT_WORDS.has(words[0].toLocaleLowerCase())) words.shift();
      while (words.length && GENERIC_SUBJECT_WORDS.has(words[words.length - 1].toLocaleLowerCase())) words.pop();
      const name = words.join(" ");
      if (contentTokens(name).length > 0) anchors.push(name);
      remaining = remaining.slice(match[0].length).replace(/^["`]/, "");
      const separator = /^\s*(?:,\s*(?:(?:and|or)\s+)?|(?:and|or|vs\.?|versus|&)\s+)/i.exec(remaining);
      if (!separator) break;
      remaining = remaining.slice(separator[0].length);
    }
  };

  const cues = /\b(?:competitors?|compan(?:y|ies)|customers?|products?|projects?)\s*(?::|\bnamed\b|\bcalled\b)?\s+/gi;
  for (const match of text.matchAll(cues)) collectNames(text.slice(match.index! + match[0].length));
  const beforeRecord = new RegExp(`\\b(${SUBJECT_NAME}(?:\\s*(?:,|and|or|&)\\s+${SUBJECT_NAME})*)\\s+(?:[Cc]alls?|[Mm]eetings?)\\b`, "g");
  for (const match of text.matchAll(beforeRecord)) collectNames(match[1]);
  const seen = new Set<string>();
  return anchors.filter((anchor) => {
    const key = anchor.toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export interface RetrievalQueryPlan {
  original: string;
  retrievalQuery: string;
  terms: string[];
  /** Lexical evidence must match at least one explicit named subject, when present. */
  subjectAnchors?: string[];
}

export function planRetrievalQuery(utterance: string): RetrievalQueryPlan {
  const original = utterance.replace(/\s+/g, " ").trim();
  if (!original) return { original, retrievalQuery: "", terms: [] };

  const phrases = [...original.matchAll(/"([^"]+)"/g)]
    .map((match) => match[1].replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const withoutQuotes = original.replace(/"[^"]*"/g, " ");
  const content = contentTokens(withoutQuotes);
  const rawTokens = withoutQuotes.match(/[A-Za-z0-9][A-Za-z0-9_./-]{0,}/g) ?? [];
  const hasRecordType = content.some((token) => RECORD_TYPE_TERMS.has(token.toLocaleLowerCase()));
  const hasSubject = [...phrases.flatMap(contentTokens), ...content].some((token) => {
    const lower = token.toLocaleLowerCase();
    return !RECORD_TYPE_TERMS.has(lower) && !MEETING_QUERY_FILLER.has(lower) && !SUBJECT_CONNECTORS.has(lower);
  });
  const explicitMeetingLookup = hasRecordType && hasSubject && rawTokens.some((token) => SUBJECT_CONNECTORS.has(token.toLocaleLowerCase()));
  const retrievalContent = explicitMeetingLookup
    ? content.filter((token) => {
        const lower = token.toLocaleLowerCase();
        return !RECORD_TYPE_TERMS.has(lower) && !MEETING_QUERY_FILLER.has(lower);
      })
    : content;
  const terms = unique([...phrases, ...retrievalContent]);
  const subjectAnchors = explicitSubjectAnchors(original);
  return {
    original,
    retrievalQuery: terms.join(" ") || original,
    terms,
    ...(subjectAnchors.length > 0 ? { subjectAnchors } : {}),
  };
}
