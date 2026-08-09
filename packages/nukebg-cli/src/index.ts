// nukebg-cli ships as a command-line binary only — see the `bin` entry in
// package.json (`nukebg` -> dist/cli.js).
//
// There is deliberately no library surface: `main`/`types` were removed from
// the manifest because tsup builds a single `cli` entry with `dts: false`, so
// no `dist/index.js` or `dist/index.d.ts` is ever emitted and a consumer
// importing this package would hit ERR_MODULE_NOT_FOUND.
//
// If a programmatic API is wanted later, add an `index` entry to
// tsup.config.ts with `dts: true`, export the intended surface from this file,
// and restore `main`/`types` together — all three, or none.
export {};
