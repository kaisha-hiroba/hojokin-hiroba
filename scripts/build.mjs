// data/subsidies.json + data/overrides.json + src/ から静的サイトを dist/ に生成する。
// 使い方: node scripts/build.mjs
import { readFile, writeFile, mkdir, rm, readdir, copyFile } from "node:fs/promises";
import { loadJoseikin } from "./lib/joseikin.mjs";

// 出力先は既定で dist/。検査などで別の場所に出したいときは環境変数 DIST_DIR で指定する(例: DIST_DIR=/tmp/site-test)
const DIST = process.env.DIST_DIR ? new URL(`file:///${process.env.DIST_DIR.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/?$/, "/")}`) : new URL("../dist/", import.meta.url);
const SRC = new URL("../src/", import.meta.url);
const raw = JSON.parse(await readFile(new URL("../data/subsidies.json", import.meta.url), "utf8"));
const overrides = JSON.parse(await readFile(new URL("../data/overrides.json", import.meta.url), "utf8"));
const J = await loadJoseikin(); // 厚生労働省の助成金(data/mhlw.json)。無ければ null

// ---------- 日付ユーティリティ (JSTの暦日 "YYYY-MM-DD") ----------
const toJstDate = (iso) => (iso ? new Date(new Date(iso).getTime() + 9 * 3600e3).toISOString().slice(0, 10) : null);
const todayJst = toJstDate(new Date().toISOString());
const ym = (d) => d.slice(0, 7);
const addMonths = (s, n) => { const [y, m] = s.split("-").map(Number); const t = y * 12 + (m - 1) + n; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`; };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmtDate = (d) => { const [y, m, dd] = d.split("-"); return `${y}年${+m}月${+dd}日`; };
const yen = (n) => { if (!n) return "—"; if (n >= 1e8) return `${+(n / 1e8).toFixed(4)}億円`; if (n >= 1e4) { const v = n / 1e4; return `${(Number.isInteger(v) ? v : +v.toFixed(2)).toLocaleString("ja-JP")}万円`; } return `${n.toLocaleString("ja-JP")}円`; };
const daysFrom = (d) => Math.round((Date.parse(d) - Date.parse(todayJst)) / 86400000);
const addYears = (d, n) => `${+d.slice(0, 4) + n}${d.slice(4)}`;
const isDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(v).toISOString().slice(0, 10) === v;

// ---------- 分類マスタ ----------
const REGIONS = [
  ["北海道・東北", [["北海道", "hokkaido"], ["青森県", "aomori"], ["岩手県", "iwate"], ["宮城県", "miyagi"], ["秋田県", "akita"], ["山形県", "yamagata"], ["福島県", "fukushima"]]],
  ["関東", [["茨城県", "ibaraki"], ["栃木県", "tochigi"], ["群馬県", "gunma"], ["埼玉県", "saitama"], ["千葉県", "chiba"], ["東京都", "tokyo"], ["神奈川県", "kanagawa"]]],
  ["中部", [["新潟県", "niigata"], ["富山県", "toyama"], ["石川県", "ishikawa"], ["福井県", "fukui"], ["山梨県", "yamanashi"], ["長野県", "nagano"], ["岐阜県", "gifu"], ["静岡県", "shizuoka"], ["愛知県", "aichi"]]],
  ["近畿", [["三重県", "mie"], ["滋賀県", "shiga"], ["京都府", "kyoto"], ["大阪府", "osaka"], ["兵庫県", "hyogo"], ["奈良県", "nara"], ["和歌山県", "wakayama"]]],
  ["中国・四国", [["鳥取県", "tottori"], ["島根県", "shimane"], ["岡山県", "okayama"], ["広島県", "hiroshima"], ["山口県", "yamaguchi"], ["徳島県", "tokushima"], ["香川県", "kagawa"], ["愛媛県", "ehime"], ["高知県", "kochi"]]],
  ["九州・沖縄", [["福岡県", "fukuoka"], ["佐賀県", "saga"], ["長崎県", "nagasaki"], ["熊本県", "kumamoto"], ["大分県", "oita"], ["宮崎県", "miyazaki"], ["鹿児島県", "kagoshima"], ["沖縄県", "okinawa"]]],
].map(([name, p]) => ({ name, prefs: p.map((x) => x[0]), slugs: p.map((x) => x[1]) }));
const PREFS = REGIONS.flatMap((r) => r.prefs);
const PREF_SLUG = Object.fromEntries(REGIONS.flatMap((r) => r.prefs.map((p, i) => [p, r.slugs[i]])));

const PURPOSE_SLUG = {
  "設備整備・IT導入をしたい": "equipment-it", "新たな事業を行いたい": "new-business", "エコ・SDGs活動支援がほしい": "eco-sdgs",
  "雇用・職場環境を改善したい": "employment", "販路拡大・海外展開をしたい": "sales-overseas", "安全・防災対策支援がほしい": "safety-disaster",
  "資金繰りを改善したい": "cashflow", "人材育成を行いたい": "training", "まちづくり・地域振興支援がほしい": "community",
  "イベント・事業運営支援がほしい": "event", "研究開発・実証事業を行いたい": "rd", "災害（自然災害、感染症等）支援がほしい": "disaster-relief",
  "事業を引き継ぎたい": "succession", "教育・子育て・少子化支援がほしい": "education", "スポーツ・文化支援がほしい": "culture",
};
const INDUSTRY_ORDER = ["農業、林業", "漁業", "鉱業、採石業、砂利採取業", "建設業", "製造業", "電気・ガス・熱供給・水道業", "情報通信業", "運輸業、郵便業", "卸売業、小売業", "金融業、保険業", "不動産業、物品賃貸業", "学術研究、専門・技術サービス業", "宿泊業、飲食サービス業", "生活関連サービス業、娯楽業", "教育、学習支援業", "医療、福祉", "複合サービス事業", "サービス業（他に分類されないもの）", "公務（他に分類されるものを除く）", "分類不能の産業"];
const INDUSTRY_SLUG = Object.fromEntries(INDUSTRY_ORDER.map((n, i) => [n, `i${String(i + 1).padStart(2, "0")}`]));

// ---------- 手入力データの検証 ----------
const knownIds = new Set(raw.items.map((s) => s.id));
for (const [id, o] of Object.entries(overrides)) {
  if (id.startsWith("_")) continue;
  if (!knownIds.has(id)) console.warn(`overrides: ${id} は公募中の一覧にありません(終了済み?)`);
  for (const k of ["reportDeadline", "paymentDeadline"]) if (o[k] != null && !isDate(o[k])) { console.error(`overrides: ${id}.${k} の日付形式が不正です: ${o[k]}`); process.exit(1); }
}
const safeUrl = (u, id) => (/^https:\/\//.test(u ?? "") ? u : `https://www.jgrants-portal.go.jp/subsidy/${id}`);

// ---------- データモデル ----------
const splitList = (s) => String(s ?? "").split(/\s\/\s/).map((x) => x.trim()).filter(Boolean);
const toModel = (s) => {
  const o = s.id.startsWith("_") ? {} : overrides[s.id] ?? {};
  const deadline = toJstDate(s.end);
  let projectEnd = s.projectEnd ? toJstDate(s.projectEnd) : null;
  if (projectEnd && deadline && (projectEnd < deadline || projectEnd > addYears(deadline, 10))) projectEnd = null;
  const prefs = PREFS.filter((p) => s.area.includes(p));
  const national = s.area.includes("全国") || prefs.length >= 40;
  const purposes = splitList(s.purpose);
  const inds = splitList(s.industry).filter((x) => INDUSTRY_SLUG[x]);
  const m = /(\d+)名以下/.exec(s.employees), n = /(\d+)名以上/.exec(s.employees);
  return {
    ...s, slug: s.id.toLowerCase(), url: safeUrl(s.url, s.id), prefs, national, purposes, inds, indAll: inds.length >= 18,
    emax: m ? +m[1] : null, emin: n ? +n[1] : null, areaOther: !national && !prefs.length ? s.area : "",
    dates: { start: toJstDate(s.start), deadline, projectEnd, report: o.reportDeadline ?? null, payment: o.paymentDeadline ?? null },
    manualSource: o.source ?? null,
  };
};
const active = raw.items.map(toModel).filter((s) => s.dates.deadline && s.dates.deadline >= todayJst).map((s) => ({ ...s, status: "open" }));
// 受付終了・公募予定(data/archive.json があれば)
let archiveRaw = { items: [] };
try { archiveRaw = JSON.parse(await readFile(new URL("../data/archive.json", import.meta.url), "utf8")); } catch { console.warn("data/archive.json がありません(過去の公募なしで生成します)"); }
const activeIds = new Set(active.map((s) => s.id));
const upcoming = [], closed = [];
for (const r of archiveRaw.items) {
  if (activeIds.has(r.id) || !r.end) continue;
  const m = toModel({ ...r, id: r.id });
  const { start, deadline } = m.dates;
  if (!deadline || deadline.slice(0, 4) > "2100") continue;
  if (start && start > todayJst && deadline >= start) upcoming.push({ ...m, status: "upcoming" });
  else if (deadline < todayJst) closed.push({ ...m, status: "closed" });
}
// タイトルから年度・回数・括弧書きを除いた比較用キー(公募履歴・重複判定に使う)
const seriesKey = (t) => t.normalize("NFKC")
  .replace(/【([^】]*)】|\[([^\]]*)\]|\(([^)]*)\)/g, (m, a, b, c) => (/[0-9]|年度|次|回|期|募集|公募|受付|追加|予定|終了|締切|申請/.test(a ?? b ?? c ?? "") ? "" : m))
  .replace(/(令和|平成)\s*[0-9元]+\s*年度?/g, "").replace(/第\s*[0-9一二三四五六七八九十]+\s*[回次期]/g, "").replace(/[0-9]+\s*(次公募|年度|回)/g, "")
  .replace(/補正(予算)?|[\s・、,_~～-]/g, "");

