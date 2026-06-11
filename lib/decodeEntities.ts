/**
 * Robust HTML entity decoder for scraped text.
 *
 * Scraped og:description / titles frequently arrive with HTML entities, and
 * some sources double-encode them (e.g. `&amp;#x27;` which a browser renders as
 * the literal text `&#x27;`). The decoder handles named, decimal, and hex
 * numeric entities, and loops until the string is fully stable so double- (or
 * triple-) encoded sequences collapse to their plain characters.
 */

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  copy: "©",
  reg: "®",
  trade: "™",
  deg: "°",
  middot: "·",
  bull: "•",
  eacute: "é",
  egrave: "è",
  agrave: "à",
  ccedil: "ç",
  uuml: "ü",
  ouml: "ö",
  auml: "ä",
  ntilde: "ñ",
};

function decodePass(input: string): string {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, body: string) => {
    if (body[0] === "#") {
      const isHex = body[1] === "x" || body[1] === "X";
      const code = parseInt(body.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      if (Number.isNaN(code) || code < 0 || code > 0x10ffff) return match;
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    const named = NAMED[body] ?? NAMED[body.toLowerCase()];
    return named ?? match;
  });
}

/**
 * Fully decode HTML entities, including double-encoded sequences. Also
 * normalizes whitespace runs to single spaces and trims.
 */
export function decodeHtmlEntities(input: string): string {
  let out = input;
  // Loop to collapse double/triple encoding; bail after a few passes.
  for (let i = 0; i < 4; i++) {
    const next = decodePass(out);
    if (next === out) break;
    out = next;
  }
  return out.replace(/\s+/g, " ").trim();
}
