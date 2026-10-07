// Bundles the Electron main process and preload script from TypeScript to
// CommonJS with esbuild (D7). Vite builds the renderer separately.
//
// Why bundle rather than run tsc:
// - Sandboxed preload scripts can't `require` local files, so the preload must
//   be a single file.
// - Bundling lets main and preload import the shared IPC contract from
//   src/shared without a second build output tree.
//
// Native and Electron modules stay external: they're resolved at runtime from
// node_modules (better-sqlite3 has a compiled .node binary).
//
// Usage: node scripts/build-electron.mjs [--watch]

import * as esbuild from 'esbuild'

const watch = process.argv.includes('--watch')

/** @type {esbuild.BuildOptions} */
const common = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  sourcemap: true,
  external: ['electron', 'better-sqlite3'],
  logLevel: 'info',
}

const builds = [
  { ...common, entryPoints: ['electron/main.ts'], outfile: 'dist-electron/main.cjs' },
  { ...common, entryPoints: ['electron/preload.ts'], outfile: 'dist-electron/preload.cjs' },
]

if (watch) {
  for (const options of builds) {
    const ctx = await esbuild.context(options)
    await ctx.watch()
  }
} else {
  await Promise.all(builds.map((options) => esbuild.build(options)))
}
