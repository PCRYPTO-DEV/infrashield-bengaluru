# X account manager agent

A Claude-powered agent that runs the InfraShield Bengaluru X (Twitter) account
the way a careful social manager would: it drafts posts in the house voice,
triages mentions, drafts replies, reads metrics, and leaves notes for you.
**Nothing reaches X without passing an approval queue you control.**

```
you:    python -m x_agent daily
agent:  fetches mentions -> triages -> drafts replies/posts -> queue
you:    python -m x_agent queue        # read the drafts
you:    python -m x_agent approve 4 5  # or reject / edit
you:    python -m x_agent publish      # sends approved drafts
```

## What the agent will and will not do

| It will | It will not |
|---|---|
| Draft original posts (up to `X_AGENT_MAX_POSTS_PER_RUN` per run) | Publish a pending draft |
| Draft replies to mentions it can answer from `facts.md` | Reply to anyone without your approval |
| Flag complaints, press, legal, partnership and investor mentions for you | Answer those itself |
| Quote only numbers that appear in `facts.md` | Invent or round a statistic |
| Enforce 280 weighted chars, one hashtag max, banned phrases | Post "smart city", "revolutionary", etc. |
| Refuse drafts that near-duplicate a recent post | Repeat itself |

Every gate is enforced in `x_agent/tools.py`, not just in the prompt.

## Setup

1. Install dependencies (Python 3.10+):
   ```bash
   pip install -r x_agent/requirements.txt
   ```
2. Copy `.env.example` to `.env` and fill in:
   - `ANTHROPIC_API_KEY`
   - `X_AGENT_PUBLISHER=dryrun` to start. Switch to `x` once X keys are in.
3. Edit **`x_agent/voice.md`** (tone, audience, what to say and never say) and
   **`x_agent/facts.md`** (the only source of numbers the agent may quote).
4. Dry run:
   ```bash
   python -m x_agent ideas      # drafts posts; nothing is sent anywhere
   python -m x_agent queue
   ```

### Connecting the real X account

Create a project and app at https://developer.x.com, set the app permissions to
**Read and Write**, generate the OAuth 1.0a access token and secret for your
account, then put these in `.env`:

```
X_AGENT_PUBLISHER=x
X_API_KEY=...            # consumer key
X_API_SECRET=...         # consumer secret
X_ACCESS_TOKEN=...
X_ACCESS_TOKEN_SECRET=...
X_BEARER_TOKEN=...       # optional, used for reads
```

Check with `python -m x_agent whoami`.

X API tiers matter: the free tier lets the app post but does not allow reading
mentions or metrics. `mentions` and `report` need at least the Basic tier.
On free tier the agent will tell you it could not fetch mentions and carry on.

### Alternative: publish through Typefully

If you prefer Typefully to schedule into your queue, set
`X_AGENT_PUBLISHER=typefully` and `TYPEFULLY_API_KEY`. Typefully cannot reply
to specific tweets or read mentions, so use it for original posts only.
Your Typefully account must have the X account connected first.

## Commands

| Command | What happens |
|---|---|
| `daily` | Fetch and triage mentions, draft replies, draft up to N posts, publish anything already approved, summarise |
| `mentions` | Triage mentions only |
| `ideas` | Draft posts only |
| `report` | Pull metrics, explain what worked, leave three content directions as a note |
| `run "..."` | Any instruction, e.g. `run "Draft one post announcing the demo is live"` |
| `queue [status]` | List drafts (`pending` by default, or `approved`, `published`, `rejected`, `failed`, `all`) |
| `show ID` | One draft with rationale |
| `approve ID...` / `reject ID...` | Decide |
| `edit ID "text"` | Replace text (validated, goes back to pending) |
| `publish` | Send approved drafts |
| `log` | Activity log, including agent notes and flagged mentions |

Add `-v` to see each tool call.

## Running it on a schedule

Cron, 09:00 and 17:00 IST, then review on your phone:
```
0 9,17 * * *  cd /path/to/infrashield-bengaluru && python -m x_agent daily >> x_agent/cron.log 2>&1
```
Approve from anywhere with `python -m x_agent approve ...` and `publish`.

### Letting original posts go out unattended

Set `X_AGENT_AUTO_PUBLISH_POSTS=true` and the agent's original posts are saved as
*approved* so `daily` publishes them in the same run. Replies still always wait
for you. Turn this on only after a couple of weeks of approving drafts by hand
and being happy with them.

## Settings

| Env | Default | Meaning |
|---|---|---|
| `X_AGENT_MODEL` | `claude-opus-5-5` | Claude model |
| `X_AGENT_EFFORT` | `medium` | `low`..`max`; raise if drafts feel thin |
| `X_AGENT_PUBLISHER` | `dryrun` | `dryrun`, `x`, `typefully` |
| `X_AGENT_MAX_POSTS_PER_RUN` | `3` | Cap on new original drafts per run |
| `X_AGENT_AUTO_PUBLISH_POSTS` | `false` | Original posts skip the human gate |
| `X_AGENT_TIMEZONE` | `Asia/Kolkata` | Used for the "current time" the agent sees |
| `X_AGENT_DB_PATH` | `x_agent/x_agent.db` | SQLite queue and logs (git-ignored) |

## Layout

```
x_agent/
  agent.py        Claude tool-runner loop, system prompt, missions
  tools.py        the gated tools + draft validation
  publishers.py   X API v2 (tweepy), Typefully, dry run
  store.py        SQLite: drafts, mentions, activity log
  cli.py          command line
  voice.md        tone and rules (edit)
  facts.md        the only allowed facts/numbers (edit)
tests/test_x_agent.py   offline tests, no network
```

Run the tests with `python -m pytest tests/test_x_agent.py`.
