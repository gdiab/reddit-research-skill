# Reddit Research Skill

Search and analyze Reddit posts, comments, and subreddits for market research, product validation, and topic analysis. No API key required.

Built for [OpenClaw](https://github.com/openclaw/openclaw) agents, but the CLI works standalone.

## How It Works

Uses Reddit's public JSON endpoints (append `.json` to any Reddit URL). No authentication, no API key, no approval process.

## Commands

```bash
# Search across all of Reddit
npx tsx scripts/reddit-search.ts search "splitwise alternative"

# Search within a specific subreddit
npx tsx scripts/reddit-search.ts search "app idea" --subreddit AppIdeas --sort top --time month

# Browse a subreddit
npx tsx scripts/reddit-search.ts subreddit SomebodyMakeThis --sort top --time week --limit 10

# Read a post + comments
npx tsx scripts/reddit-search.ts comments https://reddit.com/r/AppIdeas/comments/abc123/post_title/

# Get a user's recent posts
npx tsx scripts/reddit-search.ts user spez --limit 5
```

All commands output structured JSON to stdout.

## Options

| Flag | Default | Description |
|------|---------|-------------|
| `--subreddit` | (all) | Restrict search to a subreddit |
| `--sort` | `relevance` | `relevance`, `hot`, `new`, `top`, `rising` |
| `--time` | `month` | `hour`, `day`, `week`, `month`, `year`, `all` |
| `--limit` | `25` | Max results (1-100) |

## Caching

Results are cached locally to avoid redundant requests:
- Search results: 24h
- Comments: 24h
- Subreddit listings: 1h
- User posts: 1h

Cache location: `~/.openclaw/workspace/memory/reddit-cache/`

## Rate Limits

Without authentication, Reddit allows ~10 requests/minute. The tool enforces a minimum 6-second delay between API calls and backs off automatically on 429 responses.

## Requirements

- Node.js 18+ (uses native `fetch`)
- TypeScript runtime: `npx tsx`

## License

MIT
