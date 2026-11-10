import { test } from "node:test";
import assert from "node:assert/strict";
import { hideClientId, hideClientValues } from "../../src/api/client-gate.js";

// Guards for the R15 review of client id hiding: escapes that swallow id digits, an escaped authority.
const ID = "455148-1";
const GUID = "8f3c2a10-1b2c-4d5e-9f00-112233445566";

test("an id whose first two digits read as a percent escape is still hidden", () => {
  assert.equal(hideClientId(`https://x/a?n=%${ID}`, [ID]), "https://x/a?n=%{client}");
  assert.equal(hideClientId(`https://x/a?n=%25${ID}`, [ID]), "https://x/a?n=%25{client}");
  const sent = `https://x/a?${new URLSearchParams({ n: `%${ID}` })}`;
  assert.equal(hideClientId(sent, [ID]), "https://x/a?n=%25{client}");
});

test("query and header values hide an id behind a stray percent sign", () => {
  assert.deepEqual(hideClientValues({ n: `%${ID}`, m: `%25${ID}`, k: [`x%${ID}`] }, [ID]), { n: "%{client}", m: "%25{client}", k: ["x%{client}"] });
});

test("an escaped slash ends the host, so the id after it is hidden", () => {
  assert.equal(hideClientId(`https://api.datev.de%2Fclients%2F${ID}`, [ID]), "https://api.datev.de%2Fclients%2F{client}");
  assert.equal(hideClientId(`https://api.datev.de%2F${ID}?x=1`, [ID]), "https://api.datev.de%2F{client}?x=1");
  assert.equal(hideClientId(`https://api.datev.de:443/clients/${ID}`, [ID]), "https://api.datev.de:443/clients/{client}");
});

test("an id after a word and a dash is the id, as in a DATEV path; after a digit and a dash it is not", () => {
  assert.equal(hideClientId(`https://x/a/batch-${ID}`, [ID]), "https://x/a/batch-{client}");
  assert.equal(hideClientId(`https://x/a/7-${ID}`, [ID]), `https://x/a/7-${ID}`);
});

// Deterministic generator from a fixed start number, no clock.
function rng(start: number) {
  let a = start >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const esc = (ch: string) => `%${ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`;
const decode = (s: string) => s.replace(/%([0-9A-Fa-f]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
const pick = <T,>(r: () => number, xs: readonly T[]) => xs[Math.trunc(r() * xs.length)]!;

function encodeId(r: () => number, id: string): { text: string; mixed: boolean } {
  const mode = pick(r, ["raw", "once", "twice", "partial"] as const);
  const text = [...id]
    .map((ch) => {
      const m = mode === "partial" ? pick(r, ["raw", "once", "twice"] as const) : mode;
      return m === "raw" ? ch : m === "once" ? esc(ch) : [...esc(ch)].map(esc).join("");
    })
    .join("");
  return { text, mixed: mode === "partial" };
}

const lit = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const SAFE = ["clients", "a", "docs", "jobs", "%20", "%25ZZ", "a+b", "~v", "é", "\u{1F600}", "x.y"];
const SEP = ["/", "=", "&", "%2F", "%252F", ";", ",", "%25", "%20"];
const DECOYS = ["1455148-1", "455148-10", "x455148-1_"];

test("property: the id never shows in any reading and every other byte stays as sent", () => {
  for (let run = 1; run <= 400; run++) {
    const r = rng(run);
    const id = run % 3 === 0 ? GUID : ID;
    const parts: { text: string; isId: boolean; mixed?: boolean }[] = [];
    for (const zone of ["/", "?", "#"]) {
      parts.push({ text: zone, isId: false });
      const n = 1 + Math.trunc(r() * 5);
      for (let i = 0; i < n; i++) {
        const k = r();
        const coded = k < 0.35 ? encodeId(r, id) : undefined;
        const text = coded ? coded.text : k < 0.5 ? pick(r, DECOYS) : pick(r, SAFE);
        const sep = pick(r, SEP);
        // A following "%25" can merge into one escape with the next token, so that id may stay if no reading forms it.
        parts.push({ text, isId: k < 0.35, mixed: coded?.mixed || sep === "%25" }, { text: sep, isId: false });
      }
    }
    const url = `https://api.datev.de${parts.map((p) => p.text).join("")}`;
    const out = hideClientId(url, [id]);
    // Other parts stay byte for byte; an id at one escape level is replaced, a mixed one when a reading forms it.
    const expected = parts.map((p) => (!p.isId ? lit(p.text) : p.mixed ? `(?:${lit("{client}")}|${lit(p.text)})` : lit("{client}"))).join("");
    assert.match(out, new RegExp(`^${lit("https://api.datev.de")}${expected}$`), `run ${run}: ${url}`);
    const own = new RegExp(`(?<![A-Za-z0-9_])(?<![0-9]-)${id}(?![A-Za-z0-9_-])`, "i");
    for (const reading of [out, decode(out), decode(decode(out))]) assert.ok(!own.test(reading), `run ${run}: ${reading}`);
    for (const d of DECOYS) if (url.includes(d)) assert.ok(out.includes(d), `run ${run}: decoy ${d} kept`);
  }
});
