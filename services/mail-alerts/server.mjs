import { createServer } from 'node:http';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { timingSafeEqual } from 'node:crypto';

const port = Number(process.env.PORT || 8080);
const telegramToken = required('TELEGRAM_BOT_TOKEN');
const telegramChatId = required('TELEGRAM_CHAT_ID');
const webhookSecret = required('WEBHOOK_SECRET');
const uiUsername = required('ALERTS_UI_USERNAME');
const uiPassword = required('ALERTS_UI_PASSWORD');
const statePath = process.env.STATE_PATH || '/data/state.json';
const maxBodyBytes = 128 * 1024;
const maxEvents = 50;

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be configured`);
  return value;
}

const state = {
  startedAt: new Date().toISOString(),
  received: 0,
  telegramSent: 0,
  telegramFailed: 0,
  lastError: null,
  events: [],
};

async function loadState() {
  try {
    Object.assign(state, JSON.parse(await readFile(statePath, 'utf8')));
    state.events = Array.isArray(state.events) ? state.events.slice(0, maxEvents) : [];
  } catch (error) {
    if (error?.code !== 'ENOENT') console.error('Unable to restore alert state:', error);
  }
}

async function saveState() {
  await mkdir(new URL('.', `file://${statePath}`).pathname, { recursive: true });
  const temporary = `${statePath}.tmp`;
  await writeFile(temporary, JSON.stringify(state), { mode: 0o600 });
  await rename(temporary, statePath);
}

function secureEqual(actual, expected) {
  const actualBuffer = Buffer.from(actual || '');
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function hasUiAccess(request) {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith('Basic ')) return false;
  try {
    const credentials = Buffer.from(authorization.slice(6), 'base64').toString('utf8');
    const separator = credentials.indexOf(':');
    if (separator < 0) return false;
    const username = credentials.slice(0, separator);
    const password = credentials.slice(separator + 1);
    return secureEqual(username, uiUsername) && secureEqual(password, uiPassword);
  } catch {
    return false;
  }
}

function requestUiAccess(response) {
  response.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Mail alerts", charset="UTF-8"' });
  response.end('Authentication required');
}

function json(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

function html(response) {
  response.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'",
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(PAGE);
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBodyBytes) {
        reject(Object.assign(new Error('Payload too large'), { status: 413 }));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(Object.assign(new Error('Invalid JSON'), { status: 400 })); }
    });
    request.on('error', reject);
  });
}

function compactData(data) {
  if (!data || typeof data !== 'object') return '';
  const denied = new Set(['body', 'messageBody', 'htmlBody', 'raw', 'password', 'token', 'secret', 'authorization']);
  const safe = Object.fromEntries(Object.entries(data)
    .filter(([key]) => !denied.has(key.toLowerCase()))
    .slice(0, 12)
    .map(([key, value]) => [key, typeof value === 'string' ? value.slice(0, 320) : value]));
  const result = JSON.stringify(safe, null, 2);
  return result === '{}' ? '' : result.slice(0, 2200);
}

function normaliseEvent(event) {
  return {
    id: typeof event?.id === 'string' ? event.id : crypto.randomUUID(),
    type: typeof event?.type === 'string' ? event.type : 'unknown.event',
    createdAt: typeof event?.createdAt === 'string' ? event.createdAt : new Date().toISOString(),
    details: compactData(event?.data),
  };
}

function formatTelegram(events, test = false) {
  if (test) return '✅ Mail Alerts: Telegram connection works.';
  const lines = ['🚨 Stalwart alert'];
  for (const event of events.slice(0, 8)) {
    lines.push(`\n• ${event.type}\n${event.createdAt}`);
    if (event.details) lines.push(event.details);
  }
  return lines.join('\n').slice(0, 3900);
}

