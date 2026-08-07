import { isIP } from 'node:net';
import type { NextRequest } from 'next/server';
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

export async function notifyMailAlertsLogin(input: {
  account: string;
  ip: string | null;
  userAgent: string | null;
}): Promise<void> {
  const baseUrl = process.env.MAIL_ALERTS_URL;
  const secret = process.env.MAIL_ALERTS_SECRET;
  if (!baseUrl || !secret) {
    logger.warn('Mail alerts login notification skipped: service is not configured');
    return;
  }
  if (!input.ip) {
    logger.warn('Mail alerts login notification skipped: proxy did not provide a valid client IP');
    return;
  }

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
      headers: {
        'Content-Type': 'application/json',
        'X-Alert-Secret': secret,
      },
      body: JSON.stringify({
        id: crypto.randomUUID(),
        type: 'webmail.login.success',
        severity: 'info',
        createdAt: new Date().toISOString(),
        data: {
          account: input.account,
          ip: input.ip,
          userAgent: input.userAgent?.slice(0, 512),
        },
      }),
      signal: AbortSignal.timeout(ALERT_TIMEOUT_MS),
    });
    if (!response.ok) {
      logger.warn('Mail alerts login notification rejected', { status: response.status });
      return;
    }
    logger.info('Mail alerts login notification delivered', { account: input.account, ip: input.ip });
  } catch (error) {
    logger.warn('Mail alerts login notification failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
