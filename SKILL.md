---
name: reddit-research
description: >
  Reddit research skill for searching posts, browsing subreddits, and gathering
  real-world signal from communities. Use when the user wants to find product pain
  points, app ideas, market validation, community opinions, or "what are people
  complaining about" insights on Reddit. No API key required — uses Reddit's public
  JSON endpoints. Triggers on "search Reddit", "what's on Reddit about", "find
  Reddit posts", "browse r/", "check this subreddit", or any request to gather
  signal from Reddit communities. Also use for product research, app idea
  validation, understanding user pain points, or finding "somebody make this" style
  requests. Do NOT use for private/DM content, NSFW-only subreddits, or when the
  user explicitly wants X/Twitter data instead.
compatibility: >
  Requires network access and Node.js 18+ with npx/tsx. Uses Reddit public JSON
  endpoints — no API key or credentials needed. Rate-limited to ~10 req/min.
metadata:
  author: thoth
  version: 1.0.0
---

# Reddit Research Skill

You are a Reddit research module. Your job is to help gather structured signal from
Reddit communities — finding relevant posts, pain points, product requests, community
opinions, and market insights. The goal is actionable intelligence: not a wall of raw
posts, but curated findings that surface what matters.

## Architecture

The skill has four commands:

1. **search** — Query Reddit for posts matching a topic or keyword
2. **comments** — Fetch the full comment thread on a specific post
3. **subreddit** — Browse a subreddit's hot/new/top/rising posts
4. **user** — Fetch a user's recent post history

No API key needed. Uses Reddit's public `.json` endpoints.

### File locations

| What | Where |
|------|-------|
| CLI tool | `<skill-dir>/scripts/reddit-search.ts` |
| Config (yours) | `<skill-dir>/config.local.json` (falls back to `config.json`) |
| Cache | `~/.reddit-research-cache/` (configurable via `REDDIT_CACHE_DIR` env var) |

## CLI Commands

### search — Search Reddit posts

```bash
# Cross-Reddit search
npx tsx <skill-path>/scripts/reddit-search.ts search "expense splitting app"

# Restrict to a subreddit
npx tsx <skill-path>/scripts/reddit-search.ts search "expense splitting" --subreddit r/personalfinance

# With all options
npx tsx <skill-path>/scripts/reddit-search.ts search "roommate app" \
  --subreddit r/roommates \
  --sort top \
  --time year \
  --limit 50
```

**Options:**
- `--subreddit r/Name` — restrict to one subreddit (optional; omit for cross-Reddit)
- `--sort relevance|hot|new|top` — default: `relevance`
- `--time hour|day|week|month|year|all` — default: `month`
- `--limit N` — default: `25`, max: `100`

### comments — Fetch post + comments

```bash
# From a full URL
npx tsx <skill-path>/scripts/reddit-search.ts comments \
  "https://www.reddit.com/r/AppIdeas/comments/abc123/title/"

# From just the post ID
npx tsx <skill-path>/scripts/reddit-search.ts comments abc123
```

Returns the post metadata plus top-level comments flattened with a `depth` field.
Use this when a post's title is interesting but the real signal is in the comments.

### subreddit — Browse subreddit posts

```bash
# Hot posts (default)
npx tsx <skill-path>/scripts/reddit-search.ts subreddit r/SideProject

# Top posts this week
npx tsx <skill-path>/scripts/reddit-search.ts subreddit r/AppIdeas --sort top --time week

# Rising posts
npx tsx <skill-path>/scripts/reddit-search.ts subreddit r/startups --sort rising --limit 50
```

**Options:**
- `--sort hot|new|top|rising` — default: `hot`
- `--time hour|day|week|month|year|all` — default: `week` (ignored for hot/new/rising)
- `--limit N` — default: `25`

### user — Get a user's recent posts

```bash
npx tsx <skill-path>/scripts/reddit-search.ts user some_username --limit 20
```

Useful for checking if a particular community voice has other relevant posts.

## Output Format

All commands output structured JSON to stdout. Logs go to stderr.

### Post object (search, subreddit, user)

```json
{
  "id": "abc123",
  "title": "I want an app that splits expenses fairly...",
  "selftext": "First 500 chars of the post body...",
  "author": "username",
  "subreddit": "PersonalFinance",
  "score": 142,
  "upvote_ratio": 0.95,
  "num_comments": 37,
  "url": "https://i.redd.it/example.jpg",
  "permalink": "/r/personalfinance/comments/abc123/title/",
  "created_utc": 1709740800,
  "created_at": "2026-03-06T12:00:00.000Z",
  "flair": "Discussion",
  "is_self": true,
  "engagement_score": 134
}
```

**Note:** `engagement_score = score × upvote_ratio` — a better signal than raw score
because it discounts posts with low upvote ratios (controversial or irrelevant).

### Comments response

```json
{
  "post": { /* same Post object */ },
  "comments": [
    {
      "id": "def456",
      "author": "commenter",
      "body": "Full comment text...",
      "score": 89,
      "created_utc": 1709741000,
      "created_at": "2026-03-06T12:03:20.000Z",
      "depth": 0,
      "reply_count": 4,
      "replies": [
        {
          "id": "ghi789",
          "depth": 1,
          ...
        }
      ]
    }
  ]
}
```

## Research Methodology

### 1. Decompose the question into search angles

Most research questions benefit from 3–6 targeted searches rather than one broad query.

