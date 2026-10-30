(() => {
  const urls = new Set();
  const requests = new Map();
  const visited = new Set();
  let html = '';
  const visit = (frame) => {
    if (visited.has(frame) || visited.size >= 32) return;
    visited.add(frame);
    try {
      const doc = frame.document;
      const state = frame.__smarteduLiteProbe || { urls: [], requests: [] };
      for (const url of state.urls) if (urls.size < 2048) urls.add(url);
      for (const request of state.requests) {
        if (requests.size < 256 || requests.has(request.url)) requests.set(request.url, request);
      }
      for (const entry of frame.performance.getEntriesByType('resource')) {
        if (urls.size < 2048) urls.add(entry.name);
      }
      for (const element of doc.querySelectorAll('iframe[src], embed[src], object[data], a[href]')) {
        const value = element.src || element.data || element.href;
        if (value && urls.size < 2048) urls.add(value);
      }
      if (html.length < 1024 * 1024 && doc.documentElement) {
        html += '\n' + doc.documentElement.outerHTML.slice(0, 1024 * 1024 - html.length);
      }
      for (let index = 0; index < frame.frames.length && visited.size < 32; index++) visit(frame.frames[index]);
    } catch (_) {
      // Cross-origin frame requests are observed by the native Windows hook.
    }
  };
  visit(window);
  return { html, title: document.title || '', urls: [...urls], requests: [...requests.values()] };
})()
