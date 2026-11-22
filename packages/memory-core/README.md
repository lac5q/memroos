# @memroos/memory-core

Deterministic memory primitives from MemroOS. The API is at 0.x and may change.

- evidence request/result binding and the open local baseline ranker;
- offline retrieval-query planning and content-token extraction;
- the ranking-model identity schema (which model produced a ranking);
- canonical key-sorted SHA-256 request hashing;
- pure memory-label decisions and complete engine-scope checks and hashes.

It is not a full memory server. It has no learner, remote provider, network, storage,
evaluation corpus, or storage-backed authorization service. Policy decisions
are pure helpers and do not replace authenticated identity, tenant and source
admission, resolved memberships, lifecycle checks, or required audit.
Request and evidence hashes bind inputs and revisions; they do not authorize
access to evidence.

Hash and ranking behavior can depend on the runtime locale. Callers that need
reproducible results should pin and document the runtime locale alongside
their inputs and package version.

Import the package root or one of its explicit subpaths:

```ts
import { planRetrievalQuery, rankEvidenceBaseline } from "@memroos/memory-core";
import { hashEngineRequest } from "@memroos/memory-core/hash";
import { authorizeMemoryUse } from "@memroos/memory-core/memory-policy";
import { hashMemoryEngineScope } from "@memroos/memory-core/memory-scope";
```

Development commands:

```bash
npm run build
npm run typecheck
npm test
npm run check:build
```

Rebuild after editing package source. The build records source/output hashes,
cleans old output, serializes concurrent builds and reuses unchanged output.
After a crashed build, remove `.build-lock` before retrying.

The build-state file checks development freshness; it does not prove artifact
authenticity. The library itself has no build-time filesystem requirement when
installed as compiled JavaScript.

License: the MemroOS Source Available License 1.0 (`LICENSE`).
