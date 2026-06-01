// Makes every mockup fully self-contained so it renders when opened directly
// (file://), with no external CSS or font requests. Fonts are embedded as base64.
// Run: node docs/design/mockups/build-standalone.mjs
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = path.dirname(fileURLToPath(import.meta.url))
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

async function fetchText(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!r.ok) throw new Error(`${url} -> ${r.status}`)
  return r.text()
}
async function fetchDataUri(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!r.ok) throw new Error(`${url} -> ${r.status}`)
  const buf = Buffer.from(await r.arrayBuffer())
  return `data:font/woff2;base64,${buf.toString('base64')}`
}

// Rebuild each @font-face with a single base64 woff2 src. Optionally keep only
// some subsets (Google ships one @font-face per unicode-range subset).
async function embed(css, keepSubsets) {
  let out = ''
  const re = /(?:\/\*\s*([\w-]+)\s*\*\/\s*)?(@font-face\s*\{[^}]*\})/g
  let m
  while ((m = re.exec(css))) {
    const subset = m[1]
    const block = m[2]
    if (keepSubsets && subset && !keepSubsets.includes(subset)) continue
    const um = block.match(/url\((['"]?)((?:https?:)?\/\/[^)'"\s]+\.woff2)\1\)/)
    if (!um) continue
    let furl = um[2]
    if (furl.startsWith('//')) furl = 'https:' + furl
    const data = await fetchDataUri(furl)
    const pick = (re2) => (block.match(re2) || [''])[0]
    const fam = pick(/font-family:[^;]+;/)
    const styl = pick(/font-style:[^;]+;/) || 'font-style:normal;'
    const wght = pick(/font-weight:[^;]+;/) || 'font-weight:400;'
    const range = pick(/unicode-range:[^;]+;/)
    out += `@font-face{${fam}${styl}${wght}font-display:swap;src:url(${data}) format("woff2");${range}}\n`
  }
  return out
}

console.log('Fetching font CSS...')
const fontshareCss = await fetchText(
  'https://api.fontshare.com/v2/css?f[]=cabinet-grotesk@700,800&f[]=general-sans@400,500,600&display=swap',
)
const googleCss = await fetchText('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&display=swap')

console.log('Embedding fonts as base64...')
const fonts = (await embed(fontshareCss)) + (await embed(googleCss, ['latin', 'latin-ext']))
await fs.writeFile(path.join(dir, '_fonts-inline.css'), fonts)
console.log(`  fonts payload: ${(fonts.length / 1024).toFixed(0)} KB`)

const system = await fs.readFile(path.join(dir, 'system.css'), 'utf8')

const files = [
  'index.html',
  'dashboard.html',
  'signup.html',
  'provisioning.html',
  'employees.html',
  'employees-empty.html',
  'mobile.html',
  'keycloak-login.html',
]

for (const f of files) {
  const p = path.join(dir, f)
  let html = await fs.readFile(p, 'utf8')
  if (html.includes('data-inlined="hrobot"')) {
    console.log(`  skip ${f} (already inlined)`)
    continue
  }
  const hadSystem = /href="system\.css"/.test(html)
  // strip all external stylesheet/font/preconnect links
  html = html.replace(/<link[^>]*(fontshare|googleapis|gstatic|preconnect|system\.css)[^>]*>\s*/g, '')
  const style = `<style data-inlined="hrobot">\n${fonts}${hadSystem ? system : ''}</style>\n`
  html = html.replace('</head>', style + '</head>')
  await fs.writeFile(p, html)
  console.log(`  inlined ${f} -> ${(html.length / 1024).toFixed(0)} KB${hadSystem ? ' (+system.css)' : ''}`)
}

console.log('Done.')