async function sendTelegram(message) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: telegramChatId, text: message }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Telegram API returned ${response.status}`);
    state.telegramSent += 1;
    state.lastError = null;
  } catch (error) {
    state.telegramFailed += 1;
    state.lastError = `Telegram: ${error instanceof Error ? error.message : 'unknown error'}`;
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function handleWebhook(request, response) {
  if (!secureEqual(request.headers['x-alert-secret'], webhookSecret)) return json(response, 401, { error: 'Unauthorized' });
  try {
    const payload = await readJsonBody(request);
    const events = Array.isArray(payload.events) ? payload.events.map(normaliseEvent) : [];
    if (events.length === 0) return json(response, 400, { error: 'No events supplied' });
    state.received += events.length;
    state.events.unshift(...events);
    state.events.splice(maxEvents);
    await sendTelegram(formatTelegram(events));
    await saveState();
    return json(response, 202, { accepted: events.length });
  } catch (error) {
    state.lastError = error instanceof Error ? error.message : 'Webhook processing failed';
    await saveState().catch(() => {});
    return json(response, error?.status || 502, { error: state.lastError });
  }
}

const PAGE = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mail Alerts</title><style>body{margin:0;background:#f5f7fb;color:#172033;font:14px system-ui,sans-serif}.wrap{max-width:1000px;margin:0 auto;padding:32px 20px}header{display:flex;justify-content:space-between;align-items:center;margin-bottom:24px}h1{margin:0;font-size:24px}.status{color:#16803c}.error{color:#bf3131}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.card,section{background:#fff;border:1px solid #dce2ed;border-radius:12px;padding:16px;box-shadow:0 1px 2px #17203308}.num{font-size:26px;font-weight:700;margin-top:8px}section{margin-top:16px}button{background:#2463eb;color:#fff;border:0;border-radius:8px;padding:9px 13px;font-weight:600;cursor:pointer}button:disabled{opacity:.6}.event{border-top:1px solid #e8ecf3;padding:13px 0}.event:first-child{border:0}.event h3{font-size:14px;margin:0 0 4px}.event time{color:#64748b;font-size:12px}.event pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f7f9fc;border-radius:6px;padding:8px;font-size:12px;margin:8px 0 0}@media(max-width:680px){.grid{grid-template-columns:repeat(2,1fr)}}</style></head><body><main class="wrap"><header><div><h1>Mail Alerts</h1><p id="connection">Loading status…</p></div><button id="test">Send test to Telegram</button></header><div class="grid" id="stats"></div><section><h2>Last events</h2><div id="events"></div></section></main><script>const esc=(v)=>String(v??'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));async function refresh(){const r=await fetch('/api/status');const s=await r.json();document.querySelector('#connection').innerHTML=s.lastError?'<span class="error">'+esc(s.lastError)+'</span>':'<span class="status">Telegram connection ready</span>';document.querySelector('#stats').innerHTML=[['Received',s.received],['Telegram sent',s.telegramSent],['Telegram failed',s.telegramFailed],['Started',new Date(s.startedAt).toLocaleString()]].map(([n,v])=>'<div class="card"><span>'+n+'</span><div class="num">'+esc(v)+'</div></div>').join('');document.querySelector('#events').innerHTML=s.events.length?s.events.map(e=>'<article class="event"><h3>'+esc(e.type)+'</h3><time>'+esc(new Date(e.createdAt).toLocaleString())+'</time>'+(e.details?'<pre>'+esc(e.details)+'</pre>':'')+'</article>').join(''):'<p>No events received yet.</p>'}document.querySelector('#test').onclick=async e=>{e.target.disabled=true;try{const r=await fetch('/api/test',{method:'POST'});if(!r.ok)throw new Error((await r.json()).error);await refresh()}catch(err){alert('Test failed: '+err.message)}finally{e.target.disabled=false}};refresh();setInterval(refresh,10000)</script></body></html>`;

await loadState();
createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  if (request.method === 'GET' && url.pathname === '/health') return json(response, 200, { ok: true });
  if (request.method === 'POST' && url.pathname === '/webhook/stalwart') return handleWebhook(request, response);
  if (!hasUiAccess(request)) return requestUiAccess(response);
  if (request.method === 'GET' && url.pathname === '/') return html(response);
  if (request.method === 'GET' && url.pathname === '/api/status') return json(response, 200, state);
  if (request.method === 'POST' && url.pathname === '/api/test') {
    try { await sendTelegram(formatTelegram([], true)); await saveState(); return json(response, 200, { ok: true }); }
    catch { await saveState().catch(() => {}); return json(response, 502, { error: state.lastError }); }
  }
  return json(response, 404, { error: 'Not found' });
}).listen(port, '0.0.0.0', () => console.log(`Mail alerts listening on ${port}`));
