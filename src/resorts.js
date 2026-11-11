// resorts.js
// Data only: no functions, no page code. Other files import this list.
//
// Each resort has:
//   id        - short name with no spaces (handy as a key later, e.g. for the AI agent)
//   name      - the name shown on the page
//   latitude  - north/south position in degrees
//   longitude - east/west position in degrees
//   elevation - approximate TOP LIFT height in metres. Open-Meteo uses this
//               to adjust the temperature for mountain height.
//
// NOTE: elevations for Parnassos (2250), Kalavryta (2340) and Vasilitsa (2249)
// come from snowreport.gr. Velouchi (2000) is still my estimate.
// Coordinates are approximate. Edit the numbers if you know better values.

export const resorts = [
  {
    id: "parnassos",
    name: "Parnassos",
    latitude: 38.56,
    longitude: 22.62,
    elevation: 2250,
  },
  {
    id: "kalavryta",
    name: "Kalavryta",
    latitude: 38.0,
    longitude: 22.2,
    elevation: 2340,
  },
  {
    id: "velouchi",
    name: "Velouchi (Karpenisi)",
    latitude: 38.94,
    longitude: 21.81,
    elevation: 2000,
  },
  {
    id: "vasilitsa",
    name: "Vasilitsa",
    latitude: 40.03,
    longitude: 21.08,
    elevation: 2249,
  },
];
