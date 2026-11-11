# Ski Conditions (Greece)

Hour-by-hour ski condition scores for Greek ski resorts
(Parnassos, Kalavryta, Velouchi, Vasilitsa), using free weather data
from [Open-Meteo](https://open-meteo.com/).

## Structure

- `src/resorts.js` - resort names and coordinates
- `src/weather.js` - `getWeather(resort)` returns hourly weather
- `src/scoring.js` - `scoreConditions(hour)` returns a 0-100 score
- `src/main.js` - the only file that touches the web page
- `index.html`, `style.css` - the page

The weather and scoring functions don't depend on the page, so they can be
reused later as tools for an AI agent.
