const test = require("node:test");
const assert = require("node:assert/strict");
const { parseRosterHtml, parseDisbandedDate } = require("../server");

test("parses player alias, full name, role, and join date from Liquipedia roster rows", () => {
  const html = `<table><tbody>
    <tr><th>ID</th><th>Name</th><th>Role</th><th>Join Date</th></tr>
    <tr class="table2&#95;&#95;row--body">
      <td><b><a href="/rocketleague/Oski" title="Oski">Oski</a></b></td>
      <td>Oskar Gozdowski</td><td></td><td>2025-10-11 <sup>[1]</sup></td>
    </tr>
    <tr class="table2&#95;&#95;row--body">
      <td><b><a href="/rocketleague/Snaski" title="Snaski">Snaski</a></b></td>
      <td>Nicolai Vistesen Andersen</td><td>Coach</td><td>2025-10-11</td>
    </tr>
  </tbody></table>`;

  assert.deepEqual(parseRosterHtml(html), [
    { alias: "Oski", name: "Oskar Gozdowski", role: "Player", joined: "2025-10-11" },
    { alias: "Snaski", name: "Nicolai Vistesen Andersen", role: "Coach", joined: "2025-10-11" }
  ]);
});

test("decodes HTML entities in player names", () => {
  const html = `<tr><td><a title="Proxh">Proxh</a></td><td>Yusuf Emre Tunc &amp; Co.</td></tr>`;
  assert.equal(parseRosterHtml(html)[0].name, "Yusuf Emre Tunc & Co.");
});

test("extracts a disbanded date from the team infobox", () => {
  assert.equal(parseDisbandedDate("|name=Gentle Mates\n|disbanded=2024-08-16\n|location=France"), "2024-08-16");
  assert.equal(parseDisbandedDate("|disbanded=\n|location=France"), null);
});
