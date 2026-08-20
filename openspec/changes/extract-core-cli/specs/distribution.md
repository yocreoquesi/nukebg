# Distribution Specification

## Purpose

This spec defines the npm workspace topology, the published package contracts, and the invariants that must hold across the monorepo. It is the contract `sdd-verify` checks before approving the change as shippable.

## Requirements

### REQ-DIST-1: Workspace topology

**Statement**: The repo MUST be converted to an npm workspaces monorepo with the following structure:

```
packages/
  nukebg-core/     — pure library, publicly published
  nukebg-cli/      — Node binary, publicly published
packages/nukebg-app/ OR root   — browser app, private
```

The root `package.json` MUST declare `"workspaces": ["packages/*"]`. Each package MUST have its own `package.json`. The root MUST NOT declare production `dependencies` that belong to a specific package.

#### Scenario: Workspace structure is correct

- GIVEN the repo after migration
- WHEN `npm ls --workspaces` is executed at the repo root
- THEN it lists exactly the three workspace packages without errors

#### Scenario: Each package builds independently

- GIVEN the workspace is set up
- WHEN `npm run build` is executed inside `packages/nukebg-core` alone (no workspace flag)
- THEN the build succeeds without referencing any file outside `packages/nukebg-core/`
- AND the same holds for `packages/nukebg-cli`

---

### REQ-DIST-2: `nukebg-core` package invariants

**Statement**: `packages/nukebg-core/package.json` MUST satisfy all of the following:

- `"name": "nukebg-core"`.
- `"private": false` (or the field absent — default is public).
- No `dependencies` on `onnxruntime-web`, `onnxruntime-node`, `sharp`, `@huggingface/transformers`, or any DOM-runtime library.
- `"exports"` field that exposes at minimum `"."` pointing to the compiled main entry.
- `"types"` field pointing to generated `.d.ts`.
- `"engines": { "node": ">=20.0.0" }`.
- TypeScript strict mode enabled in `tsconfig.json` (inherits or sets `"strict": true`).

#### Scenario: `nukebg-core` installs without ORT conflict

- GIVEN a fresh `npm install` in a directory that has only `nukebg-core` as a dependency
- WHEN installation completes
- THEN neither `onnxruntime-web` nor `onnxruntime-node` appears in the installed `node_modules`

#### Scenario: `nukebg-core` types are available

- GIVEN `nukebg-core` is installed as a dependency
- WHEN a TypeScript file does `import type { ImageDataLike, PipelineRunner } from "nukebg-core"`
- THEN tsc resolves the types without error

---

### REQ-DIST-3: `nukebg-cli` package invariants

**Statement**: `packages/nukebg-cli/package.json` MUST satisfy all of the following:

- `"name": "nukebg-cli"`.
- `"private": false`.
- `"bin": { "nukebg": "./dist/cli.js" }`.
- `"dependencies"` includes `nukebg-core` (workspace reference), `onnxruntime-node`, `@huggingface/transformers`, `sharp`, `commander`, and `env-paths`.
- MUST NOT depend on `onnxruntime-web`.
- `"engines": { "node": ">=22.12.0" }`.

#### Scenario: Binary is executable after global install

- GIVEN `npm install -g nukebg-cli` (or `npm link` for local testing)
- WHEN `nukebg --version` is executed in a terminal
- THEN the package version is printed and the exit code is 0

#### Scenario: CLI does not bundle ORT-web

- GIVEN the built `packages/nukebg-cli/dist/` directory
- WHEN its files are scanned for references to `onnxruntime-web`
- THEN no such reference is found

---

### REQ-DIST-4: Browser app package stays private

**Statement**: The browser application package (whether at the repo root or under `packages/nukebg-app`) MUST have `"private": true` in its `package.json`. It MUST NOT be published to npm. It MUST depend on `nukebg-core` via the workspace protocol (`"nukebg-core": "*"` or `"workspace:*"`).

#### Scenario: App package is excluded from publish

- GIVEN `npm publish --workspaces --dry-run` is executed at the repo root
- WHEN the output is inspected
- THEN the browser app package is NOT listed as a package to be published

---

### REQ-DIST-5: Root `npm test` runs all package tests

**Statement**: Running `npm test` at the repo root MUST execute the test suites of all workspace packages. The root MUST delegate via `npm test --workspaces` or an equivalent. All packages MUST have a `"test"` script in their `package.json`. A failure in any package's tests MUST cause the root `npm test` to exit non-zero.

Each package MUST have its own `vitest.config.ts` (or equivalent). The root MAY have a shared vitest config that is extended per package, but each package's tests MUST be runnable in isolation via `npm test` inside that package directory.

#### Scenario: Root test command runs all packages

- GIVEN the workspace is set up and all packages have passing tests
- WHEN `npm test` is run at the repo root
- THEN tests from `nukebg-core`, `nukebg-cli`, and the browser app all execute
- AND the exit code is 0

#### Scenario: One package failure fails root

- GIVEN `nukebg-core` has a failing test
- WHEN `npm test` is run at the repo root
- THEN the exit code is non-zero
- AND the failure output identifies the failing package

---

### REQ-DIST-6: Workspace dependency graph is acyclic

**Statement**: The workspace dependency graph MUST be a directed acyclic graph. Specifically:
- `nukebg-core` MUST NOT depend on `nukebg-cli` or the browser app.
- `nukebg-cli` MUST NOT depend on the browser app.
- The browser app MAY depend on `nukebg-core`.

This constraint is enforced at `npm install` time by the workspace resolver; a cycle would cause installation to fail or produce incorrect resolution. It is listed here for `sdd-verify` awareness.

#### Scenario: No circular dependency

- GIVEN the workspace is fully installed
- WHEN `npm ls --workspaces` or a dependency graph tool is run
- THEN no cycle involving any workspace package is reported
