// Платформенная валидация: validateScenario с platform: 'vk' ругается ошибкой
// на TG-only блок и не трогает кроссплатформенные. Проверяем также, что без
// platform (легаси-вызовы) поведение не меняется — Telegram-боты не получают
// новых issues.
import { describe, it, expect } from 'vitest';
import { validateScenario, countIssues } from '../shared/validate';
import type { Scenario } from '../shared/types';

function sc(blocks: Scenario['blocks']): Scenario {
  return { version: 1, start: 's', blocks };
}

describe('validateScenario: платформенная матрица', () => {
  it('TG-only блок на VK-боте — ошибка platform-unsupported с blockId', () => {
    const issues = validateScenario(
      sc({
        s: { id: 's', type: 'start', params: { command: '/start' }, next: 'p' },
        p: { id: 'p', type: 'poll', params: { question: 'вопрос', pollOptions: [] }, next: '' },
      }),
      { platform: 'vk' }
    );
    const hit = issues.find((i) => i.code === 'platform-unsupported');
    expect(hit).toBeDefined();
    expect(hit!.level).toBe('error');
    expect(hit!.blockId).toBe('p');
    expect(countIssues(issues).errors).toBeGreaterThan(0);
  });

  it('тот же сценарий на Telegram — platform-issues нет', () => {
    const issues = validateScenario(
      sc({
        s: { id: 's', type: 'start', params: { command: '/start' }, next: 'p' },
        p: { id: 'p', type: 'poll', params: { question: 'вопрос', pollOptions: [] }, next: '' },
      }),
      { platform: 'telegram' }
    );
    expect(issues.find((i) => i.code === 'platform-unsupported')).toBeUndefined();
  });

  it('без options (легаси) платформенной проверки нет — Telegram-дефолт', () => {
    const issues = validateScenario(
      sc({
        s: { id: 's', type: 'start', params: { command: '/start' }, next: 'm' },
        m: { id: 'm', type: 'message', params: { text: 'привет' }, next: '' },
      })
    );
    expect(issues.find((i) => i.code === 'platform-unsupported')).toBeUndefined();
  });

  it('замороженный TG-only блок на VK не ошибкой (disabled не влияет на рантайм)', () => {
    const issues = validateScenario(
      sc({
        s: { id: 's', type: 'start', params: { command: '/start' }, next: 'p' },
        p: { id: 'p', type: 'web_app', params: { disabled: true }, next: '' },
      }),
      { platform: 'vk' }
    );
    expect(issues.find((i) => i.code === 'platform-unsupported')).toBeUndefined();
  });

  it('кроссплатформенный сценарий VK проходит без platform-issues', () => {
    const issues = validateScenario(
      sc({
        s: { id: 's', type: 'start', params: { command: '/start' }, next: 'b' },
        b: { id: 'b', type: 'buttons', params: { prompt: 'жми', buttons: [{ label: 'ОК', value: 'ok' }] }, branches: { ok: 'm' } },
        m: { id: 'm', type: 'message', params: { text: 'дальше' }, next: 'e' },
        e: { id: 'e', type: 'end', params: {} },
      }),
      { platform: 'vk' }
    );
    expect(issues.find((i) => i.code === 'platform-unsupported')).toBeUndefined();
    expect(countIssues(issues).errors).toBe(0);
  });
});
