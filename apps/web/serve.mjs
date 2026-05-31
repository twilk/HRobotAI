// Zero-dependency dev server for the HRobot onboarding web app.
// Serves the static SPA and reverse-proxies the API so the browser stays same-origin
// (no CORS, no backend changes):
//   /api/*   -> control-plane API   (default http://localhost:3000)
//   /tapi/*  -> tenant-runtime API  (default http://localhost:3001), path rewritten to /api/*
//
// Usage:  node apps/web/serve.mjs           (then open http://localhost:5173)
//   env:  WEB_PORT, CONTROL_PLANE_ORIGIN, TENANT_RUNTIME_ORIGIN
import { createServer, request as httpRequest } from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, extname, join, normalize } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const WEB_PORT = Number(process.env.WEB_PORT ?? 5173)
const CONTROL_PLANE = process.env.CONTROL_PLANE_ORIGIN ?? 'http://localhost:3000'
const TENANT_RUNTIME = process.env.TENANT_RUNTIME_ORIGIN ?? 'http://localhost:3001'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
}

/** Proxy an incoming request to `origin`, optionally rewriting the path. */
function proxy(clientReq, clientRes, origin, path) {
  const target = new URL(origin)
  const upstream = httpRequest(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port,
      method: clientReq.method,
      path,
      headers: { ...clientReq.headers, host: target.host },
    },
    (upRes) => {
      clientRes.writeHead(upRes.statusCode ?? 502, upRes.headers)
      upRes.pipe(clientRes)
    },
  )
  upstream.on('error', (err) => {
    clientRes.writeHead(502, { 'content-type': 'application/json' })
    clientRes.end(
      JSON.stringify({
        error: 'upstream_unreachable',
        detail: `Could not reach ${origin}. Is the API running? (${err.message})`,
      }),
    )
  })
  clientReq.pipe(upstream)
}

const server = createServer(async (req, res) => {
  const url = req.url ?? '/'
  // API proxies
  if (url.startsWith('/api/')) return proxy(req, res, CONTROL_PLANE, url)
  if (url.startsWith('/tapi/')) return proxy(req, res, TENANT_RUNTIME, url.replace(/^\/tapi/, '/api'))

  // Static files (SPA: anything else serves index.html)
  let pathname = decodeURIComponent(url.split('?')[0])
  if (pathname === '/' || !extname(pathname)) pathname = '/index.html'
  const filePath = join(HERE, normalize(pathname).replace(/^(\.\.[/\\])+/, ''))
  try {
    const body = await readFile(filePath)
    res.writeHead(200, { 'content-type': MIME[extname(filePath)] ?? 'application/octet-stream' })
    res.end(body)
  } catch {
    // SPA fallback
    const body = await readFile(join(HERE, 'index.html'))
    res.writeHead(200, { 'content-type': MIME['.html'] })
    res.end(body)
  }
})

server.listen(WEB_PORT, () => {
  console.log(`HRobot onboarding web app:  http://localhost:${WEB_PORT}`)
  console.log(`  /api  -> ${CONTROL_PLANE}   (control-plane)`)
  console.log(`  /tapi -> ${TENANT_RUNTIME}  (tenant-runtime)`)
})
