function formatCritical(events, test = false) {
  if (test) return '✅ Mail Alerts: Telegram connection works.';
  const lines = ['🚨 Критическое событие почты'];
  for (const event of events.slice(0, 8)) {
    lines.push(`\n• ${event.type}\n${event.createdAt}`);
    if (event.details) lines.push(event.details);
  }
  return lines.join('\n').slice(0, 3900);
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
    const actionId = await state.createPendingAction({ type: 'login', ...login });
    const text = [
      '🔐 Новый IP при входе в почту',
      `Пользователь: ${login.account}`,
      `IP: ${login.ip}`,
      ...(login.device ? [`Устройство: ${login.device}`] : []),
      `Время: ${login.createdAt}`,
      '',
      'Если это ожидаемый вход, подтвердите IP. Блокировка не изменит пароль или учётную запись.',
    ].join('\n');
    return send(text, {
      reply_markup: { inline_keyboard: [
        [{ text: '✅ Это я', callback_data: `allow:${actionId}` }],
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
      return editCallbackMessage(callback, `✅ Подтверждённый вход\n${action.account}\n${action.ip}`);
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
        return editCallbackMessage(callback, `⛔ IP заблокирован\n${action.account}\n${action.ip}\nДо: ${expiresAt}`);
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