// ---------- 自治体・都道府県・国の制度(サイタくん公開データ / CDLA-Permissive-2.0) ----------
let saitaRaw = { items: [] };
try { saitaRaw = JSON.parse(await readFile(new URL("../data/saita.json", import.meta.url), "utf8")); } catch { console.warn("data/saita.json がありません(自治体データなしで生成します)"); }
const PREF_BY_ROMAJI = Object.fromEntries(Object.entries(PREF_SLUG).map(([k, v]) => [v, k]));
const SAITA_PURPOSE = { capex: ["設備整備・IT導入をしたい"], it_intro: ["設備整備・IT導入をしたい"], rd: ["研究開発・実証事業を行いたい"], hr: ["雇用・職場環境を改善したい", "人材育成を行いたい"], market: ["販路拡大・海外展開をしたい"], startup: ["新たな事業を行いたい"], succession: ["事業を引き継ぎたい"] };
const SAITA_INDUSTRY = { it: ["情報通信業"], entertainment: ["生活関連サービス業、娯楽業"], professional: ["学術研究、専門・技術サービス業"], agriculture: ["農業、林業", "漁業"], construction: ["建設業"], wholesale: ["卸売業、小売業"], finance: ["金融業、保険業"], realestate: ["不動産業、物品賃貸業"], hospitality: ["宿泊業、飲食サービス業"], medical: ["医療、福祉"] };
const INDUSTRY_HINTS = [
  [/農業|農家|農林|林業|就農|営農|畜産|農産物|農地/, ["農業、林業"]], [/漁業|水産|漁協|漁船|養殖/, ["漁業"]],
  [/建設業|建築業|工務店|土木/, ["建設業"]], [/製造業|ものづくり|工場|製造/, ["製造業"]],
  [/宿泊|旅館|ホテル|飲食店|飲食業/, ["宿泊業、飲食サービス業"]], [/商店街|小売|卸売|商店/, ["卸売業、小売業"]],
  [/運送|運輸|タクシー|物流|トラック|バス事業/, ["運輸業、郵便業"]], [/医療機関|介護事業|福祉施設|保育所|病院|診療所|薬局/, ["医療、福祉"]],
  [/情報通信|ソフトウェア|IT企業|情報サービス業/, ["情報通信業"]], [/不動産業|宅建/, ["不動産業、物品賃貸業"]],
];
const SAITA_SCALE ={ any: ["従業員数の制約なし", null], sme: ["中小企業が対象", 300], small: ["小規模事業者が対象", 20] };
const LOAN_TITLE = /利子補給|利子補助|利子助成|利子補填|利子負担|融資|貸付|資金貸|信用保証|保証料|利率/;
const PERSONAL_RE = /奨学金|医療費|住宅|耐震|空き家|空家|移住|出産|育児|子ども|児童|高齢者|不妊|予防接種|健診|検診|通学|入学|就学|結婚|ブロック塀|墓地|ひとり親|介護予防/; // 個人・世帯向けと思われる題名
const BIZ_RE = /事業者|事業所|中小企業|企業|店舗|工務店|法人|団体|商店|創業|起業/;
const NON_GRANT = new Set(["loan", "credit_guarantee", "interest_subsidy", "tax", "equity", "crowdfunding"]); // 融資・保証・税制などは「補助金・助成金」ではないため除外
const RATE_FRAC = { 0.5: "1/2", 0.67: "2/3", 0.66: "2/3", 0.33: "1/3", 0.34: "1/3", 0.75: "3/4", 0.8: "4/5", 1: "10/10", 0.25: "1/4" };
const fmtRate = (v) => { if (v == null) return null; const x = +v > 1 ? +v / 100 : +v; if (x >= 0.995) return "全額(10/10)"; return RATE_FRAC[+x.toFixed(2)] ? `${RATE_FRAC[+x.toFixed(2)]}以内` : `${+(x * 100).toFixed(1)}%`; };
const cleanTitle = (r) => {
  const t = String(r.title ?? "").trim();
  if (t.length >= 6 && !/ホームページ$|^お知らせ$|^トップページ/.test(t)) return t;
  const head = t.split(/[／｜|]/)[0].trim();
  if (/ホームページ$/.test(t) && head.length >= 6 && !/ホームページ$|^お知らせ$|^トップページ/.test(head)) return head;
  const d = String(r.description ?? "").replace(/\s+/g, "").slice(0, 32);
  return `${r.municipality ?? ""}${d ? " " + d : t}`.trim() || "(名称未取得の制度)";
};
const fromSaita = (r) => {
  const prefs = (r.prefectures ?? []).map((p) => PREF_BY_ROMAJI[p] ?? (PREFS.includes(p) ? p : null)).filter(Boolean);
  const national = r.gov_level === "national" || (r.prefectures ?? []).some((p) => p === "national" || p === "全国");
  const purposes = [...new Set(r.flags.filter((f) => f.startsWith("purpose_")).flatMap((f) => SAITA_PURPOSE[f.slice(8)] ?? []))];
  const inds = [...new Set(r.flags.filter((f) => f.startsWith("category_")).flatMap((f) => SAITA_INDUSTRY[f.slice(9)] ?? []))];
  // 業種フラグが無い制度は、名称・概要の語句から推定する(誤って絞り込まないよう、明確な語だけを使う)
  if (PERSONAL_RE.test(r.title ?? "") && !BIZ_RE.test(r.title ?? "")) inds.length = 0;
  else if (!inds.length) {
    const text = `${r.title ?? ""} ${r.description ?? ""}`;
    for (const [re, names] of INDUSTRY_HINTS) if (re.test(text)) for (const n of names) if (!inds.includes(n)) inds.push(n);
  }
  const [empLabel, emax] = SAITA_SCALE[r.eligible_scale] ?? SAITA_SCALE.any;
  const http = /^https?:\/\//.test(r.detailed_url ?? "") ? r.detailed_url : null;
  const deadline = /^\d{4}-\d{2}-\d{2}$/.test(r.application_deadline ?? "") ? r.application_deadline : null;
  const start = /^\d{4}-\d{2}-\d{2}$/.test(r.acceptance_start ?? "") ? r.acceptance_start : null;
  const amount = r.maximum_amount ? +r.maximum_amount : null;
  return {
    id: `m${r.id}`, slug: `m${r.id}`, src: "saita", title: cleanTitle(r), desc: String(r.description ?? "").trim(), muni: r.municipality ?? "", level: r.gov_level,
    area: "", employees: empLabel, maxLimit: amount && amount > 0 ? amount : null, rate: fmtRate(r.subsidy_rate), purpose: "", industry: "", institution: r.institution_name ?? r.municipality ?? "",
    url: http ?? "", prefs: national ? [] : prefs, national, purposes, inds, indAll: inds.length === 0, emax, emin: null, areaOther: "",
    dates: { start, deadline, projectEnd: null, report: null, payment: null }, manualSource: null,
  };
};
const sameArea = (a, b) => (a.national && b.national) || (!a.national && !b.national && a.prefs.some((p) => b.prefs.includes(p)));
const jByKey = new Map();
for (const s of active) { const k = seriesKey(s.title); if (k.length >= 6) (jByKey.get(k) ?? jByKey.set(k, []).get(k)).push(s); }
let saitaDup = 0, saitaSkipped = 0;
for (const r of saitaRaw.items) {
  if (NON_GRANT.has(r.support_type) || LOAN_TITLE.test(r.title ?? "")) { saitaSkipped++; continue; }
  const m = fromSaita(r);
  if (!m.url || (m.dates.deadline && m.dates.deadline < todayJst)) { saitaSkipped++; continue; }
  if (m.level !== "municipal" && (jByKey.get(seriesKey(m.title)) ?? []).some((j) => sameArea(j, m))) { saitaDup++; continue; }
  if (m.dates.start && m.dates.start > todayJst) upcoming.push({ ...m, status: "upcoming" });
  else active.push({ ...m, status: "open" });
}
console.log(`自治体データ: 取り込み ${saitaRaw.items.length - saitaSkipped - saitaDup}件 / 除外(融資等・期限切れ) ${saitaSkipped}件 / jGrantsと重複 ${saitaDup}件`);

