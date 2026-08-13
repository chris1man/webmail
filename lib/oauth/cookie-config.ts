import { configManager } from '@/lib/admin/config-manager';
import { SESSION_COOKIE_MAX_AGE } from '@/lib/auth/session-cookie';

type SameSite = 'lax' | 'none' | 'strict';

export function getCookieOptions() {
  const sameSite = configManager.get<SameSite>('cookieSameSite', 'lax');
  const secure = process.env.COOKIE_SECURE !== undefined
    ? process.env.COOKIE_SECURE === 'true'
    : (sameSite === 'none' || process.env.NODE_ENV === 'production');
  return {
    httpOnly: true,
    secure,
    sameSite,
    path: '/',
    maxAge: SESSION_COOKIE_MAX_AGE,
  };
}
