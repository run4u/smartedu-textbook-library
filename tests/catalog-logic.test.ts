import { describe, expect, it } from 'vitest';
import { computeFilterOptions, filterResources, getSelectableResources, getSelectedResources, groupResources, toggleAllSelection, toggleSkipDownloaded } from '../src/lib/catalog';

type Patch = Partial<{ title: string; stage: string; subject: string; grade: string; volume: string; edition: string; resourceYear: string; localState: 'downloaded' | 'not-downloaded' }>;

function make(id: string, patch: Patch = {}) {
  return {
    contentId: id,
    title: '英语 七年级上册',
    stage: '初中',
    subject: '英语',
    grade: '七年级',
    volume: '上册',
    edition: '北师大版',
    resourceYear: '2025年度',
    onlineTime: '',
    updateTime: '',
    sizeBytes: 1,
    localState: 'not-downloaded' as const,
    ...patch,
  };
}

const emptyFilters = { stage: '', subject: '', grade: '', volume: '', edition: '' };

describe('filterResources', () => {
  it('requires every keyword to match', () => {
    const catalog = [make('a', { title: '英语 七年级上册' }), make('b', { title: '数学 七年级上册', subject: '数学' })];
    const result = filterResources(catalog, emptyFilters, '英语 七年级');
    expect(result.map((resource) => resource.contentId)).toEqual(['a']);
  });

  it('narrows by filter field', () => {
    const catalog = [make('a', { subject: '英语' }), make('b', { subject: '数学' })];
    const result = filterResources(catalog, { ...emptyFilters, subject: '数学' }, '');
    expect(result.map((resource) => resource.contentId)).toEqual(['b']);
  });

  it('matches year keywords too', () => {
    const catalog = [make('a', { resourceYear: '2026年度' }), make('b', { resourceYear: '2025年度' })];
    const result = filterResources(catalog, emptyFilters, '2026');
    expect(result.map((resource) => resource.contentId)).toEqual(['a']);
  });
});

describe('computeFilterOptions', () => {
  it('narrows edition options based on the selected subject', () => {
    const catalog = [make('a', { subject: '英语', edition: '北师大版' }), make('b', { subject: '英语', edition: '人教版' }), make('c', { subject: '数学', edition: '人教版' })];
    const options = computeFilterOptions(catalog, { ...emptyFilters, subject: '英语' });
    expect(options.edition).toEqual(['人教版', '北师大版']);
  });
});

describe('groupResources', () => {
  it('groups by the classification key and keeps order', () => {
    const catalog = [make('a', { subject: '英语', grade: '七年级' }), make('b', { subject: '英语', grade: '七年级' }), make('c', { subject: '数学', grade: '八年级' })];
    const groups = groupResources(catalog);
    expect(groups).toHaveLength(2);
    const english = groups.find(([key]) => key.includes('英语'))!;
    expect(english[1].map((resource) => resource.contentId)).toEqual(['a', 'b']);
  });
});

describe('selection helpers', () => {
  it('getSelectableResources skips downloaded only when enabled', () => {
    const catalog = [make('a', { localState: 'downloaded' }), make('b')];
    expect(getSelectableResources(catalog, true).map((resource) => resource.contentId)).toEqual(['b']);
    expect(getSelectableResources(catalog, false)).toHaveLength(2);
  });

  it('getSelectedResources enforces skip downloaded when submitting a batch', () => {
    const catalog = [make('a', { localState: 'downloaded' }), make('b')];
    const selected = new Set(['a', 'b']);
    expect(getSelectedResources(catalog, selected, true).map((resource) => resource.contentId)).toEqual(['b']);
    expect(getSelectedResources(catalog, selected, false).map((resource) => resource.contentId)).toEqual(['a', 'b']);
  });

  it('toggleAllSelection selects then clears the given list', () => {
    const list = [make('a'), make('b')];
    const selected = toggleAllSelection(new Set(), list, false);
    expect(selected.has('a')).toBe(true);
    expect(selected.has('b')).toBe(true);
    expect(toggleAllSelection(selected, list, true).size).toBe(0);
  });

  it('toggleSkipDownloaded removes downloaded items when enabled and re-adds on disable', () => {
    const catalog = [make('a', { localState: 'downloaded' }), make('b')];
    const enabled = toggleSkipDownloaded(new Set(['a', 'b']), catalog, catalog, true, false);
    expect(enabled.has('a')).toBe(false);
    const disabled = toggleSkipDownloaded(new Set(['a']), catalog, catalog, false, true);
    expect(disabled.has('b')).toBe(true);
  });
});