const subsidies = [...active, ...upcoming];
const allItems = [...subsidies, ...closed];
if (new Set(allItems.map((s) => s.slug)).size !== allItems.length) { console.error("slug 重複"); process.exit(1); }
const dlKey = (s) => s.dates.deadline ?? "9999-12-31";
closed.sort((a, b) => b.dates.deadline.localeCompare(a.dates.deadline));
subsidies.sort((a, b) => dlKey(a).localeCompare(dlKey(b)) || a.title.localeCompare(b.title, "ja"));

const purposeCount = {};
for (const s of subsidies) for (const p of s.purposes) purposeCount[p] = (purposeCount[p] || 0) + 1;
const purposeList = Object.keys(purposeCount).sort((a, b) => purposeCount[b] - purposeCount[a]);
for (const s of closed) for (const p of s.purposes) if (!(p in purposeCount)) { purposeCount[p] = 0; purposeList.push(p); }
const pslug = purposeList.map((p) => PURPOSE_SLUG[p] ?? `p${purposeList.indexOf(p) + 1}`);
const instCount = {};
for (const s of subsidies) if (s.institution && s.src !== "saita") instCount[s.institution] = (instCount[s.institution] || 0) + 1;
const SERIES = Object.entries(instCount).filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).slice(0, 18);

const TYPES = {
  start: { label: "公募開始", source: "jGrants" }, deadline: { label: "申請締切", source: "jGrants" },
  projectEnd: { label: "事業終了期限", source: "jGrants" }, report: { label: "実績報告期限", source: "公募要領(手入力)" }, payment: { label: "支給申請期限", source: "公募要領(手入力)" },
};
const events = [];
for (const s of subsidies) for (const [type, date] of Object.entries(s.dates)) if (date) events.push({ type, date, s });
events.sort((a, b) => a.date.localeCompare(b.date) || a.s.title.localeCompare(b.s.title, "ja"));
const first = addMonths(ym(todayJst), -1), last = addMonths(ym(todayJst), 18);
const months = []; for (let m = first; m <= last; m = addMonths(m, 1)) months.push(m);
const stats = {
  open: active.length, upcoming: upcoming.length, closed: closed.length, soon: subsidies.filter((s) => s.dates.deadline && daysFrom(s.dates.deadline) <= 30).length, municipal: new Set(subsidies.filter((s) => s.muni).map((s) => (s.prefs[0] ?? "") + s.muni)).size,
  fresh: subsidies.filter((s) => s.status === "open" && s.dates.start && daysFrom(s.dates.start) >= -30).length, national: subsidies.filter((s) => s.national).length,
};
const fetchedAtJst = new Date(new Date(raw.fetchedAt).getTime() + 9 * 3600e3).toISOString().replace("T", " ").slice(0, 16);

// ---------- 共通HTML ----------
const NAV = [["", "探す"], ["purpose/", "目的別"], ["area/", "地域別"], ["industry/", "業種別"], ["calendar/" + ym(todayJst) + "/", "カレンダー"], ...(J ? [["joseikin/", "厚労省の助成金"]] : []), ["guide/", "ガイド"]];
const page = ({ title, desc, body, root, nav = "", head = "", scripts = "" }) => `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(desc || "全国の補助金・助成金を、キーワード・目的・地域・業種・規模・上限額・締切から探せる検索サイト。")}">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='9' fill='%230e5a8a'/%3E%3Ctext x='16' y='23' font-size='20' text-anchor='middle' fill='white' font-family='sans-serif' font-weight='bold'%3E補%3C/text%3E%3C/svg%3E">
<link rel="stylesheet" href="${root}assets/style.css">${head}</head>
<body><header class="site-head"><div class="wrap"><a class="brand" href="${root}"><i>補</i>補助金・助成金のひろば</a>
<nav class="gnav" aria-label="グローバル">${NAV.map(([h, l]) => `<a href="${root}${h}"${nav === l ? ' aria-current="page"' : ""}>${l}</a>`).join("")}<a class="favlink" href="${root}#fav=1">★ 気になる<b data-n="0"></b></a></nav></div></header>
${body}
<footer class="foot"><div class="wrap"><div class="cols">
<div><h2>探し方</h2><ul><li><a href="${root}">キーワード・条件で探す</a></li><li><a href="${root}purpose/">目的から探す</a></li><li><a href="${root}area/">地域から探す</a></li><li><a href="${root}industry/">業種から探す</a></li><li><a href="${root}calendar/${ym(todayJst)}/">締切カレンダー</a></li></ul></div>
<div><h2>目的別(人気)</h2><ul>${purposeList.slice(0, 5).map((p, i) => `<li><a href="${root}purpose/${pslug[i]}/">${esc(p.replace(/をしたい|がほしい/, ""))}</a></li>`).join("")}</ul></div>
${J ? `<div><h2>厚労省の助成金</h2><ul>${J.footerLinks.map(([h, l]) => `<li><a href="${root}${h}">${esc(l)}</a></li>`).join("")}</ul></div>` : ""}
<div><h2>ガイド</h2><ul>${GUIDES.map((g) => `<li><a href="${root}guide/${g.slug}/">${esc(g.title)}</a></li>`).join("")}</ul></div>
<div><h2>カレンダー登録</h2><ul><li><a href="${root}deadline.ics">申請締切 (ICS)</a></li><li><a href="${root}all.ics">全日程 (ICS)</a></li></ul></div></div>
<p class="notice">データは<a href="https://www.jgrants-portal.go.jp/" rel="noopener">jGrants</a>(デジタル庁)の公開APIから ${esc(fetchedAtJst)}(JST) に取得しました。締切は変更・延長されることがあります。<strong>申請前に必ず各補助金の公式ページと公募要領で最新の日程・要件をご確認ください。</strong>「実績報告期限」「支給申請期限」は公募要領をもとに手入力した情報です。当サイトは公式の窓口ではありません。</p>
<p class="notice">市区町村・都道府県・国の制度の一部は、<a href="https://www.subsidy-support.tech/data" rel="noopener">サイタくん 補助金公開データフィード</a>(<a href="https://cdla.dev/permissive-2-0/" rel="noopener">CDLA-Permissive-2.0</a>)を利用しています。出典: サイタくん (www.subsidy-support.tech)。<a href="${root}licenses/saita-kun.txt">ライセンス・出典表示</a>。これらの掲載内容は自動収集のため、古い・不正確な場合があります。必ずリンク先の公式ページをご確認ください。</p></div></footer>
<script src="${root}assets/site.js"></script>${scripts}</body></html>`;

