const path = require('node:path');

function filename(resource) {
  return [resource.stage, resource.subject, resource.grade, resource.volume, resource.edition, resource.resourceYear, resource.contentId.slice(0, 8)].filter(Boolean).join('_').replace(/[\\/:*?"<>|]/g, '_') + '.pdf';
}

function outputPaths(resource, downloadsPath) {
  const directory = path.join(downloadsPath, 'SmartEdu Textbook Library');
  const target = path.join(directory, filename(resource));
  return { directory, target, part: `${target}.part` };
}

function validatePdf(headerAscii, size, expectedSize) {
  if (headerAscii !== '%PDF-') return new Error('下载内容不是 PDF 文件');
  if (expectedSize > 0 && size !== expectedSize) return new Error(`文件大小校验失败：期望 ${expectedSize}，实际 ${size}`);
  return null;
}

module.exports = { filename, outputPaths, validatePdf };
