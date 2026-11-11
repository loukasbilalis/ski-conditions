// tools.js
// The ski-conditions functions packaged as "tools" an AI agent can call.
//
// This file does NOT depend on any AI library or on the web page. Each tool is
// just an object with four things:
//   name         - what the AI calls it
//   description  - tells the AI WHEN and WHY to use it (the AI reads this!)
//   input_schema - a JSON Schema describing the input the AI must send
//   run(input)   - ordinary JavaScript that does the work and returns plain data
// That shape is what the Claude API expects, and most other agent frameworks
// accept the same pieces. agent/run.js shows how to connect them to Claude.

import { resorts } from "./resorts.js";
import { CONFIG } from "./config.js";
import { getWeather as fetchOpenMeteo } from "./weather.js";
import { scoreForecast, resolveSettings, liftHourIndexes } from "./scoring.js";
import { summarizeForecast } from "./summary.js";

const RESORT_IDS = resorts.map((r) => r.id);

// A reusable piece of schema: "which resort?". The `enum` lists the allowed
// ids, so the AI can only pick a real one.
const resortIdProperty = {
  type: "string",
  enum: RESORT_IDS,
  description: "Which resort. Use list_resorts to see what each id means.",
};

// Round a number for the AI (fewer digits = fewer tokens). Keeps null as null.
const round = (value, digits = 1) =>
  value === null || value === undefined ? null : Math.round(value * 10 ** digits) / 10 ** digits;

/**
 * Build the tools.
 *
 * @param {object} [options]
 * @param {Function} [options.getWeather]  Where weather comes from. Defaults to the
 *   real Open-Meteo function. Tests pass in a fake one, so no internet is needed.
 * @param {number} [options.cacheMinutes]  Weather is remembered this long, so an AI that
 *   calls three tools for one resort downloads the forecast only once. Use 0 to switch off.
 */
