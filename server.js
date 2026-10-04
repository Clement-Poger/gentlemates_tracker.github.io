const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");

const ROOT = __dirname;
const CACHE_DIR = path.join(ROOT, ".cache", "liquipedia");
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MIN_REQUEST_GAP_MS = 2_000;
const MIN_PARSE_GAP_MS = 30_000;
const MAX_RESPONSE_BYTES = 2_000_000;

const games = {
  valorant: {
    name: "VALORANT",
    wiki: "valorant",
    page: "Gentle_Mates",
    section: 4,
    status: "active",
    sourceUrl: "https://liquipedia.net/valorant/Gentle_Mates",
    statsUrl: "https://www.vlr.gg/team/12629/gentle-mates"
  },
  "rocket-league": {
    name: "ROCKET LEAGUE",
    wiki: "rocketleague",
    page: "Gentle_Mates",
    section: 4,
    status: "active",
    sourceUrl: "https://liquipedia.net/rocketleague/Gentle_Mates",
    statsUrl: "https://octane.gg/teams/gentle-mates"
  },
  "call-of-duty": {
    name: "CALL OF DUTY",
    wiki: "callofduty",
    page: "Gentle_Mates",
    status: "historical",
    sourceUrl: "https://liquipedia.net/callofduty/Gentle_Mates"
  }
};

let lastApiRequestAt = 0;
let lastParseRequestAt = 0;
let requestQueue = Promise.resolve();
const refreshes = new Map();

function decodeHtmlEntities(value) {
  return value
    .replace(/&#(?:x([0-9a-f]+)|(\d+));/gi, (match, hex, decimal) => {
      const point = Number.parseInt(hex || decimal, hex ? 16 : 10);
      return Number.isFinite(point) ? String.fromCodePoint(point) : match;
    })
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function htmlText(value) {
  return decodeHtmlEntities(value
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function parseRosterHtml(html) {
  const rows = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
  const roster = [];

  for (const [, row] of rows) {
    const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => match[1]);
    if (cells.length < 2) continue;

    const anchor = cells[0].match(/<a\b[^>]*title="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    const alias = anchor ? htmlText(anchor[2]) : htmlText(cells[0]);
    const name = htmlText(cells[1]);
    if (!alias || !name) continue;

    roster.push({
      alias,
      name,
      role: cells[2] ? htmlText(cells[2]) : "Player",
      joined: cells[3] ? htmlText(cells[3]).replace(/\s*\[[^\]]*\]\s*$/, "") : ""
    });
  }

  return roster;
}

function parseDisbandedDate(wikitext) {
  const match = wikitext.match(/^\|disbanded\s*=\s*(\d{4}-\d{2}-\d{2})\s*$/im);
  return match ? match[1] : null;
}

function getApiContact() {
  return (process.env.GM_STATS_CONTACT || "").trim();
}

function liquipediaUrl(game, params) {
  const url = new URL(`https://liquipedia.net/${game.wiki}/api.php`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }
  return url;
}

function enqueueApiRequest(url, { isParse }) {
  const operation = requestQueue.then(async () => {
    const now = Date.now();
    const minGap = isParse ? MIN_PARSE_GAP_MS : MIN_REQUEST_GAP_MS;
    const lastAt = isParse ? Math.max(lastParseRequestAt, lastApiRequestAt) : lastApiRequestAt;
    const delay = Math.max(0, minGap - (now - lastAt));
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));

    const contact = getApiContact();
    if (!contact) {
      const error = new Error("Configure GM_STATS_CONTACT with a project contact email or public URL to use the Liquipedia API.");
      error.statusCode = 503;
      throw error;
    }

    const requestedAt = Date.now();
    lastApiRequestAt = requestedAt;
    if (isParse) lastParseRequestAt = requestedAt;

    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": `GMStats/1.0 (${contact})`
      },
      signal: AbortSignal.timeout(20_000)
    });
    if (!response.ok) {
      const error = new Error(`Liquipedia API returned HTTP ${response.status}.`);
      error.statusCode = 502;
      throw error;
    }

    const body = await response.text();
    if (Buffer.byteLength(body, "utf8") > MAX_RESPONSE_BYTES) {
      const error = new Error("Liquipedia API response exceeded the configured size limit.");
      error.statusCode = 502;
      throw error;
    }

    let data;
    try {
      data = JSON.parse(body);
    } catch {
      const error = new Error("Liquipedia API returned invalid JSON.");
      error.statusCode = 502;
      throw error;
    }
    if (data.error) {
      const error = new Error(`Liquipedia API error: ${data.error.info || data.error.code || "unknown error"}`);
      error.statusCode = 502;
      throw error;
    }
    return data;
  });

  requestQueue = operation.catch(() => {});
  return operation;
}

async function fetchActiveRoster(game) {
  const url = liquipediaUrl(game, {
    action: "parse",
    page: game.page,
    section: game.section,
    prop: "text",
    format: "json"
  });
  const data = await enqueueApiRequest(url, { isParse: true });
  const html = data.parse && data.parse.text && data.parse.text["*"];
  if (typeof html !== "string") {
    throw new Error("Liquipedia did not return the expected roster section.");
  }

  return {
    players: parseRosterHtml(html),
    status: "active"
  };
}

