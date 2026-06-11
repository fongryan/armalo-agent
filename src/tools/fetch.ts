import type { Tool } from '../types.js';

const MAX_CONTENT_LENGTH = 20_000;

/**
 * URL fetcher — retrieves and cleans web page content for the agent to read.
 * Strips HTML tags, scripts, styles and returns readable plain text.
 */
export const fetchUrlTool: Tool = {
  name: 'fetch_url',
  description: 'Fetch the content of a URL and return readable text. Useful for reading articles, documentation, or any web page.',
  input_schema: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The URL to fetch',
      },
      max_length: {
        type: 'number',
        description: `Maximum characters to return (default: ${MAX_CONTENT_LENGTH})`,
      },
    },
    required: ['url'],
  },
  async execute({ url, max_length }: Record<string, unknown>) {
    const targetUrl = String(url);
    const limit = Math.min(Number(max_length) || MAX_CONTENT_LENGTH, 50_000);

    validateUrl(targetUrl);

    const res = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'armalo-agent/0.1.0 (research assistant)',
        'Accept': 'text/html,application/xhtml+xml,text/plain',
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch ${targetUrl}: HTTP ${res.status}`);
    }

    const contentType = res.headers.get('content-type') ?? '';
    const text = await res.text();

    if (contentType.includes('text/html') || text.trimStart().startsWith('<')) {
      const cleaned = stripHtml(text);
      return {
        url: targetUrl,
        content: cleaned.slice(0, limit),
        truncated: cleaned.length > limit,
        length: cleaned.length,
      };
    }

    return {
      url: targetUrl,
      content: text.slice(0, limit),
      truncated: text.length > limit,
      length: text.length,
    };
  },
};

function validateUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`Only http/https URLs are allowed, got: ${parsed.protocol}`);
  }
  // Block private IP ranges
  const hostname = parsed.hostname;
  if (
    hostname === 'localhost' ||
    hostname.startsWith('127.') ||
    hostname.startsWith('192.168.') ||
    hostname.startsWith('10.') ||
    hostname === '::1'
  ) {
    throw new Error(`Fetching private/local addresses is not allowed`);
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
    .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, ' ')
    .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, ' ')
    .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s{3,}/g, '\n\n')
    .trim();
}