const areaBadge = (s) => (s.muni ? `<span class="badge area">${esc((s.prefs[0] ? s.prefs[0] + " " : "") + s.muni)}</span>` : s.national ? `<span class="badge nat">全国</span>` : s.prefs.length ? `<span class="badge area">${esc(s.prefs.length > 3 ? s.prefs.slice(0, 3).join("・") + `ほか${s.prefs.length - 3}` : s.prefs.join("・"))}</span>` : `<span class="badge area">${esc(s.areaOther || "地域指定")}</span>`);
const pillHtml = (s) => { if (s.status === "closed") return `<span class="pill long">受付終了</span>`; if (s.status === "upcoming") return `<span class="pill">${fmtDate(s.dates.start)} 公募開始予定</span>`; if (!s.dates.deadline) return `<span class="pill long">随時・要確認</span>`; const d = daysFrom(s.dates.deadline); return d > 365 ? `<span class="pill long">長期公募</span>` : `<span class="pill${d <= 7 ? " urgent" : d <= 30 ? " soon" : ""}">${d === 0 ? "締切は本日" : `あと${d}日`}</span>`; };
const isNew = (s) => s.status === "open" && s.dates.start && daysFrom(s.dates.start) >= -30;
const rateText = (s) => (s.rate && s.rate.length < 20 ? esc(s.rate) : s.rate ? "公募要領を確認" : "—");
function cardHtml(s, root) {
  const tags = s.purposes.slice(0, 3).map((p) => `<a class="tag" href="${root}purpose/${pslug[purposeList.indexOf(p)]}/">${esc(p)}</a>`).join("") + (s.purposes.length > 3 ? `<span class="tag">+${s.purposes.length - 3}</span>` : "");
  const dl = s.dates.deadline, long = dl && daysFrom(dl) > 365;
  return `<article class="card"${dl && s.status === "open" ? ` data-deadline="${dl}"` : ""}><div class="card-top">${areaBadge(s)}${isNew(s) ? `<span class="badge new">新着</span>` : ""}${pillHtml(s)}</div>
<h3><a href="${root}subsidy/${s.slug}/">${esc(s.title)}</a></h3>
<dl class="kv"><div><dt>上限額</dt><dd class="big">${yen(s.maxLimit)}</dd></div><div><dt>補助率</dt><dd>${rateText(s)}</dd></div><div><dt>申請締切</dt><dd>${!dl ? "随時・要確認" : long ? "随時(長期)" : fmtDate(dl)}</dd></div><div><dt>対象規模</dt><dd>${esc(s.employees)}</dd></div></dl>
${s.desc ? `<p class="desc">${esc(s.desc.slice(0, 70))}${s.desc.length > 70 ? "…" : ""}</p>` : ""}<div class="tags">${tags}</div>${s.institution && !s.muni ? `<p class="org">実施: ${esc(s.institution)}</p>` : ""}
<button class="fav" type="button" data-fav="${s.slug}" aria-pressed="false" aria-label="気になる: ${esc(s.title)}" title="気になるに追加">☆</button></article>`;
}
const crumbs = (root, trail) => `<div class="crumbs"><a href="${root}">トップ</a>${trail.map(([h, l]) => (h ? `<span><a href="${root}${h}">${esc(l)}</a></span>` : `<span>${esc(l)}</span>`)).join("")}</div>`;
const head = (root, trail, h1, p) => `<div class="page-head"><div class="wrap">${crumbs(root, trail)}<h1>${esc(h1)}</h1>${p ? `<p>${p}</p>` : ""}</div></div>`;
const searchLink = (root, q) => `${root}#${q}`;

const compact = (s) => ({ i: s.slug, t: s.title, a: s.prefs, an: s.national, p: s.purposes.map((x) => purposeList.indexOf(x)).filter((i) => i >= 0), d: s.indAll ? [] : s.inds.map((x) => INDUSTRY_ORDER.indexOf(x)), ia: s.indAll ? 1 : 0, e: s.employees, emin: s.emin, emax: s.emax, m: s.maxLimit || 0, r: s.rate, o: s.muni ? "" : s.institution, mu: s.muni || undefined, ds: s.desc ? s.desc.slice(0, 70) : undefined, s: s.dates.start, x: s.dates.deadline || "", ...(s.status === "upcoming" ? { u: 1 } : {}) });
// ---------- トップ(= 補助金を探すページ) ----------
function indexPage() {
  const pj = purposeList.map((p, i) => ({ p, i }));
  const tilesP = pj.map(({ p }) => `<button class="tile" type="button" data-pressed="purpose" data-v="${esc(p)}" aria-pressed="false"><span>${esc(p)}</span><small>${purposeCount[p]}</small></button>`).join("");
  const areaCount = (p) => subsidies.filter((s) => s.national || s.prefs.includes(p)).length;
  const tilesA = `<div class="regions">${REGIONS.map((r) => `<div class="region"><h4>${esc(r.name)}</h4><div class="tiles">${r.prefs.map((p) => `<button class="tile" type="button" data-pressed="area" data-v="${p}" aria-pressed="false"><span>${p}</span><small>${areaCount(p)}</small></button>`).join("")}</div></div>`).join("")}</div>`;
  const indCount = (n) => subsidies.filter((s) => s.indAll || s.inds.includes(n)).length;
  const tilesI = INDUSTRY_ORDER.map((n) => `<button class="tile" type="button" data-pressed="ind" data-v="${esc(n)}" aria-pressed="false"><span>${esc(n)}</span><small>${indCount(n)}</small></button>`).join("");
  const ap = (o, label, sub = "") => `<button class="tile" type="button" data-apply='${esc(JSON.stringify(o))}'><span>${label}${sub ? ` <em style="font-style:normal;color:var(--ink3);font-weight:400">${sub}</em>` : ""}</span></button>`;
  const base = { size: "", min: "", max: "", dl: "", isNew: false, rate: false };
  const tilesSize = [["5", "5名以下"], ["20", "6〜20名"], ["100", "21〜100名"], ["300", "101〜300名"], ["900", "301〜900名"], ["901", "901名以上"]].map(([v, l]) => ap({ ...base, size: v }, l)).join("");
  const tilesMoney = [["", "100", "〜100万円"], ["100", "500", "100〜500万円"], ["500", "1000", "500〜1,000万円"], ["1000", "10000", "1,000万〜1億円"], ["10000", "", "1億円以上"]].map(([a, b, l]) => ap({ ...base, min: a, max: b }, l)).join("");
  const tilesDl = [ap({ ...base, dl: "7" }, "7日以内に締切"), ap({ ...base, dl: "30" }, "30日以内に締切"), ap({ ...base, dl: "90" }, "90日以内に締切"), ap({ ...base, isNew: true }, "新着(30日以内に公募開始)"), ap({ ...base, dl: "long" }, "長期公募(1年超)"), ap({ ...base, rate: true }, "補助率が明記されている")].join("");
  const tilesSeries = SERIES.map(([n, c]) => `<button class="tile" type="button" data-apply='${esc(JSON.stringify({ q: n }))}'><span>${esc(n)}</span><small>${c}</small></button>`).join("");
  const hintsAll = ["IT導入", "省エネ", "創業", "賃上げ", "設備", "事業承継", "研究開発", "防災", "雇用", "海外"];
  const hints = hintsAll.filter((k) => subsidies.some((s) => `${s.title} ${s.purpose}`.includes(k) || (k === "IT導入" && s.purpose.includes("IT"))));
  const diag = `<div class="diag"><label>やりたいこと<select id="d-p"><option value="">指定しない</option>${purposeList.map((p) => `<option>${esc(p)}</option>`).join("")}</select></label>
<label>事業所のある地域<select id="d-a"><option value="">指定しない</option>${PREFS.map((p) => `<option>${p}</option>`).join("")}</select></label>
<label>従業員数<select id="d-s"><option value="">指定しない</option><option value="5">5名以下</option><option value="20">6〜20名</option><option value="100">21〜100名</option><option value="300">101〜300名</option><option value="900">301〜900名</option><option value="901">901名以上</option></select></label>
<button class="btn" type="button" id="diag-go">この条件で探す</button></div>`;
  const tabs = [["tp", "目的から", `<p class="hd">やりたいことから選びます。複数選択できます。</p><div class="tiles">${tilesP}</div>`],
    ["ta", "地域から", `<p class="hd">事業所のある都道府県を選びます。全国対象の制度も一緒に表示されます。</p>${tilesA}`],
    ["ti", "業種から", `<p class="hd">日本標準産業分類の大分類です。業種を問わない制度も含まれます。</p><div class="tiles">${tilesI}</div>`],
    ["ts", "規模・金額から", `<p class="hd">従業員数で探す</p><div class="tiles">${tilesSize}</div><p class="hd" style="margin-top:18px">上限額で探す</p><div class="tiles">${tilesMoney}</div>`],
    ["td", "締切・新着から", `<div class="tiles">${tilesDl}</div><p class="hd" style="margin-top:18px">日付で見たい方は<a href="calendar/${ym(todayJst)}/">締切カレンダー</a>へ。</p>`],
    ["tr", "制度・実施機関から", `<p class="hd">複数回の公募がある制度や、実施機関ごとにまとめて探します。</p><div class="tiles">${tilesSeries}</div>`],
    ["tg", "かんたん診断", `<p class="hd">3つの質問に答えるだけで、条件に合う補助金を絞り込みます。</p>${diag}`]];
  const data = {
    base: "", purposes: purposeList, pslug, industries: INDUSTRY_ORDER, regions: REGIONS.map((r) => ({ name: r.name, prefs: r.prefs })),
    archiveCount: closed.length,
  };
  const body = `<section class="hero"><div class="wrap"><h1>自社に合う補助金・助成金を、<em>すぐ</em>見つける。</h1>
<p class="lead">キーワードに加えて、目的・地域・業種・従業員数・上限額・締切から、公募中の制度を横断検索できます。</p>
<form class="searchbox" id="hform" role="search"><label class="sr" for="hq">キーワード</label><input id="hq" type="search" placeholder="例: 設備投資、IT導入、創業、省エネ、事業再構築" autocomplete="off"><button type="submit">検索</button></form>
${J ? `<p class="jpromo"><a href="joseikin/"><b>厚生労働省の助成金</b>(雇用関係${J.courseCount}コース+労働条件等${J.labourCount}制度)を一覧・目的別に見る →</a></p>` : ""}
<div class="hints"><span>よく探されるキーワード:</span>${hints.map((k) => `<button type="button" data-q="${esc(k)}">${esc(k)}</button>`).join("")}</div>
<ul class="stats"><li><b>${(stats.open + stats.upcoming).toLocaleString("ja-JP")}</b><span>公募中・予定の制度</span></li><li><b>${stats.municipal.toLocaleString("ja-JP")}</b><span>掲載市区町村</span></li><li><b>${stats.soon}</b><span>30日以内に締切</span></li><li><b>${stats.fresh}</b><span>30日以内に公募開始</span></li><li><b>${stats.national}</b><span>全国対象</span></li><li><b>${stats.closed.toLocaleString("ja-JP")}</b><span>過去の公募(受付終了)</span></li><li class="upd">更新: ${esc(fetchedAtJst)}</li></ul>
<div class="finder"><div class="tabs" role="tablist" aria-label="探し方">${tabs.map(([id, l], i) => `<button type="button" role="tab" aria-selected="${i === 0}" aria-controls="${id}">${l}</button>`).join("")}</div>
${tabs.map(([id, , c], i) => `<div class="panel" id="${id}" role="tabpanel"${i ? " hidden" : ""}>${c}</div>`).join("")}</div></div></section>
<section class="results" id="results"><div class="wrap"><div class="layout">
<aside class="side" id="side" aria-label="絞り込み"><div style="display:flex;justify-content:space-between;align-items:center"><h2 style="margin:14px 0 2px">絞り込み <span style="font-weight:400;font-size:.8rem;color:var(--ink3)">(<span id="side-n">0</span>件)</span></h2><span><button class="clear" id="side-reset" type="button">クリア</button> <button class="clear openside" data-close-side type="button" aria-label="閉じる">✕</button></span></div>
<details open><summary>公募状況</summary><div class="opts" id="f-status"></div></details>
<details open><summary>目的</summary><div class="opts" id="f-purpose"></div></details>
<details><summary>地域</summary><div class="opts" id="f-area"></div></details>
<details><summary>業種</summary><div class="opts" id="f-ind"></div></details>
<details><summary>従業員数(自社の規模)</summary><div class="opts" id="f-size"></div></details>
<details><summary>上限額(万円)</summary><div style="display:flex;gap:8px;align-items:center;margin:6px 0 10px"><input class="field" id="min" inputmode="numeric" aria-label="上限額の下限(万円)" placeholder="下限" style="width:100%;min-width:0"> 〜 <input class="field" id="max" inputmode="numeric" aria-label="上限額の上限(万円)" placeholder="上限" style="width:100%;min-width:0"></div></details>
<details><summary>申請締切</summary><div class="opts" id="f-dl"></div></details>
<details open><summary>こだわり条件</summary><div class="opts"><label class="opt"><input type="checkbox" id="isnew"><span>新着(30日以内に公募開始)</span></label><label class="opt"><input type="checkbox" id="rate"><span>補助率が明記されている</span></label><label class="opt"><input type="checkbox" id="favonly"><span>気になるリストのみ</span></label></div></details>
<div class="apply"><button class="btn" style="width:100%" data-close-side type="button">結果を見る</button></div></aside>
<div><div class="bar"><button class="btn ghost sm openside" data-open-side type="button">絞り込み</button><div class="cnt" id="count" aria-live="polite"></div>
<div class="sort"><label for="q" class="sr">結果の中でキーワード絞り込み</label><input class="field" id="q" type="search" placeholder="キーワードで絞り込み" style="padding:7px 10px;width:220px"><label for="sort">並び替え</label><select id="sort"><option value="dl">締切が近い順</option><option value="rel">関連度順</option><option value="new">公募開始が新しい順</option><option value="max">上限額が高い順</option></select></div></div>
<div class="chips" id="chips"></div><div class="list" id="list"></div><button class="btn ghost more" id="more" type="button" hidden>さらに表示</button></div></div></div></section><div class="scrim" id="scrim" hidden></div>`;
  return page({ title: "補助金・助成金のひろば｜全国の補助金・助成金を条件で探す", body, root: "", nav: "探す", scripts: `<script src="assets/items.js"></script><script type="application/json" id="data">${JSON.stringify(data).replace(/</g, "\\u003c")}</script><script src="assets/search.js"></script>` });
}

