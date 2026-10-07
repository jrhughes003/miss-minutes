// Starts Electron on this project with a clean environment.
//
// Some parent processes (VS Code's extension host, other Electron apps) export
// ELECTRON_RUN_AS_NODE=1. Electron then runs as plain Node and no window ever
// appears, which looks like a hang. Removing it here makes `npm run
// electron:dev` behave the same whatever terminal it was started from.
import { spawn } from 'node:child_process'
import electronPath from 'electron'

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const child = spawn(electronPath, ['.', ...process.argv.slice(2)], { stdio: 'inherit', env })
child.on('exit', (code) => process.exit(code ?? 0))
