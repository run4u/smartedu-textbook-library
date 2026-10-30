import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const install = readFileSync(new URL('../src-tauri/scripts/detail-probe.js', import.meta.url), 'utf8');
const read = readFileSync(new URL('../src-tauri/scripts/read-detail-probe.js', import.meta.url), 'utf8');

function browser() {
  class Xhr {
    open(_method: string, _url: string) {}
    setRequestHeader(_name: string, _value: string) {}
    send() {}
  }
  const response = { url: 'https://cdn.example/book.pdf' };
  const fetch = vi.fn().mockResolvedValue(response);
  const window: any = { fetch };
  const context: any = { window, XMLHttpRequest: Xhr, URL, Headers, location: { href: 'https://basic.smartedu.cn/detail' } };
  runInNewContext(install, context);
  return { context, window, Xhr, fetch, response };
}

describe('Lite browser request probe', () => {
  it('binds fetch authorization to its resolved request URL and preserves the response', async () => {
    const b = browser();
    const response = await b.window.fetch('/book.pdf#page=2', { headers: { 'X-Nd-Auth': 'fixture' } });
    expect(response).toBe(b.response);
    expect(b.window.__smarteduLiteProbe.requests).toEqual([{ url: 'https://basic.smartedu.cn/book.pdf', auth: 'fixture' }]);
    await b.window.fetch('https://cdn.example/public.pdf');
    expect(b.window.__smarteduLiteProbe.requests).toHaveLength(1);
  });

  it('respects Request headers and an explicit fetch header override', async () => {
    const b = browser();
    const request = { url: 'https://cdn.example/book.pdf', headers: { 'X-Nd-Auth': 'original' } };
    await b.window.fetch(request);
    expect(b.window.__smarteduLiteProbe.requests[0].auth).toBe('original');
    const other = { url: 'https://cdn.example/public.pdf', headers: request.headers };
    await b.window.fetch(other, { headers: {} });
    expect(b.window.__smarteduLiteProbe.requests).toHaveLength(1);
  });

  it('keeps concurrent XHR credentials separate and captures only sent requests', () => {
    const b = browser();
    const first = new b.Xhr();
    const second = new b.Xhr();
    first.open('GET', '/first.pdf');
    first.setRequestHeader('X-Nd-Auth', 'first');
    second.open('GET', '/second.pdf');
    second.setRequestHeader('X-Nd-Auth', 'second');
    expect(b.window.__smarteduLiteProbe.requests).toHaveLength(0);
    second.send();
    first.send();
    expect(b.window.__smarteduLiteProbe.requests).toEqual([
      { url: 'https://basic.smartedu.cn/second.pdf', auth: 'second' },
      { url: 'https://basic.smartedu.cn/first.pdf', auth: 'first' },
    ]);
    first.open('GET', '/public.pdf');
    first.send();
    expect(b.window.__smarteduLiteProbe.requests).toHaveLength(2);
  });

  it('does not wrap requests twice or swallow a browser network error', async () => {
    const b = browser();
    const wrapped = b.window.fetch;
    runInNewContext(install, b.context);
    expect(b.window.fetch).toBe(wrapped);
    const error = new Error('offline');
    b.fetch.mockRejectedValueOnce(error);
    await expect(b.window.fetch('/book.pdf')).rejects.toBe(error);
  });

  it('bounds URL and authorization buffers', async () => {
    const b = browser();
    for (let index = 0; index < 600; index++) {
      await b.window.fetch(`/book-${index}.pdf`, { headers: { 'X-Nd-Auth': `fixture-${index}` } });
    }
    expect(b.window.__smarteduLiteProbe.urls.length).toBeLessThanOrEqual(512);
    expect(b.window.__smarteduLiteProbe.requests).toHaveLength(128);
    expect(b.window.__smarteduLiteProbe.requests.at(-1).auth).toBe('fixture-599');
  });

  it('reads same-origin reader frames while tolerating a cross-origin frame', () => {
    const frame = (requests: any[] = [], frames: any[] = [], elements: any[] = []) => ({
      document: { title: 'Textbook reader', documentElement: { outerHTML: '<html></html>' }, querySelectorAll: () => elements },
      performance: { getEntriesByType: () => [] },
      __smarteduLiteProbe: { requests, urls: requests.map((request) => request.url) }, frames,
    });
    const child = frame([{ url: 'https://cdn.example/book.pdf', auth: 'reader-fixture' }]);
    const blocked = Object.defineProperty({}, 'document', { get() { throw new Error('cross-origin'); } });
    const window = frame([], [child, blocked], [{ src: 'https://reader.example/viewer.html?file=book.pdf' }]);
    const result = runInNewContext(read, { window, document: window.document });
    expect(result.requests).toEqual([{ url: 'https://cdn.example/book.pdf', auth: 'reader-fixture' }]);
    expect(result.urls).toContain('https://reader.example/viewer.html?file=book.pdf');
    expect(result.title).toBe('Textbook reader');
  });
});
