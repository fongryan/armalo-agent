import type { Tool } from '../types.js';

/**
 * Web search tool — fetches results from a search provider.
 * Uses the Brave Search API when BRAVE_SEARCH_API_KEY is set (full web search).
 * Falls back to DuckDuckGo Instant Answer API (Wikipedia abstracts + related
 * topics only — NOT full web search results).
 */
export const webSearchTool: Tool = {
  name: 'web_search',
  description:
    'Search the web for information. With BRAVE_SEARCH_API_KEY set, returns full web results. Without it, falls back to DuckDuckGo Instant Answers (Wikipedia abstracts and related topics — not full web search).',
  input_schema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search query',
      },
      num_results: {
        type: 'number',
        description: 'Number of results to return (default: 5, max: 10)',
      },
    },
    required: ['query'],
  },
  async execute({ query, num_results = 5 }: Record<string, unknown>) {
    const q = String(query);
    const n = Math.min(Number(num_results) || 5, 10);

    const braveKey = process.env.BRAVE_SEARCH_API_KEY;
    if (braveKey) {
      return await searchBrave(q, n, braveKey);
    }

    return await searchDuckDuckGo(q, n);
  },
};

async function searchBrave(query: string, count: number, apiKey: string): Promise<unknown> {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`;
  const res = await fetch(url, {
    headers: { 'Accept': 'application/json', 'X-Subscription-Token': apiKey },
  });
  if (!res.ok) throw new Error(`Brave search failed: ${res.status}`);
  const data = await res.json() as { web?: { results?: Array<{ title: string; url: string; description: string }> } };
  const results = data?.web?.results ?? [];
  return results.slice(0, count).map((r) => ({
    title: r.title,
    url: r.url,
    snippet: r.description,
  }));
}

async function searchDuckDuckGo(query: string, count: number): Promise<unknown> {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'armalo-agent/0.1.0' },
  });
  if (!res.ok) throw new Error(`DuckDuckGo search failed: ${res.status}`);
  const data = await res.json() as {
    RelatedTopics?: Array<{ Text?: string; FirstURL?: string }>;
    AbstractText?: string;
    AbstractURL?: string;
    AbstractSource?: string;
  };

  const results: Array<{ title: string; url: string; snippet: string }> = [];

  if (data.AbstractText) {
    results.push({
      title: data.AbstractSource || 'Summary',
      url: data.AbstractURL || '',
      snippet: data.AbstractText,
    });
  }

  for (const topic of (data.RelatedTopics ?? []).slice(0, count - results.length)) {
    if (topic.Text && topic.FirstURL) {
      results.push({
        title: topic.Text.split(' - ')[0] ?? topic.Text,
        url: topic.FirstURL,
        snippet: topic.Text,
      });
    }
  }

  return results.slice(0, count);
}
