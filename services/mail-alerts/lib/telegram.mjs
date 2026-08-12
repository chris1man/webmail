function formatCritical(events, test = false) {
  if (test) return '✅ Mail Alerts: Telegram connection works.';
  const lines = ['🚨 Критическое событие почты'];
  for (const event of events.slice(0, 8)) {
    lines.push(`\n• ${event.type}\n${event.createdAt}`);
    if (event.details) lines.push(event.details);
  }
  return lines.join('\n').slice(0, 3900);
}

function formatProfile(login) {
  const profile = login.fingerprint?.profile || {};
  return [
    `Статус: ${login.deviceStatus === 'new' ? 'новое устройство' : 'известное устройство'}`,
    `Visitor ID: ${login.fingerprint?.visitorId || 'недоступен'}`,
    login.fingerprint?.confidence !== null && login.fingerprint?.confidence !== undefined ? `Confidence: ${login.fingerprint.confidence}` : null,
    login.fingerprint?.version ? `FingerprintJS: ${login.fingerprint.version}` : null,
    profile.browser || profile.os ? `Браузер / ОС: ${[profile.browser, profile.os].filter(Boolean).join(' / ')}` : null,
    profile.language ? `Язык: ${profile.language}` : null,
    profile.timezone ? `Часовой пояс: ${profile.timezone}` : null,
    profile.screen ? `Экран: ${profile.screen}` : null,
    profile.cpuCores !== null && profile.cpuCores !== undefined ? `CPU: ${profile.cpuCores} cores` : null,
    profile.deviceMemoryGb !== null && profile.deviceMemoryGb !== undefined ? `RAM: ${profile.deviceMemoryGb} GB` : null,
    profile.touchPoints !== null && profile.touchPoints !== undefined ? `Touch: ${profile.touchPoints}` : null,
  ].filter(Boolean);
}

function detailsMessages(login) {
  const fingerprint = login.fingerprint;
  if (!fingerprint) return ['ℹ️ FingerprintJS не вернул данные для этого входа.'];
  const json = JSON.stringify({
    visitorId: fingerprint.visitorId, confidence: fingerprint.confidence, version: fingerprint.version,
    profile: fingerprint.profile, components: fingerprint.components,
  }, null, 2);
  const header = `🧩 Полная информация устройства\nПользователь: ${login.account}\nIP: ${login.ip}\n\n`;
  const size = 3600;
  const chunks = [];
  for (let start = 0; start < json.length; start += size) {
    chunks.push(`${start === 0 ? header : '🧩 Продолжение\n'}${json.slice(start, start + size)}`);
  }
  return chunks;
}

