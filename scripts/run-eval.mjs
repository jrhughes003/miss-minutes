// Runs a TypeScript eval script: bundles it with esbuild (so TypeScript and
// the app's own modules just work) into node_modules/.tmp, then runs it with
// the remaining arguments.   node scripts/run-eval.mjs eval/parse/run.ts --system baseline
import { spawnSync } from 'node:child_process'
import * as esbuild from 'esbuild'

const [entry, ...rest] = process.argv.slice(2)
if (!entry) {
  console.error('usage: node scripts/run-eval.mjs <entry.ts> [args...]')
  process.exit(2)
}
const outfile = 'node_modules/.tmp/eval-run.cjs'
await esbuild.build({ entryPoints: [entry], bundle: true, platform: 'node', target: 'node22', format: 'cjs', outfile, logLevel: 'error', external: ['electron'] })
const { status } = spawnSync(process.execPath, [outfile, ...rest], { stdio: 'inherit' })
process.exit(status ?? 1)
