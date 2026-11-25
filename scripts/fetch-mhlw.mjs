// 厚生労働省「各種助成金・奨励金等の制度」とその下層ページを取得し、data/mhlw.json に保存する。
// 使い方: node scripts/fetch-mhlw.mjs
// 構成: ①入口(joseikin_shoureikin) ②雇用関係助成金一覧(カテゴリ別コース) ③労働条件等関係助成金 ④各コース・共通ページの本文
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { parseBlocks, pageTitle, absUrl } from "./lib/mhlw-html.mjs";

// --soft: 取得に失敗しても異常終了せず、前回の data/mhlw.json をそのまま使う(毎朝の自動更新を止めないため)
if (process.argv.includes("--soft")) process.on("uncaughtException", (e) => { console.warn(`厚労省データの取得に失敗したため、前回のデータを使います: ${e.message}`); process.exit(0); });

const OUT = new URL("../data/mhlw.json", import.meta.url);
const ROOT = "https://www.mhlw.go.jp";
const HUB = `${ROOT}/seisakunitsuite/joseikin_shoureikin/index.html`;
const KYUFUKIN = `${ROOT}/stf/seisakunitsuite/bunya/koyou_roudou/koyou/kyufukin`;
const LIST_URL = `${KYUFUKIN}/index_00057.html`;
const ROUDOU_URL = `${ROOT}/stf/seisakunitsuite/bunya/koyou_roudou/roudoukijun/zigyonushi/index_00051.html`;

// 共通・案内ページ(コース一覧には現れないが、申請の前提になる情報)
const COMMON = [
  ["common-requirements", `${KYUFUKIN}/index_00018.html`, "申請にあたって(共通の要件・申請方法)"],
  ["contact", `${KYUFUKIN}/toiawase2.html`, "お問い合わせ先・申請先"],
  ["fraud", `${KYUFUKIN}/index_00061.html`, "不正受給について"],
  ["e-application", `${KYUFUKIN}/index_00060.html`, "電子申請"],
  ["agencies", `${KYUFUKIN}/joseijigyousya.html`, "雇用関係助成金を取り扱う職業紹介事業者等"],
  ["guidelines", `${KYUFUKIN}/index_00026.html`, "雇用関係助成金支給要領"],
  ["pamphlets", `${KYUFUKIN}/000763045.html`, "雇用関係助成金パンフレット"],
  ["search-tool", `${KYUFUKIN}/index_00007.html`, "雇用関係助成金検索ツール"],
  ["abolished", `${KYUFUKIN}/haishi.html`, "廃止済みで経過措置中の助成金一覧"],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getText(url, tries = 4) {
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (hojokin-hiroba static site builder)" }, signal: AbortSignal.timeout(30000), redirect: "follow" });
      if (res.status === 404) return { status: 404, html: "", url: res.url };
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = new Uint8Array(await res.arrayBuffer());
      let cs = /charset=([\w-]+)/i.exec(res.headers.get("content-type") ?? "")?.[1];
      if (!cs) cs = /<meta[^>]*charset=["']?([\w-]+)/i.exec(new TextDecoder("latin1").decode(buf.slice(0, 3000)))?.[1];
      let html; try { html = new TextDecoder(cs || "utf-8").decode(buf); } catch { html = new TextDecoder("utf-8").decode(buf); }
      return { status: 200, html, url: res.url };
    } catch (e) {
      if (i === tries) throw new Error(`${url}: ${e.message}`);
      await sleep(1500 * i);
    }
  }
}
async function pool(items, size, fn) {
  const out = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: size }, async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); await sleep(150); } }));
  return out;
}

