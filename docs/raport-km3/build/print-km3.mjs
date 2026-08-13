// Render docs/raport-km3/report.html -> Raport_KM3_HRobot.pdf via Chrome DevTools Protocol,
// with a repeating logo header and a page-numbered footer. Adapted 1:1 from raport-km2 print-cdp.mjs.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ROOT = path.join(import.meta.dirname, '..');
const HTML = 'file:///' + path.join(ROOT, 'report.html').replace(/\\/g, '/');
const OUT = path.join(ROOT, 'Raport_KM3_HRobot.pdf');
const LOGO = fs.readFileSync(path.join(ROOT, 'assets', 'logo-bar.png')).toString('base64');
const PORT = 9337;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
  '--hide-scrollbars', '--disable-application-cache', '--disk-cache-size=1', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${process.env.TEMP}\\hr-km3-${Date.now()}`, HTML,
], { stdio: 'ignore' });

async function getPageWS() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json`);
      const list = await r.json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(300);
  }
  throw new Error('DevTools endpoint not ready');
}

function rpc(ws, id, method, params) {
  return new Promise((resolve, reject) => {
    const onMsg = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id === id) { ws.removeEventListener('message', onMsg); m.error ? reject(new Error(m.error.message)) : resolve(m.result); }
    };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

const wsUrl = await getPageWS();
const ws = new WebSocket(wsUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });

await rpc(ws, 1, 'Page.enable', {});
await sleep(2500);

const header = `<div style="width:100%; text-align:center; margin:0; padding:0;">
  <img src="data:image/png;base64,${LOGO}" style="height:34px;"></div>`;
const footer = `<div style="width:100%; font-size:8px; color:#666; text-align:center; padding:0 12mm;">
  HRobot.AI · App Pro sp. z o.o. — Raport z realizacji Kamienia Milowego 3 · Poufne · Strona <span class="pageNumber"></span> / <span class="totalPages"></span></div>`;

const result = await rpc(ws, 2, 'Page.printToPDF', {
  landscape: false,
  printBackground: true,
  displayHeaderFooter: true,
  headerTemplate: header,
  footerTemplate: footer,
  paperWidth: 8.27, paperHeight: 11.69,
  marginTop: 0.72, marginBottom: 0.55, marginLeft: 0.63, marginRight: 0.63,
  preferCSSPageSize: false,
});

fs.writeFileSync(OUT, Buffer.from(result.data, 'base64'));
console.log('WROTE', OUT, (fs.statSync(OUT).size / 1024).toFixed(0) + 'KB');
ws.close();
chrome.kill();
process.exit(0);
