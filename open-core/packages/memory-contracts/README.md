# @memroos/memory-contracts

`@memroos/memory-contracts` is a standalone Apache-2.0 package
containing the dependency-free OpenAI memory wire contract used by MemroOS.
It exposes the stable scope, tool, error, limit, and JSON-schema contract
values without importing application, policy, storage, or memory-engine code.

The package is licensed under Apache-2.0. The
root `LICENSE` is carried here byte-for-byte for the current workspace; this
package has no publication permission or release claim.

Development commands:

```bash
npm run build
npm run typecheck
npm test
npm run check:build
```

The app and its tests build this package before consuming its compiled exports.
