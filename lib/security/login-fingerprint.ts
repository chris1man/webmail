export interface LoginFingerprint {
  visitorId: string;
  confidence: number;
  version: string;
  profile: {
    userAgent: string;
    browser: string;
    os: string;
    language: string;
    timezone: string;
    screen: string;
    cpuCores: number | null;
    deviceMemoryGb: number | null;
    touchPoints: number;
  };
  // The raw component values are retained by Mail Alerts only. They aren't
  // rendered in the normal Telegram alert; the operator must explicitly tap
  // the details button in Telegram to see the diagnostic snapshot.
  components: Record<string, unknown>;
}

function detectBrowser(userAgent: string): string {
  const match = userAgent.match(/(?:Edg|OPR|Chrome|Firefox|Version)\/([\d.]+)/);
  if (!match) return 'Unknown';
  const name = match[0].split('/')[0];
  const labels: Record<string, string> = { Edg: 'Edge', OPR: 'Opera', Version: 'Safari' };
  return `${labels[name] ?? name} ${match[1]}`;
}

function detectOs(userAgent: string): string {
  if (/Windows NT 10\.0/.test(userAgent)) return 'Windows 10/11';
  if (/Android/.test(userAgent)) return `Android ${userAgent.match(/Android\s+([\d.]+)/)?.[1] ?? ''}`.trim();
  if (/iPhone|iPad|iPod/.test(userAgent)) return `iOS ${userAgent.match(/OS\s+([\d_]+)/)?.[1]?.replaceAll('_', '.') ?? ''}`.trim();
  if (/Mac OS X/.test(userAgent)) return `macOS ${userAgent.match(/Mac OS X\s+([\d_]+)/)?.[1]?.replaceAll('_', '.') ?? ''}`.trim();
  if (/Linux/.test(userAgent)) return 'Linux';
  return 'Unknown';
}

function jsonSafe(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[truncated]';
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return value.slice(0, 500);
  if (Array.isArray(value)) return value.slice(0, 30).map((item) => jsonSafe(item, depth + 1));
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .slice(0, 30)
      .map(([key, item]) => [key.slice(0, 80), jsonSafe(item, depth + 1)]));
  }
  return String(value).slice(0, 500);
}

async function collect(): Promise<LoginFingerprint | null> {
  try {
    const FingerprintJS = (await import('@fingerprintjs/fingerprintjs')).default;
    const agent = await FingerprintJS.load({ monitoring: false });
    const result = await agent.get();
    const nav = navigator as Navigator & { deviceMemory?: number; maxTouchPoints?: number };
    const userAgent = navigator.userAgent.slice(0, 512);

    return {
      visitorId: result.visitorId,
      confidence: result.confidence.score,
      version: result.version,
      profile: {
        userAgent,
        browser: detectBrowser(userAgent),
        os: detectOs(userAgent),
        language: navigator.language || 'unknown',
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown',
        screen: `${window.screen.width}x${window.screen.height} @${window.devicePixelRatio || 1}x`,
        cpuCores: typeof navigator.hardwareConcurrency === 'number' ? navigator.hardwareConcurrency : null,
        deviceMemoryGb: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null,
        touchPoints: nav.maxTouchPoints ?? 0,
      },
      components: Object.entries(result.components).reduce<Record<string, unknown>>((safe, [name, component]) => {
        const candidate = jsonSafe(component);
        // Keep the authenticated webhook comfortably below its 128 KiB cap.
        if (JSON.stringify({ ...safe, [name]: candidate }).length <= 48_000) safe[name] = candidate;
        return safe;
      }, {}),
    };
  } catch {
    return null;
  }
}

/** Collects a browser-only diagnostic snapshot. Failure must never block login. */
export async function collectLoginFingerprint(): Promise<LoginFingerprint | null> {
  return Promise.race([
    collect(),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 2_000)),
  ]);
}