// 同じ制度の公募履歴(jGrants の公募のみ。自治体データは年度違いの履歴を持たないため対象外)
const seriesMap = new Map();
for (const s of allItems) if (s.src !== "saita" && s.dates.deadline) { const k = seriesKey(s.title) + "|" + (s.national ? "N" : s.prefs.join(",")); if (k.length >= 8) (seriesMap.get(k) ?? seriesMap.set(k, []).get(k)).push(s); }
const historyOf = (s) => { if (s.src === "saita") return []; const g = seriesMap.get(seriesKey(s.title) + "|" + (s.national ? "N" : s.prefs.join(","))) ?? []; return g.length >= 2 ? g.slice().sort((a, b) => b.dates.deadline.localeCompare(a.dates.deadline)) : []; };
// 同じ市区町村の他の制度
const byMuni = new Map();
for (const s of subsidies) if (s.muni) { const k = (s.prefs[0] ?? "") + s.muni; (byMuni.get(k) ?? byMuni.set(k, []).get(k)).push(s); }
// 目的×地域で絞るための索引(関連制度を高速に引く)
const byPurpose = new Map();
for (const s of subsidies.filter((x) => x.src !== "saita")) for (const p of s.purposes) (byPurpose.get(p) ?? byPurpose.set(p, []).get(p)).push(s);
const CAP = 60; // 一覧ページに並べる件数の上限(超過分は検索ページへ誘導)

