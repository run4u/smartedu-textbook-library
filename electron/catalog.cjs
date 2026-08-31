const fs = require('node:fs/promises');
const path = require('node:path');
const { app } = require('electron');
const { normalizeResource } = require('./catalog-normalize.cjs');

const VERSION_URL = 'https://s-file-2.ykt.cbern.com.cn/zxx/ndrs/resources/tch_material/version/data_version.json';

async function fetchCatalog() {
  const version = await fetch(VERSION_URL, { signal: AbortSignal.timeout(20000) });
  if (!version.ok) throw new Error(`官方目录响应异常：${version.status}`);
  const { urls = '' } = await version.json();
  const parts = String(urls).split(',').map((url) => url.trim()).filter(Boolean);
  const responses = await Promise.all(parts.map(async (url) => { const response = await fetch(url, { signal: AbortSignal.timeout(30000) }); if (!response.ok) throw new Error(`官方目录分片响应异常：${response.status}`); return response.json(); }));
  return responses.flat().map(normalizeResource).filter((item) => item.contentId);
}

async function loadCatalog() {
  const cachePath = path.join(app.getPath('userData'), 'catalog-cache.json');
  try { const resources = await fetchCatalog(); await fs.writeFile(cachePath, JSON.stringify({ cachedAt: new Date().toISOString(), resources })); return { resources, source: 'official', cachedAt: new Date().toISOString() }; }
  catch (error) { try { const cached = JSON.parse(await fs.readFile(cachePath, 'utf8')); if (Array.isArray(cached.resources)) return { ...cached, source: 'cache', warning: error.message }; } catch {} throw error; }
}

module.exports = { loadCatalog, fetchCatalog };
