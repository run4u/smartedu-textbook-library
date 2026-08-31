import { describe, expect, it } from 'vitest';
import { DEFAULT_FILENAME_TEMPLATE, normalizeSettings } from '../electron/settings.cjs';

describe('settings normalization', () => {
  it('uses safe defaults for missing or invalid values', () => {
    const settings = normalizeSettings({ startupFilterMode: 'invalid', defaultView: 'unknown', filenameTemplate: '' });
    expect(settings.startupFilterMode).toBe('defaults');
    expect(settings.defaultView).toBe('catalog');
    expect(settings.filenameTemplate).toBe(DEFAULT_FILENAME_TEMPLATE);
    expect(settings.defaultSkipDownloaded).toBe(true);
  });

  it('keeps supported preferences and normalizes filter fields', () => {
    const settings = normalizeSettings({
      downloadDirectory: 'D:/Books',
      filenameTemplate: '{教材名称}_{短ID}',
      startupFilterMode: 'last',
      defaultView: 'settings',
      defaultFilters: { stage: '初中', subject: 42 },
      defaultSkipDownloaded: false,
      downloadNotifications: false,
    });
    expect(settings.downloadDirectory).toBe('D:/Books');
    expect(settings.startupFilterMode).toBe('last');
    expect(settings.defaultView).toBe('settings');
    expect(settings.defaultFilters).toEqual({ stage: '初中', subject: '', grade: '', volume: '', edition: '' });
    expect(settings.defaultSkipDownloaded).toBe(false);
    expect(settings.downloadNotifications).toBe(false);
  });
});