// ---------- 補助金詳細 ----------
const TCLS = { start: "t-start", deadline: "t-deadline", projectEnd: "t-projectEnd", report: "t-report", payment: "t-payment" };
function detailPage(s) {
  const root = "../../";
  const sc = (r) => r.purposes.filter((p) => s.purposes.includes(p)).length;
  const related = s.muni
    ? (byMuni.get((s.prefs[0] ?? "") + s.muni) ?? []).filter((r) => r !== s).slice(0, 4)
    : [...new Set(s.purposes.flatMap((p) => byPurpose.get(p) ?? []))].filter((r) => r !== s && (r.national || s.national || r.prefs.some((p) => s.prefs.includes(p)))).sort((a, b) => sc(b) - sc(a) || dlKey(a).localeCompare(dlKey(b))).slice(0, 4);
  const tl = Object.entries(TYPES).filter(([k]) => s.dates[k]).sort((a, b) => s.dates[a[0]].localeCompare(s.dates[b[0]])).map(([k, t]) => `<li class="${TCLS[k]}"><i class="dot"></i><div><b>${t.label}</b><span>${fmtDate(s.dates[k])}</span><small>出典: ${k === "report" || k === "payment" ? esc(s.manualSource || t.source) : s.src === "saita" ? "サイタくん公開データ" : t.source}</small></div></li>`).join("");
  const histAll = historyOf(s), hi = Math.max(0, histAll.indexOf(s));
  const hist = histAll.slice(Math.max(0, Math.min(hi - 5, histAll.length - 12)), Math.max(0, Math.min(hi - 5, histAll.length - 12)) + 12);
  const dl = s.dates.deadline;
  const banner = s.status === "closed" ? `<div class="warnbox" style="margin:0 0 14px;font-size:.92rem"><b>この公募は受付を終了しています(${fmtDate(dl)}締切)。</b>同じ制度が次回も公募される場合があります。${hist.some((h) => h.status !== "closed") ? "下の「同じ制度の公募履歴」に現在の公募があります。" : "公式ページや下の過去の公募日程を参考に、次回に備えてください。"}</div>` : s.status === "upcoming" ? `<div class="warnbox" style="margin:0 0 14px;font-size:.92rem;background:var(--ok-bg)"><b>${fmtDate(s.dates.start)}に公募開始予定です。</b>${dl ? `申請締切は${fmtDate(dl)}です。` : ""}</div>` : "";
  const inds = s.indAll ? "業種を問わない" : s.inds.join("、") || "—";
  const saita = s.src === "saita";
  const where = saita ? [s.prefs[0], s.muni].filter(Boolean).join(" ") || (s.national ? "全国" : "—") : s.national ? "全国" : s.prefs.join("、") || s.areaOther || "—";
  const calMonth = dl ? (ym(dl) < first ? first : ym(dl) > last ? last : ym(dl)) : ym(todayJst);
  const body = `${head(root, [["", s.title.length > 36 ? s.title.slice(0, 36) + "…" : s.title]], s.title, `${areaBadge(s)} 　${esc(saita && s.muni ? "" : s.institution || "")}`)}
<div class="main"><div class="wrap"><div class="grid2"><div>
${banner}${saita && s.desc ? `<div class="box" style="margin-bottom:14px"><h3>概要</h3><p style="margin:0">${esc(s.desc)}</p></div>` : ""}<div class="box"><dl class="facts">
<div><dt>申請締切</dt><dd${dl && s.status === "open" ? ` data-deadline="${dl}"` : ""}>${dl ? `<b>${fmtDate(dl)}</b> ${pillHtml(s)}` : `<b>随時・予算がなくなり次第など</b> <span style="color:var(--ink3);font-size:.85rem">(期限は公式ページで確認)</span>`}</dd></div>
<div><dt>上限額</dt><dd><b>${yen(s.maxLimit)}</b></dd></div><div><dt>補助率</dt><dd>${s.rate ? esc(s.rate) : "—"}</dd></div>
<div><dt>対象地域</dt><dd>${esc(where)}</dd></div>
<div><dt>従業員数</dt><dd>${esc(s.employees || "—")}</dd></div><div><dt>対象業種</dt><dd>${esc(inds)}</dd></div>
<div><dt>利用目的</dt><dd class="tags">${s.purposes.map((p) => `<a class="tag" href="${root}purpose/${pslug[purposeList.indexOf(p)]}/">${esc(p)}</a>`).join("") || "—"}</dd></div>
<div><dt>実施機関・制度名</dt><dd>${esc(s.institution || "—")}</dd></div></dl></div>
${tl ? `<h2 class="h2">スケジュール</h2><div class="box"><ul class="timeline">${tl}</ul></div>` : ""}
${hist.length ? `<h2 class="h2">同じ制度の公募履歴</h2><div class="box"><table class="hist"><thead><tr><th>公募名</th><th>公募期間</th><th>上限額</th></tr></thead><tbody>${hist.map((h) => `<tr${h === s ? ' class="cur"' : ""}><td>${h === s ? "<b>" + esc(h.title) + "(このページ)</b>" : `<a href="${root}subsidy/${h.slug}/">${esc(h.title)}</a>`}</td><td${h.status === "open" ? ` data-deadline="${h.dates.deadline}"` : ""}>${h.dates.start ? fmtDate(h.dates.start) : "—"}〜${fmtDate(h.dates.deadline)}${h.status === "closed" ? "" : " " + pillHtml(h)}</td><td>${yen(h.maxLimit)}</td></tr>`).join("")}</tbody></table></div>` : ""}
${related.length ? `<h2 class="h2">${s.muni ? `${esc(s.muni)}の他の制度` : "あわせて見たい補助金・助成金"}</h2><div class="list">${related.map((r) => cardHtml(r, root)).join("")}</div>` : ""}</div>
<aside><div class="box"><h3>この補助金を申請するには</h3><p style="margin:0 0 4px;font-size:.88rem;color:var(--ink2)">詳細な要件・申請方法は${saita ? "実施機関の公式ページ" : "公式ページ(jGrants)"}で確認できます。</p>
<div class="cta"><a class="btn" href="${esc(s.url)}" rel="noopener" target="_blank">公式ページを開く ↗</a><button class="fav lg" type="button" data-fav="${s.slug}" aria-pressed="false"><span class="s">☆</span><span class="t">気になる</span></button>${dl && s.status !== "closed" ? `<a class="btn ghost" href="${root}calendar/${calMonth}/">締切をカレンダーで見る</a>` : ""}</div>
<div class="warnbox">${saita ? "この情報は自治体等の公開情報から自動収集したもので、古い・不正確な場合があります。" : "締切は変更・延長されることがあります。"}申請前に必ず公式ページ・公募要領で最新情報をご確認ください。</div>${saita ? `<p style="margin:10px 0 0;font-size:.76rem;color:var(--ink3)">出典: <a href="https://www.subsidy-support.tech/data" rel="noopener">サイタくん 補助金公開データ</a> (CDLA-Permissive-2.0)</p>` : ""}</div></aside></div></div></div>`;
  return page({ title: `${s.title}｜補助金・助成金のひろば`, desc: `${s.title}${dl ? `の申請締切(${fmtDate(dl)})、` : "の"}上限額(${yen(s.maxLimit)})、対象地域・業種・従業員数。`, body, root, head: `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "WebPage", name: s.title }).replace(/</g, "\\u003c")}</script>` });
}

// ---------- 目的別・地域別・業種別 ----------
const hubLink = (root, href, label, n) => `<a href="${root}${href}"><span>${esc(label)}</span><small>${n}</small></a>`;
const localCount = (p) => subsidies.filter((s) => !s.national && s.prefs.includes(p)).length;
function hubPage(kind) {
  const root = "../";
  if (kind === "purpose") {
    const body = `${head(root, [["purpose/", "目的別"]], "目的から補助金・助成金を探す", "やりたいことから、使える制度を探します。")}<div class="main"><div class="wrap"><div class="hub">${purposeList.map((p, i) => hubLink(root, `purpose/${pslug[i]}/`, p, purposeCount[p])).join("")}</div></div></div>`;
    return page({ title: "目的から探す｜補助金・助成金のひろば", body, root, nav: "目的別" });
  }
  if (kind === "area") {
    const natN = subsidies.filter((s) => s.national).length;
    const body = `${head(root, [["area/", "地域別"]], "地域から補助金・助成金を探す", `事業所のある都道府県を選んでください。各ページに、その都道府県・市区町村の制度と、全国対象の制度(${natN}件)を掲載しています。数字は都道府県・市区町村の制度の件数です。`)}<div class="main"><div class="wrap">${REGIONS.map((r) => `<div class="hub-group"><h2>${esc(r.name)}</h2><div class="hub">${r.prefs.map((p) => hubLink(root, `area/${PREF_SLUG[p]}/`, p, localCount(p))).join("")}</div></div>`).join("")}</div></div>`;
    return page({ title: "地域から探す｜補助金・助成金のひろば", body, root, nav: "地域別" });
  }
  const body = `${head(root, [["industry/", "業種別"]], "業種から補助金・助成金を探す", "日本標準産業分類の大分類ごとに、対象となる制度を探します。")}<div class="main"><div class="wrap"><div class="hub">${INDUSTRY_ORDER.map((n) => hubLink(root, `industry/${INDUSTRY_SLUG[n]}/`, n, subsidies.filter((s) => s.indAll || s.inds.includes(n)).length)).join("")}</div></div></div>`;
  return page({ title: "業種から探す｜補助金・助成金のひろば", body, root, nav: "業種別" });
}
function listPage({ title, trail, h1, lead, groups, searchQ, nav, extra = "" }) {
  const root = "../../";
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  const body = `${head(root, trail, h1, lead)}<div class="main"><div class="wrap"><p style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:0 0 6px"><b>${total.toLocaleString("ja-JP")}件</b><a class="btn ghost sm" href="${root}#${searchQ}">条件を追加してさらに絞り込む →</a></p>${extra}
${groups.map((g) => (g.items.length ? `${g.h ? `<h2 class="h2">${esc(g.h)}(${g.items.length.toLocaleString("ja-JP")}件)</h2>` : ""}<div class="list">${g.items.slice(0, CAP).map((s) => cardHtml(s, root)).join("")}</div>${g.items.length > CAP ? `<p style="margin-top:14px"><a class="btn ghost sm" href="${root}#${g.q ?? searchQ}">残り${(g.items.length - CAP).toLocaleString("ja-JP")}件も検索で見る →</a></p>` : ""}` : "")).join("") || `<div class="empty"><h3>現在公募中の該当制度はありません</h3><p>条件を変えて<a href="${root}">トップの検索</a>をお試しください。</p></div>`}</div></div>`;
  return page({ title: `${title}｜補助金・助成金のひろば`, desc: lead.replace(/<[^>]+>/g, ""), body, root, nav });
}

