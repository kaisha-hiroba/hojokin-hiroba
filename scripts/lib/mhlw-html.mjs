// 厚生労働省サイトのHTMLを「見出し・段落・箇条書き・表」のブロック列に変換する簡易パーサ(依存なし)。
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ensp: " ", emsp: " " };
const decode = (s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") { const c = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); try { return String.fromCodePoint(c); } catch { return ""; } }
    return ENT[e.toLowerCase()] ?? m;
  });

const clean = (s) =>
  s.replace(/[​﻿]/g, "").replace(/[ \t\r\n　]+/g, " ").replace(/\s*\[\s*\]\([^)]*\)\s*/g, " ").trim();

export const absUrl = (href, base) => {
  try {
    const u = new URL(href, base);
    return /^https?:$/.test(u.protocol) ? u.href : null;
  } catch { return null; }
};

export function pageTitle(html) {
  const m = /<title>([^<]*)<\/title>/i.exec(html);
  return m ? clean(decode(m[1])).replace(/[｜|]\s*厚生労働省\s*$/, "") : "";
}

export function extractMain(html) {
  const s = html.search(/<main\b/i);
  const e = html.search(/<\/main>/i);
  return s >= 0 && e > s ? html.slice(s, e) : html;
}

// 戻り値: [{t:'h',l,x} | {t:'p',x} | {t:'li',x} | {t:'table',rows:[[{x,h}]]}]  x内のリンクは [文字](URL) 形式
export function parseBlocks(htmlIn, base) {
  const html = extractMain(htmlIn).replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, "");
  const out = [];
  let buf = "", href = null, linkText = "", inLi = 0, table = null, row = null, cell = null, head = 0;
  const push = (b) => out.push(b);
  const flush = () => {
    const x = clean(buf); buf = "";
    if (!x) return;
    if (cell) { cell.x += (cell.x ? " " : "") + x; return; }
    if (head) { push({ t: "h", l: head, x }); return; }
    push(inLi ? { t: "li", x } : { t: "p", x });
  };
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>|([^<]+)/g;
  let m;
  while ((m = re.exec(html))) {
    if (m[4] !== undefined) { const t = decode(m[4]); buf += t; if (href) linkText += t; continue; }
    const close = !!m[1], tag = m[2].toLowerCase(), attrs = m[3];
    if (tag === "a") {
      if (!close) { const h = /href\s*=\s*"([^"]*)"/i.exec(attrs); const u = h && !h[1].startsWith("#") ? absUrl(decode(h[1]), base) : null; if (u) { href = u; linkText = ""; buf += "\u0001"; } }
      else if (href) {
        const lt = clean(linkText); const i = buf.lastIndexOf("\u0001");
        if (i >= 0) buf = lt ? buf.slice(0, i) + `[${lt.replace(/[\[\]]/g, "")}](${href})` : buf.slice(0, i);
        href = null; linkText = "";
      }
      continue;
    }
    if (tag === "img") { const a = /alt\s*=\s*"([^"]*)"/i.exec(attrs); if (a && clean(decode(a[1]))) buf += ` ${decode(a[1])} `; continue; }
    if (tag === "br") { buf += " "; continue; }
    if (/^h[1-6]$/.test(tag)) { flush(); head = close ? 0 : +tag[1]; continue; }
    if (tag === "table") { flush(); if (!close) table = { t: "table", rows: [] }; else if (table) { if (table.rows.length) push(table); table = null; } continue; }
    if (tag === "tr") { flush(); if (!close) row = []; else if (row && table) { if (row.length) table.rows.push(row); row = null; } continue; }
    if (tag === "td" || tag === "th") { if (!close) { flush(); cell = { x: "", h: tag === "th" }; } else if (cell) { flush(); if (row) row.push(cell); cell = null; } continue; }
    if (tag === "li") { flush(); if (!close) inLi++; else inLi = Math.max(0, inLi - 1); continue; }
    if (["p", "div", "ul", "ol", "dl", "dt", "dd", "section", "article", "header", "footer", "aside", "nav", "figure", "figcaption", "caption", "blockquote", "tbody", "thead"].includes(tag)) { flush(); continue; }
  }
  flush();
  // ノイズ除去: 目次(ページ内リンクのみのli)・「ページの先頭へ戻る」・Adobe Reader案内
  return out.filter((b) => !(b.x && /^(ページの先頭へ戻る|PDFファイルを見るためには)/.test(b.x.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1"))));
}
