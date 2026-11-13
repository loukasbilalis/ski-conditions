// dev-server.js
// A tiny local web server for trying the site AND the chatbot API on your own
// computer, without needing a Vercel account or the Vercel CLI.
//
//   node dev-server.js                 then open http://localhost:3000
//   PORT=4000 node dev-server.js       use another port
//   HOST=0.0.0.0 node dev-server.js    let other devices on your Wi-Fi connect (e.g. your phone)
//
// It serves the files in this folder, and sends POST /api/chat to api/chat.js,
// the same function Vercel runs. It is only for development.

import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import chatHandler from "./api/chat.js";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "127.0.0.1"; // only this computer, unless you say otherwise
const MAX_BODY_BYTES = 100_000;

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function plain(res, status, text) {
  res.statusCode = status;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end(text);
}

// Read the request body (with a size limit) and turn JSON into an object,
// the way Vercel does before calling the function.
async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) return { tooLarge: true };
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return { body: undefined };
  try {
    return { body: JSON.parse(text) };
  } catch {
    return { body: text }; // the function will reply "could not read that request"
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    // The API
    if (url.pathname === "/api/chat") {
      const { body, tooLarge } = await readBody(req);
      if (tooLarge) return plain(res, 413, "Request too large");
      req.body = body;
      return await chatHandler(req, res);
    }

    // Everything else is a file from this folder.
    let relative = decodeURIComponent(url.pathname);
    if (relative.endsWith("/")) relative += "index.html";
    const file = path.join(ROOT, relative);
    const parts = path.relative(ROOT, file).split(path.sep);

    // Never serve things outside the folder, hidden files (like .env or .git),
    // installed packages, or the api/ folder (those are code, not web pages).
    const forbidden = parts[0] === ".." || parts.some((part) => part.startsWith(".") || part === "node_modules") || parts[0] === "api";
    if (forbidden) return plain(res, 404, "Not found");

    const data = await fs.readFile(file);
    res.statusCode = 200;
    res.setHeader("Content-Type", CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream");
    res.setHeader("Cache-Control", "no-store");
    res.end(data);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "EISDIR") return plain(res, 404, "Not found");
    console.error(error);
    plain(res, 500, "Server error");
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Local server: http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`);
  console.log("Press Ctrl+C to stop.");
});