// ---------- カレンダー ----------
const legend = `<ul class="legend">${Object.entries(TYPES).map(([k, t]) => `<li class="${TCLS[k]}"><i></i>${t.label}</li>`).join("")}</ul>`;
function monthPage(m) {
  const [y, mo] = m.split("-").map(Number), root = "../../";
  const firstDow = new Date(Date.UTC(y, mo - 1, 1)).getUTCDay(), days = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const byDay = {}; for (const e of events) if (ym(e.date) === m) (byDay[+e.date.slice(8)] ??= []).push(e);
  const link = (e) => `${root}subsidy/${e.s.slug}/`;
  let cells = ""; for (let i = 0; i < firstDow; i++) cells += `<div class="cell"></div>`;
  for (let d = 1; d <= days; d++) {
    const ev = byDay[d] ?? [];
    cells += `<div class="cell" data-date="${m}-${String(d).padStart(2, "0")}"><div class="dn">${d}</div>${ev.slice(0, 3).map((e) => `<a class="cchip ${TCLS[e.type]}" href="${link(e)}" title="${esc(e.s.title)}">${TYPES[e.type].label} ${esc(e.s.title)}</a>`).join("")}${ev.length > 3 ? `<a class="cmore" href="#d${d}">ほか${ev.length - 3}件</a>` : ""}${ev.length ? `<a class="ccnt" href="#d${d}">${ev.length}件</a>` : ""}</div>`;
  }
  const detail = Object.keys(byDay).map(Number).sort((a, b) => a - b).map((d) => `<section class="cal-day" id="d${d}"><h3>${mo}月${d}日</h3><ul>${byDay[d].map((e) => `<li><span class="tag ${TCLS[e.type]}">${TYPES[e.type].label}</span> <a href="${link(e)}">${esc(e.s.title)}</a></li>`).join("")}</ul></section>`).join("");
  const pv = months.includes(addMonths(m, -1)) ? `<a href="../${addMonths(m, -1)}/">← 前月</a>` : "<span></span>", nx = months.includes(addMonths(m, 1)) ? `<a href="../${addMonths(m, 1)}/">翌月 →</a>` : "<span></span>";
  const body = `${head(root, [["calendar/" + ym(todayJst) + "/", "カレンダー"]], `${y}年${mo}月の補助金・助成金カレンダー`, "申請締切・公募開始などの日程を月ごとに確認できます。")}<div class="main"><div class="wrap">${legend}<div class="mnav">${pv}<strong>${y}年${mo}月</strong>${nx}</div>
<div class="mgrid">${["日", "月", "火", "水", "木", "金", "土"].map((x) => `<div class="dow">${x}</div>`).join("")}${cells}</div>
<h2 class="h2">この月の日程一覧(${Object.values(byDay).flat().length}件)</h2>${detail || "<p>この月に登録された日程はありません。</p>"}
<p style="margin-top:24px"><a class="btn ghost sm" href="${root}deadline.ics">申請締切をカレンダーアプリに登録 (ICS)</a> <a class="btn ghost sm" href="${root}all.ics">全日程 (ICS)</a></p></div></div>
<script>{const t=new Date(Date.now()+9*36e5).toISOString().slice(0,10);document.querySelector('.cell[data-date="'+t+'"]')?.classList.add('today')}</script>`;
  return page({ title: `${y}年${mo}月のカレンダー｜補助金・助成金のひろば`, body, root, nav: "カレンダー" });
}

// ---------- ガイド記事(下層ページ) ----------
var GUIDES = [
  { slug: "subsidy-vs-grant", title: "補助金と助成金の違いとは？", sum: "目的・財源・受け取りやすさ・申請時期の違いを整理します。",
    body: `<p>「補助金」と「助成金」は、どちらも国や自治体などが事業者を支援するために交付する、原則として返済不要のお金です。混同されがちですが、一般的には次のような違いがあります。</p>
<table><tr><th></th><th>補助金</th><th>助成金</th></tr><tr><th>主な趣旨</th><td>新事業・設備投資・販路開拓など、政策目標に沿った取組の支援</td><td>雇用の維持・職場環境の改善・人材育成など、制度の要件に沿った取組の支援</td></tr><tr><th>主な窓口</th><td>経済産業省・中小企業庁、自治体など</td><td>厚生労働省(労働局・ハローワーク)、自治体など</td></tr><tr><th>採択</th><td>審査があり、予算や採択件数に上限があることが多い</td><td>要件を満たせば受給できる制度が多い</td></tr><tr><th>公募</th><td>公募期間が限られる</td><td>通年で受け付ける制度もある</td></tr></table>
<p class="note">名称と実態は必ずしも一致しません。「助成金」と呼ばれていても審査がある制度、「補助金」でも要件を満たせば受けられる制度があります。名称ではなく、公募要領で<strong>対象者・対象経費・審査の有無・締切</strong>を確認してください。</p>
<h2>どちらも後払いが基本</h2><p>多くの制度では、先に自己資金で支払いを済ませ、事業完了後の実績報告を経てから交付される「精算払い(後払い)」です。申請から入金まで数か月から1年以上かかることもあるため、資金繰りの計画が大切です。</p>
<h2>厚生労働省の助成金を探す</h2><p>雇用関係助成金(キャリアアップ助成金、人材開発支援助成金、両立支援等助成金など)や労働条件等関係の助成金は、<a href="../../joseikin/">厚労省の助成金ガイド</a>に、目的別・コース別にまとめています。</p>
<h2>探すときのポイント</h2><p>このサイトでは<a href="../../">トップページ</a>から、目的・地域・業種・従業員数・上限額・締切などの条件で、補助金・助成金を区別せずまとめて探せます。</p>` },
  { slug: "application-flow", title: "補助金申請の基本の流れ", sum: "探す→公募要領を読む→準備→申請→採択→事業実施→実績報告→交付までの全体像。",
    body: `<p>制度ごとに細部は異なりますが、多くの補助金は次の流れで進みます。</p>
<h2>1. 制度を探す</h2><p>目的・地域・業種・規模から候補を絞り込みます。<a href="../../">検索ページ</a>の件数表示を目安に、条件を足したり外したりして比べるのがコツです。</p>
<h2>2. 公募要領を読む</h2><p>対象者、対象経費、補助率、上限額、締切、提出書類、審査の観点を確認します。サイトの要約ではなく、必ず<strong>公式の公募要領</strong>で確認してください。</p>
<h2>3. 準備する</h2><p>電子申請の制度では、<strong>GビズIDプライム</strong>のアカウントが必要になることが多く、取得に時間がかかる場合があります。事業計画書や見積書、決算書などもあわせて準備します。</p>
<h2>4. 申請 → 審査 → 採択(交付決定)</h2><p>多くの制度では、<strong>交付決定の前に発注・契約・支払いした経費は対象外</strong>になります。着手のタイミングには注意してください。</p>
<h2>5. 事業の実施 → 実績報告 → 交付</h2><p>事業完了後に、領収書や成果物を添えて実績報告を行い、確定検査を経て補助金が支払われます。報告期限は制度ごとに決まっています。</p>
<p class="note">各補助金の詳細ページでは、申請締切に加え、事業終了期限や実績報告期限などの日程を可能な範囲で掲載しています。</p>` },
  { slug: "checklist", title: "申請前に確認したい7つのチェックポイント", sum: "対象者・対象経費・時期・資金繰りなど、見落としがちな確認事項。",
    body: `<ol><li><strong>対象者</strong>: 業種、従業員数、法人格(個人事業主・法人・団体)の要件を満たしているか。</li><li><strong>対象地域</strong>: 事業所の所在地が対象に含まれるか。</li><li><strong>対象経費</strong>: 買いたいもの・やりたいことが補助対象に含まれるか。</li><li><strong>締切と着手時期</strong>: 交付決定前の発注が対象外にならないか。</li><li><strong>補助率と上限額</strong>: 自己負担額を含めた資金計画が成り立つか。</li><li><strong>併用の可否</strong>: 同じ経費で他の補助金と重複受給できない場合があります。</li><li><strong>申請に必要な準備</strong>: GビズID、事業計画書、見積書、決算書などの用意と所要時間。</li></ol>
<p class="note">不明点は、制度の事務局、商工会・商工会議所、よろず支援拠点などの公的な相談窓口に確認すると安心です。</p>` },
  { slug: "how-to-search", title: "このサイトでの補助金の探し方", sum: "キーワード・目的・地域・業種・規模・上限額・締切の7つの入口を使い分けるコツ。",
    body: `<p>トップページの検索は、次のような複数の入口から同じ結果にたどり着けます。</p>
<ul><li><strong>キーワード</strong>: 「創業」「省エネ」など。似た言葉(起業、脱炭素など)も一緒に検索します。スペース区切りで複数指定すると、すべてを含む制度だけに絞れます。</li><li><strong>目的から</strong>: 「設備整備・IT導入」「雇用・職場環境」など、やりたいことで選びます。</li><li><strong>地域から</strong>: 都道府県を選ぶと、その地域限定の制度と全国対象の制度を表示します。</li><li><strong>業種から</strong>: 日本標準産業分類の大分類から選びます。</li><li><strong>規模・金額から</strong>: 従業員数や上限額の範囲で選びます。</li><li><strong>締切・新着から</strong>: 締切が近い順や、最近公募が始まった制度から探します。</li><li><strong>かんたん診断</strong>: 3つの質問に答えるだけで条件を一括設定します。</li></ul>
<p>絞り込み条件の横の数字は、<strong>その条件を選んだときの該当件数</strong>です。0件の選択肢は薄く表示されます。気になる制度は ★ で保存でき、あとから「気になる」リストで見返せます(保存先はお使いのブラウザ内です)。</p>
<p class="note">検索結果の条件はURLに保存されるため、そのままブックマークや共有ができます。</p>` },
];
function guideIndex() {
  const root = "../";
  const body = `${head(root, [["guide/", "ガイド"]], "補助金・助成金ガイド", "申請の前に知っておきたい基礎知識と、このサイトの使い方をまとめました。")}<div class="main"><div class="wrap"><div class="arts">${GUIDES.map((g) => `<a href="${g.slug}/"><b>${esc(g.title)}</b><span>${esc(g.sum)}</span></a>`).join("")}</div></div></div>`;
  return page({ title: "ガイド｜補助金・助成金のひろば", body, root, nav: "ガイド" });
}
function guidePage(g) {
  const root = "../../";
  const others = GUIDES.filter((x) => x !== g);
  const body = `${head(root, [["guide/", "ガイド"], ["", g.title]], g.title, esc(g.sum))}<div class="main"><div class="wrap"><div class="article">${g.body}</div><h2 class="h2">ほかのガイド</h2><div class="arts">${others.map((x) => `<a href="../${x.slug}/"><b>${esc(x.title)}</b><span>${esc(x.sum)}</span></a>`).join("")}</div><p style="margin-top:28px"><a class="btn" href="${root}">補助金・助成金を探す</a></p></div></div>`;
  return page({ title: `${g.title}｜補助金・助成金のひろば`, desc: g.sum, body, root, nav: "ガイド" });
}

