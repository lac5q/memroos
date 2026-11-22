# MemroOS core

Deterministic building blocks for agent memory, from MemroOS:

- **`@memroos/memory-core`**: memory policy and scope checks, a local baseline
  evidence ranker, retrieval-query planning, canonical request hashing, and the
  schema that names which ranking model produced a ranking.
- **`@memroos/memory-contracts`**: the wire contract for MemroOS's OpenAI memory
  tools (`get_profile`, `search`, `fetch`, `create_memory`, `update_memory`): their
  scopes, error codes, limits and JSON schemas, with no dependencies.

These are libraries, not a memory server. They have no storage, network access,
learner or authentication of their own: policy decisions are pure functions
that a caller combines with its own identity, tenancy and audit checks.

## Use

Node 22 or later.

```bash
npm ci
npm run build
npm test
```

Each package's README lists its exports and commands.

## License

The MemroOS Source Available License 1.0 (`LICENSE`). In short:

- an eligible small company may use, change and self-host this software for its
  own internal work;
- offering it, or a service built substantially on it, as a hosted or managed
  memory service for others needs a separate commercial license;
- so does use by a larger company.

The `LICENSE` file is the authoritative text; this summary is not.
Third-party components and their licenses are listed in
`THIRD_PARTY_NOTICES.md`.
