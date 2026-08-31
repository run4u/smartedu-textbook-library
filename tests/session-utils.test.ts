import { describe, expect, it } from 'vitest';
import { isCredentialCookie } from '../electron/session-utils.cjs';

describe('session credential detection', () => {
  it('recognizes only the platform credential cookies', () => {
    expect(isCredentialCookie({ name: 'UC_TOKEN-abc-product' })).toBe(true);
    expect(isCredentialCookie({ name: 'uc_sso_tgc-abc-product' })).toBe(true);
    expect(isCredentialCookie({ name: 'session_id' })).toBe(false);
    expect(isCredentialCookie({ name: 'auth_redirect' })).toBe(false);
    expect(isCredentialCookie({ name: 'tracking_token' })).toBe(false);
  });
});