const LINK_RE = /\[([^\]]*)\]\(([^)]*)\)/g;
const plain = (x) => x.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").trim();
const linkOf = (x) => { const m = /^\[([^\]]*)\]\(([^)]*)\)\s*(.*)$/.exec(x.trim()); return m ? { name: m[1].trim(), url: m[2], rest: m[3].trim() } : null; };
const normUrl = (u) => u.replace(/#.*$/, "");
const mhlwHtml = (u) => /^https:\/\/www\.mhlw\.go\.jp\/.*\.html?$/i.test(u) || /^https:\/\/www\.mhlw\.go\.jp\/.*\/$/.test(u);

// ---- ② 雇用関係助成金一覧 → カテゴリ別コース ----
const JEED = "（独）高齢・障害・求職者雇用支援機構";
const splitOrg = (name) => (name.includes(JEED) ? { name: name.replace(`（${JEED}）`, "").replace(JEED, "").replace(/\s+/g, " ").trim(), org: "JEED" } : { name: name.replace(/\s+/g, " ").trim(), org: "" });
const isFooter = (b) => b.t === "h" && /^政策について/.test(plain(b.x));
function parseCatalog(blocks) {
  const cats = []; let cat = null, cur = null;
  const startIdx = blocks.findIndex((b) => b.t === "h" && b.l === 2 && /助成金の申請にあたって/.test(b.x));
  for (const b of blocks.slice(startIdx + 1)) {
    if (isFooter(b)) break;
    if (b.t === "h" && b.l === 2) {
      const m = /^([0-9０-９]+)[．.]\s*(.+)$/.exec(b.x);
      cat = m ? { no: +m[1].normalize("NFKC"), name: m[2], courses: [], note: "" } : null; if (cat) cats.push(cat); cur = null; continue;
    }
    if (!cat || b.t === "table") continue;
    const links = [...b.x.matchAll(LINK_RE)];
    const first = linkOf(b.x);
    if (first && links.length >= 1 && (b.t === "p" || b.t === "li")) {
      const rest = b.x.replace(LINK_RE, "").trim();
      const entries = links.map((m) => ({ ...splitOrg(m[1]), url: normUrl(m[2]) }));
      if (entries.length > 1 || (cur && !cur.summary && /職場適応援助者/.test(entries[0].name) && /職場適応援助者/.test(cur.name))) {
        // 1つのコースが複数リンク(訪問型/企業在籍型)で並ぶ場合: 先頭を本体、残りを alt に
        if (cur && !cur.summary && entries.length === 1) { cur.alt = [...(cur.alt ?? []), entries[0]]; continue; }
        cur = { ...entries[0], summary: rest, alt: entries.slice(1) }; cat.courses.push(cur); continue;
      }
      cur = { ...entries[0], summary: rest }; cat.courses.push(cur);
    } else if (cur && !cur.summary && !first) cur.summary = plain(b.x);
    else if (!cur && !first) cat.note += (cat.note ? " " : "") + plain(b.x);
  }
  return cats.filter((c) => c.courses.length);
}

// ---- ③ 入口ページ: 事業主/事業主団体/労働者向けの制度群 ----
function parseHub(blocks) {
  const groups = [];
  for (const b of blocks) {
    if (isFooter(b)) break;
    const ls = [...b.x.matchAll(LINK_RE)];
    if (b.t === "h") {
      if (ls.length) for (const m of ls) groups.push({ name: m[1].replace(/\s+/g, " ").trim(), url: normUrl(m[2]), items: [] });
      else groups.push({ name: plain(b.x), url: "", items: [] });
    } else if (ls.length && groups.length) { const o = splitOrg(ls[0][1].replace(/\s+/g, " ")); groups.at(-1).items.push({ ...o, url: normUrl(ls[0][2]) }); }
    else if (b.x && groups.length && /^※/.test(b.x)) groups.at(-1).note = plain(b.x);
  }
  return groups.filter((g) => g.url || g.items.length);
}
// 労働条件等関係助成金の案内ページ: 「N．制度名」見出しの下に 説明文→リンク が続く
function parseRoudou(blocks) {
  const groups = []; let g = null, desc = "";
  for (const b of blocks) {
    if (isFooter(b)) break;
    if (b.t === "h" && /^[0-9０-９]+[．.]/.test(b.x)) { g = { name: b.x.replace(/^[0-9０-９]+[．.]\s*/, ""), items: [] }; groups.push(g); desc = ""; continue; }
    if (!g || b.t === "li" || b.t === "table") continue;
    const l = linkOf(b.x);
    if (l && !/\.pdf$/i.test(l.url) && !/^[０-９0-9]+[．.]/.test(l.name)) { g.items.push({ ...splitOrg(l.name), url: normUrl(l.url), summary: desc }); desc = ""; }
    else if (!l && b.t === "p") desc = plain(b.x);
  }
  return groups.filter((x) => x.items.length);
}

const bodyBlocks = (blocks) => {
  const i = blocks.findIndex((b) => b.t === "h" && b.l === 1);
  const body = i >= 0 ? blocks.slice(i + 1) : blocks;
  // 末尾のサイドバー「政策について」、旧テンプレートの末尾パンくず([ホーム] > …)以降は本文ではない
  const f = body.findIndex((b, k) => isFooter(b) || (k > 0 && b.t === "p" && /^\[ホーム\]\(/.test(b.x)));
  return (f >= 0 ? body.slice(0, f) : body).filter((b) => b.t === "table" || b.x);
};

async function fetchPage(url) {
  const r = await getText(url);
  if (r.status === 404) return null;
  const title = pageTitle(r.html);
  if (/お探しのページが見つかりません/.test(title) || /404 Not Found/.test(title)) return null;
  const blocks = parseBlocks(r.html, r.url);
  const h1 = blocks.find((b) => b.t === "h" && b.l === 1);
  return { url, finalUrl: r.url, title: (h1 ? plain(h1.x).replace(/^雇用・労働/, "") : title) || title, htmlTitle: title, blocks: bodyBlocks(blocks) };
}

const prev = await readFile(OUT, "utf8").then(JSON.parse).catch(() => null);

console.log("入口・一覧を取得…");
const hub = await fetchPage(HUB);
const list = await fetchPage(LIST_URL);
if (!list) throw new Error("雇用関係助成金一覧が取得できません");
const catalog = parseCatalog(parseBlocks((await getText(LIST_URL)).html, LIST_URL));
const nCourses = catalog.reduce((n, c) => n + c.courses.length, 0);
console.log(`カテゴリ${catalog.length} / コース${nCourses}`);
if (nCourses < 40) throw new Error(`コース数が少なすぎます(${nCourses})。ページ構造が変わった可能性があります。`);
if (prev && prev.catalog && nCourses < prev.catalog.reduce((n, c) => n + c.courses.length, 0) * 0.7) throw new Error("コース数が前回より大幅に減りました。保存を中止します。");
const hubGroups = parseHub(hub.blocks);
const roudou = await fetchPage(ROUDOU_URL);
const roudouGroups = roudou ? parseRoudou(roudou.blocks) : [];
console.log(`入口の制度群${hubGroups.length} / 労働条件等${roudouGroups.length}群 ${roudouGroups.reduce((n, g) => n + g.items.length, 0)}制度`);

// ---- ④ 本文を持つページを全て取得(コースの詳細 + 共通ページ + 入口のリンク先) ----
const targets = new Map(); // url -> {slug?, kind}
const add = (url, info) => { const u = normUrl(absUrl(url, ROOT) ?? ""); if (u && mhlwHtml(u) && !targets.has(u)) targets.set(u, info); };
for (const [slug, url, title] of COMMON) add(url, { slug, kind: "common", title });
add(ROUDOU_URL, { slug: "roudou-kijun", kind: "common", title: "事業主に対する労働条件等関係助成金のご案内" });
for (const c of catalog) for (const co of c.courses) { add(co.url, { kind: "course" }); for (const a of co.alt ?? []) add(a.url, { kind: "course" }); }
for (const g of hubGroups) { if (g.url) add(g.url, { kind: "hub" }); for (const i of g.items) add(i.url, { kind: "hub" }); }
for (const g of roudouGroups) for (const i of g.items) add(i.url, { kind: "roudou" });

console.log(`本文取得: ${targets.size}ページ`);
const pages = {};
const urls = [...targets.keys()];
await pool(urls, 3, async (u) => {
  try {
    const p = await fetchPage(u);
    if (!p) { console.warn(`  取得不可/404: ${u}`); return; }
    pages[u] = { ...targets.get(u), title: p.title, finalUrl: p.finalUrl, blocks: p.blocks };
  } catch (e) {
    console.warn(`  失敗: ${e.message}`);
    const old = prev?.pages?.[u]; if (old) { pages[u] = old; console.warn("  → 前回の内容で補完"); }
  }
});

// 取得失敗が多い場合は異常とみなす
if (Object.keys(pages).length < urls.length * 0.7) throw new Error("本文の取得失敗が多すぎます。保存を中止しました。");

await mkdir(new URL("../data/", import.meta.url), { recursive: true });
await writeFile(OUT, JSON.stringify({ fetchedAt: new Date().toISOString(), source: HUB, hub: { title: hub.title, blocks: hub.blocks.filter((b) => !isFooter(b)).slice(0, 0) }, hubGroups, catalog, roudouGroups, pages }, null, 1));
console.log(`保存: data/mhlw.json (ページ${Object.keys(pages).length})`);