export function createTelegramClient({ token, chatId, state, apiBase }) {
  async function call(method, body) {
    const response = await fetch(`${apiBase.replace(/\/$/, '')}/bot${token}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) throw new Error(`Telegram API ${method} failed`);
    return payload.result;
  }

  async function send(message, options = {}) {
    try {
      const result = await call('sendMessage', { chat_id: chatId, text: message, ...options });
      await state.incrementTelegram(true);
      return result;
    } catch (error) {
      await state.incrementTelegram(false);
      throw error;
    }
  }

  async function sendNewLogin(login) {
    if (login.deviceStatus === 'known') {
      return send([
        '🔐 Вход с известного устройства',
        `Пользователь: ${login.account}`,
        `IP: ${login.ip}`,
        `Время: ${login.createdAt}`,
      ].join('\n'), { disable_notification: true });
    }

    const actionId = await state.createPendingAction({ type: 'login', ...login });
    const text = [
      '🔐 Новый вход в почту',
      `Пользователь: ${login.account}`,
      `IP: ${login.ip}`,
      ...formatProfile(login),
      `Время: ${login.createdAt}`,
      '',
      'Если это ожидаемый вход, подтвердите IP. Блокировка не изменит пароль или учётную запись.',
    ].join('\n');
    return send(text, {
      reply_markup: { inline_keyboard: [
        [{ text: '✅ Это я', callback_data: `allow:${actionId}` }],
        [{ text: '🧩 Полная информация', callback_data: `details:${actionId}` }],
        [{ text: '⛔ IP на 24 ч', callback_data: `ask24:${actionId}` }, { text: '⛔ IP на 7 дней', callback_data: `ask168:${actionId}` }],
      ] },
    });
  }

  async function answerCallback(callbackQueryId, text) {
    await call('answerCallbackQuery', { callback_query_id: callbackQueryId, text, show_alert: false });
  }

  async function editCallbackMessage(callback, text) {
    if (!callback.message) return;
    await call('editMessageText', { chat_id: chatId, message_id: callback.message.message_id, text });
  }

  async function processCallback(callback, handlers) {
    if (String(callback.from?.id) !== String(chatId)) return;
    const [command, id] = String(callback.data || '').split(':');
    const action = await state.getPendingAction(id);
    if (!action || action.type !== 'login') return answerCallback(callback.id, 'Действие истекло.');
    if (command === 'allow') {
      await handlers.onAllow(action);
      await state.removePendingAction(id);
      await answerCallback(callback.id, 'IP добавлен в известные.');
      return editCallbackMessage(callback, `✅ Подтверждённое устройство\n${action.account}\n${action.ip}\n${action.fingerprint?.visitorId || ''}`);
    }
    if (command === 'details') {
      await answerCallback(callback.id, 'Отправляю полную информацию.');
      for (const message of detailsMessages(action)) await send(message);
      return;
    }
    if (command === 'ask24' || command === 'ask168') {
      const hours = command === 'ask24' ? 24 : 168;
      action.durationHours = hours;
      state.state.pendingActions[id] = action;
      await state.save();
      await answerCallback(callback.id, 'Подтвердите блокировку.');
      return call('editMessageReplyMarkup', {
        chat_id: chatId, message_id: callback.message.message_id,
        reply_markup: { inline_keyboard: [[
          { text: `Подтвердить блок на ${hours === 24 ? '24 ч' : '7 дней'}`, callback_data: `block:${id}` },
          { text: 'Отмена', callback_data: `cancel:${id}` },
        ]] },
      });
    }
    if (command === 'cancel') {
      await state.removePendingAction(id);
      await answerCallback(callback.id, 'Отменено.');
      return editCallbackMessage(callback, `Отменено\n${action.account}\n${action.ip}`);
    }
    if (command === 'block') {
      try {
        const expiresAt = await handlers.onBlock(action);
        await state.removePendingAction(id);
        await answerCallback(callback.id, 'IP заблокирован.');
        return editCallbackMessage(callback, `⛔ IP заблокирован\n${action.account}\n${action.ip}\nVisitor ID: ${action.fingerprint?.visitorId || 'недоступен'}\nДо: ${expiresAt}`);
      } catch (error) {
        await state.setError(error);
        return answerCallback(callback.id, `Ошибка: ${error instanceof Error ? error.message : 'unknown'}`);
      }
    }
    return answerCallback(callback.id, 'Неизвестное действие.');
  }

  return {
    sendCritical: (events) => events.length ? send(formatCritical(events)) : Promise.resolve(),
    sendNewLogin,
    sendTest: () => send(formatCritical([], true)),
    startPolling({ enabled, onAllow, onBlock }) {
      if (!enabled) return;
      const poll = async () => {
        try {
          const updates = await call('getUpdates', { offset: (state.state.telegramUpdateOffset || 0) + 1, timeout: 25, allowed_updates: ['callback_query'] });
          for (const update of updates) {
            await state.updateTelegramOffset(update.update_id);
            if (update.callback_query) await processCallback(update.callback_query, { onAllow, onBlock });
          }
        } catch (error) {
          await state.setError(error);
        } finally {
          setTimeout(poll, 1000);
        }
      };
      void poll();
    },
  };
}
