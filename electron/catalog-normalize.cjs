function normalizeResource(item) {
  const tags = Object.fromEntries((item.tag_list || []).filter((tag) => tag.tag_dimension_id && tag.tag_name).map((tag) => [tag.tag_dimension_id, tag.tag_name]));
  const properties = item.custom_properties || {};
  const title = item.global_title?.['zh-CN'] || item.id;
  const grade = tags.zxxnj || title.match(/[一二三四五六七八九]年级/)?.[0] || '';
  const subject = tags.zxxxk || ['语文', '数学', '英语', '物理', '化学', '生物', '历史', '地理', '道德与法治'].find((name) => title.includes(name)) || '';
  const volume = tags.zxxcc || title.match(/上册|下册|全一册/)?.[0] || '';
  const stage = tags.zxxxd || (/^[一二三四五六]年级$/.test(grade) ? '小学' : /^[七八九]年级$/.test(grade) ? '初中' : '');
  return { contentId: item.id, title, stage, subject, grade, volume, edition: tags.zxxbb || '', resourceYear: tags.bknd || '', onlineTime: item.online_time || '', updateTime: item.update_time || '', sizeBytes: properties.size || 0, localState: 'not-downloaded' };
}

module.exports = { normalizeResource };
