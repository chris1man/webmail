import { isIP } from 'node:net';
import type { NextRequest } from 'next/server';
import type { LoginFingerprint } from '@/lib/security/login-fingerprint';
import { logger } from '@/lib/logger';

const ALERT_TIMEOUT_MS = 5_000;

function firstForwardedIp(value: string | null): string | null {
  const candidate = value?.split(',')[0]?.trim();
  return candidate && isIP(candidate) ? candidate : null;
}

export function requestClientIp(request: NextRequest): string | null {
  return firstForwardedIp(request.headers.get('x-forwarded-for'))
    ?? firstForwardedIp(request.headers.get('x-real-ip'));
}

/**
 * This accepts only a bounded browser snapshot. It is diagnostic data, never
 * an authentication factor: clients can omit or forge every one of its fields.
 */
function normaliseFingerprint(value: unknown) {
  if (!value || typeof value !== 'object') return null;
  const fingerprint = value as Partial<LoginFingerprint>;
  if (typeof fingerprint.visitorId !== 'string' || !fingerprint.visitorId) return null;
  const profile: Partial<LoginFingerprint['profile']> = fingerprint.profile || {};
  return {
    visitorId: fingerprint.visitorId.slice(0, 128),
    confidence: typeof fingerprint.confidence === 'number' ? Math.max(0, Math.min(1, fingerprint.confidence)) : null,
    version: typeof fingerprint.version === 'string' ? fingerprint.version.slice(0, 32) : 'unknown',
    profile: {
      userAgent: typeof profile.userAgent === 'string' ? profile.userAgent.slice(0, 512) : null,
      browser: typeof profile.browser === 'string' ? profile.browser.slice(0, 120) : null,
      os: typeof profile.os === 'string' ? profile.os.slice(0, 120) : null,
      language: typeof profile.language === 'string' ? profile.language.slice(0, 32) : null,
      timezone: typeof profile.timezone === 'string' ? profile.timezone.slice(0, 80) : null,
      screen: typeof profile.screen === 'string' ? profile.screen.slice(0, 80) : null,
      cpuCores: typeof profile.cpuCores === 'number' ? profile.cpuCores : null,
      deviceMemoryGb: typeof profile.deviceMemoryGb === 'number' ? profile.deviceMemoryGb : null,
      touchPoints: typeof profile.touchPoints === 'number' ? profile.touchPoints : null,
    },
    // Client-side code has already depth/length-limited this snapshot. The
    // 128 KiB Mail Alerts request limit is the final bound.
    components: fingerprint.components && typeof fingerprint.components === 'object' ? fingerprint.components : {},
  };
}

export async function notifyMailAlertsLogin(input: {
  account: string;
  ip: string | null;
  userAgent: string | null;
  fingerprint?: LoginFingerprint | null;
}): Promise<void> {
  const baseUrl = process.env.MAIL_ALERTS_URL;
  const secret = process.env.MAIL_ALERTS_SECRET;
  if (!baseUrl || !secret || !input.ip) return;

  let endpoint: URL;
  try {
    endpoint = new URL('/webhook/system', baseUrl);
    if (!['http:', 'https:'].includes(endpoint.protocol)) return;
  } catch {
    logger.warn('Mail alerts login notification disabled: invalid MAIL_ALERTS_URL');
    return;
  }

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Alert-Secret': secret },
      body: JSON.stringify({
        id: crypto.randomUUID(), type: 'webmail.login.success', severity: 'info', createdAt: new Date().toISOString(),
        data: {
          account: input.account, ip: input.ip, userAgent: input.userAgent?.slice(0, 512),
          fingerprint: normaliseFingerprint(input.fingerprint),
        },
      }),
      signal: AbortSignal.timeout(ALERT_TIMEOUT_MS),
    });
    if (!response.ok) logger.warn('Mail alerts login notification rejected', { status: response.status });
  } catch (error) {
    logger.warn('Mail alerts login notification failed', { error: error instanceof Error ? error.message : 'Unknown error' });
  }
}
