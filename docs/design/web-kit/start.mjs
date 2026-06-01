// Serves the production build (`next start`) with cwd pinned here, so it can be
// launched from the repo root. Run `npm run build` first. No HMR (stable for screenshots).
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = dirname(fileURLToPath(import.meta.url))
const nextBin = join(dir, 'node_modules', 'next', 'dist', 'bin', 'next')

const child = spawn(process.execPath, [nextBin, 'start', '-p', '5601'], {
  cwd: dir,
  stdio: 'inherit',
})

child.on('exit', (code) => process.exit(code ?? 0))
