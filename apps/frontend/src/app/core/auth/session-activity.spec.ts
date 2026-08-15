import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearSessionActivity,
  isIdleExpired,
  markActivity,
  markRefresh,
  markSessionStart,
  needsKeepAlive,
  readSessionActivity,
} from './session-activity';

const fiveMinutesMs = 300_000;
const now = 1_700_000_000_000;

beforeEach(() => {
  clearSessionActivity();
});

describe('isIdleExpired', () => {
  it('no vence antes de cumplirse la ventana', () => {
    expect(isIdleExpired(now, now - fiveMinutesMs + 1, fiveMinutesMs)).toBe(false);
  });

  it('vence justo al cumplirse la ventana', () => {
    expect(isIdleExpired(now, now - fiveMinutesMs, fiveMinutesMs)).toBe(true);
  });
});

describe('needsKeepAlive', () => {
  it('espera antes de refrescar con la ventana recién abierta', () => {
    expect(needsKeepAlive(now, now, fiveMinutesMs)).toBe(false);
  });

  it('refresca antes de que muera el access token, que vive media ventana', () => {
    const halfWindowAgo = now - fiveMinutesMs / 2;

    expect(needsKeepAlive(now, halfWindowAgo, fiveMinutesMs)).toBe(true);
  });
});

describe('marcas de la sesión', () => {
  it('markActivity conserva el instante del último refresh', () => {
    markSessionStart(now);

    markActivity(now + 1000);

    expect(readSessionActivity()).toEqual({ lastActivityAt: now + 1000, lastRefreshAt: now });
  });

  it('markRefresh no cuenta como actividad del usuario', () => {
    markSessionStart(now);

    markRefresh(now + 1000);

    expect(readSessionActivity()).toEqual({ lastActivityAt: now, lastRefreshAt: now + 1000 });
  });

  it('clearSessionActivity deja la sesión sin marcas', () => {
    markSessionStart(now);

    clearSessionActivity();

    expect(readSessionActivity()).toBeNull();
  });
});
