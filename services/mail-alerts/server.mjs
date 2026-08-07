import { createServer } from 'node:http';
import { readJsonBody, secureEqual, verifyHmac } from './lib/http.mjs';
import { createStateStore } from './lib/state.mjs';
import { createTelegramClient } from './lib/telegram.mjs';
import { blockIp } from './lib/stalwart.mjs';
import { renderPage } from './lib/ui.mjs';

const port = Number(process.env.PORT || 8080);
const telegramToken = required('TELEGRAM_BOT_TOKEN');
const telegramChatId = required('TELEGRAM_CHAT_ID');
const webhookSecret = required('WEBHOOK_SECRET');
const uiUsername = required('ALERTS_UI_USERNAME');
const uiPassword = required('ALERTS_UI_PASSWORD');
const telegramPolling = process.env.TELEGRAM_POLLING !== 'false';
const state = createStateStore(process.env.STATE_PATH || '/data/state.json');
const telegram = createTelegramClient({
  token: telegramToken,
  chatId: telegramChatId,
  state,
  apiBase: process.env.TELEGRAM_API_BASE || 'https://api.telegram.org',
});
const maxBodyBytes = 128 * 1024;

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be configured`);
  return value;
}

function json(response, status, body) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(body));
}

function hasUiAccess(request) {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith('Basic ')) return false;
  try {
    const credentials = Buffer.from(authorization.slice(6), 'base64').toString('utf8');
    const separator = credentials.indexOf(':');
    if (separator < 0) return false;
    return secureEqual(credentials.slice(0, separator), uiUsername)
      && secureEqual(credentials.slice(separator + 1), uiPassword);
  } catch {
    return false;
  }
}

function requestUiAccess(response) {
  response.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Mail alerts", charset="UTF-8"' });
  response.end('Authentication required');
}

function html(response) {
  response.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'",
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(renderPage());
}

function eventFromSystemPayload(payload) {
  return {
    id: typeof payload?.id === 'string' ? payload.id : crypto.randomUUID(),
    type: typeof payload?.type === 'string' ? payload.type : 'system.unknown',
    severity: typeof payload?.severity === 'string' ? payload.severity : 'error',
    createdAt: typeof payload?.createdAt === 'string' ? payload.createdAt : new Date().toISOString(),
    data: payload?.data && typeof payload.data === 'object' ? payload.data : { message: payload?.message },
  };
}

function credentialsForStalwart() {
  const url = process.env.STALWART_JMAP_URL;
  const token = process.env.STALWART_API_TOKEN;
  return url && token ? { url, token } : null;
}

async function blockLoginIp(action) {
  const credentials = credentialsForStalwart();
  if (!credentials) throw new Error('Stalwart API is not configured');
  const expiresAt = new Date(Date.now() + action.durationHours * 60 * 60 * 1000).toISOString();
  await blockIp({ ...credentials, address: action.ip, expiresAt });
  await state.recordAction({
    type: 'ip.blocked',
    account: action.account,
    ip: action.ip,
    durationHours: action.durationHours,
    expiresAt,
  });
  return expiresAt;
}

async function receiveStalwart(request, response) {
  try {
    const raw = await readJsonBody(request, maxBodyBytes);
    if (!verifyHmac(raw.body, request.headers['x-signature'], webhookSecret)) {
      return json(response, 401, { error: 'Invalid Stalwart signature' });
    }
    const payload = raw.json;
    if (!Array.isArray(payload.events) || payload.events.length === 0) return json(response, 400, { error: 'No events supplied' });
    const result = await state.recordStalwartEvents(payload.events);
    await telegram.sendCritical(result.critical);
    for (const login of result.newLogins) await telegram.sendNewLogin(login);
    return json(response, 202, { accepted: result.accepted, newLogins: result.newLogins.length });
  } catch (error) {
    await state.setError(error);
    return json(response, error?.status || 502, { error: error instanceof Error ? error.message : 'Webhook processing failed' });
  }
}

async function receiveSystem(request, response) {
  if (!secureEqual(request.headers['x-alert-secret'], webhookSecret)) return json(response, 401, { error: 'Unauthorized' });
  try {
    const { json: payload } = await readJsonBody(request, maxBodyBytes);
    const event = await state.recordSystemEvent(eventFromSystemPayload(payload));
    await telegram.sendCritical([event]);
    return json(response, 202, { accepted: 1 });
  } catch (error) {
    await state.setError(error);
    return json(response, error?.status || 502, { error: error instanceof Error ? error.message : 'Webhook processing failed' });
  }
}

await state.load();
telegram.startPolling({
  enabled: telegramPolling,
  onAllow: async (action) => state.trustIp(action.account, action.ip),
  onBlock: blockLoginIp,
});

createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  if (request.method === 'GET' && url.pathname === '/health') return json(response, 200, { ok: true });
  if (request.method === 'POST' && url.pathname === '/webhook/stalwart') return receiveStalwart(request, response);
  if (request.method === 'POST' && url.pathname === '/webhook/system') return receiveSystem(request, response);
  if (!hasUiAccess(request)) return requestUiAccess(response);
  if (request.method === 'GET' && url.pathname === '/') return html(response);
  if (request.method === 'GET' && url.pathname === '/api/status') return json(response, 200, state.publicStatus());
  if (request.method === 'POST' && url.pathname === '/api/test') {
    try {
      await telegram.sendTest();
      return json(response, 200, { ok: true });
    } catch (error) {
      await state.setError(error);
      return json(response, 502, { error: error instanceof Error ? error.message : 'Telegram test failed' });
    }
  }
  return json(response, 404, { error: 'Not found' });
}).listen(port, '0.0.0.0', () => console.log(`Mail alerts listening on ${port}`));
