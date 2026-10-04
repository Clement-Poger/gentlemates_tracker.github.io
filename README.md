# GM Stats

A responsive Gentle Mates esports dashboard with source-linked roster data. The interface borrows CodeBook's paper-like surfaces and violet/lime accents while retaining Gentle Mates red in the visual identity.

## Run locally

Liquipedia requires API requests to identify the project and include contact information in the User-Agent. Add an email address or public project URL to `GM_STATS_CONTACT`, then start the built-in Node server:

```powershell
$env:GM_STATS_CONTACT = "mailto:you@example.com"
node .\server.js
```

Open `http://127.0.0.1:4173`. Opening `index.html` directly does not start the data API. No npm packages are needed; use Node.js 20 or later.

## Data coverage and attribution

- Current team profiles and roster sections are fetched from the Liquipedia MediaWiki API for VALORANT and Rocket League.
- The Call of Duty profile is historical; the app displays the profile's disbanded date if returned by the API.
- Liquipedia is community-maintained, not an official Gentle Mates or publisher feed. API responses are cached locally for 24 hours and request pacing follows the Liquipedia API terms. Source links and retrieval times are shown in the app.
- Match scores and specialist player-performance metrics are not copied into the dashboard yet because no stable, verified API feed and reuse terms have been confirmed. The app links to VLR.gg or Octane.gg instead of showing invented or unattributed numbers.
- Liquipedia content is licensed under CC BY-SA 3.0. Keep attribution with any reuse and review its current [API terms](https://liquipedia.net/api-terms-of-use).

## Navigation

The app includes overview, roster, match-center, player-directory, and useful-links pages. Game and page navigation moves into an accessible hamburger drawer on phones and tablets; the left navigation remains on larger screens.

## Validation

Run `node --test .\tests\server.test.js` for the Liquipedia response-parser tests and `node --check .\app.js` / `node --check .\server.js` for syntax checks.
