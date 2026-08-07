# Mail Alerts

Lightweight Telegram alert relay for the mail server. It stores a small local JSON state file, exposes a Basic-authenticated dashboard and has no database or Docker socket access.

## Inputs

| Endpoint | Source | Authentication |
| --- | --- | --- |
| `POST /webhook/stalwart` | Stalwart event webhook | `X-Signature`: base64 HMAC-SHA256 of the raw body using `WEBHOOK_SECRET` |
| `POST /webhook/system` | Health check, disk check, backup script, Bulwark | `X-Alert-Secret: WEBHOOK_SECRET` |

System webhook example:

```sh
curl -X POST https://alerts.example.com/webhook/system \
  -H 'Content-Type: application/json' \
  -H "X-Alert-Secret: $WEBHOOK_SECRET" \
  -d '{"type":"disk.capacity","severity":"critical","message":"Disk usage is 92%","data":{"usedPercent":92}}'
```

## Required environment variables

- `TELEGRAM_BOT_TOKEN` – set only in Portainer, never commit it.
- `TELEGRAM_CHAT_ID` – the single Telegram user/chat permitted to receive alerts and use action buttons.
- `WEBHOOK_SECRET` – a long random secret, used as Stalwart HMAC key and system-webhook secret.
- `ALERTS_UI_USERNAME`, `ALERTS_UI_PASSWORD` – dashboard Basic authentication.

`TELEGRAM_API_BASE` exists only for local tests; do not set it in production.

To enable the Telegram IP-block action additionally configure:

- `STALWART_JMAP_URL` – normally `http://stalwart:8080/jmap` over the private `mail-network`.
- `STALWART_API_TOKEN` – a Stalwart API key with only `sysBlockedIpCreate` (and optionally query/destroy permissions for a future blocks list). Do not use the primary administrator password.

## Stalwart setup

Create a WebHook in **Settings → Telemetry → Webhooks**:

- URL: `https://alerts.example.com/webhook/stalwart`
- Signature key: the exact value of `WEBHOOK_SECRET`
- Event policy: Include
- Events: `auth.success`, terminal queue/delivery failures, `message-ingest.error`, `store.rocksdb-error`, `store.s3-error`, `store.unexpected-error`, `task-queue.task-failed`, `telemetry.webhook-error`.

`auth.success` does not create an alert for every login. The service keeps a local per-account list of known IPs and notifies only for a previously unseen account/IP pair. A mobile user changing networks can therefore legitimately trigger an alert.

Telegram uses long polling for callback buttons; no inbound Telegram URL or public bot webhook is needed. The `BlockedIp` action prevents future connections from that IP. It does not change the user password or account and cannot permanently identify a physical device that changes IP addresses.
