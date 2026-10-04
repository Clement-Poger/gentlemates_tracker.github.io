const games = {
  valorant: {
    name: "VALORANT",
    subtitle: "The active VALORANT lineup and linked competition sources.",
    sources: [
      { label: "Liquipedia", detail: "Roster profile and team history", href: "https://liquipedia.net/valorant/Gentle_Mates" },
      { label: "VLR.gg", detail: "Match history and player statistics", href: "https://www.vlr.gg/team/12629/gentle-mates" },
      { label: "Gentle Mates", detail: "Official team announcements", href: "https://x.com/GentleMates" }
    ]
  },
  "rocket-league": {
    name: "ROCKET LEAGUE",
    subtitle: "The active Rocket League lineup and linked competition sources.",
    sources: [
      { label: "Liquipedia", detail: "Roster profile and team history", href: "https://liquipedia.net/rocketleague/Gentle_Mates" },
      { label: "Octane.gg", detail: "Match history and player statistics", href: "https://octane.gg/teams/gentle-mates" },
      { label: "Gentle Mates", detail: "Official team announcements", href: "https://x.com/GentleMates" }
    ]
  },
  "call-of-duty": {
    name: "CALL OF DUTY",
    subtitle: "Historical team profile and source links.",
    sources: [
      { label: "Liquipedia", detail: "Historical team profile", href: "https://liquipedia.net/callofduty/Gentle_Mates" },
      { label: "Call of Duty League", detail: "Official league source", href: "https://callofdutyleague.com/" },
      { label: "Gentle Mates", detail: "Official team announcements", href: "https://x.com/GentleMates" }
    ]
  }
};

const pageTitles = {
  overview: ["TEAM OVERVIEW", "Follow the team.", "Live roster data with a direct trail back to its source."],
  roster: ["ACTIVE LINEUP", "Meet the roster.", "Player names and roles as published by the linked source."],
  matches: ["MATCH CENTER", "Every result counts.", "Follow verified fixtures and results at their source."],
  players: ["PLAYER ANALYTICS", "Numbers, with context.", "Specialist statistics sources, clearly separated from team claims."],
  links: ["SCOUTING DESK", "Follow the source.", "Team, league, and specialist statistics references."]
};

let currentGame = "valorant";
let currentPage = "overview";
let searchTerm = "";
let matchFilter = "all";
let toastTimer;
let activeRequest = 0;
const gameData = new Map();
const loadErrors = new Map();

const pageContent = document.querySelector("#page-content");
const searchInput = document.querySelector("#global-search");
const sidebar = document.querySelector("#sidebar");
const menuToggle = document.querySelector("#menu-toggle");
const sidebarScrim = document.querySelector("#sidebar-scrim");
const mobileNavigation = window.matchMedia("(max-width: 1024px)");

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[char]);

function setPage(page) {
  if (!pageTitles[page]) return;
  currentPage = page;
  closeMobileNavigation();
  document.querySelectorAll(".primary-nav [data-page], .sidebar-bottom [data-page]").forEach((item) => {
    item.classList.toggle("active", item.dataset.page === page);
  });
  render();
}

function setGame(game) {
  if (!games[game]) return;
  currentGame = game;
  closeMobileNavigation();
  document.querySelectorAll(".game-item").forEach((item) => item.classList.toggle("selected", item.dataset.game === game));
  document.querySelector("#breadcrumb-game").textContent = games[game].name;
  if (!gameData.has(game)) void loadGame(game);
  render();
}

function formatDate(value) {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not available";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function sourceLinks(game, compact = false) {
  return game.sources.map((source) => `<a class="link-card${compact ? " compact" : ""}" href="${escapeHtml(source.href)}" target="_blank" rel="noopener noreferrer">
    <span class="link-icon">↗</span><span><strong>${escapeHtml(source.label)}</strong><small>${escapeHtml(source.detail)}</small></span><span class="link-arrow">›</span>
  </a>`).join("");
}

function heading(game) {
  const [eyebrow, title, subtitle] = pageTitles[currentPage];
  return `<div class="page-heading">
    <div><div class="eyebrow">${eyebrow} &nbsp; / &nbsp; ${escapeHtml(game.name)}</div><h1>${title}</h1><p class="heading-subtitle">${subtitle}</p></div>
    <div class="heading-actions"><button class="button" data-action="source">↗ &nbsp; Data sources</button><button class="button primary" data-action="refresh">⟳ &nbsp; Refresh data</button></div>
  </div>`;
}

