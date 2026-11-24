# Contributing

Contributions are welcome. Start with an issue for substantial changes. Keep changes focused and use meaningful commits that describe what changed and why.

## Local checks

```sh
bun install --frozen-lockfile
bun run typecheck
bun run test
bun run build
```

Node.js and npm are supported: `npm ci`, `npm run typecheck`, `npm test`, `npm run build`.

## Compiler principles

1. Keep the raw archive independent of React. Do not mutate the source design.
2. Prefer captured source properties and explicit component identities. Keep inferred behavior and reference measurements distinguishable.
3. Use reusable React modules and route-level loading. Preserve original code components and their instance controls.
4. Test generic fixtures with different typography, layouts and routes. Never hardcode a regression project's IDs, names, URLs or content.
5. Do not reduce comparison thresholds to make tests pass. Unavailable coverage is not success.
6. Do not commit private designs, credentials, screenshots, unpublished source trees or user asset archives.

Add a regression test for each bug. For visual changes, include the viewport, reproduction, source provenance and before/after measurements from an authorized project. No proprietary fixtures are needed to run the public CI suite.

## Reporting a problem

Include the tool version, runtime, archive format, sanitized minimal example, expected result, actual result and relevant diagnostics. Do not upload confidential source projects or private assets. For suspected vulnerabilities, use the process in [SECURITY.md](SECURITY.md).

