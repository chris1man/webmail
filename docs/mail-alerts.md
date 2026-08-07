# Mail Alerts: deployment and event sources

The `mail-alerts` stack is a lightweight Telegram notification service. It has a Basic-authenticated dashboard, stores only a small JSON event history in its volume and does not mount the Docker socket.

## 1. Deploy in Portainer

Create a new stack from the repository branch and use `docker-compose.mail-alerts.yml` as the compose path. Add the variables from `services/mail-alerts/.env.example` in Portainer's **Environment variables** section.

Use a long random value for `WEBHOOK_SECRET`. It is an HMAC key for Stalwart and a shared secret for health, disk and backup events. Do not put the Telegram token or Stalwart API key in the repository.

Connect an NPM proxy host such as `alerts.<your-domain>` to `mail-alerts:8080` over `proxy-network`. The dashboard itself asks for `ALERTS_UI_USERNAME` and `ALERTS_UI_PASSWORD`.

The compose stack joins both existing Docker networks:

- `proxy-network` for the dashboard through Nginx Proxy Manager;
- `mail-network` to reach Stalwart privately for IP blocks.

## 2. Test Telegram

Open the dashboard and press **Отправить тест в Telegram**. A successful test proves the bot token and chat ID are correct.

## 3. Stalwart webhook

In Stalwart go to **Settings → Telemetry → Webhooks** and create one webhook:

- URL: `https://alerts.<your-domain>/webhook/stalwart`
- Signature key: same value as `WEBHOOK_SECRET`
- Policy: **Include**
- Delivery: enabled, lossy disabled, timeout 10 seconds

Start with these events:

```text
auth.success
message-ingest.error
store.rocksdb-error
store.s3-error
store.unexpected-error
task-queue.task-failed
telemetry.webhook-error
```

Add only the exact terminal delivery/queue failure events visible in your Stalwart event selector. This avoids alerts for normal retries.

For `auth.success`, Mail Alerts saves known account/IP pairs. A Telegram alert is sent only for a new public IP. Internal Docker and proxy addresses are ignored because they do not identify a user device. The buttons either trust that IP or create a temporary Stalwart `BlockedIp` for 24 hours or seven days. The action does not alter the mailbox password or user account.

For the block buttons, create a Stalwart API key scoped to the `sysBlockedIpCreate` permission and set it as `STALWART_API_TOKEN`. Without that key, alerts still work; the block action reports that it is not configured.

## 3.1 Bulwark webmail-login events

Stalwart server events remain useful for storage and delivery failures. For login alerts from the Bulwark web interface, use the Webmail backend as the source of truth: it knows that a browser session was successfully created and has the browser's forwarded client IP.

In the **Webmail** stack in Portainer, add:

```text
MAIL_ALERTS_URL=http://mail-alerts-mail-alerts-1:8080
MAIL_ALERTS_SECRET=<the same WEBHOOK_SECRET used by mail-alerts>
```

Both containers must be on `proxy-network` (they already are in the current deployment). The notifier receives `webmail.login.success` as an authenticated system event and only sends Telegram when the account/IP/device combination has not previously been trusted. The notifier is best-effort: a timeout or failure never blocks a mail login.

## 4. System event webhook

Health probes, disk checks, backup scripts and Bulwark can all post a small JSON document to `/webhook/system`:

```json
{
  "type": "backup.failed",
  "severity": "critical",
  "message": "Nightly backup exited with code 1",
  "data": { "backup": "stalwart-nightly" }
}
```

Send the request with `X-Alert-Secret` equal to `WEBHOOK_SECRET`. A health monitor should send only transitions: `service.down` when a service becomes unavailable and `service.recovered` once it comes back. A disk monitor should alert at 80%, 90% and 95%, not on every minute of a full disk.

## 5. What must remain separate

The notifier deliberately does not read Docker state or the host filesystem. A small host-side timer/checker should probe public URLs and `df`, while the backup script sends its own outcome. This separation prevents the Internet-facing notifier from receiving privileged Docker-socket or root-filesystem access.

## 6. Host health and disk checker

`services/mail-alerts/scripts/check-host.sh` runs once per minute from the VPS host. Copy it to `/usr/local/bin/mail-alerts-check`, make it executable and put secrets into a root-only file such as `/etc/mail-alerts-monitor.env`:

```sh
MAIL_ALERTS_URL=https://alerts.example.com
WEBHOOK_SECRET=the-same-long-secret
MAIL_ALERTS_CHECK_URLS='Portainer|https://portainer.example.com/;Webmail|https://webmail.example.com/;Stalwart|https://mail.example.com/.well-known/jmap'
MAIL_ALERTS_DISK_WARNING_PERCENT=80
MAIL_ALERTS_DISK_CRITICAL_PERCENT=90
```

Then add this cron entry:

```cron
* * * * * root . /etc/mail-alerts-monitor.env && /usr/local/bin/mail-alerts-check
```

The checker sends an alert only when a URL changes from up to down or back to up, and when disk usage crosses a threshold. It has no Docker socket or filesystem mount inside a container.
