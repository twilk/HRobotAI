// Launches `next dev` with cwd pinned to this folder, so it can be started from
// the repo root (the Claude preview tool runs launch.json commands from root).
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = dirname(fileURLToPath(import.meta.url))
const nextBin = join(dir, 'node_modules', 'next', 'dist', 'bin', 'next')

const child = spawn(process.execPath, [nextBin, 'dev', '-p', '5601'], {
  cwd: dir,
  stdio: 'inherit',
})

child.on('exit', (code) => process.exit(code ?? 0))
