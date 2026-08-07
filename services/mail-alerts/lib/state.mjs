import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const maxEvents = 100;
const maxActions = 100;
const maxHandledIds = 500;
const maxKnownIpsPerAccount = 30;

function compactData(data) {
  if (!data || typeof data !== 'object') return '';
  const denied = new Set(['body', 'messagebody', 'htmlbody', 'raw', 'password', 'token', 'secret', 'authorization']);
  const safe = Object.fromEntries(Object.entries(data)
    .filter(([key]) => !denied.has(key.toLowerCase()))
    .slice(0, 12)
    .map(([key, value]) => [key, typeof value === 'string' ? value.slice(0, 320) : value]));
  const result = JSON.stringify(safe, null, 2);
  return result === '{}' ? '' : result.slice(0, 2200);
}

function extractLogin(data) {
  if (!data || typeof data !== 'object') return null;
  const account = ['accountName', 'account', 'email', 'username', 'login', 'principal']
    .map((key) => data[key]).find((value) => typeof value === 'string' && value.length > 0);
  const ip = ['remoteIp', 'remoteIP', 'ip', 'remote_ip']
    .map((key) => data[key]).find((value) => typeof value === 'string' && value.length > 0);
  return account && ip ? { account, ip } : null;
}

function normaliseEvent(event) {
  return {
    id: typeof event?.id === 'string' ? event.id : crypto.randomUUID(),
    type: typeof event?.type === 'string' ? event.type : 'unknown.event',
    severity: typeof event?.severity === 'string' ? event.severity : 'error',
    createdAt: typeof event?.createdAt === 'string' ? event.createdAt : new Date().toISOString(),
    data: event?.data && typeof event.data === 'object' ? event.data : {},
  };
}

function eventForStorage(event) {
  return { ...event, details: compactData(event.data), data: undefined };
}

export function createStateStore(path) {
  const state = {
    startedAt: new Date().toISOString(), received: 0, telegramSent: 0, telegramFailed: 0,
    lastError: null, events: [], actions: [], knownIps: {}, handledIds: [], pendingActions: {}, telegramUpdateOffset: 0,
  };

  async function save() {
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.tmp`;
    await writeFile(temporary, JSON.stringify(state), { mode: 0o600 });
    await rename(temporary, path);
  }

  function rememberEvent(event) {
    const stored = eventForStorage(event);
    state.events.unshift(stored);
    state.events.splice(maxEvents);
    return stored;
  }

  return {
    state,
    async load() {
      try {
        const restored = JSON.parse(await readFile(path, 'utf8'));
        Object.assign(state, restored);
        state.events = Array.isArray(state.events) ? state.events.slice(0, maxEvents) : [];
        state.actions = Array.isArray(state.actions) ? state.actions.slice(0, maxActions) : [];
        state.handledIds = Array.isArray(state.handledIds) ? state.handledIds.slice(0, maxHandledIds) : [];
        state.knownIps = state.knownIps && typeof state.knownIps === 'object' ? state.knownIps : {};
        state.pendingActions = state.pendingActions && typeof state.pendingActions === 'object' ? state.pendingActions : {};
      } catch (error) {
        if (error?.code !== 'ENOENT') console.error('Unable to restore alert state:', error);
      }
    },
    save,
    async setError(error) {
      state.lastError = error instanceof Error ? error.message : String(error || 'Unknown error');
      await save().catch(() => {});
    },
    async recordAction(action) {
      state.actions.unshift({ id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...action });
      state.actions.splice(maxActions);
      await save();
    },
    async recordSystemEvent(event) {
      const normalised = normaliseEvent(event);
      state.received += 1;
      const stored = rememberEvent(normalised);
      await save();
      return stored;
    },
    async recordStalwartEvents(events) {
      const critical = [];
      const newLogins = [];
      for (const raw of events) {
        const event = normaliseEvent(raw);
        if (state.handledIds.includes(event.id)) continue;
        state.handledIds.unshift(event.id);
        state.handledIds.splice(maxHandledIds);
        state.received += 1;
        const stored = rememberEvent(event);
        if (event.type === 'auth.success') {
          const login = extractLogin(event.data);
          if (login && !state.knownIps[login.account]?.[login.ip]) newLogins.push({ ...login, createdAt: event.createdAt });
        } else {
          critical.push(stored);
        }
      }
      await save();
      return { accepted: critical.length + newLogins.length, critical, newLogins };
    },
    async trustIp(account, ip) {
      const known = state.knownIps[account] || {};
      known[ip] = new Date().toISOString();
      const entries = Object.entries(known).sort(([, a], [, b]) => String(b).localeCompare(String(a))).slice(0, maxKnownIpsPerAccount);
      state.knownIps[account] = Object.fromEntries(entries);
      await this.recordAction({ type: 'ip.trusted', account, ip });
    },
    async createPendingAction(action) {
      const id = crypto.randomUUID().replaceAll('-', '').slice(0, 20);
      state.pendingActions[id] = { ...action, createdAt: new Date().toISOString(), expiresAt: Date.now() + 15 * 60 * 1000 };
      await save();
      return id;
    },
    async getPendingAction(id) {
      const action = state.pendingActions[id];
      if (!action || action.expiresAt < Date.now()) {
        delete state.pendingActions[id];
        await save();
        return null;
      }
      return action;
    },
    async removePendingAction(id) {
      delete state.pendingActions[id];
      await save();
    },
    async updateTelegramOffset(offset) {
      state.telegramUpdateOffset = offset;
      await save();
    },
    async incrementTelegram(success) {
      if (success) { state.telegramSent += 1; state.lastError = null; }
      else state.telegramFailed += 1;
      await save();
    },
    publicStatus() {
      return {
        startedAt: state.startedAt, received: state.received, telegramSent: state.telegramSent,
        telegramFailed: state.telegramFailed, lastError: state.lastError, events: state.events,
        actions: state.actions, knownIpCount: Object.values(state.knownIps).reduce((count, ips) => count + Object.keys(ips).length, 0),
      };
    },
  };
}