async function fetchCallOfDutyStatus(game) {
  const url = liquipediaUrl(game, {
    action: "query",
    format: "json",
    prop: "revisions",
    rvprop: "content",
    rvslots: "main",
    titles: game.page
  });
  const data = await enqueueApiRequest(url, { isParse: false });
  const page = Object.values(data.query && data.query.pages || {})[0];
  const wikitext = page && page.revisions && page.revisions[0] &&
    page.revisions[0].slots && page.revisions[0].slots.main &&
    (page.revisions[0].slots.main.content || page.revisions[0].slots.main["*"]);
  if (typeof wikitext !== "string") {
    throw new Error("Liquipedia did not return the expected team profile.");
  }

  return {
    players: [],
    status: parseDisbandedDate(wikitext) ? "disbanded" : "unknown",
    disbandedDate: parseDisbandedDate(wikitext)
  };
}

async function readCache(key) {
  try {
    const content = await fs.readFile(path.join(CACHE_DIR, `${key}.json`), "utf8");
    return JSON.parse(content);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw new Error(`Unable to read Liquipedia cache for ${key}: ${error.message}`);
  }
}

async function writeCache(key, value) {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  const target = path.join(CACHE_DIR, `${key}.json`);
  const temporary = `${target}.${process.pid}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(value, null, 2), "utf8");
  await fs.rename(temporary, target);
}

function cacheIsFresh(cache) {
  return cache && Date.now() - Date.parse(cache.fetchedAt) < CACHE_TTL_MS;
}

async function loadGame(key, { forceRefresh = false } = {}) {
  const game = games[key];
  if (!game) {
    const error = new Error("Unknown game.");
    error.statusCode = 404;
    throw error;
  }

  const cached = await readCache(key);
  if (cacheIsFresh(cached) && !forceRefresh) return cached;
  if (refreshes.has(key)) return refreshes.get(key);
  if (cached && !forceRefresh) return { ...cached, stale: true };

  const refresh = (async () => {
    const details = game.status === "historical"
      ? await fetchCallOfDutyStatus(game)
      : await fetchActiveRoster(game);
    const result = {
      game: key,
      name: game.name,
      status: details.status,
      disbandedDate: details.disbandedDate || null,
      players: details.players,
      fetchedAt: new Date().toISOString(),
      source: {
        name: "Liquipedia",
        kind: "community-maintained",
        page: game.sourceUrl,
        api: `https://liquipedia.net/${game.wiki}/api.php`,
        stats: game.statsUrl || null,
        attribution: "Data from Liquipedia (CC BY-SA 3.0); verify against cited sources."
      }
    };
    await writeCache(key, result);
    return result;
  })();

  refreshes.set(key, refresh);
  try {
    return await refresh;
  } finally {
    refreshes.delete(key);
  }
}

function jsonResponse(response, statusCode, value, extraHeaders = {}) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...extraHeaders
  });
  response.end(JSON.stringify(value));
}

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8"
};

async function handleRequest(request, response) {
  const url = new URL(request.url, "http://localhost");
  const apiMatch = url.pathname.match(/^\/api\/games\/([a-z-]+)$/);
  if (request.method === "GET" && apiMatch) {
    try {
      const result = await loadGame(apiMatch[1], { forceRefresh: url.searchParams.get("refresh") === "1" });
      jsonResponse(response, 200, result);
    } catch (error) {
      const statusCode = Number.isInteger(error.statusCode) ? error.statusCode : 502;
      console.error(`[api] ${apiMatch[1]}: ${error.message}`);
      jsonResponse(response, statusCode, { error: error.message });
    }
    return;
  }

  if (request.method !== "GET" || !["/", "/index.html", "/styles.css", "/app.js"].includes(url.pathname)) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  const fileName = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  try {
    const content = await fs.readFile(path.join(ROOT, fileName));
    response.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(fileName)],
      "Cache-Control": "no-cache"
    });
    response.end(content);
  } catch (error) {
    console.error(`[static] ${fileName}: ${error.message}`);
    response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Unable to read the requested app file.");
  }
}

if (require.main === module) {
  const port = Number.parseInt(process.env.PORT || "4173", 10);
  http.createServer((request, response) => {
    handleRequest(request, response).catch((error) => {
      console.error(`[server] ${error.message}`);
      if (!response.headersSent) jsonResponse(response, 500, { error: "Internal server error." });
      else response.destroy();
    });
  }).listen(port, "127.0.0.1", () => {
    console.log(`GM Stats running at http://127.0.0.1:${port}`);
    if (!getApiContact()) {
      console.warn("Live data disabled: set GM_STATS_CONTACT to a project contact email or public URL.");
    }
  });
}

module.exports = { decodeHtmlEntities, parseRosterHtml, parseDisbandedDate, loadGame };
