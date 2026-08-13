export const SESSION_COOKIE = 'jmap_session';

const DEFAULT_SESSION_COOKIE_DAYS = 90;
const MAX_SESSION_COOKIE_DAYS = 365;

/**
 * Lifetime shared by the encrypted basic-auth session and OAuth refresh-token
 * cookies. A deployment can override it without rebuilding the application.
 */
export function getSessionCookieMaxAge(): number {
  const rawDays = process.env.SESSION_COOKIE_DAYS?.trim() ?? '';
  const configuredDays = /^\d+$/.test(rawDays) ? Number(rawDays) : Number.NaN;
  const days = Number.isFinite(configuredDays) && configuredDays > 0
    ? Math.min(configuredDays, MAX_SESSION_COOKIE_DAYS)
    : DEFAULT_SESSION_COOKIE_DAYS;
  return days * 24 * 60 * 60;
}

export const SESSION_COOKIE_MAX_AGE = getSessionCookieMaxAge();

/** Get the cookie name for a given account slot. Slot 0 uses the legacy name. */
export function sessionCookieName(slot: number): string {
  return slot === 0 ? SESSION_COOKIE : `${SESSION_COOKIE}_${slot}`;
}
