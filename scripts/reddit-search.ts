#!/usr/bin/env npx tsx
/**
 * reddit-search.ts — Reddit research CLI for Thoth
 * Uses Reddit's public JSON endpoints (no API key required)
 *
 * Commands:
 *   search   <query>   [--subreddit r/X] [--sort relevance|hot|new|top] [--time hour|day|week|month|year|all] [--limit 25]
 *   comments <url|id>
 *   subreddit r/X      [--sort hot|new|top|rising] [--time week] [--limit 25]
 *   user     <username> [--limit 10]
 */

import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

// ─── Config ──────────────────────────────────────────────────────────────────

const USER_AGENT = process.env.REDDIT_USER_AGENT || "reddit-research-skill/1.0 (personal research tool)";
const CACHE_DIR = process.env.REDDIT_CACHE_DIR || join(homedir(), ".reddit-research-cache");
const CACHE_TTL_SEARCH = 24 * 60 * 60 * 1000;   // 24h
const CACHE_TTL_SUBREDDIT = 1 * 60 * 60 * 1000; // 1h
const CACHE_TTL_COMMENTS = 24 * 60 * 60 * 1000; // 24h
const MIN_REQUEST_DELAY = 6000; // 6s between requests (Reddit's unauthenticated limit ~10 req/min)

let lastRequestTime = 0;

// ─── Logging ─────────────────────────────────────────────────────────────────

function log(...args: unknown[]) {
  process.stderr.write(args.map(String).join(" ") + "\n");
}

// ─── Cache ───────────────────────────────────────────────────────────────────

if (!existsSync(CACHE_DIR)) {
  mkdirSync(CACHE_DIR, { recursive: true });
}

function cacheKey(kind: string, identifier: string): string {
  const hash = createHash("sha256").update(identifier).digest("hex").slice(0, 16);
  return join(CACHE_DIR, `${kind}-${hash}.json`);
}

function readCache<T>(path: string, ttl: number): T | null {
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as { ts: number; data: T };
    if (Date.now() - raw.ts > ttl) return null;
    return raw.data;
  } catch {
    return null;
  }
}

function writeCache(path: string, data: unknown) {
  try {
    writeFileSync(path, JSON.stringify({ ts: Date.now(), data }), "utf8");
  } catch (e) {
    log("WARN: failed to write cache:", e);
  }
}

// ─── HTTP ─────────────────────────────────────────────────────────────────────

async function delay(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

async function redditFetch(url: string, retries = 2): Promise<unknown> {
  // Rate limit
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (lastRequestTime > 0 && elapsed < MIN_REQUEST_DELAY) {
    const wait = MIN_REQUEST_DELAY - elapsed;
    log(`Rate limiting: waiting ${wait}ms...`);
    await delay(wait);
  }
  lastRequestTime = Date.now();

  log(`Fetching: ${url}`);

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "application/json",
        },
      });

      if (res.status === 429) {
        const retryAfter = parseInt(res.headers.get("retry-after") ?? "60", 10);
        const waitMs = retryAfter * 1000;
        log(`429 Too Many Requests — waiting ${retryAfter}s before retry...`);
        await delay(waitMs);
        continue;
      }

      if (res.status === 403 || res.status === 401) {
        throw new Error(
          `HTTP ${res.status}: This endpoint may require authentication. ` +
            `Try accessing a public subreddit or reducing request frequency.`
        );
      }

      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
      }

      return await res.json();
    } catch (err) {
      if (attempt < retries) {
        log(`Network error (attempt ${attempt + 1}/${retries + 1}): ${err}. Retrying...`);
        await delay(3000);
      } else {
        throw err;
      }
    }
  }

  throw new Error(`Failed after ${retries + 1} attempts`);
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface RedditPost {
  id: string;
  title: string;
  selftext: string;
  author: string;
  subreddit: string;
  score: number;
  upvote_ratio: number;
  num_comments: number;
  url: string;
  permalink: string;
  created_utc: number;
  created_at: string;
  flair: string | null;
  is_self: boolean;
  engagement_score: number;
}

