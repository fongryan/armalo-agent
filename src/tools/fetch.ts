import type { Tool } from '../types.js';

const MAX_CONTENT_LENGTH = 20_000;

/**
 * URL fetcher — retrieves and cleans web page content for the agent to read.
 * Strips HTML tags, scripts, styles and returns readable plain text.
 *
 * SSRF protection blocks: loopback, RFC-1918 private ranges, link-local,
 * cloud metadata endpoints (169.254.x.x), and all non-http/https protocols.
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
  if (isPrivateHostname(parsed.hostname)) {
    throw new Error(`Fetching private/local addresses is not allowed: ${parsed.hostname}`);
  }
}

function isPrivateHostname(hostname: string): boolean {
  // Named private hosts
  if (hostname === 'localhost') return true;
  if (hostname.endsWith('.local') || hostname.endsWith('.internal')) return true;

  // IPv6 loopback (::1) and link-local (fe80::)
  const lc = hostname.toLowerCase();
  if (lc === '::1' || lc === '0:0:0:0:0:0:0:1') return true;
  if (lc.startsWith('fe80:')) return true;

  // IPv4-mapped IPv6 (::ffff:127.0.0.1, etc.)
  const ipv4Mapped = lc.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (ipv4Mapped?.[1]) return isPrivateIPv4(ipv4Mapped[1]);

  // Bare IPv4
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) return isPrivateIPv4(hostname);

  return false;
}

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) return false;
  const [a, b] = parts as [number, number, number, number];
  return (
    a === 0 ||                            // 0.0.0.0/8 — unspecified
    a === 10 ||                           // 10.0.0.0/8 — Class A private
    a === 127 ||                          // 127.0.0.0/8 — loopback
    (a === 169 && b === 254) ||           // 169.254.0.0/16 — link-local / AWS IMDS
    (a === 172 && b >= 16 && b <= 31) ||  // 172.16.0.0/12 — Class B private (VPC)
    (a === 192 && b === 168)              // 192.168.0.0/16 — Class C private
  );
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
