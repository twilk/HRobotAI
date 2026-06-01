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
import { dirname, extname, join, normalize, resolve, sep } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE)
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

// Hop-by-hop headers must not be forwarded across a proxy (RFC 7230 §6.1).
const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'proxy-connection', 'te', 'trailer', 'transfer-encoding', 'upgrade',
])
function endToEnd(headers) {
  const out = {}
  for (const [k, v] of Object.entries(headers)) {
    if (!HOP_BY_HOP.has(k.toLowerCase())) out[k] = v
  }
  return out
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
      headers: { ...endToEnd(clientReq.headers), host: target.host },
    },
    (upRes) => {
      clientRes.writeHead(upRes.statusCode ?? 502, endToEnd(upRes.headers))
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

  // Static files (SPA: missing/extension-less paths fall back to index.html).
  let pathname
  try {
    pathname = decodeURIComponent(url.split('?')[0])
  } catch {
    pathname = '/index.html' // malformed percent-encoding (e.g. "/%") -> serve the app
  }
  if (pathname === '/' || !extname(pathname)) pathname = '/index.html'
  const filePath = resolve(ROOT, '.' + normalize(pathname).replace(/\\/g, '/'))
  // Containment check: never serve anything outside the web root.
  if (filePath !== ROOT && !filePath.startsWith(ROOT + sep)) {
    const body = await readFile(join(ROOT, 'index.html'))
    res.writeHead(200, { 'content-type': MIME['.html'] })
    return res.end(body)
  }
  try {
    const body = await readFile(filePath)
    res.writeHead(200, { 'content-type': MIME[extname(filePath)] ?? 'application/octet-stream' })
    res.end(body)
  } catch {
    const body = await readFile(join(ROOT, 'index.html')) // SPA fallback
    res.writeHead(200, { 'content-type': MIME['.html'] })
    res.end(body)
  }
})

server.listen(WEB_PORT, () => {
  console.log(`HRobot onboarding web app:  http://localhost:${WEB_PORT}`)
  console.log(`  /api  -> ${CONTROL_PLANE}   (control-plane)`)
  console.log(`  /tapi -> ${TENANT_RUNTIME}  (tenant-runtime)`)
})
