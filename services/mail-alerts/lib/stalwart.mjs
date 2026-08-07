import { isIP } from 'node:net';

export async function blockIp({ url, token, address, expiresAt }) {
  if (!isIP(address)) throw new Error('Invalid IP address');
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      using: ['urn:ietf:params:jmap:core', 'urn:stalwart:jmap'],
      methodCalls: [[
        'x:BlockedIp/set',
        { create: { notifier: { address, reason: 'manual', expiresAt } } },
        'block-ip',
      ]],
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Stalwart API returned ${response.status}`);
  let payload;
  try { payload = JSON.parse(body); } catch { throw new Error('Stalwart API returned invalid JSON'); }
  const result = payload.methodResponses?.[0];
  if (!result || result[0] === 'error' || result[1]?.notCreated?.notifier) {
    throw new Error(result?.[1]?.description || 'Stalwart refused the IP block');
  }
}