function gameTabs() {
  return `<div class="game-switcher" role="tablist" aria-label="Choose a game">
    ${Object.entries(games).map(([key, game]) => `<button class="game-tab${key === currentGame ? " active" : ""}" role="tab" aria-selected="${key === currentGame}" data-game="${key}">${game.name}</button>`).join("")}
  </div>`;
}

function provenance(data) {
  if (!data) return "";
  const label = data.source.kind === "community-maintained" ? "COMMUNITY-MAINTAINED SOURCE" : "SOURCE";
  return `<span class="source-stamp"><span class="stamp-dot"></span>${label}<span class="stamp-divider">·</span>UPDATED ${escapeHtml(formatDate(data.fetchedAt))}</span>`;
}

function loadingMessage() {
  return `<div class="card loading-card"><span class="loading-mark"></span><strong>Fetching the current team profile</strong><span>Checking Liquipedia's API and its request limits…</span></div>`;
}

function errorMessage(error, game) {
  return `<div class="card error-card"><span class="error-symbol">!</span><div><strong>Live data could not be loaded</strong><p>${escapeHtml(error)}</p><p class="error-source">Use the source profile to check the latest roster.</p><a href="${escapeHtml(game.sources[0].href)}" target="_blank" rel="noopener noreferrer">Open Liquipedia →</a></div><button class="button" data-action="refresh">Retry</button></div>`;
}

function rosterCount(players) {
  return players.filter((player) => !/coach|manager|analyst|staff/i.test(player.role)).length;
}

function rosterCards(players) {
  const visible = players.filter((player) => matchesSearch(`${player.alias} ${player.name} ${player.role}`));
  if (!visible.length) {
    return `<div class="empty-state"><strong>${players.length ? "No players found" : "No active roster listed"}</strong>${players.length ? "Try another search." : "Check the linked team profile for its latest status."}</div>`;
  }
  return `<div class="roster-cards">${visible.map((player) => `<article class="card player-card">
    <div class="player-card-top"><span class="player-avatar">${escapeHtml(player.alias.slice(0, 2).toUpperCase())}</span><span><h3>${escapeHtml(player.alias)}</h3><div class="player-card-role">${escapeHtml(player.role || "Player")}</div></span></div>
    <div class="player-card-stats"><span>PLAYER NAME<strong>${escapeHtml(player.name)}</strong></span><span>JOINED<strong>${escapeHtml(player.joined || "—")}</strong></span></div>
  </article>`).join("")}</div>`;
}

function dataUnavailable(title, detail, href, linkLabel) {
  return `<div class="empty-state"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(detail)}</span><a class="inline-source" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(linkLabel)} →</a></div>`;
}

function overview(game, data) {
  const players = data.players || [];
  const activePlayers = rosterCount(players);
  const staffCount = players.length - activePlayers;
  const statusText = data.status === "disbanded"
    ? `PROFILE MARKED DISBANDED${data.disbandedDate ? ` · ${data.disbandedDate}` : ""}`
    : "ACTIVE TEAM PROFILE";
  return `${heading(game)}${gameTabs()}
    <section class="card match-hero">
      <div class="card-topline"><span class="section-kicker">GENTLE MATES · ${escapeHtml(game.name)}</span><span class="status-pill"><span class="status-dot"></span>${escapeHtml(statusText)}</span></div>
      <div class="source-hero"><div class="source-brand">M<span>8</span></div><div><div class="source-hero-label">LIVE TEAM PROFILE</div><h2>${escapeHtml(game.name)}<span class="title-slash"> / </span>GENTLE MATES</h2><p>Roster facts are fetched from a community-maintained Liquipedia API profile.</p></div></div>
      <div class="match-hero-foot"><span>${provenance(data)}</span><a class="hero-source-link" href="${escapeHtml(data.source.page)}" target="_blank" rel="noopener noreferrer">OPEN SOURCE PROFILE ↗</a></div>
    </section>
    <div class="hero-grid overview-kpis">
      <article class="card kpi-card"><div class="kpi-label">ROSTER PLAYERS</div><div class="kpi-value">${activePlayers}</div><div class="kpi-detail">Listed in the current team profile</div></article>
      <article class="card kpi-card"><div class="kpi-label">COACHING / STAFF</div><div class="kpi-value">${staffCount || "—"}</div><div class="kpi-detail">${staffCount ? "Listed alongside the roster" : "Not listed in this profile"}</div></article>
      <article class="card kpi-card"><div class="kpi-label">MATCH RESULTS</div><div class="kpi-value">—</div><div class="kpi-detail">Not imported from the API yet</div></article>
    </div>
    <div class="dashboard-grid">
      <section class="card"><div class="card-header"><h2 class="card-title">${data.status === "disbanded" ? "Historical roster" : "Current roster"}</h2><button class="card-action" data-action="roster">VIEW ROSTER &nbsp; →</button></div>${players.length ? `<div class="roster-strip">${players.map((player) => `<div class="roster-mini"><span class="player-avatar">${escapeHtml(player.alias.slice(0, 2).toUpperCase())}</span><strong>${escapeHtml(player.alias)}</strong><small>${escapeHtml(player.role || "PLAYER")}</small></div>`).join("")}</div>` : `<div class="empty-state"><strong>No active roster listed</strong>See the historical team profile for current status.</div>`}</section>
      <section class="card form-card"><div class="card-header"><h2 class="card-title">Recent results</h2><button class="card-action" data-action="matches">MATCH CENTER &nbsp; →</button></div>${dataUnavailable("Results not available in this feed", "No match scores are included in the roster endpoint. Open a specialist stats source.", game.sources[1].href, `Open ${game.sources[1].label}`)}</section>
    </div>
    <section class="card section-spacer provenance-card"><div class="card-header"><h2 class="card-title">Source trail</h2><span class="section-kicker">DATA IS NOT PUBLISHER-OFFICIAL</span></div><div class="provenance-copy"><p>${escapeHtml(data.source.attribution)}</p><p>Liquipedia entries can change. This app keeps the source page and retrieval time visible; player performance statistics remain linked externally until a supported feed is available.</p></div></section>`;
}

