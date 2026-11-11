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
- `src/main.js` - the only file that touches the web page
- `index.html`, `style.css` - the page
- `test.js` - run `node test.js` to check the logic

The weather, scoring and summary functions don't depend on the page, so they can be
reused later as tools for an AI agent.

## How an hour is scored

1. **Hard vetoes** - wind gusts at the lift limit, rain, very low visibility, extreme cold or too little snow: score 0.
2. **Weighted average** of nine factor scores (wind, visibility, rain, cold comfort, morning ice, snow quality, snow depth, current snowfall, fresh snow).
3. **Weakest-link caps** - the final score can't be much higher than the worst safety factor or the worst quality factor.

Per-resort wind limit, minimum snow depth and lift hours are set in `src/config.js`
(`defaults` and `resortOverrides`). The page shows the full breakdown when you hover over an hour.

## Run it locally

```
node test.js                      # check the logic
python3 -m http.server 8000       # then open http://localhost:8000
```
