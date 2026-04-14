/**
 * Type shim for onnxruntime-web.
 *
 * The package ships `types.d.ts` but omits it from its `exports` map, so
 * `moduleResolution: "bundler"` can't locate the types. This triple-slash
 * reference pulls them in explicitly. Drop this shim if upstream ever
 * adds `"types"` conditions to the package's exports.
 */
/// <reference path="../../node_modules/onnxruntime-web/types.d.ts" />
