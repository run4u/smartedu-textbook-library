const path = require('node:path');

const DEFAULT_FILENAME_TEMPLATE = '{学段}_{学科}_{年级}_{册次}_{版本}_{年度}_{短ID}';
const templateFields = {
  '{教材名称}': (resource) => resource.title,
  '{学段}': (resource) => resource.stage,
  '{学科}': (resource) => resource.subject,
  '{年级}': (resource) => resource.grade,
  '{册次}': (resource) => resource.volume,
  '{版本}': (resource) => resource.edition,
  '{年度}': (resource) => resource.resourceYear,
  '{资源ID}': (resource) => resource.contentId,
  '{短ID}': (resource) => String(resource.contentId || '').slice(0, 8),
};

function sanitizeFilename(value) {
  return String(value || '').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').replace(/_+/g, '_').trim();
}

function filename(resource, template = DEFAULT_FILENAME_TEMPLATE) {
  const sourceTemplate = String(template || DEFAULT_FILENAME_TEMPLATE);
  let rendered = sourceTemplate;
  for (const [token, read] of Object.entries(templateFields)) rendered = rendered.split(token).join(String(read(resource) || ''));
  rendered = sanitizeFilename(rendered.replace(/\{[^{}]+\}/g, '')) || `教材_${String(resource.contentId || '').slice(0, 8)}`;
  rendered = rendered.replace(/\.pdf$/i, '');
  if (!sourceTemplate.includes('{短ID}') && !sourceTemplate.includes('{资源ID}')) rendered = `${rendered}_${String(resource.contentId || '').slice(0, 8)}`;
  return `${rendered}.pdf`;
}

function outputPaths(resource, downloadsPath, options = {}) {
  const directory = options.directory || path.join(downloadsPath, 'SmartEdu Textbook Library');
  const target = path.join(directory, filename(resource, options.filenameTemplate));
  return { directory, target, part: `${target}.part` };
}

function validatePdf(headerAscii, size, expectedSize) {
  if (headerAscii !== '%PDF-') return new Error('下载内容不是 PDF 文件');
  if (expectedSize > 0 && size !== expectedSize) return new Error(`文件大小校验失败：期望 ${expectedSize}，实际 ${size}`);
  return null;
}

module.exports = { DEFAULT_FILENAME_TEMPLATE, filename, outputPaths, sanitizeFilename, validatePdf };
