import { describe, expect, it } from 'vitest';
import { normalizeResource } from '../electron/catalog-normalize.cjs';

describe('normalizeResource', () => {
  it('normalizes a fully tagged item', () => {
    const item = {
      id: 'abc-123',
      global_title: { 'zh-CN': '普通高中教科书·数学（B版）必修 第一册' },
      tag_list: [
        { tag_dimension_id: 'zxxxd', tag_name: '高中' },
        { tag_dimension_id: 'zxxxk', tag_name: '数学' },
        { tag_dimension_id: 'zxxnj', tag_name: '高中年级' },
        { tag_dimension_id: 'zxxcc', tag_name: '必修 第一册' },
        { tag_dimension_id: 'zxxbb', tag_name: '人教版（B版）' },
        { tag_dimension_id: 'bknd', tag_name: '2026年度' },
      ],
      custom_properties: { size: 123456 },
      online_time: '2026-01-01',
      update_time: '2026-02-01',
    };
    expect(normalizeResource(item)).toEqual({
      contentId: 'abc-123',
      title: '普通高中教科书·数学（B版）必修 第一册',
      stage: '高中',
      subject: '数学',
      grade: '高中年级',
      volume: '必修 第一册',
      edition: '人教版（B版）',
      resourceYear: '2026年度',
      onlineTime: '2026-01-01',
      updateTime: '2026-02-01',
      sizeBytes: 123456,
      localState: 'not-downloaded',
    });
  });

  it('infers stage/subject/grade/volume from the title when tags are missing', () => {
    const result = normalizeResource({ id: 'x', global_title: { 'zh-CN': '英语 七年级上册' } });
    expect(result.stage).toBe('初中');
    expect(result.subject).toBe('英语');
    expect(result.grade).toBe('七年级');
    expect(result.volume).toBe('上册');
  });

  it('falls back to the id and empty fields for an opaque item', () => {
    const result = normalizeResource({ id: 'only-id' });
    expect(result.title).toBe('only-id');
    expect(result.stage).toBe('');
    expect(result.subject).toBe('');
    expect(result.grade).toBe('');
    expect(result.volume).toBe('');
    expect(result.sizeBytes).toBe(0);
  });
});