function rosterPage(game, data) {
  const players = data.players || [];
  return `${heading(game)}${gameTabs()}<section class="card"><div class="card-header"><h2 class="card-title">${data.status === "disbanded" ? "Historical roster" : "Roster"}</h2><span class="section-kicker">${rosterCount(players)} PLAYERS · LIQUIPEDIA</span></div>${rosterCards(players)}</section>`;
}

function matchesPage(game, data) {
  const message = data.status === "disbanded"
    ? `This team profile is marked disbanded${data.disbandedDate ? ` (${data.disbandedDate})` : ""}.`
    : "The roster feed does not include verified scores or match dates.";
  return `${heading(game)}${gameTabs()}<section class="card"><div class="card-header"><h2 class="card-title">Match history</h2><span class="section-kicker">NO SAMPLE RESULTS</span></div>${dataUnavailable("No verified match records loaded", message, game.sources[1] ? game.sources[1].href : data.source.page, `Open ${game.sources[1] ? game.sources[1].label : "Liquipedia"}`)}</section>`;
}

function playersPage(game, data) {
  const players = data.players.filter((player) => matchesSearch(`${player.alias} ${player.name} ${player.role}`));
  const body = players.length
    ? players.map((player) => `<tr><td><span class="table-player"><span class="player-avatar">${escapeHtml(player.alias.slice(0, 2).toUpperCase())}</span><span><strong>${escapeHtml(player.alias)}</strong><small>${escapeHtml(player.name)}</small></span></span></td><td>${escapeHtml(player.role || "Player")}</td><td>${escapeHtml(player.joined || "—")}</td><td><span class="external-data">See specialist source</span></td></tr>`).join("")
    : `<tr><td colspan="4"><div class="empty-state"><strong>No players found</strong>Try another search.</div></td></tr>`;
  return `${heading(game)}${gameTabs()}<section class="card"><div class="card-header"><h2 class="card-title">Player directory</h2><span class="section-kicker">PERFORMANCE METRICS LINKED, NOT MIRRORED</span></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Player</th><th>Role</th><th>Joined</th><th>Statistics</th></tr></thead><tbody>${body}</tbody></table></div><div class="provenance-copy"><p>Player performance ratings depend on the game and competition. Open the specialist source rather than presenting a number without its definition or attribution.</p><p><a class="inline-source" href="${escapeHtml(game.sources[1].href)}" target="_blank" rel="noopener noreferrer">Open ${escapeHtml(game.sources[1].label)} →</a></p></div></section>`;
}

function linksPage(game) {
  return `${heading(game)}${gameTabs()}<div class="link-grid">${sourceLinks(game)}</div><div class="card section-spacer provenance-card"><div class="card-header"><h2 class="card-title">How the data is labelled</h2></div><div class="provenance-copy"><p>Liquipedia is a community-maintained wiki, not an official Gentle Mates or game-publisher feed. Its content is attributed under CC BY-SA 3.0.</p><p>Specialist match/statistics sites are linked directly. Statistics are not copied until their definitions and reuse terms can be verified.</p></div></div>`;
}

