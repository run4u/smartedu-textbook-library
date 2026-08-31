import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  server: {
    watch: {
      ignored: ['**/.electron-data/**'],
    },
  },
  plugins: [react(), { name: 'official-catalog-api', configureServer: (server) => {
    server.middlewares.use('/api/catalog', async (_request, response) => {
      try {
        const version = await fetch('https://s-file-2.ykt.cbern.com.cn/zxx/ndrs/resources/tch_material/version/data_version.json');
        const { urls = '' } = await version.json() as { urls?: string };
        const parts = await Promise.all(String(urls).split(',').filter(Boolean).map(async (url) => (await fetch(url.trim())).json()));
        const resources = parts.flat().map((item: any) => { const tags = Object.fromEntries((item.tag_list || []).filter((tag: any) => tag.tag_dimension_id && tag.tag_name).map((tag: any) => [tag.tag_dimension_id, tag.tag_name])); const title = item.global_title?.['zh-CN'] || item.id; const grade = tags.zxxnj || title.match(/[一二三四五六七八九]年级/)?.[0] || ''; const subject = tags.zxxxk || ['语文', '数学', '英语', '物理', '化学', '生物', '历史', '地理', '道德与法治'].find((name) => title.includes(name)) || ''; const volume = tags.zxxcc || title.match(/上册|下册|全一册/)?.[0] || ''; const stage = tags.zxxxd || (/^[一二三四五六]年级$/.test(grade) ? '小学' : /^[七八九]年级$/.test(grade) ? '初中' : ''); return { contentId: item.id, title, stage, subject, grade, volume, edition: tags.zxxbb || '', resourceYear: tags.bknd || '', onlineTime: item.online_time || '', updateTime: item.update_time || '', sizeBytes: item.custom_properties?.size || 0, localState: 'not-downloaded' }; });
        response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ resources, source: 'official', cachedAt: new Date().toISOString() }));
      } catch (error) { response.statusCode = 502; response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) })); }
    });
  } }],
  base: './',
});