interface RedditComment {
  id: string;
  author: string;
  body: string;
  score: number;
  created_utc: number;
  created_at: string;
  depth: number;
  reply_count: number;
  replies: RedditComment[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toIso(utc: number): string {
  return new Date(utc * 1000).toISOString();
}

function truncate(text: string, maxLen = 500): string {
  if (!text || text === "[deleted]" || text === "[removed]") return text ?? "";
  return text.length > maxLen ? text.slice(0, maxLen) + "…" : text;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parsePost(data: any): RedditPost {
  return {
    id: data.id,
    title: data.title,
    selftext: truncate(data.selftext ?? ""),
    author: data.author,
    subreddit: data.subreddit,
    score: data.score ?? 0,
    upvote_ratio: data.upvote_ratio ?? 1,
    num_comments: data.num_comments ?? 0,
    url: data.url,
    permalink: data.permalink,
    created_utc: data.created_utc,
    created_at: toIso(data.created_utc),
    flair: data.link_flair_text ?? null,
    is_self: data.is_self ?? false,
    engagement_score: Math.round((data.score ?? 0) * (data.upvote_ratio ?? 1)),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseComments(listing: any, depth = 0, maxDepth = 5): RedditComment[] {
  if (!listing || listing.kind !== "Listing") return [];
  const results: RedditComment[] = [];

  for (const child of listing.data?.children ?? []) {
    if (child.kind !== "t1") continue; // skip "more" links
    const d = child.data;
    const replies: RedditComment[] =
      depth < maxDepth && d.replies && typeof d.replies === "object"
        ? parseComments(d.replies, depth + 1, maxDepth)
        : [];

    results.push({
      id: d.id,
      author: d.author,
      body: d.body,
      score: d.score ?? 0,
      created_utc: d.created_utc,
      created_at: toIso(d.created_utc),
      depth,
      reply_count: d.replies?.data?.children?.filter((c: { kind: string }) => c.kind === "t1").length ?? 0,
      replies,
    });
  }
  return results;
}

// ─── Commands ────────────────────────────────────────────────────────────────

interface SearchOptions {
  subreddit?: string;
  sort?: string;
  time?: string;
  limit?: number;
}

async function cmdSearch(query: string, opts: SearchOptions): Promise<void> {
  const sort = opts.sort ?? "relevance";
  const time = opts.time ?? "month";
  const limit = opts.limit ?? 25;

  let url: string;
  let cacheId: string;

  if (opts.subreddit) {
    const sub = opts.subreddit.replace(/^r\//, "");
    url = `https://www.reddit.com/r/${sub}/search.json?q=${encodeURIComponent(query)}&restrict_sr=1&sort=${sort}&t=${time}&limit=${limit}&raw_json=1`;
    cacheId = `search:${sub}:${query}:${sort}:${time}:${limit}`;
  } else {
    url = `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&sort=${sort}&t=${time}&limit=${limit}&raw_json=1`;
    cacheId = `search:all:${query}:${sort}:${time}:${limit}`;
  }

  const cachePath = cacheKey("search", cacheId);
  const cached = readCache<RedditPost[]>(cachePath, CACHE_TTL_SEARCH);
  if (cached) {
    log(`Cache hit for search: "${query}"`);
    process.stdout.write(JSON.stringify(cached, null, 2) + "\n");
    return;
  }

  const raw = await redditFetch(url) as { data?: { children?: Array<{ data: unknown }> } };
  const posts = (raw?.data?.children ?? []).map((c) => parsePost(c.data));

  writeCache(cachePath, posts);
  process.stdout.write(JSON.stringify(posts, null, 2) + "\n");
  log(`Found ${posts.length} posts.`);
}

async function cmdComments(input: string): Promise<void> {
  // Accept full URL or post ID
  let permalink = input;

  // If it's a full URL, extract the path
  if (input.startsWith("http")) {
    try {
      const u = new URL(input);
      permalink = u.pathname;
    } catch {
      permalink = input;
    }
  } else if (!input.startsWith("/r/")) {
    // Bare post ID — use the /comments/{id} shortcut
    permalink = `/comments/${input}`;
  }

  // Strip trailing slash if present, then add .json
  permalink = permalink.replace(/\/$/, "");

  // Extract post ID for caching
  const postId = permalink.match(/comments\/([a-z0-9]+)/i)?.[1] ?? permalink;
  const cachePath = cacheKey("comments", postId);
  const cached = readCache<{ post: RedditPost; comments: RedditComment[] }>(cachePath, CACHE_TTL_COMMENTS);
  if (cached) {
    log(`Cache hit for comments: ${postId}`);
    process.stdout.write(JSON.stringify(cached, null, 2) + "\n");
    return;
  }

  const url = `https://www.reddit.com${permalink}.json?raw_json=1&limit=100`;
  const raw = await redditFetch(url) as unknown[];

  // Reddit returns an array: [postListing, commentsListing]
  if (!Array.isArray(raw) || raw.length < 2) {
    throw new Error("Unexpected response shape from Reddit comments endpoint");
  }

  const postListing = raw[0] as { data?: { children?: Array<{ data: unknown }> } };
  const commentsListing = raw[1] as { data?: { children?: unknown[] }; kind?: string };

  const postChildren = postListing?.data?.children ?? [];
  const post = postChildren.length > 0 ? parsePost((postChildren[0] as { data: unknown }).data) : null;

  const comments = parseComments(commentsListing);

  const result = { post, comments };
  writeCache(cachePath, result);
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  log(`Fetched post + ${comments.length} top-level comments.`);
}

interface SubredditOptions {
  sort?: string;
  time?: string;
  limit?: number;
}

async function cmdSubreddit(subreddit: string, opts: SubredditOptions): Promise<void> {
  const sub = subreddit.replace(/^r\//, "");
  const sort = opts.sort ?? "hot";
  const time = opts.time ?? "week";
  const limit = opts.limit ?? 25;

  const cacheId = `subreddit:${sub}:${sort}:${time}:${limit}`;
  const cachePath = cacheKey("subreddit", cacheId);
  const cached = readCache<RedditPost[]>(cachePath, CACHE_TTL_SUBREDDIT);
  if (cached) {
    log(`Cache hit for r/${sub} (${sort})`);
    process.stdout.write(JSON.stringify(cached, null, 2) + "\n");
    return;
  }

  // "rising" doesn't support the t (time) param
  const timeParam = sort === "rising" || sort === "hot" || sort === "new" ? "" : `&t=${time}`;
  const url = `https://www.reddit.com/r/${sub}/${sort}.json?limit=${limit}${timeParam}&raw_json=1`;

  const raw = await redditFetch(url) as { data?: { children?: Array<{ data: unknown }> } };
  const posts = (raw?.data?.children ?? []).map((c) => parsePost(c.data));

  writeCache(cachePath, posts);
  process.stdout.write(JSON.stringify(posts, null, 2) + "\n");
  log(`Fetched ${posts.length} posts from r/${sub}.`);
}

interface UserOptions {
  limit?: number;
}

async function cmdUser(username: string, opts: UserOptions): Promise<void> {
  const limit = opts.limit ?? 10;
  const url = `https://www.reddit.com/user/${username}/submitted.json?limit=${limit}&raw_json=1`;

  const cacheId = `user:${username}:${limit}`;
  const cachePath = cacheKey("user", cacheId);
  // Users cached for 1h (same as subreddit listing)
  const cached = readCache<RedditPost[]>(cachePath, CACHE_TTL_SUBREDDIT);
  if (cached) {
    log(`Cache hit for user: ${username}`);
    process.stdout.write(JSON.stringify(cached, null, 2) + "\n");
    return;
  }

  const raw = await redditFetch(url) as { data?: { children?: Array<{ data: unknown }> } };
  const posts = (raw?.data?.children ?? []).map((c) => parsePost(c.data));

  writeCache(cachePath, posts);
  process.stdout.write(JSON.stringify(posts, null, 2) + "\n");
  log(`Fetched ${posts.length} recent posts by u/${username}.`);
}

// ─── Arg parser ──────────────────────────────────────────────────────────────

function parseArgs(argv: string[]) {
  const args: Record<string, string | boolean> = {};
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }

  return { args, positional };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const argv = process.argv.slice(2);

  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    process.stderr.write(`
Reddit Research CLI (Thoth)
No API key required — uses Reddit public JSON endpoints.

USAGE:
  npx tsx reddit-search.ts <command> [args] [options]

COMMANDS:
  search <query>
      [--subreddit r/AppIdeas]      Restrict to a subreddit (optional)
      [--sort relevance|hot|new|top] Default: relevance
      [--time hour|day|week|month|year|all] Default: month
      [--limit 25]

  comments <url|post-id>
      Fetch the post and its top-level comments

  subreddit r/SubredditName
      [--sort hot|new|top|rising]   Default: hot
      [--time week]
      [--limit 25]

  user <username>
      [--limit 10]

OUTPUT:
  Structured JSON to stdout. Logs to stderr.

CACHING:
  Search/comments: 24h TTL
  Subreddit/user:  1h TTL
  Cache dir: ~/.openclaw/workspace/memory/reddit-cache/
`);
    process.exit(0);
  }

  const command = argv[0];
  const { args, positional } = parseArgs(argv.slice(1));

  try {
    switch (command) {
      case "search": {
        const query = positional[0];
        if (!query) throw new Error("search requires a query argument");
        await cmdSearch(query, {
          subreddit: args.subreddit as string | undefined,
          sort: args.sort as string | undefined,
          time: args.time as string | undefined,
          limit: args.limit ? parseInt(args.limit as string, 10) : undefined,
        });
        break;
      }

      case "comments": {
        const input = positional[0];
        if (!input) throw new Error("comments requires a URL or post ID");
        await cmdComments(input);
        break;
      }

      case "subreddit": {
        const sub = positional[0];
        if (!sub) throw new Error("subreddit requires a subreddit name (e.g. r/AppIdeas)");
        await cmdSubreddit(sub, {
          sort: args.sort as string | undefined,
          time: args.time as string | undefined,
          limit: args.limit ? parseInt(args.limit as string, 10) : undefined,
        });
        break;
      }

      case "user": {
        const username = positional[0];
        if (!username) throw new Error("user requires a username");
        await cmdUser(username, {
          limit: args.limit ? parseInt(args.limit as string, 10) : undefined,
        });
        break;
      }

      default:
        process.stderr.write(`Unknown command: ${command}\n`);
        process.exit(1);
    }
  } catch (err) {
    process.stderr.write(`ERROR: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }
}

main();
