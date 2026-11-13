# Ski Conditions (Greece)

Hour-by-hour ski condition scores (0-100) for ski lessons and casual skiing with
children at Greek ski resorts (Parnassos, Vasilitsa, Velouchi, Kalavryta), using free
weather data from [Open-Meteo](https://open-meteo.com/).

## Structure

- `src/config.js` - **every threshold, table and weight**. Edit numbers here to tune the scores.
- `src/resorts.js` - resort names, coordinates and base altitude
- `src/weather.js` - `getWeather(resort)` returns hourly weather (yesterday, today, tomorrow)
- `src/scoring.js` - `scoreForecast(hours, resort)` and `scoreConditions(hour, context, settings)`
- `src/summary.js` - `summarizeDay()` / `summarizeForecast()`: best window, worst hour, vetoes
- `src/tools.js` - the functions as AI agent tools (`createTools()`, `runTool()`)
- `agent/prompt.js` - the AI's instructions (system prompt), shared by the demo agent and the chatbot
- `agent/run.js` - a demo agent that uses those tools with Claude
- `api/chat.js` - the chatbot's back end (a Vercel serverless function)
- `mock/weekend.js` - made-up demo weather for a sample weekend (used by the page and the chatbot)
- `dev-server.js` - a small local server for trying the site and the chatbot API
- `src/main.js` - the only file in `src/` that touches the web page
- `index.html`, `style.css` - the page
- `chat/chat.js`, `chat/chat.css` - the chat widget (floating 💬 button and panel)
- `chat/chat-logic.js` - the widget's logic with no page code (builds requests, handles errors)
- `test.js` - run `node test.js` to check the scoring logic
- `test-chat.js` - run `node test-chat.js` to check the chatbot API (offline, free)

The weather, scoring and summary functions don't depend on the page, so they can be
reused later as tools for an AI agent.

## AI agent tools

`src/tools.js` packages the functions as tools for an AI agent. It uses no AI library:
each tool is a name, a description, a JSON input schema and a `run()` function.

| Tool | What it returns |
|---|---|
| `list_resorts` | Resort ids, names, base altitude, lift hours, wind limit, minimum snow depth |
| `get_hourly_weather` | Raw hourly forecast for one resort during lift hours (today and tomorrow) |
| `score_hourly_conditions` | Hourly 0-100 scores with vetoes and the weakest factor (optionally every factor) |
| `get_daily_summary` | Per day: best 3-hour window, worst hour and its cause, veto reasons |

`agent/run.js` is a demo that connects them to Claude with the SDK's tool runner:

```
npm install                       # once, in the project folder
ant auth login                    # or: export ANTHROPIC_API_KEY="your-key"
node agent/run.js "Which resort has the best conditions tomorrow morning?"
```

## The chatbot API (`api/chat.js`)

`POST /api/chat` with `{ "messages": [{ "role": "user", "content": "..." }], "mock": false }`
returns `{ "reply": "...", "toolsUsed": ["get_daily_summary(parnassos)"] }`.
It asks Claude Haiku 5.5, runs the tools on the server (at most 5 rounds), and answers.
Set `"mock": true` to use the demo weather in `mock/weekend.js` instead of real data.

Limits (all in `LIMITS` at the top of `api/chat.js`): questions up to 500 characters,
the last 10 messages, replies up to 1200 tokens (including Claude's hidden thinking), 10 questions per 10 minutes per visitor
(best effort: the counter lives in server memory), no streaming.

**The API key** is read only from the `ANTHROPIC_API_KEY` environment variable. It is never in
the browser code or in the repo.

## The chat widget and demo data

The 💬 button (bottom right) opens a chat panel: three suggested questions, a "Thinking…" state,
and a small grey line under each answer listing the tools that were used. On a phone it fills
the screen. Open the site with `#chat` at the end of the address to open the chat straight away.

**Demo data:** add `?mock=1` to the address (for example `http://localhost:3000/?mock=1`) and both
the page and the chat use the made-up weather in `mock/weekend.js` instead of the real forecast.
A warning banner shows while it is on. Real data returns when you remove `?mock=1`.

Try the API on your computer (no Vercel account needed; it uses your `ant auth login`):

```
node dev-server.js
curl -s localhost:3000/api/chat -H 'content-type: application/json' \
  -d '{"messages":[{"role":"user","content":"Best resort on Saturday?"}],"mock":true}'
```

On Vercel, add `ANTHROPIC_API_KEY` under Project Settings, then Environment Variables
(for both Production and Preview), and redeploy. Also set a monthly spending limit in the
Anthropic console: this is a public endpoint that spends your credit.

## How an hour is scored

1. **Hard vetoes** - wind gusts at the lift limit, rain, very low visibility, extreme cold or too little snow: score 0.
2. **Weighted average** of nine factor scores (wind, visibility, rain, cold comfort, morning ice, snow quality, snow depth, current snowfall, fresh snow).
3. **Weakest-link caps** - the final score can't be much higher than the worst safety factor or the worst quality factor.

Per-resort wind limit, minimum snow depth and lift hours are set in `src/config.js`
(`defaults` and `resortOverrides`). The page shows the full breakdown when you hover over an hour.

## Run it locally

```
node test.js                      # check the scoring logic (the last part needs internet)
node test-chat.js                 # check the chatbot API (offline, free)
node dev-server.js                # the site AND the chatbot API at http://localhost:3000
```
