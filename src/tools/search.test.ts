import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { webSearchTool } from './search.js';

type SearchResult = Array<{ title: string; url: string; snippet: string }>;

function mockDuckDuckGoResponse(data: {
  AbstractText?: string;
  AbstractURL?: string;
  AbstractSource?: string;
  RelatedTopics?: Array<{ Text: string; FirstURL: string }>;
}): Response {
  return new Response(JSON.stringify({
    AbstractText: '',
    AbstractURL: '',
    AbstractSource: '',
    RelatedTopics: [],
    ...data,
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('webSearchTool — DuckDuckGo fallback (no Brave key)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    // Ensure Brave key is not present
    delete process.env['BRAVE_SEARCH_API_KEY'];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the abstract as the first result', async () => {
    vi.mocked(fetch).mockResolvedValue(mockDuckDuckGoResponse({
      AbstractText: 'Tokyo is the capital of Japan.',
      AbstractURL: 'https://en.wikipedia.org/wiki/Tokyo',
      AbstractSource: 'Wikipedia',
    }));

    const results = await webSearchTool.execute({ query: 'Tokyo capital' }) as SearchResult;
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.snippet).toContain('Tokyo');
    expect(results[0]!.url).toBe('https://en.wikipedia.org/wiki/Tokyo');
  });

  it('returns related topics when abstract is empty', async () => {
    vi.mocked(fetch).mockResolvedValue(mockDuckDuckGoResponse({
      RelatedTopics: [
        { Text: 'Python - Programming language', FirstURL: 'https://en.wikipedia.org/wiki/Python' },
        { Text: 'Python (snake) - Reptile', FirstURL: 'https://en.wikipedia.org/wiki/Python_snake' },
      ],
    }));

    const results = await webSearchTool.execute({ query: 'python' }) as SearchResult;
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results.some((r) => r.url.includes('wikipedia.org'))).toBe(true);
  });

  it('combines abstract and related topics up to num_results', async () => {
    vi.mocked(fetch).mockResolvedValue(mockDuckDuckGoResponse({
      AbstractText: 'Abstract summary.',
      AbstractURL: 'https://example.com/abstract',
      AbstractSource: 'Source',
      RelatedTopics: [
        { Text: 'Topic 1', FirstURL: 'https://example.com/1' },
        { Text: 'Topic 2', FirstURL: 'https://example.com/2' },
        { Text: 'Topic 3', FirstURL: 'https://example.com/3' },
      ],
    }));

    const results = await webSearchTool.execute({ query: 'test', num_results: 3 }) as SearchResult;
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it('caps results at 10 even when a larger num_results is requested', async () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      Text: `Result ${i}`,
      FirstURL: `https://example.com/${i}`,
    }));
    vi.mocked(fetch).mockResolvedValue(mockDuckDuckGoResponse({ RelatedTopics: many }));

    const results = await webSearchTool.execute({ query: 'test', num_results: 50 }) as SearchResult;
    expect(results.length).toBeLessThanOrEqual(10);
  });

  it('omits topics that lack a URL', async () => {
    vi.mocked(fetch).mockResolvedValue(mockDuckDuckGoResponse({
      RelatedTopics: [
        { Text: 'Valid result', FirstURL: 'https://example.com/valid' },
        { Text: 'No URL', FirstURL: '' },
      ],
    }));

    const results = await webSearchTool.execute({ query: 'test' }) as SearchResult;
    expect(results.every((r) => r.url.length > 0)).toBe(true);
  });

  it('throws when DuckDuckGo returns a non-200 status', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('', { status: 500 }));

    await expect(webSearchTool.execute({ query: 'anything' })).rejects.toThrow('DuckDuckGo search failed');
  });

  it('constructs the correct DuckDuckGo API URL', async () => {
    vi.mocked(fetch).mockResolvedValue(mockDuckDuckGoResponse({}));

    await webSearchTool.execute({ query: 'hello world' });

    const calledUrl = String(vi.mocked(fetch).mock.calls[0]?.[0] ?? '');
    expect(calledUrl).toContain('api.duckduckgo.com');
    expect(calledUrl).toContain(encodeURIComponent('hello world'));
    expect(calledUrl).toContain('format=json');
  });
});

describe('webSearchTool — Brave Search API', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    process.env['BRAVE_SEARCH_API_KEY'] = 'test-brave-key-abc123';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env['BRAVE_SEARCH_API_KEY'];
  });

  it('uses the Brave API when a key is set', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
      web: {
        results: [
          { title: 'Brave Result', url: 'https://example.com', description: 'A brave search result' },
        ],
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    const results = await webSearchTool.execute({ query: 'test query' }) as SearchResult;
    expect(results[0]!.title).toBe('Brave Result');
    expect(results[0]!.snippet).toBe('A brave search result');
    expect(results[0]!.url).toBe('https://example.com');
  });

  it('passes the Brave API key in the X-Subscription-Token header', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ web: { results: [] } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    await webSearchTool.execute({ query: 'test' });

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('api.search.brave.com'),
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-Subscription-Token': 'test-brave-key-abc123',
        }),
      }),
    );
  });

  it('requests the correct result count from Brave', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ web: { results: [] } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    await webSearchTool.execute({ query: 'test', num_results: 7 });

    const calledUrl = String(vi.mocked(fetch).mock.calls[0]?.[0] ?? '');
    expect(calledUrl).toContain('count=7');
  });

  it('returns an empty array when Brave has no results', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ web: { results: [] } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    const results = await webSearchTool.execute({ query: 'xyzabc' }) as SearchResult;
    expect(results).toHaveLength(0);
  });

  it('throws when Brave returns a non-200 status', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('Unauthorized', { status: 401 }));

    await expect(webSearchTool.execute({ query: 'test' })).rejects.toThrow('Brave search failed');
  });
});

describe('webSearchTool — tool metadata', () => {
  it('has the correct tool name', () => {
    expect(webSearchTool.name).toBe('web_search');
  });

  it('has a non-empty description', () => {
    expect(webSearchTool.description.length).toBeGreaterThan(10);
  });

  it('input_schema requires query', () => {
    expect(webSearchTool.input_schema.required).toContain('query');
  });

  it('input_schema has num_results as optional property', () => {
    expect(webSearchTool.input_schema.properties['num_results']).toBeDefined();
  });
});