function matchesSearch(value) {
  return !searchTerm || value.toLowerCase().includes(searchTerm.toLowerCase());
}

function render() {
  const game = games[currentGame];
  const data = gameData.get(currentGame);
  const error = loadErrors.get(currentGame);
  if (error) {
    pageContent.innerHTML = `${heading(game)}${gameTabs()}${errorMessage(error, game)}`;
    return;
  }
  if (!data) {
    pageContent.innerHTML = `${heading(game)}${gameTabs()}${loadingMessage()}`;
    return;
  }
  pageContent.innerHTML = ({
    overview: () => overview(game, data),
    roster: () => rosterPage(game, data),
    matches: () => matchesPage(game, data),
    players: () => playersPage(game, data),
    links: () => linksPage(game)
  })[currentPage]();
}

async function loadGame(gameKey, { forceRefresh = false } = {}) {
  const requestId = ++activeRequest;
  loadErrors.delete(gameKey);
  if (!gameData.has(gameKey)) render();
  try {
    const response = await fetch(`/api/games/${encodeURIComponent(gameKey)}${forceRefresh ? "?refresh=1" : ""}`, {
      headers: { Accept: "application/json" }
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Data request failed (${response.status}).`);
    gameData.set(gameKey, result);
    loadErrors.delete(gameKey);
  } catch (error) {
    loadErrors.set(gameKey, error.message || "The data request failed.");
  }
  if (requestId === activeRequest && gameKey === currentGame) render();
}

function showToast(message) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.classList.add("visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 3500);
}

function setMobileNavigation(open) {
  const isOpen = mobileNavigation.matches && open;
  sidebar.classList.toggle("mobile-open", isOpen);
  sidebarScrim.classList.toggle("visible", isOpen);
  menuToggle.setAttribute("aria-expanded", String(isOpen));
  menuToggle.setAttribute("aria-label", isOpen ? "Close navigation menu" : "Open navigation menu");
  sidebar.setAttribute("aria-hidden", String(mobileNavigation.matches && !isOpen));
  document.body.classList.toggle("navigation-open", isOpen);
  const firstNavigationItem = sidebar.querySelector(".nav-item");
  if (isOpen && firstNavigationItem) firstNavigationItem.focus();
}

function closeMobileNavigation() {
  setMobileNavigation(false);
}

document.addEventListener("click", (event) => {
  const target = event.target.closest("button, a");
  if (!target) return;
  if (target.id === "menu-toggle") {
    setMobileNavigation(!sidebar.classList.contains("mobile-open"));
  } else if (target.id === "sidebar-scrim") {
    closeMobileNavigation();
  } else if (target.dataset.game) {
    setGame(target.dataset.game);
  } else if (target.dataset.page) {
    event.preventDefault();
    setPage(target.dataset.page);
  } else if (target.dataset.action === "matches" || target.dataset.action === "roster" || target.dataset.action === "players") {
    setPage(target.dataset.action);
  } else if (target.dataset.action === "source") {
    setPage("links");
  } else if (target.dataset.action === "refresh") {
    gameData.delete(currentGame);
    void loadGame(currentGame, { forceRefresh: true });
  } else if (target.id === "help-button") {
    showToast("Liquipedia is community-maintained; match and player-stat sources open externally.");
  } else if (target.id === "dismiss-banner") {
    target.closest(".demo-banner").remove();
  }
});

searchInput.addEventListener("input", () => {
  searchTerm = searchInput.value.trim();
  render();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && sidebar.classList.contains("mobile-open")) {
    closeMobileNavigation();
    menuToggle.focus();
    return;
  }
  if (event.key === "/" && !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) {
    event.preventDefault();
    searchInput.focus();
  }
  if (event.key === "Escape" && document.activeElement === searchInput) {
    searchInput.value = "";
    searchTerm = "";
    searchInput.blur();
    render();
  }
});

mobileNavigation.addEventListener("change", () => setMobileNavigation(false));
sidebar.addEventListener("keydown", (event) => {
  if (event.key !== "Tab" || !sidebar.classList.contains("mobile-open")) return;
  const focusable = [...sidebar.querySelectorAll("a[href], button:not([disabled])")];
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});

setMobileNavigation(false);
render();
void loadGame(currentGame);