export function createTools({ getWeather = fetchOpenMeteo, cacheMinutes = 10 } = {}) {
  const cache = new Map(); // resort id -> { fetchedAt, request }

  // Get the weather for a resort, from memory if it is fresh enough.
  function weatherFor(resort) {
    const cached = cache.get(resort.id);
    if (cached && Date.now() - cached.fetchedAt < cacheMinutes * 60_000) return cached.request;

    const request = getWeather(resort);
    cache.set(resort.id, { fetchedAt: Date.now(), request });
    request.catch(() => cache.delete(resort.id)); // don't remember failures
    return request;
  }

  // Find the resort the AI asked for, or explain what went wrong.
  function findResort(input) {
    const resort = resorts.find((r) => r.id === input?.resort_id);
    if (!resort) {
      throw new Error(
        `Unknown resort_id ${JSON.stringify(input?.resort_id)}. Valid ids: ${RESORT_IDS.join(", ")}.`
      );
    }
    return resort;
  }

  return [
    // -----------------------------------------------------------
    {
      name: "list_resorts",
      description:
        "List the ski resorts this app covers, with their id, name, base altitude, lift hours, " +
        "the wind limit at which lifts close, and the minimum snow depth. " +
        "Call this first if you are unsure which resort_id to use.",
      input_schema: { type: "object", properties: {}, additionalProperties: false },
      async run() {
        return resorts.map((resort) => {
          const settings = resolveSettings(resort);
          return {
            resort_id: resort.id,
            name: resort.name,
            base_altitude_m: resort.elevation,
            lift_hours: `${String(settings.liftHours.start).padStart(2, "0")}:00-${String(settings.liftHours.end).padStart(2, "0")}:00`,
            lift_wind_limit_kmh: settings.windLimit,
            minimum_snow_depth_m: settings.minSnowDepth,
          };
        });
      },
    },

    // -----------------------------------------------------------
    {
      name: "get_hourly_weather",
      description:
        "Get the raw hourly weather forecast for one resort, for today and tomorrow, during lift hours only " +
        "(local Greek time). Use this when the user asks about actual weather values such as temperature, " +
        "wind gusts, visibility, rain or snow. For how GOOD the conditions are, use score_hourly_conditions instead. " +
        "Data comes from Open-Meteo and is a forecast, not an observation.",
      input_schema: {
        type: "object",
        properties: { resort_id: resortIdProperty },
        required: ["resort_id"],
        additionalProperties: false,
      },
      async run(input) {
        const resort = findResort(input);
        const hours = await weatherFor(resort);
        const indexes = liftHourIndexes(hours, resolveSettings(resort));
        return {
          resort_id: resort.id,
          timezone: "Europe/Athens",
          units: {
            temperature: "°C",
            feels_like: "°C",
            wind_gusts: "km/h",
            visibility: "m",
            humidity: "%",
            snow_depth: "m (modelled natural snow; ignores snowmaking and grooming)",
            snowfall: "cm per hour",
            rain_and_showers: "mm per hour",
          },
          hours: indexes.map((i) => {
            const h = hours[i];
            return {
              time: h.time,
              temperature: round(h.temperature),
              feels_like: round(h.apparentTemperature),
              wind_gusts: round(h.windGusts, 0),
              visibility: round(h.visibility, 0),
              humidity: round(h.humidity, 0),
              snow_depth: round(h.snowDepth, 2),
              snowfall: round(h.snowfall),
              rain: round(h.rain),
              showers: round(h.showers),
            };
          }),
        };
      },
    },

    // -----------------------------------------------------------
    {
      name: "score_hourly_conditions",
      description:
        "Score the ski conditions hour by hour for one resort, for today and tomorrow, during lift hours. " +
        "Scores are for beginner lessons and casual skiing with young children. Each hour has a score from " +
        "0 (terrible) to 100 (excellent), any hard vetoes, and the weakest factor. " +
        "A veto means the score is forced to 0 (for example gusts at the lift limit, rain, very low " +
        "visibility, extreme cold, or too little snow). Set include_factors to true to also get every factor's score.",
      input_schema: {
        type: "object",
        properties: {
          resort_id: resortIdProperty,
          include_factors: {
            type: "boolean",
            description: "Also return the 0-100 score of every individual factor. Default false.",
          },
        },
        required: ["resort_id"],
        additionalProperties: false,
      },
      async run(input) {
        const resort = findResort(input);
        const scored = scoreForecast(await weatherFor(resort), resort);
        return {
          resort_id: resort.id,
          hours: scored.map((r) => ({
            time: r.time,
            score: r.score,
            vetoes: r.vetoes.map((v) => v.label),
            weakest_factor: r.worstFactor ? { name: r.worstFactor.label, score: round(r.worstFactor.score, 0) } : null,
            ...(input.include_factors
              ? {
                  factors: Object.fromEntries(
                    Object.entries(r.factors).map(([id, value]) => [CONFIG.factors[id].label, round(value, 0)])
                  ),
                }
              : {}),
            ...(r.missing.length ? { missing_data: r.missing.map((id) => CONFIG.factors[id].label) } : {}),
          })),
        };
      },
    },

    // -----------------------------------------------------------
    {
      name: "get_daily_summary",
      description:
        "Summarise each day (today and tomorrow) for one resort: the best consecutive window of lift hours " +
        "with its average score, the worst hour and what caused it, and which vetoes occurred and for how many hours. " +
        "Use this to answer questions like 'when is the best time to ski tomorrow?' or 'is it worth going today?'. " +
        "Days are not averaged into a single score on purpose.",
      input_schema: {
        type: "object",
        properties: { resort_id: resortIdProperty },
        required: ["resort_id"],
        additionalProperties: false,
      },
      async run(input) {
        const resort = findResort(input);
        const scored = scoreForecast(await weatherFor(resort), resort);
        return {
          resort_id: resort.id,
          days: summarizeForecast(scored).map(({ date, summary }) => ({
            date,
            best_window: {
              from: summary.bestWindow.startTime,
              to: summary.bestWindow.endTime,
              hours: summary.bestWindow.hours,
              average_score: summary.bestWindow.average,
            },
            worst_hour: {
              time: summary.worstHour.time,
              score: summary.worstHour.score,
              cause: summary.worstHour.vetoes.length
                ? summary.worstHour.vetoes.map((v) => v.label)
                : summary.worstHour.worstFactor
                ? [summary.worstHour.worstFactor.label]
                : [],
            },
            vetoes: summary.vetoes.map((v) => ({ reason: v.label, hours: v.hours })),
          })),
        };
      },
    },
  ];
}

// The ready-to-use tools, using the real weather.
export const tools = createTools();

/**
 * Run a tool by name. Handy for agent frameworks that give you a tool name and
 * an input object, and want a result back.
 * Never throws: a problem comes back as { error: "..." } so the AI can read it and recover.
 */
export async function runTool(name, input = {}, toolList = tools) {
  const tool = toolList.find((t) => t.name === name);
  if (!tool) return { error: `Unknown tool ${JSON.stringify(name)}. Tools: ${toolList.map((t) => t.name).join(", ")}.` };
  try {
    return await tool.run(input);
  } catch (error) {
    return { error: error.message };
  }
}
