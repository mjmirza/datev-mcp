import { test } from "node:test";
import assert from "node:assert/strict";
import { startCallbackServer } from "../../src/auth/callback-server.js";

const STATE = "S".repeat(24);

async function visit(query: string, lang?: "en" | "de") {
  const before = process.env.DATEV_MCP_LANG;
  if (lang) process.env.DATEV_MCP_LANG = lang;
  else delete process.env.DATEV_MCP_LANG;
  try {
    const cb = await startCallbackServer(STATE, { timeoutMs: 5000 });
    const settled = cb.result.catch(() => undefined);
    const res = await fetch(`${cb.redirectUri.replace("localhost", "127.0.0.1")}?${query}`, { signal: AbortSignal.timeout(5000) });
    const html = await res.text();
    await settled;
    return { res, html };
  } finally {
    if (before === undefined) delete process.env.DATEV_MCP_LANG;
    else process.env.DATEV_MCP_LANG = before;
  }
}

const ok = `code=CODE&state=${STATE}`;
const failed = `error=${encodeURIComponent('<b>"access_denied"</b>')}&state=${STATE}`;
const mismatch = "code=X&state=forged";

test("the callback page declares its language and a mobile viewport", async () => {
  for (const q of [ok, failed, mismatch]) {
    const { html } = await visit(q);
    assert.match(html, /<html lang="en">/);
    assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
    assert.match(html, /<main[\s>]/);
    assert.match(html, /<h1>/);
    assert.match(html, /role="status"/);
  }
});

test("the callback page is sent with locked-down headers", async () => {
  for (const q of [ok, failed, mismatch]) {
    const { res } = await visit(q);
    assert.equal(res.headers.get("content-type"), "text/html; charset=utf-8");
    assert.equal(
      res.headers.get("content-security-policy"),
      "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    );
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.equal(res.headers.get("referrer-policy"), "no-referrer");
  }
});

test("the page defines light tokens and redefines them for dark mode", async () => {
  const { html } = await visit(ok);
  const root = html.match(/:root\s*\{([^}]*)\}/);
  assert.ok(root, "no :root token block");
  for (const t of ["--background", "--foreground", "--card", "--card-foreground", "--muted-foreground", "--border", "--primary", "--primary-foreground", "--radius"])
    assert.ok(root[1].includes(`${t}:`), `missing light token ${t}`);
  const dark = html.match(/@media \(prefers-color-scheme: dark\)\s*\{\s*:root\s*\{([^}]*)\}/);
  assert.ok(dark, "no dark media block");
  const bg = dark[1].match(/--background:\s*oklch\(([\d.]+)/);
  assert.ok(bg && Number(bg[1]) >= 0.14 && Number(bg[1]) <= 0.22, `dark background lightness ${bg?.[1]}`);
});

test("no colour on the page sits in the banned blue to purple hue band", async () => {
  for (const q of [ok, failed, mismatch]) {
    const { html } = await visit(q);
    const colours = [...html.matchAll(/oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/g)];
    assert.ok(colours.length > 0);
    for (const [, l, c, h] of colours) {
      if (Number(c) > 0.01) assert.ok(Number(h) < 220 || Number(h) > 330, `banned hue ${h}`);
      assert.ok(Number(l) >= 0.14, `near-black lightness ${l}`);
    }
    assert.doesNotMatch(html, /gradient|backdrop-filter|#[0-9a-f]{3,8}\b/i);
  }
});

test("the page loads nothing from anywhere", async () => {
  for (const q of [ok, failed, mismatch]) {
    const { html } = await visit(q);
    assert.doesNotMatch(html, /<link|<script|<img|@import|url\(|https?:/i);
  }
});

test("text DATEV sends back is escaped, never rendered as markup", async () => {
  const { html } = await visit(failed);
  assert.ok(!html.includes("<b>"));
  assert.ok(html.includes("&#60;b&#62;&#34;access_denied&#34;&#60;/b&#62;"));
});

test("German mode shows the callback page in German", async () => {
  const done = await visit(ok, "de");
  assert.match(done.html, /<html lang="de">/);
  assert.match(done.html, /DATEV-Anmeldung abgeschlossen/);
  assert.doesNotMatch(done.html, /login complete|close this tab/i);
  const bad = await visit(failed, "de");
  assert.match(bad.html, /DATEV-Anmeldung fehlgeschlagen/);
  assert.match(bad.html, /datev-mcp login/);
  assert.doesNotMatch(bad.html, /answered|run the login/i);
  const wrong = await visit(mismatch, "de");
  assert.match(wrong.html, /Anmeldung nicht angenommen/);
});

test("the login command on the page never splits across lines", async () => {
  for (const lang of ["en", "de"] as const) {
    const { html } = await visit(`error=access_denied&state=${STATE}`, lang);
    assert.match(html, /<code>datev-mcp login<\/code>/, lang);
    assert.match(html, /code\{white-space:nowrap/, lang);
  }
});