// ---------- ICS ----------
const ics = (evs) => {
  const fold = (l) => { let out = "", cur = 0; for (const ch of l) { const n = Buffer.byteLength(ch); if (cur + n > 74) { out += "\r\n "; cur = 1; } out += ch; cur += n; } return out; };
  const e2 = (s) => String(s).replace(/\r/g, "").replace(/([,;\\])/g, "\\$1").replace(/\n/g, "\\n");
  const nextDay = (d) => new Date(Date.parse(d) + 86400000).toISOString().slice(0, 10).replace(/-/g, "");
  const stamp = raw.fetchedAt.replace(/[-:]/g, "").replace(/\.\d+/, "");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//hojokin-hiroba//calendar//JA", "CALSCALE:GREGORIAN", "X-WR-CALNAME:補助金・助成金のひろば", "X-WR-TIMEZONE:Asia/Tokyo"];
  for (const e of evs) lines.push("BEGIN:VEVENT", `UID:${e.s.id}-${e.type}@hojokin-hiroba`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${e.date.replace(/-/g, "")}`, `DTEND;VALUE=DATE:${nextDay(e.date)}`,
    fold(`SUMMARY:${e2(`【${TYPES[e.type].label}】${e.s.title}`)}`), fold(`DESCRIPTION:${e2(`詳細・最新情報: ${e.s.url}\n日程は変更される場合があります。公式ページで確認してください。`)}`), fold(`URL:${e.s.url}`), "END:VEVENT");
  lines.push("END:VCALENDAR"); return lines.join("\r\n") + "\r\n";
};

// ---------- 出力 ----------
await mkdir(DIST, { recursive: true });
for (const f of await readdir(DIST)) await rm(new URL(f, DIST), { recursive: true, force: true });
const w = async (p, c) => { await mkdir(new URL(p.replace(/[^/]*$/, ""), DIST), { recursive: true }); await writeFile(new URL(p, DIST), c); };
await mkdir(new URL("assets/", DIST), { recursive: true });
for (const f of ["style.css", "site.js", "search.js", "joseikin.css", "joseikin.js"]) await copyFile(new URL(f, SRC), new URL(`assets/${f}`, DIST));

await w("index.html", indexPage());
for (const s of allItems) await w(`subsidy/${s.slug}/index.html`, detailPage(s));
await w("assets/items.js", "window.__ITEMS__=" + JSON.stringify(subsidies.map(compact)) + ";");
await w("assets/archive.js", "window.__ARCHIVE__=" + JSON.stringify(closed.map(compact)) + ";");
for (const k of ["purpose", "area", "industry"]) await w(`${k}/index.html`, hubPage(k));
purposeList.forEach((p, i) => w(`purpose/${pslug[i]}/index.html`, listPage({ title: `${p}の補助金・助成金`, trail: [["purpose/", "目的別"], ["", p]], h1: `${p.replace(/をしたい|がほしい/, "")}ための補助金・助成金`, lead: `「${esc(p)}」に使える公募中の制度を、締切が近い順に掲載しています。`, groups: [{ items: subsidies.filter((s) => s.purposes.includes(p)) }], searchQ: `purpose=${encodeURIComponent(p)}`, nav: "目的別" })));
for (const p of PREFS) {
  const inPref = subsidies.filter((s) => s.prefs.includes(p) && !s.national), local = inPref.filter((s) => !s.muni), munis = inPref.filter((s) => s.muni), nat = subsidies.filter((s) => s.national);
  const muniCount = new Map(); for (const s of munis) muniCount.set(s.muni, (muniCount.get(s.muni) || 0) + 1);
  const muniChips = muniCount.size ? `<h2 class="h2">市区町村から探す</h2><div class="tags" style="gap:8px">${[...muniCount].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ja")).map(([m, n]) => `<a class="tag" style="font-size:.9rem;padding:2px 14px" href="../../#area=${encodeURIComponent(p)}&q=${encodeURIComponent(m)}&nat=0">${esc(m)} <b>${n}</b></a>`).join("")}</div>` : "";
  await w(`area/${PREF_SLUG[p]}/index.html`, listPage({ title: `${p}の補助金・助成金`, trail: [["area/", "地域別"], ["", p]], h1: `${p}の補助金・助成金`, lead: `${esc(p)}で使える公募中の制度です。${esc(p)}限定の制度と、全国対象の制度をあわせて掲載しています。`, extra: muniChips, groups: [{ h: `${p}の制度`, items: local }, { h: `${p}内の市区町村の制度`, items: munis, q: `area=${encodeURIComponent(p)}&nat=0` }, { h: "全国対象の制度", items: nat }], searchQ: `area=${encodeURIComponent(p)}`, nav: "地域別" }));
}
for (const n of INDUSTRY_ORDER) await w(`industry/${INDUSTRY_SLUG[n]}/index.html`, listPage({ title: `${n}の補助金・助成金`, trail: [["industry/", "業種別"], ["", n]], h1: `${n}向けの補助金・助成金`, lead: `「${esc(n)}」が対象に含まれる公募中の制度です。`, groups: [{ h: `${n}を対象とする制度`, items: subsidies.filter((s) => !s.indAll && s.inds.includes(n)) }, { h: "業種を問わない制度", items: subsidies.filter((s) => s.indAll) }], searchQ: `ind=${encodeURIComponent(n)}`, nav: "業種別" }));
for (const m of months) await w(`calendar/${m}/index.html`, monthPage(m));
if (J) await J.write(w, { page, head, esc });
await w("guide/index.html", guideIndex());
for (const g of GUIDES) await w(`guide/${g.slug}/index.html`, guidePage(g));
const inRange = events.filter((e) => e.date >= `${first}-01`);
await w("licenses/saita-kun.txt", [
  "自治体・都道府県・国の制度データについて",
  "",
  "本サイトの一部の制度情報は、サイタくん 補助金公開データフィード (https://www.subsidy-support.tech/data) を加工して利用しています。",
  "出典: サイタくん (www.subsidy-support.tech)",
  "データ提供元: 日本補助金支援機構株式会社",
  "ライセンス: Community Data License Agreement - Permissive, Version 2.0 (CDLA-Permissive-2.0)",
  "ライセンス全文: https://cdla.dev/permissive-2-0/",
  "",
  `データのスナップショット: ${saitaRaw.generatedAt ?? "不明"}`,
  "掲載にあたり、題名の補完、融資・保証・税制等の除外、国の制度との重複除外、形式の変換などの加工を行っています。",
  "データは自動収集されたもので、正確性・最新性は保証されません。申請前に必ず公式ページをご確認ください。",
  "",
].join("\n"));
await w("all.ics", ics(inRange)); await w("deadline.ics", ics(inRange.filter((e) => e.type === "deadline")));
console.log(`生成: 公募中${active.length}件(うち自治体等 ${active.filter((s) => s.src === "saita").length}件) 公募予定${upcoming.length}件 過去${closed.length}件 / 詳細${allItems.length}ページ / 目的${purposeList.length} 地域${PREFS.length} 業種${INDUSTRY_ORDER.length} / カレンダー${months.length}か月 / ガイド${GUIDES.length}${J ? ` / 厚労省の助成金${J.pageCount}ページ` : ""}`);
