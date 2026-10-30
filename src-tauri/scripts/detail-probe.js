(() => {
  if (window.__smarteduLiteProbe) return;
  const state = window.__smarteduLiteProbe = { urls: [], requests: [] };
  const normalizeUrl = (value) => {
    try {
      const raw = value && value.url !== undefined ? value.url : value;
      const url = new URL(String(raw), location.href);
      if (!['https:', 'http:'].includes(url.protocol)) return '';
      url.hash = '';
      return url.href;
    } catch (_) { return ''; }
  };
  const rememberUrl = (value) => {
    const url = normalizeUrl(value);
    if (url && !state.urls.includes(url)) {
      if (state.urls.length >= 512) state.urls.shift();
      state.urls.push(url);
    }
    return url;
  };
  const rememberRequest = (value, headers) => {
    const url = rememberUrl(value);
    if (!url) return;
    try {
      const auth = new Headers(headers || {}).get('x-nd-auth') || '';
      if (!auth) return;
      const index = state.requests.findIndex((entry) => entry.url === url);
      if (index >= 0) state.requests.splice(index, 1);
      if (state.requests.length >= 128) state.requests.shift();
      state.requests.push({ url, auth });
    } catch (_) {}
  };
  const originalFetch = window.fetch;
  if (originalFetch) {
    window.fetch = function(input, init) {
      const headers = init && init.headers !== undefined ? init.headers : input && input.headers;
      rememberRequest(input, headers);
      return originalFetch.apply(this, arguments).then((response) => {
        rememberUrl(response && response.url);
        return response;
      });
    };
  }
  const requests = new WeakMap();
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSetHeader = XMLHttpRequest.prototype.setRequestHeader;
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(method, url) {
    const result = originalOpen.apply(this, arguments);
    requests.set(this, { url: rememberUrl(url), headers: new Headers() });
    return result;
  };
  XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
    const result = originalSetHeader.apply(this, arguments);
    const request = requests.get(this);
    if (request) request.headers.append(name, value);
    return result;
  };
  XMLHttpRequest.prototype.send = function() {
    const request = requests.get(this);
    if (request) rememberRequest(request.url, request.headers);
    return originalSend.apply(this, arguments);
  };
})();
