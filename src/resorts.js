// resorts.js
// Data only: no functions, no page code. Other files import this list.
//
// Each resort has:
//   id        - short name with no spaces (a key for config overrides and the AI agent)
//   name      - the name shown on the page
//   latitude  - north/south position in degrees
//   longitude - east/west position in degrees
//   elevation - height of the MAIN BASE / HUB in metres. Open-Meteo uses this
//               to adjust the temperature for mountain height.
//
// Per-resort wind limit, minimum snow depth and lift hours are NOT here:
// they are in config.js (see "defaults" and "resortOverrides").

export const resorts = [
  {
    id: "parnassos",
    name: "Parnassos",
    latitude: 38.56,
    longitude: 22.58,
    elevation: 1950,
  },
  {
    id: "vasilitsa",
    name: "Vasilitsa",
    latitude: 40.0588,
    longitude: 21.0838,
    elevation: 1640,
  },
  {
    id: "velouchi",
    name: "Velouchi (Karpenisi)",
    latitude: 38.9416,
    longitude: 21.8056,
    elevation: 1840,
  },
  {
    id: "kalavryta",
    name: "Kalavryta",
    latitude: 37.99,
    longitude: 22.2,
    elevation: 1700,
  },
];
