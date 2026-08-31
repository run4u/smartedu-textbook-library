import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { filename, outputPaths, validatePdf } from '../electron/download-utils.cjs';

const resource = {
  contentId: 'abcdefgh-1234-5678-9abc-def012345678',
  stage: '高中',
  subject: '数学',
  grade: '高中年级',
  volume: '必修 第一册',
  edition: '人教版（B版）',
  resourceYear: '2026年度',
};

describe('filename', () => {
  it('joins classification, year and short id with underscores', () => {
    expect(filename(resource)).toBe('高中_数学_高中年级_必修 第一册_人教版（B版）_2026年度_abcdefgh.pdf');
  });

  it('never contains characters invalid on Windows', () => {
    const tricky = { ...resource, edition: '版本"<>|:*?/\\测试' };
    const name = filename(tricky);
    expect(/[\\/:*?"<>|]/.test(name)).toBe(false);
  });

  it('renders a custom template and appends a short id when the template omits identity', () => {
    expect(filename({ ...resource, title: '数学/教材' }, '{教材名称}_{年度}')).toBe('数学_教材_2026年度_abcdefgh.pdf');
  });

  it('does not append another id when the template contains an identity token', () => {
    expect(filename(resource, '{学科}_{短ID}')).toBe('数学_abcdefgh.pdf');
  });

  it('does not duplicate a pdf extension supplied by the user', () => {
    expect(filename(resource, '{学科}_{短ID}.pdf')).toBe('数学_abcdefgh.pdf');
  });
});

describe('outputPaths', () => {
  it('places files under the SmartEdu Textbook Library directory with a .part sibling', () => {
    const downloadsPath = path.join('test-root', 'downloads');
    const paths = outputPaths(resource, downloadsPath);
    expect(paths.directory).toBe(path.join(downloadsPath, 'SmartEdu Textbook Library'));
    expect(paths.target).toBe(path.join(paths.directory, '高中_数学_高中年级_必修 第一册_人教版（B版）_2026年度_abcdefgh.pdf'));
    expect(paths.part).toBe(`${paths.target}.part`);
  });

  it('supports a custom output directory and filename template', () => {
    const directory = path.join('test-root', 'custom');
    const paths = outputPaths(resource, path.join('ignored', 'downloads'), { directory, filenameTemplate: '{学科}_{年度}_{短ID}' });
    expect(paths.target).toBe(path.join(directory, '数学_2026年度_abcdefgh.pdf'));
  });
});

describe('validatePdf', () => {
  it('accepts a matching PDF header and size', () => {
    expect(validatePdf('%PDF-', 100, 100)).toBeNull();
  });

  it('rejects a non-PDF header', () => {
    expect(validatePdf('nope!', 100, 100)).toBeInstanceOf(Error);
  });

  it('rejects a size mismatch when an expected size is given', () => {
    const error = validatePdf('%PDF-', 90, 100);
    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toContain('期望 100，实际 90');
  });

  it('skips size check when expected size is unknown', () => {
    expect(validatePdf('%PDF-', 90, 0)).toBeNull();
  });
});
