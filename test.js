// test.js
// Run in the terminal with:  node test.js
// Checks the functions without needing a browser.

import { resorts } from "./src/resorts.js";
import { getWeather } from "./src/weather.js";

const hours = await getWeather(resorts[0]);

console.log(`${resorts[0].name}: got ${hours.length} hours. First 5:`);
console.table(hours.slice(0, 5));
