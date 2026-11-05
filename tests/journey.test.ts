import { describe, expect, it } from 'vitest';
import { canCreateBot, canPublishScenario, friendlyApiError, apiErrorKey, createApiError, authErrorMessage, validationIssueKey, validationIssueMessage, nextPopoverState, publishStepLabelKey, rollbackSettingsState } from '../web/src/journey';
import { validateScenario } from '../shared/validate';
import { TEMPLATES } from '../web/src/templates';
import { logLabel } from '../web/src/logLabels';
import { isValidSkillLevel } from '../worker/src/db';

describe('first-time user journey helpers', () => {
  it('requires trimmed bot name and token before creation', () => {
    expect(canCreateBot('  ', 'token')).toBe(false);
    expect(canCreateBot('My bot', '  ')).toBe(false);
    expect(canCreateBot(' My bot ', ' token ')).toBe(true);
  });

  it('blocks testing and publication only when the scenario has errors', () => {
    const empty = { version: 1, start: '', blocks: {} } as any;
    const valid = TEMPLATES[0].scenario;
    expect(canPublishScenario(validateScenario(empty))).toBe(false);
    expect(canPublishScenario(validateScenario(valid))).toBe(true);
  });

  it('treats a valid message connected to start as publishable', () => {
    const scenario = {
      version: 1,
      start: 'start',
      blocks: {
        start: { id: 'start', type: 'start', params: { command: '/start' }, next: 'message' },
        message: { id: 'message', type: 'message', params: { text: 'Привет' } },
      },
    } as any;
    const issues = validateScenario(scenario);
    expect(canPublishScenario(issues)).toBe(true);
    expect(issues.some((issue) => issue.level === 'error')).toBe(false);
  });

  it('keeps an empty message blocking with an actionable issue', () => {
    const scenario = {
      version: 1,
      start: 'start',
      blocks: {
        start: { id: 'start', type: 'start', params: { command: '/start' }, next: 'message' },
        message: { id: 'message', type: 'message', params: { text: '   ' } },
      },
    } as any;
    const issues = validateScenario(scenario);
    expect(canPublishScenario(issues)).toBe(false);
    expect(validationIssueMessage(issues.find((issue) => issue.code === 'msg-empty')!, 'ru')).toContain('Пустое сообщение');
  });

  it('turns known API failures into human-readable messages', () => {
    expect(friendlyApiError('unauthorized')).toBe('Сессия истекла — войдите заново');
    expect(friendlyApiError('name and token required')).toBe('Введите имя и токен бота');
    expect(friendlyApiError('Логин занят')).toBe('Этот логин уже занят');
    expect(friendlyApiError({ status: 500, message: 'SQLITE constraint failed: secret' })).toBe('Сервер временно недоступен. Попробуйте ещё раз');
    expect(friendlyApiError({ kind: 'network', message: 'Failed to fetch' })).toBe('Не удалось подключиться. Проверьте интернет и повторите попытку');
    expect(friendlyApiError('SQLITE constraint failed: secret')).toBe('Не удалось выполнить действие. Попробуйте ещё раз');
    expect(friendlyApiError('unexpected database implementation detail')).toBe('Не удалось выполнить действие. Попробуйте ещё раз');
    expect(friendlyApiError('')).toBe('Ошибка');
  });

  it('normalizes JSON, plain-text, empty and malformed failures without leaking details', () => {
    expect(apiErrorKey({ status: 401, body: { error: 'unauthorized' } })).toBe('error.unauthorized');
    expect(apiErrorKey({ status: 400, body: { message: 'name and token required' } })).toBe('error.botRequired');
    expect(apiErrorKey({ status: 429, body: 'too many requests' })).toBe('error.rateLimited');
    expect(apiErrorKey({ status: 503, body: '' })).toBe('error.server');
    expect(apiErrorKey({ status: 400, body: '{not-json' })).toBe('error.validation');
    expect(apiErrorKey({ kind: 'timeout' })).toBe('error.timeout');
    expect(createApiError(500, { error: 'SQL error with token=secret' }).message).toBe('SQL error with token=secret');
  });

  it('returns localized keys for English UI without exposing raw server text', () => {
    expect(apiErrorKey({ status: 403 })).toBe('error.forbidden');
    expect(friendlyApiError({ status: 403, message: 'internal path C:/secret' }, 'en')).toBe('You do not have access to this bot');
  });

  it('authErrorMessage prefers the server code in both languages', () => {
    expect(authErrorMessage({ status: 401, body: { error: 'Логин не найден', code: 'login_not_found' } }, 'ru')).toBe('Логин не найден');
    expect(authErrorMessage({ status: 401, body: { error: 'Логин не найден', code: 'login_not_found' } }, 'en')).toBe('No account with this login');
    expect(authErrorMessage({ status: 401, body: { error: 'Пароль не верный', code: 'wrong_password' } }, 'ru')).toBe('Пароль не верный');
    expect(authErrorMessage({ status: 401, body: { error: 'Пароль не верный', code: 'wrong_password' } }, 'en')).toBe('Incorrect password');
    expect(authErrorMessage({ status: 401, body: { error: 'Неверный админ-ключ', code: 'admin_key_invalid' } }, 'ru')).toBe('Неверный админ-ключ');
    expect(authErrorMessage({ status: 401, body: { error: 'Неверный админ-ключ', code: 'admin_key_invalid' } }, 'en')).toBe('Incorrect admin key');
  });

  it('authErrorMessage falls back to the Russian error string when code is absent (old worker)', () => {
    expect(authErrorMessage({ status: 401, body: { error: 'Логин не найден' } }, 'ru')).toBe('Логин не найден');
    expect(authErrorMessage({ status: 401, body: { error: 'Пароль не верный' } }, 'en')).toBe('Incorrect password');
    // Старый текст воркера («не правильный») тоже признаётся парольной ошибкой.
    expect(authErrorMessage({ status: 401, body: { error: 'Пароль не правильный' } }, 'ru')).toBe('Пароль не верный');
    expect(authErrorMessage({ status: 401, body: { error: 'Неверный админ-ключ' } }, 'ru')).toBe('Неверный админ-ключ');
    expect(authErrorMessage({ status: 409, body: { error: 'Логин занят' } }, 'ru')).toBe('Этот логин уже занят');
    expect(authErrorMessage({ status: 409, body: { error: 'Логин занят' } }, 'en')).toBe('This login is already taken');
  });

  it('authErrorMessage maps rate limits to the generic text and everything else to friendlyApiError', () => {
    expect(authErrorMessage({ status: 429, body: { error: 'слишком много неудачных попыток. Подождите 10 минут', code: 'rate_limited' } }, 'ru')).toBe('Слишком много запросов. Попробуйте позже');
    expect(authErrorMessage({ status: 429, body: 'too many requests' }, 'ru')).toBe('Слишком много запросов. Попробуйте позже');
    // Случайный 401 без auth-кода — по-прежнему «сессия истекла» (глобальный
    // маппинг apiErrorKey не менялся).
    expect(authErrorMessage({ status: 401, body: { error: 'unauthorized' } }, 'ru')).toBe('Сессия истекла — войдите заново');
    expect(authErrorMessage({ kind: 'network', message: 'Failed to fetch' }, 'ru')).toBe('Не удалось подключиться. Проверьте интернет и повторите попытку');
    expect(authErrorMessage(createApiError(500, { error: 'внутренняя ошибка сервера' }), 'ru')).toBe('Сервер временно недоступен. Попробуйте ещё раз');
  });

  it('keeps shared validation codes addressable for field-level feedback', () => {
    expect(validationIssueKey('msg-empty')).toBe('validation.msg-empty');
    expect(validationIssueKey('missing-target')).toBe('validation.missing-target');
    expect(validationIssueMessage({ code: 'msg-empty', message: 'Пустое сообщение' }, 'ru')).toBe('Пустое сообщение');
    expect(validationIssueMessage({ code: 'msg-empty', message: 'Пустое сообщение' }, 'en')).toBe('Message text is required');
    expect(validationIssueMessage({ code: 'unknown', message: 'internal validator detail' }, 'en')).toBe('Check this block configuration');
  });

  it('maps the known worker event families and keeps unknown codes raw', () => {
    const t = (key: any, vars?: Record<string, string | number>) => `${key}:${vars?.value ?? ''}`;
    expect(logLabel('bot.created', t)).toContain('log.ev.botCreated:');
    expect(logLabel('scenario.saved.v12', t)).toContain('log.ev.scenarioSaved:12');
    expect(logLabel('delay.scheduled.30s', t)).toContain('log.ev.delay:scheduled');
    expect(logLabel('subscription.subscribe', t)).toContain('log.ev.subscription:subscribe');
    expect(logLabel('http.ok', t)).toContain('log.ev.http:ok');
    expect(logLabel('send.error', t)).toContain('log.ev.send:error');
    expect(logLabel('invoice.error', t)).toContain('log.ev.invoice:error');
    expect(logLabel('broadcast.queued.4', t)).toContain('log.ev.broadcast:queued');
    expect(logLabel('scheduled.retry.2', t)).toContain('log.ev.scheduled:retry');
    expect(logLabel('some.future.event', t)).toBe('some.future.event');
  });

  it('accepts an unset skill level as well as the three named levels', () => {
    expect(isValidSkillLevel('')).toBe(true);
    expect(isValidSkillLevel('low')).toBe(true);
    expect(isValidSkillLevel('medium')).toBe(true);
    expect(isValidSkillLevel('high')).toBe(true);
    expect(isValidSkillLevel('expert')).toBe(false);
  });

  it('opens only the requested topbar popover', () => {
    expect(nextPopoverState('conflicts')).toEqual({ conflicts: true, more: false });
    expect(nextPopoverState('more')).toEqual({ conflicts: false, more: true });
    expect(nextPopoverState('conflicts', true)).toEqual({ conflicts: false, more: false });
  });

  it('uses localized labels for publish pipeline steps', () => {
    expect(publishStepLabelKey('save')).toBe('publish.step.save');
    expect(publishStepLabelKey('webhook')).toBe('publish.step.webhook');
    expect(publishStepLabelKey('validate')).toBe('publish.step.validate');
    expect(publishStepLabelKey('unknown')).toBe('publish.step.unknown');
  });

  it('restores optimistic settings after the current persistence request fails', () => {
    expect(rollbackSettingsState({ theme: 'light' }, { theme: 'dark' })).toEqual({ theme: 'light' });
  });
});
