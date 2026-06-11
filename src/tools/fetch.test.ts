import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchUrlTool } from './fetch.js';

type FetchResult = { url: string; content: string; truncated: boolean; length: number };

describe('fetchUrlTool — SSRF protection', () => {
  // These should throw before any network call is made
  const blocked = [
    ['localhost', 'http://localhost/admin'],
    ['127.0.0.1 (loopback)', 'http://127.0.0.1/secret'],
    ['127.0.0.99 (loopback range)', 'http://127.0.0.99/secret'],
    ['192.168.1.1 (LAN router)', 'http://192.168.1.1/admin'],
    ['10.0.0.1 (Class A private)', 'http://10.0.0.1/internal'],
    ['172.16.0.1 (VPC lower bound)', 'http://172.16.0.1/vpc'],
    ['172.24.0.1 (VPC mid)', 'http://172.24.0.1/vpc'],
    ['172.31.255.255 (VPC upper bound)', 'http://172.31.255.255/vpc'],
    ['169.254.169.254 (AWS IMDSv1)', 'http://169.254.169.254/latest/meta-data/'],
    ['169.254.0.1 (link-local)', 'http://169.254.0.1/anything'],
    ['0.0.0.0 (unspecified)', 'http://0.0.0.0/any'],
    ['IPv6 loopback [::1]', 'http://[::1]/admin'],
  ] as const;

  it.each(blocked)('blocks %s', async (_label, url) => {
    await expect(fetchUrlTool.execute({ url })).rejects.toThrow();
  });

  it('blocks file:// protocol', async () => {
    await expect(fetchUrlTool.execute({ url: 'file:///etc/passwd' }))
      .rejects.toThrow(/Only http\/https/);
  });

  it('blocks javascript: protocol', async () => {
    await expect(fetchUrlTool.execute({ url: 'javascript:alert(1)' }))
      .rejects.toThrow(/Only http\/https/);
  });

  it('blocks ftp:// protocol', async () => {
    await expect(fetchUrlTool.execute({ url: 'ftp://example.com/file' }))
      .rejects.toThrow(/Only http\/https/);
  });

  it('throws a descriptive error on invalid URL', async () => {
    await expect(fetchUrlTool.execute({ url: 'not-a-url' }))
      .rejects.toThrow('Invalid URL');
  });

  it('throws a descriptive error on empty string URL', async () => {
    await expect(fetchUrlTool.execute({ url: '' }))
      .rejects.toThrow();
  });
});

describe('fetchUrlTool — fetch behavior (mocked network)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches a public HTTPS URL', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(
      '<html><body><p>Hello world</p></body></html>',
      { status: 200, headers: { 'content-type': 'text/html' } },
    ));

    const result = await fetchUrlTool.execute({ url: 'https://example.com' }) as FetchResult;
    expect(result.url).toBe('https://example.com');
    expect(result.content).toContain('Hello world');
    expect(result.truncated).toBe(false);
  });

  it('strips <script> tags from HTML', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(
      '<html><body><script>alert("xss")</script><p>Safe text</p></body></html>',
      { status: 200, headers: { 'content-type': 'text/html' } },
    ));

    const result = await fetchUrlTool.execute({ url: 'https://example.com' }) as FetchResult;
    expect(result.content).toContain('Safe text');
    expect(result.content).not.toContain('<script>');
    expect(result.content).not.toContain('alert');
  });

  it('strips <style> tags from HTML', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(
      '<html><head><style>body { color: red; }</style></head><body><p>Text</p></body></html>',
      { status: 200, headers: { 'content-type': 'text/html' } },
    ));

    const result = await fetchUrlTool.execute({ url: 'https://example.com' }) as FetchResult;
    expect(result.content).toContain('Text');
    expect(result.content).not.toContain('<style>');
    expect(result.content).not.toContain('color: red');
  });

  it('decodes common HTML entities', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(
      '<p>AT&amp;T &lt;telecom&gt; &quot;test&quot; it&#39;s &nbsp;here</p>',
      { status: 200, headers: { 'content-type': 'text/html' } },
    ));

    const result = await fetchUrlTool.execute({ url: 'https://example.com' }) as FetchResult;
    expect(result.content).toContain('AT&T');
    expect(result.content).toContain('<telecom>');
    expect(result.content).toContain('"test"');
    expect(result.content).toContain("it's");
  });

  it('returns plain text responses without modification', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('Just plain text', {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    }));

    const result = await fetchUrlTool.execute({ url: 'https://example.com/file.txt' }) as FetchResult;
    expect(result.content).toBe('Just plain text');
  });

  it('detects HTML body even without content-type header', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(
      '<html><body><p>Detected HTML</p></body></html>',
      { status: 200, headers: { 'content-type': 'application/octet-stream' } },
    ));

    const result = await fetchUrlTool.execute({ url: 'https://example.com' }) as FetchResult;
    expect(result.content).toContain('Detected HTML');
    expect(result.content).not.toContain('<p>');
  });

  it('throws on HTTP error status', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('Not Found', { status: 404 }));

    await expect(fetchUrlTool.execute({ url: 'https://example.com/missing' }))
      .rejects.toThrow('HTTP 404');
  });

  it('throws on 500 server error', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('Internal Server Error', { status: 500 }));

    await expect(fetchUrlTool.execute({ url: 'https://example.com' }))
      .rejects.toThrow('HTTP 500');
  });

  it('truncates content to max_length', async () => {
    const longContent = 'x'.repeat(100);
    vi.mocked(fetch).mockResolvedValue(new Response(longContent, {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    }));

    const result = await fetchUrlTool.execute({ url: 'https://example.com', max_length: 10 }) as FetchResult;
    expect(result.content).toHaveLength(10);
    expect(result.truncated).toBe(true);
    expect(result.length).toBe(100);
  });

  it('does not set truncated when content fits', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('short', {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    }));

    const result = await fetchUrlTool.execute({ url: 'https://example.com' }) as FetchResult;
    expect(result.truncated).toBe(false);
  });

  it('caps max_length at 50_000 even if higher value passed', async () => {
    const longContent = 'y'.repeat(60_000);
    vi.mocked(fetch).mockResolvedValue(new Response(longContent, {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    }));

    const result = await fetchUrlTool.execute({ url: 'https://example.com', max_length: 999_999 }) as FetchResult;
    expect(result.content.length).toBeLessThanOrEqual(50_000);
  });

  it('sends the armalo-agent User-Agent header', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('ok', {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    }));

    await fetchUrlTool.execute({ url: 'https://example.com' });

    expect(fetch).toHaveBeenCalledWith(
      'https://example.com',
      expect.objectContaining({
        headers: expect.objectContaining({
          'User-Agent': expect.stringContaining('armalo-agent'),
        }),
      }),
    );
  });
});

describe('fetchUrlTool — tool metadata', () => {
  it('has the correct tool name', () => {
    expect(fetchUrlTool.name).toBe('fetch_url');
  });

  it('has a non-empty description', () => {
    expect(fetchUrlTool.description.length).toBeGreaterThan(10);
  });

  it('requires the url field', () => {
    expect(fetchUrlTool.input_schema.required).toContain('url');
  });
});