**Angles to consider:**
- **Direct problem** — the pain point stated plainly (`"splitting bills with roommates"`)
- **Wishlist language** — how people ask for solutions (`"I wish there was an app"`, `"why doesn't X exist"`)
- **Frustration language** — how people complain (`"annoying", "hate", "broken", "fed up"`)
- **Tool-specific** — if research is about a product, search its name directly
- **Community browsing** — browse relevant subreddits' top posts for the week/month

**Example decomposition:**
> "Research pain points for expense splitting apps"
>
> Search 1: `search "expense splitting" --subreddit r/personalfinance --sort top --time year`
> Search 2: `search "roommate money" --subreddit r/roommates --sort top --time year`
> Search 3: `search "splitwise venmo annoying" --sort top --time year`
> Search 4: `subreddit r/AppIdeas --sort top --time month` (then grep for expense/money/bills)
> Search 5: `subreddit r/SomebodyMakeThis --sort top --time year` (browse for financial requests)

### 2. Use subreddit browsing for discovery

Searching is great when you know what you're looking for. Subreddit browsing is better
for discovery — seeing what the community is currently excited about or frustrated by.

Start with `--sort top --time month` for recent high-signal posts, or `--sort new` to
catch emerging discussions before they get buried.

### 3. Fetch comments on promising posts

A post title like "Is there an app that does X?" is interesting. But the comments —
where people recommend alternatives, describe their own failed attempts, or detail exactly
why existing tools fall short — are often the real gold.

Use `comments <url>` on any post with `num_comments > 10` and a high `engagement_score`.

### 4. Filter and rank results

**Use `engagement_score`** (not raw `score`) to rank. It discounts controversial posts.

**Look for posts with:**
- High `num_comments` relative to `score` → indicates discussion, debate, or unmet need
- Low `upvote_ratio` (< 0.7) → controversial; read carefully
- Flair like "Idea", "Request", "Pain Point", "Question" → direct signal

**Skip:**
- Deleted posts (`author: "[deleted]"` or `selftext: "[removed]"`)
- Pure spam or self-promotion (check `is_self: false` with low engagement)

### 5. Structure your findings

When summarizing for the user, include:

```json
{
  "research_question": "...",
  "timestamp": "ISO 8601",
  "searches_executed": [...],
  "key_findings": [
    {
      "url": "https://reddit.com/r/.../comments/.../",
      "title": "...",
      "subreddit": "r/...",
      "engagement_score": 134,
      "num_comments": 37,
      "posted_at": "2026-03-01",
      "key_insight": "one sentence summary of why this matters",
      "classification": "pain_point|feature_request|validation|opposition|data"
    }
  ],
  "themes": ["theme 1", "theme 2"],
  "summary": "narrative summary of what Reddit thinks"
}
```

### 6. Cite everything

Every insight should trace to a specific Reddit permalink. When summarizing conversationally,
include `https://reddit.com{permalink}` links so the user can verify.

## Subreddit Directory

### For app/product research

| Subreddit | Best for |
|-----------|----------|
| r/AppIdeas | Direct product wishes and feature requests |
| r/SomebodyMakeThis | People explicitly requesting things to be built |
| r/SideProject | What indie devs are shipping; what's getting traction |
| r/startups | Problem/solution validation; early-stage market research |
| r/Entrepreneur | Business ideas, validation, growth struggles |

### For mobile/dev research

| Subreddit | Best for |
|-----------|----------|
| r/iOSProgramming | iOS dev community pain points; App Store meta |
| r/reactnative | RN ecosystem; tools and gaps |
| r/androiddev | Android dev community |
| r/webdev | Web tooling and pain points |

### For finance/consumer research

| Subreddit | Best for |
|-----------|----------|
| r/personalfinance | Budgeting, debt, expense management pain points |
| r/financialindependence | FIRE community; budgeting tools |
| r/povertyfinance | Budget constraints; underserved users |
| r/roommates | Shared living logistics; expense splitting pain |

### For tech/AI discourse

| Subreddit | Best for |
|-----------|----------|
| r/MachineLearning | Academic/research AI discourse |
| r/LocalLLaMA | Self-hosted AI community; what practitioners think |
| r/ChatGPT | Consumer AI sentiment |
| r/programming | General dev opinion |
| r/ExperiencedDevs | Senior dev takes |

## Rate Limits and Caching

Reddit's unauthenticated API allows ~10 requests per minute. The CLI enforces a
minimum 6-second delay between requests and retries on 429 errors.

**Cache TTLs:**
- Search results: 24 hours (keyed by query + options hash)
- Comments: 24 hours (keyed by post ID)
- Subreddit listings: 1 hour (keyed by subreddit + sort + time + limit)
- User posts: 1 hour

Cache lives in `~/.openclaw/workspace/memory/reddit-cache/`.

If a cached result exists and is fresh, it's returned immediately without an API call.
This makes re-running research fast and cheap.

## Error Handling

**429 Too Many Requests:** The CLI automatically waits and retries with backoff. If
searches are slow, it's likely due to rate limiting — let it run.

**403/401:** The endpoint may require authentication (rare for public subreddits). Try
a different subreddit or reduce request frequency.

**Network errors:** Retried once automatically, then reported.

**Deleted/removed posts:** `selftext` will be `"[removed]"` or `"[deleted]"`. The post
metadata (title, score, etc.) is still available.
