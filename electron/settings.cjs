const fs = require('node:fs/promises');
const path = require('node:path');

const DEFAULT_FILENAME_TEMPLATE = '{学段}_{学科}_{年级}_{册次}_{版本}_{年度}_{短ID}';
const DEFAULT_FILTERS = { stage: '', subject: '', grade: '', volume: '', edition: '' };
const DEFAULT_SETTINGS = {
  downloadDirectory: '',
  filenameTemplate: DEFAULT_FILENAME_TEMPLATE,
  startupFilterMode: 'defaults',
  defaultFilters: DEFAULT_FILTERS,
  lastFilters: DEFAULT_FILTERS,
  defaultSkipDownloaded: true,
  lastSkipDownloaded: true,
  defaultView: 'catalog',
  downloadNotifications: true,
};

const allowedViews = new Set(['catalog', 'tasks', 'library', 'settings']);
const allowedFilterModes = new Set(['defaults', 'last']);

function cleanFilters(value) {
  const source = value && typeof value === 'object' ? value : {};
  return Object.fromEntries(Object.keys(DEFAULT_FILTERS).map((key) => [key, typeof source[key] === 'string' ? source[key].slice(0, 100) : '']));
}

function normalizeSettings(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    downloadDirectory: typeof source.downloadDirectory === 'string' ? source.downloadDirectory : '',
    filenameTemplate: typeof source.filenameTemplate === 'string' && source.filenameTemplate.trim() ? source.filenameTemplate.trim().slice(0, 240) : DEFAULT_FILENAME_TEMPLATE,
    startupFilterMode: allowedFilterModes.has(source.startupFilterMode) ? source.startupFilterMode : DEFAULT_SETTINGS.startupFilterMode,
    defaultFilters: cleanFilters(source.defaultFilters),
    lastFilters: cleanFilters(source.lastFilters),
    defaultSkipDownloaded: typeof source.defaultSkipDownloaded === 'boolean' ? source.defaultSkipDownloaded : true,
    lastSkipDownloaded: typeof source.lastSkipDownloaded === 'boolean' ? source.lastSkipDownloaded : true,
    defaultView: allowedViews.has(source.defaultView) ? source.defaultView : DEFAULT_SETTINGS.defaultView,
    downloadNotifications: typeof source.downloadNotifications === 'boolean' ? source.downloadNotifications : true,
  };
}

class SettingsStore {
  constructor(dataPath, defaultDownloadDirectory) {
    this.filePath = path.join(dataPath, 'settings.json');
    this.defaultDownloadDirectory = defaultDownloadDirectory;
    this.settings = normalizeSettings(DEFAULT_SETTINGS);
    this.writeChain = Promise.resolve();
  }

  async load() {
    try { this.settings = normalizeSettings(JSON.parse(await fs.readFile(this.filePath, 'utf8'))); }
    catch { this.settings = normalizeSettings(DEFAULT_SETTINGS); }
    return this.publicSettings();
  }

  publicSettings() {
    return { ...this.settings, effectiveDownloadDirectory: this.effectiveDownloadDirectory(), defaultDownloadDirectory: this.defaultDownloadDirectory };
  }

  effectiveDownloadDirectory() {
    return this.settings.downloadDirectory || this.defaultDownloadDirectory;
  }

  async update(patch) {
    this.settings = normalizeSettings({ ...this.settings, ...(patch || {}) });
    const serialized = JSON.stringify(this.settings, null, 2);
    this.writeChain = this.writeChain.then(async () => {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      await fs.writeFile(this.filePath, serialized);
    });
    await this.writeChain;
    return this.publicSettings();
  }
}

module.exports = { DEFAULT_FILENAME_TEMPLATE, DEFAULT_SETTINGS, SettingsStore, normalizeSettings };
