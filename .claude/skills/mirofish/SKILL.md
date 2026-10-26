---
name: mirofish
description: Run MiroFish (github.com/666ghj/MiroFish), the open-source multi-agent swarm-intelligence prediction engine, to simulate how people, groups and public opinion react to a scenario. Use when the user wants to "predict what happens if...", rehearse a policy / announcement / PR move / product launch, simulate public opinion or social-media reaction, run a "what if" on a story or novel, or explicitly mentions MiroFish. Covers installing and starting MiroFish, feeding it seed documents, running the 5-step pipeline (graph → environment → simulation → report → interaction) through its REST API, and interviewing simulated agents afterwards.
---

# MiroFish

MiroFish turns seed documents (news, reports, policy drafts, a novel) plus a natural-language
prediction question into a simulated social world. Hundreds of LLM agents with personas and memory
post, reply and argue on simulated Twitter and Reddit (powered by CAMEL-AI's OASIS). A ReportAgent
then writes a prediction report, and you can interview individual agents or chat with the ReportAgent.

It is a **separate app** (Flask backend on :5001, Vue frontend on :3000). This skill drives it
through the backend API with `scripts/mirofish.py` (Python 3.9+, standard library only).

## 1. Make sure MiroFish is running

Check first: `python scripts/mirofish.py ping`. If it is not reachable, set it up:

```bash
git clone https://github.com/666ghj/MiroFish && cd MiroFish
cp .env.example .env        # then fill in the keys below
```

Required `.env` keys. **Ask the user for these, never invent or hard-code them:**

| Key | What |
|---|---|
| `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL_NAME` | Any OpenAI-compatible chat API. Upstream default is `qwen-plus` on Alibaba DashScope. |
| `ZEP_API_KEY` | Zep Cloud (knowledge-graph memory). Free tier at app.getzep.com is enough for small runs. |
| `LLM_BOOST_*` (optional) | A second, faster model. **Delete these lines entirely if unused**, because placeholder values break it. |

Start it with either:
- **Docker:** `docker compose up -d` (image `ghcr.io/666ghj/mirofish:latest`)
- **Source:** needs Node 18+, Python 3.11–3.12 and `uv`. Run `npm run setup:all && npm run dev`, or
  `npm run backend` for the API only.

The backend refuses to start if the keys are missing; read its console output for the reason.

## 2. Run a prediction

One command runs the whole pipeline and saves the report:

```bash
python scripts/mirofish.py run \
  --files seed1.pdf notes.md \
  --requirement "Predict how Bengaluru residents react on social media over the next week if BBMP announces X" \
  --name "bbmp-x-reaction" \
  --max-rounds 20 \
  --out report.md
```

- `--files`: one or more `.pdf`, `.md`, `.markdown` or `.txt` files, 50 MB total. If the user only
  has text in chat, write it to a `.md` file first.
- `--requirement`: the prediction question. Make it specific: who, what event, what time horizon,
  and what outcome to measure.
- `--max-rounds`: **start small (10–40).** Every round calls the LLM once per active agent, so cost
  and time grow fast. Upstream warns about high token use. Tell the user this before a big run.
- `--platform`: `parallel` (default, Twitter and Reddit), `twitter` or `reddit`.
- `--memory-update`: writes agent activity back into the Zep graph so the report can use it
  (more Zep calls).

The command prints progress and every ID (`project_id`, `graph_id`, `simulation_id`, `report_id`),
and saves them to `.mirofish_state.json` so later steps work without IDs. A full run takes
minutes to an hour. Run it in the background and poll its output instead of blocking.

To run one step at a time, or to resume after a failure, use the subcommands
`ontology → build → create → prepare → start → report` (see `--help`). Each one reads the IDs saved
by the step before it.

## 3. Explore the results

```bash
python scripts/mirofish.py status                       # where the simulation is now
python scripts/mirofish.py posts --limit 20             # what the agents actually posted
python scripts/mirofish.py chat "Which group drove the backlash, and why?"
python scripts/mirofish.py interview --agent 3 "Why did you change your mind?"
python scripts/mirofish.py interview --all "Would you vote for this policy?"
```

`interview` needs the simulation environment still alive (it stays up after a run until
`close-env`). `chat` works any time after the report exists.

## How to present results

- Lead with the report's prediction, then the evidence: quoted agent posts, which agents or groups
  drove the outcome, and how sentiment moved over rounds.
- Be honest about what this is. It is an **LLM-agent simulation**, not a forecast with calibrated
  probabilities. Personas come from the seed documents, so missing groups in the seed means
  missing voices in the result. Say how many agents and rounds the run used.
- Offer follow-ups: interview a specific agent, rerun with a changed variable ("what if the
  announcement includes a refund?") to compare, or run more rounds.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `ping` fails | Backend not running, or on another host. Pass `--base-url http://host:5001` or set `MIROFISH_URL`. |
| HTTP 502 on ontology | The LLM provider rejected the call. Check `LLM_*` keys, base URL and model name. |
| "Zep API key missing" on build | `ZEP_API_KEY` is not set in `.env`. Restart the backend after editing. |
| Prepare or run fails | `python scripts/mirofish.py status`, then read the backend console log. Retry with `start --force`. |
| Interview times out | The environment was closed or the simulation is still busy. Check `env-status`. |

The full endpoint list is in `reference/api.md`, for anything the script does not cover (entity
browsing, timelines, agent stats, report sections, logs).

## License note

MiroFish is AGPL-3.0. Running it locally is fine. If the user modifies it and serves it to others
over a network, AGPL requires publishing those changes. Mention this if they plan to host it.
