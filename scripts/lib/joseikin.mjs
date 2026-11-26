// data/mhlw.json(厚生労働省の助成金ページ) から /joseikin/ 配下のページを生成する。
// build.mjs から呼ばれる。ページの外枠(page/head など)は build.mjs 側のものを ctx で受け取る。
import { readFile } from "node:fs/promises";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const plain = (x) => String(x ?? "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\s+/g, " ").trim();
// URLの同一判定キー: プロトコル・index.html・末尾スラッシュ・#以降の差を無視
const key = (u) => String(u ?? "").replace(/#.*$/, "").replace(/^https?:\/\//, "").replace(/\/index\.html?$/i, "").replace(/\/+$/, "");

const readJson = async (p) => { try { return JSON.parse(await readFile(new URL(p, import.meta.url), "utf8")); } catch { return null; } };

// ---- 「こんなときは」ガイド: 目的 → 制度名(コース名の一部で突き合わせ) ----
const NEEDS = [
  ["従業員の雇用を維持したい(休業・教育訓練・出向)", ["雇用調整助成金", "産業雇用安定助成金（スキルアップ支援コース）", "産業雇用安定助成金（産業連携人材確保等支援コース）"]],
  ["離職者・就職が難しい人を雇い入れたい", ["特定求職者雇用開発助成金（特定就職困難者コース）", "トライアル雇用助成金（一般トライアルコース）", "早期再就職支援等助成金（雇入れ支援コース）", "特定求職者雇用開発助成金（中高年層安定雇用支援コース）", "特定求職者雇用開発助成金（生活保護受給者等雇用開発コース）"]],
  ["パート・契約社員を正社員にしたい／処遇を改善したい", ["キャリアアップ助成金（正社員化コース）", "キャリアアップ助成金（賃金規定等改定コース）", "キャリアアップ助成金（賞与・退職金制度導入コース）", "キャリアアップ助成金（短時間労働者労働時間延長支援コース）"]],
  ["従業員の職場定着・雇用管理を良くしたい", ["人材確保等支援助成金（雇用管理制度・雇用環境整備助成コース）", "人材確保等支援助成金（テレワークコース）", "人材確保等支援助成金（外国人労働者就労環境整備助成コース）"]],
  ["従業員の研修・リスキリングを行いたい", ["人材開発支援助成金（人材育成支援コース）", "人材開発支援助成金（人への投資促進コース）", "人材開発支援助成金（事業展開等リスキリング支援コース）", "人材開発支援助成金（教育訓練休暇等付与コース）"]],
  ["育児・介護と仕事の両立を支援したい", ["両立支援等助成金（出生時両立支援コース）", "両立支援等助成金（育児休業等支援コース）", "両立支援等助成金（介護離職防止支援コース）", "両立支援等助成金（育休中等業務代替支援コース）"]],
  ["高齢者の雇用を進めたい", ["65歳超雇用推進助成金（65歳超継続雇用促進コース）", "65歳超雇用推進助成金（高年齢者無期雇用転換コース）", "65歳超雇用推進助成金（高年齢者評価制度等雇用管理改善コース）"]],
  ["障害のある人を雇用したい", ["トライアル雇用助成金（障害者トライアルコース・障害者短時間トライアルコース）", "特定求職者雇用開発助成金（特定就職困難者コース）", "キャリアアップ助成金（障害者正社員化コース）", "障害者作業施設設置等助成金"]],
  ["最低賃金の引上げ・生産性向上の設備投資をしたい", ["業務改善助成金"]],
  ["労働時間の短縮・年次有給休暇の取得を進めたい", ["働き方改革推進支援助成金（労働時間短縮・年休促進支援コース）", "働き方改革推進支援助成金（勤務間インターバル導入コース）", "働き方改革推進支援助成金（業種別課題対応コース）"]],
  ["雇用情勢の厳しい地域・沖縄で事業所を設置したい", ["地域雇用開発助成金（地域雇用開発コース）", "地域雇用開発助成金（沖縄若年者雇用促進コース）"]],
  ["季節労働者を通年雇用したい", ["通年雇用助成金"]],
  ["建設業・建設技能者の育成や確保をしたい", ["建設事業主等に対する助成金"]],
  ["職場の安全衛生・受動喫煙対策に取り組みたい", ["受動喫煙防止対策助成金", "エイジフレンドリー補助金", "高度安全機械等導入支援補助金", "個人ばく露測定定着促進補助金"]],
  ["退職金共済に加入したい(掛金助成)", ["一般の中小企業退職金共済制度に係る掛金助成", "建設業退職金共済制度に係る掛金助成"]],
  ["事業主団体として会員企業を支援したい", ["人材確保等支援助成金（中小企業団体助成コース）", "働き方改革推進支援助成金（団体推進コース）"]],
  ["労働者個人が学び直しの給付を受けたい", ["教育訓練給付制度"]],
];

// 区分ごとの「ひとこと」(厚生労働省の一覧ページの説明を踏まえた要約)
const CAT_LEAD = {
  1: "休業・教育訓練・出向で従業員の雇用を維持した事業主を支援",
  2: "在籍型出向などで、人材の確保・スキルアップを図る事業主を支援",
  3: "離職を余儀なくされる人の再就職支援や、早期の雇入れ・中途採用拡大を支援",
  4: "就職が困難な人(高年齢者・障害者・母子家庭の母など)を雇い入れる事業主を支援",
  5: "職業経験の不足などで就職が難しい人を、試行的に雇い入れる事業主を支援",
  6: "雇用情勢が厳しい地域などで事業所を設置し、地域の人を雇い入れる事業主を支援",
  7: "雇用管理の改善・職場定着・外国人やテレワーク・建設分野の人材確保を支援",
  8: "季節労働者を通年雇用する事業主を支援",
  9: "65歳以上への定年引上げ・継続雇用・高年齢者の雇用管理改善などを支援",
  10: "非正規雇用の労働者の正社員化や処遇改善に取り組む事業主を支援",
  11: "育児・介護・不妊治療などと仕事の両立支援に取り組む事業主を支援",
  12: "従業員の訓練・リスキリング・教育訓練休暇などを実施する事業主を支援",
  13: "障害者の雇用に伴う施設整備・介助者配置・通勤対策などを支援(高齢・障害・求職者雇用支援機構(JEED)が実施)",
};

// URL末尾のファイル名 → 読みやすいslug
const SLUG_NAMES = {
  "pageL07_20200515": "koyo-chosei", "career": "career-up", "d01-1": "jinzai-kaihatsu", "ryouritsu01": "ryouritsu",
  "newpage_52738": "over65-keizoku", "newpage_55070": "over65-hyoka", "newpage_55142": "over65-muki",
  "03": "gyomu-kaizen", "index11": "chutaikyo", "kakekin_josei": "chutaikyo-kakekin", "kensetsu": "kentaikyo", "seisyu": "seitaikyo", "ringyou": "rintaikyo",
  "kensetsu-kaizen": "kensetsu-joseikin", "0000049868": "judo-kitsuen-joseikin", "kitsuen": "judo-kitsuen-shien", "kyouiku": "kyouiku-kunren-kyufu",
  "0000199292_00005": "jinzai-kakuho-koyokanri", "0000199317": "jinzai-kakuho-dantai", "gaikokujin": "jinzai-kakuho-gaikokujin", "telework_zyosei_R3": "jinzai-kakuho-telework",
  "0000200273": "hatarakikata-dantai", "0000120692": "hatarakikata-jikan", "0000120692_00001": "hatarakikata-gyoshu", "0000150891": "hatarakikata-interval", "0000200273_torihikikannkyou": "hatarakikata-torihiki",
  "newpage_09940": "age-friendly", "newpage_38665": "kojin-bakuro", "newpage_27384": "koudo-anzen-kikai", "kyufukin": "koyo-kankei-sogo",
  "0000082805_00012": "sangyo-koyo-skillup", "sankokinsangyourenkeijinzaikakuhotou_00001": "sangyo-koyo-renkei", "sankosaigai": "sangyo-koyo-noto", "sankosaigai_00005": "sangyo-koyo-kumamoto",
  "newpage_21924": "soki-saishushoku-support", "0000082805": "soki-saishushoku-yatoire", "0000160737_00001": "soki-saishushoku-chuto",
  "tokutei_konnan": "tokutei-konnan", "hattatsu_nanchi": "tokutei-hattatsu", "chuukou": "tokutei-chukounen", "tokutei_seikatsu": "tokutei-seikatsu",
  "newpage_16286": "trial-ippan", "shougai_trial": "trial-shogaisha", "shougai_trial_00002": "jinzai-kaihatsu-shogaisha", "chiiki_koyou": "chiiki-koyo", "okinawa_jakunen": "okinawa-jakunen", "tsuunen_koyou": "tsunen-koyo",
  "index_00004": "career-up-shogaisha",
};
const COMMON_ORDER = ["common-requirements", "contact", "e-application", "fraud", "guidelines", "pamphlets", "search-tool", "agencies", "abolished", "roudou-kijun"];
const COMMON_LEAD = {
  "common-requirements": "すべての雇用関係助成金に共通する支給要領・申請様式・申請方法",
  contact: "申請先(労働局・ハローワーク)と問い合わせ先",
  "e-application": "雇用関係助成金ポータルでの電子申請のしかた",
  fraud: "不正受給とみなされる行為と、その場合の措置",
  guidelines: "各コースの支給要領の一覧",
  pamphlets: "各コースのパンフレット・リーフレットの一覧",
  "search-tool": "条件から助成金を探す、厚生労働省の検索ツール",
  agencies: "助成金の申請を手伝う職業紹介事業者等についての案内",
  abolished: "すでに廃止されているが、経過措置の対象となる助成金",
  "roudou-kijun": "労働基準・安全衛生・退職金共済など、労働条件等に関する助成金の案内",
};

export async function loadJoseikin() {
  const data = await readJson("../../data/mhlw.json");
  if (!data) return null;
  const curated = (await readJson("../../data/mhlw-curated.json")) ?? { pages: {} };
  const fetchedAtJst = new Date(new Date(data.fetchedAt).getTime() + 9 * 3600e3).toISOString().replace("T", " ").slice(0, 16);
  const fetchedDate = fetchedAtJst.slice(0, 10);
  const fmt = (d) => { const [y, m, dd] = d.split("-"); return `${y}年${+m}月${+dd}日`; };

  // ---- ページ(URL)ごとにまとめ、slugを割り当てる ----
  const byKey = new Map(); // key -> page model
  const usedSlugs = new Set(["index"]);
  const slugOf = (url, explicit) => {
    if (explicit) { usedSlugs.add(explicit); return explicit; }
    const segs = new URL(url).pathname.split("/").filter(Boolean).map((s) => s.replace(/\.html?$/i, ""));
    const clean = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const last = segs.at(-1) === "index" ? segs.at(-2) : segs.at(-1);
    if (SLUG_NAMES[last] && !usedSlugs.has(SLUG_NAMES[last])) { usedSlugs.add(SLUG_NAMES[last]); return SLUG_NAMES[last]; }
    let i = segs.length - 1; while (i > 0 && /^index$/i.test(segs[i])) i--;
    let s = clean(segs[i] ?? "page"), j = i;
    while ((usedSlugs.has(s) || !s) && j > 0) { j--; s = `${clean(segs[j])}-${s}`; }
    for (let n = 2; usedSlugs.has(s); n++) s = `${s.replace(/-\d+$/, "")}-${n}`;
    usedSlugs.add(s); return s;
  };
  for (const [u, p] of Object.entries(data.pages)) {
    const k = key(p.finalUrl ?? u), k2 = key(u);
    const hit = byKey.get(k) ?? byKey.get(k2);
    if (hit) { hit.urls.add(u); byKey.set(k2, hit); continue; }
    const m = { url: p.finalUrl ?? u, urls: new Set([u]), kind: p.kind, title: p.title, blocks: p.blocks, slug: slugOf(p.finalUrl ?? u, p.slug), courses: [], notes: [] };
    byKey.set(k, m); byKey.set(k2, m);
  }
  const pageFor = (u) => byKey.get(key(u));
  const pages = [...new Set(byKey.values())];

  // カタログ(コース)と紐づけ
  const catalog = data.catalog.map((c) => ({ ...c, courses: c.courses.map((co) => ({ ...co, page: pageFor(co.url), altPages: (co.alt ?? []).map((a) => ({ ...a, page: pageFor(a.url) })) })) }));
  for (const c of catalog) for (const co of c.courses) if (co.page) co.page.courses.push({ ...co, cat: c.name });
  const roudou = data.roudouGroups.map((g) => ({ ...g, items: g.items.map((i) => ({ ...i, page: pageFor(i.url) })) }));
  for (const g of roudou) for (const i of g.items) if (i.page && i.page.kind !== "common") i.page.notes.push(g.name);
  const hubGroups = data.hubGroups.map((g) => ({ ...g, page: g.url ? pageFor(g.url) : null, items: g.items.map((i) => ({ ...i, page: pageFor(i.url) })) }));
  const allCourseNames = [
    ...catalog.flatMap((c) => c.courses.map((co) => ({ name: co.name, page: co.page, url: co.url }))),
    ...roudou.flatMap((g) => g.items.map((i) => ({ name: i.name, page: i.page, url: i.url }))),
    ...hubGroups.flatMap((g) => g.items.map((i) => ({ name: i.name, page: i.page, url: i.url }))),
  ];
  const findCourse = (n) => allCourseNames.find((x) => x.name === n) ?? allCourseNames.find((x) => x.name.startsWith(n)) ?? null;
  for (const [, names] of NEEDS) for (const n of names) if (!findCourse(n)) console.warn(`joseikin: ガイドの制度名が見つかりません: ${n}`);

  const courseCount = catalog.reduce((n, c) => n + c.courses.length, 0);
  const labourCount = roudou.reduce((n, g) => n + g.items.length, 0);
  const href = (root, p) => `${root}joseikin/${p.slug}/`;

  // ---- インライン: [文字](URL) を安全なリンクへ ----
  const fileKind = (u) => { const m = /\.(pdf|xlsx?|xlsm|docx?|zip|pptx?)(?:$|\?)/i.exec(u); return m ? m[1].toLowerCase().replace(/^xls.*/, "xls").replace(/^doc.*/, "doc").replace(/^ppt.*/, "ppt") : ""; };
  const FILE_LABEL = { pdf: "PDF", xls: "Excel", doc: "Word", zip: "ZIP", ppt: "PowerPoint" };
  const inline = (text, root) => {
    let out = "", last = 0; const re = /\[([^\]]*)\]\(([^)]*)\)/g; let m;
    while ((m = re.exec(text))) {
      out += esc(text.slice(last, m.index)); last = re.lastIndex;
      const label = m[1], url = m[2];
      if (!/^https?:\/\//.test(url)) { out += esc(label); continue; }
      const p = fileKind(url) ? null : pageFor(url);
      if (p && p.kind !== "sub") out += `<a href="${href(root, p)}">${esc(label)}</a>`;
      else { const f = fileKind(url); out += `<a href="${esc(url)}" rel="noopener" target="_blank">${esc(label)}</a>${f ? `<span class="ftype">${FILE_LABEL[f] ?? f}</span>` : `<span class="ext" aria-label="公式サイトを開く">↗</span>`}`; }
    }
    return out + esc(text.slice(last));
  };

  // ---- ブロック列 → 見出し階層(ツリー) ----
  // ページ冒頭の「目次リスト」(見出しと同名のli)は、独自の目次を出すので除く
  const stripNo = (t) => t.replace(/^[0-9０-９]+[．.]\s*/, "").replace(/\s+/g, "");
  const buildTree = (blocks0) => {
    const heads = new Set(blocks0.filter((b) => b.t === "h").map((b) => stripNo(plain(b.x))));
    const firstH = blocks0.findIndex((b) => b.t === "h");
    const blocks = blocks0.filter((b, i) => !(b.t === "li" && (firstH < 0 || i < firstH) && heads.has(stripNo(plain(b.x)))));
    const root ={ l: 1, h: null, blocks: [], kids: [] }, stack = [root];
    for (const b of blocks) {
      if (b.t === "h") {
        const l = Math.min(Math.max(b.l, 2), 5);
        while (stack.at(-1).l >= l) stack.pop();
        const n = { l, h: plain(b.x), blocks: [], kids: [] }; stack.at(-1).kids.push(n); stack.push(n);
      } else stack.at(-1).blocks.push(b);
    }
    return root;
  };
  const tableHtml = (b, root) => {
    const rows = b.rows, head = rows[0].every((c) => c.h) ? rows[0] : null;
    const cell = (c, tag) => `<${tag}>${inline(c.x, root)}</${tag}>`;
    const body = (head ? rows.slice(1) : rows).map((r) => `<tr>${r.map((c) => cell(c, c.h ? "th" : "td")).join("")}</tr>`).join("");
    const html = `<div class="tscroll"><table>${head ? `<thead><tr>${head.map((c) => cell(c, "th")).join("")}</tr></thead>` : ""}<tbody>${body}</tbody></table></div>`;
    const isForms = rows.some((r) => r.some((c) => /\.(xlsx?|xlsm|docx?|zip)\b/i.test(c.x))) || /様式名/.test(rows[0].map((c) => c.x).join(""));
    return isForms ? `<details class="fold"><summary>様式ダウンロードの一覧(表)</summary>${html}</details>` : html;
  };
  const blocksHtml = (blocks, root) => {
    let out = "", li = [];
    const flush = () => { if (li.length) { out += `<ul>${li.map((x) => `<li>${inline(x, root)}</li>`).join("")}</ul>`; li = []; } };
    for (const b of blocks) {
      if (b.t === "li") { li.push(b.x); continue; }
      flush();
      if (b.t === "table") out += tableHtml(b, root);
      else if (b.t === "p") out += `<p>${inline(b.x, root)}</p>`;
    }
    flush(); return out;
  };
  const DOCS_RE = /(パンフレット|リーフレット|支給要領|要領|様式|申請書|マニュアル|チェックリスト|ダウンロード|Q&A|Ｑ＆Ａ|ＦＡＱ|FAQ|活用事例|事例|過去|手引き|疑義解釈|通知|参考資料)/;
  const YEAR_RE = /^(20\d\d|令和\s*\d+|R\s*\d+)\s*年度?/;
  const NOTICE_RE = /(お知らせ|おしらせ|重要|ご注意|改正内容)/;
  let secN = 0;
  const treeHtml = (node, root, ctxPage) => {
    const body = blocksHtml(node.blocks, root);
    let yearSeen = 0;
    const kids = node.kids.map((k) => {
      const id = k.l === 2 ? `s${++secN}` : "";
      const inner = treeHtml(k, root, ctxPage);
      if (!inner.trim()) return "";
      const lvl = Math.min(k.l + 0, 5);
      const hTag = `h${lvl === 2 ? 2 : lvl === 3 ? 3 : 4}`;
      const hcls = k.l === 2 ? ' class="h2"' : "";
      const isYear = YEAR_RE.test(k.h);
      const collapse = (k.l <= 3 && DOCS_RE.test(k.h) && !NOTICE_RE.test(k.h)) || (isYear && yearSeen++ > 0);
      if (collapse) return `<details class="fold sec"${id ? ` id="${id}"` : ""}><summary><${hTag}>${esc(k.h)}</${hTag}></summary>${inner}</details>`;
      const cls = NOTICE_RE.test(k.h) && k.l <= 3 ? " notice-sec" : "";
      return `<section class="sec${cls}"${id ? ` id="${id}"` : ""}><${hTag}${hcls}>${esc(k.h)}</${hTag}>${inner}</section>`;
    }).join("");
    return body + kids;
  };
  // 見出し付きセクションを探して取り出す(「ポイント」カード用)
  const take = (tree, re) => {
    const walk = (n, parent) => { for (let i = 0; i < n.kids.length; i++) { const k = n.kids[i]; if (re.test(k.h) && (k.blocks.length || k.kids.length)) { n.kids.splice(i, 1); return k; } const r = walk(k, n); if (r) return r; } return null; };
    return walk(tree, null);
  };
  const KEY = [
    ["概要", "どんな助成金?", /^概要$/],
    ["要件", "どんな場合に受けられる?", /^(主な)?(受給|支給)要件$|^助成対象(\(主な要件\)|（主な要件）)?$|^主な(受給|支給)要件/],
    ["金額", "いくら受けられる?", /^(受給|支給|助成)額$/],
  ];
  const sectionText = (n) => plain([...n.blocks.map((b) => b.x ?? ""), ...n.kids.map(sectionText)].join(" "));

  const ctaLinks = (p) => {
    const all = []; for (const b of p.blocks) { const t = b.x ?? JSON.stringify(b.rows ?? ""); for (const m of t.matchAll(/\[([^\]]*)\]\((https:\/\/www\.esop\.mhlw\.go\.jp\/[^)]*)\)/g)) all.push({ label: plain(m[1]), url: m[2] }); }
    return all;
  };
  const crumbsOf = (root, trail) => trail;

  // ---- 詳細ページ ----
  function detailPage(p, ctx) {
    const { page, head, root, esc: e } = ctx;
    secN = 0;
    const tree = buildTree(p.blocks);
    const cur = curated.pages?.[p.slug];
    // 2枚以上そろうときだけツリーから取り出す(1枚だけなら元の位置・順序のまま通常表示)
    const found = KEY.filter(([, , re]) => { const w = (n) => n.kids.some((k) => (re.test(k.h) && (k.blocks.length || k.kids.length)) || w(k)); return w(tree); }).length;
    const cards = found >= 2 ? KEY.map(([id, label, re]) => ({ id, label, node: take(tree, re) })).filter((c) => c.node) : [];
    const keyHtml = cards.length >= 2 ? `<div class="keycards">${cards.map((c) => `<section class="kcard k-${c.id}"><h2>${e(c.label)}</h2>${treeHtml({ ...c.node, kids: c.node.kids, blocks: c.node.blocks }, root, p)}</section>`).join("")}</div>` : "";
    const curatedHtml = cur ? `<section class="curated"><h2>${e(cur.title ?? "主な支給額・要件(公式リーフレットより)")}</h2>${(cur.html ?? "").replace(/<table>/g, '<div class="tscroll"><table>').replace(/<\/table>/g, "</table></div>")}<p class="src">出典: ${cur.sources.map((s) => `<a href="${e(s.url)}" rel="noopener" target="_blank">${e(s.label)}</a>`).join("、")}(${e(cur.checked)}確認)。${e(cur.note ?? "")}</p></section>` : "";
    const rest = treeHtml(tree, root, p);
    // 目次
    const toc = [...rest.matchAll(/<(?:section|details)[^>]* id="(s\d+)"[^>]*>(?:<summary>)?<h2[^>]*>([^<]*)<\/h2>/g)].map((m) => `<a href="#${m[1]}">${m[2]}</a>`);
    const courses = p.courses.length > 1 || (p.courses.length === 1 && p.courses[0].name !== p.title) ? p.courses : [];
    const cta = ctaLinks(p).slice(0, 6);
    const contact = byKey.get(key("https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/koyou_roudou/koyou/kyufukin/toiawase2.html"));
    const req = byKey.get(key("https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/koyou_roudou/koyou/kyufukin/index_00018.html"));
    const fraud = byKey.get(key("https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/koyou_roudou/koyou/kyufukin/index_00061.html"));
    const isCourse = p.kind === "course" && !(cur?.html ?? "").includes("申請先は労働局ではありません");
    const catName = p.courses[0]?.cat ?? (p.notes[0] ?? "");
    const sumOf = roudou.flatMap((g) => g.items).find((i) => i.page === p)?.summary;
    const lead = p.kind === "common" ? COMMON_LEAD[p.slug] ?? "" : p.courses.length === 1 ? p.courses[0].summary : sumOf ? sumOf : p.courses.length > 1 ? `${p.courses.length}つのコースを扱うページです。` : "";
    const body = `${head(root, [["joseikin/", "厚労省の助成金"], ["", p.title.length > 32 ? p.title.slice(0, 32) + "…" : p.title]], p.title, e(lead))}
<div class="main"><div class="wrap"><div class="grid2"><div class="jbody">
<div class="warnbox" style="margin:0 0 18px">厚生労働省の公式ページ(${fmt(fetchedDate)}取得)の内容を、読みやすく並べ替えたものです。助成金は<b>年度ごと・コースごとに要件や金額が改正</b>されます。申請の際は必ず公式ページと最新の支給要領でご確認ください。</div>
${courses.length ? `<div class="box" style="margin-bottom:18px"><h3>このページで扱うコース</h3><ul class="clist">${courses.map((c) => `<li>${e(c.name)}${c.summary ? `<span>${e(c.summary)}</span>` : ""}</li>`).join("")}</ul></div>` : ""}
${curatedHtml}${keyHtml}
${toc.length > 2 ? `<nav class="toc" aria-label="このページの内容"><b>このページの内容</b>${toc.join("")}</nav>` : ""}
${rest || "<p>本文を取得できませんでした。公式ページをご確認ください。</p>"}
</div>
<aside><div class="box"><h3>公式の情報・申請</h3>
<div class="cta"><a class="btn" href="${e(p.url)}" rel="noopener" target="_blank">厚生労働省の公式ページ ↗</a>
${cta.length ? `<a class="btn ghost" href="${e(new Set(cta.map((c) => c.url)).size === 1 ? cta[0].url : "https://www.esop.mhlw.go.jp/")}" rel="noopener" target="_blank">電子申請(雇用関係助成金ポータル) ↗</a>` : ""}
${isCourse && contact ? `<a class="btn ghost" href="${href(root, contact)}">申請先・お問い合わせ先</a>` : ""}
${isCourse && req ? `<a class="btn ghost" href="${href(root, req)}">共通の要件・申請方法</a>` : ""}
${isCourse && fraud ? `<a class="btn ghost" href="${href(root, fraud)}">不正受給について</a>` : ""}
<a class="btn ghost" href="${root}joseikin/">厚労省の助成金一覧へ</a></div>
<div class="warnbox">「助成金の申請代行」などを名乗る勧誘にご注意ください。申請は労働局・ハローワークで直接受け付けています。</div></div></aside></div></div></div>`;
    return page({ title: `${p.title}｜厚労省の助成金｜補助金・助成金のひろば`, desc: lead || `${p.title}の概要・要件・受給額・申請方法(厚生労働省の公式情報より)。`, body, root, nav: "厚労省の助成金", head: `<link rel="stylesheet" href="${root}assets/joseikin.css">` });
  }

  // ---- 一覧(トップ) ----
  function hubPage(ctx) {
    const { page, head, root, esc: e } = ctx;
    const card = (name, summary, p, url, org, sub) => {
      const link = p ? href(root, p) : url;
      const ext = !p;
      return `<article class="jcard" data-s="${e(plain(`${name} ${summary ?? ""} ${org ?? ""}`))}"><h4><a href="${e(link)}"${ext ? ' rel="noopener" target="_blank"' : ""}>${e(name)}${ext ? '<span class="ext">↗</span>' : ""}</a></h4>${summary ? `<p>${e(summary)}</p>` : ""}${org ? `<span class="badge area">${org === "JEED" ? "JEED(独立行政法人 高齢・障害・求職者雇用支援機構)" : e(org)}</span>` : ""}${sub ?? ""}</article>`;
    };
    const needs = NEEDS.map(([label, names]) => `<div class="need"><b>${e(label)}</b><div>${names.map((n) => { const c = findCourse(n); return c ? (c.page ? `<a href="${href(root, c.page)}">${e(n.replace(/（.*$/, "").replace(/^(.*助成金)$/, "$1"))}${/（/.test(n) ? `<small>${e(n.replace(/^[^（]*（/, "").replace(/）$/, ""))}</small>` : ""}</a>` : `<a href="${e(c.url)}" rel="noopener" target="_blank">${e(n.replace(/（.*$/, ""))}<span class="ext">↗</span></a>`) : ""; }).join("")}</div></div>`).join("");
    const catHtml = catalog.map((c) => `<section class="jcat" id="cat${c.no}" data-cat><h3 class="h2">${c.no}. ${e(c.name)}<small>${c.courses.length}コース</small></h3><p class="jlead">${e(CAT_LEAD[c.no] ?? c.note ?? "")}</p><div class="jgrid">${c.courses.map((co) => card(co.name, co.summary, co.page, co.url, co.org, co.altPages.length ? `<p class="alt">${co.altPages.map((a) => `<a href="${e(a.url)}" rel="noopener" target="_blank">${e(a.name.replace(/^職場適応援助者助成金/, "").replace(/[（）]/g, "") || a.name)}<span class="ext">↗</span></a>`).join(" ")}</p>` : "")).join("")}</div></section>`).join("");
    const roudouHtml = `<section class="jcat" id="roudou" data-cat><h3 class="h2">労働条件等関係の助成金<small>${labourCount}制度</small></h3><p class="jlead">賃金の引上げ・労働時間の短縮・安全衛生・退職金共済など、労働基準に関する助成制度です(<a href="${href(root, byKey.get(key("https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/koyou_roudou/roudoukijun/zigyonushi/index_00051.html")) ?? { slug: "roudou-kijun" })}">ご案内ページ</a>)。</p>${roudou.map((g) => `<h4 class="jsub">${e(g.name)}</h4><div class="jgrid">${g.items.map((i) => card(i.name, i.summary, i.page, i.url, i.org)).join("")}</div>`).join("")}</section>`;
    const others = hubGroups.filter((g) => !/雇用関係|労働条件等/.test(g.name));
    const othersHtml = `<section class="jcat" id="others" data-cat><h3 class="h2">事業主団体向け・労働者向けの制度</h3>${others.map((g) => `<h4 class="jsub">${e(g.name)}</h4>${g.note ? `<p class="jlead">${e(g.note)}</p>` : ""}<div class="jgrid">${g.items.map((i) => card(i.name, "", i.page, i.url, i.org)).join("")}</div>`).join("")}</section>`;
    const commonPages = COMMON_ORDER.map((s) => pages.find((p) => p.slug === s)).filter(Boolean);
    const commonHtml = `<section class="jcat" id="common" data-cat><h3 class="h2">申請の前に確認したい共通情報</h3><div class="jgrid">${commonPages.map((p) => card(p.title.replace(/^雇用関係助成金/, "雇用関係助成金 ").replace(/\s+/g, " "), COMMON_LEAD[p.slug], p)).join("")}</div></section>`;
    const body = `${head(root, [["joseikin/", "厚労省の助成金"]], "厚生労働省の助成金・奨励金 完全ガイド", `厚生労働省が実施する雇用関係助成金(${courseCount}コース)と労働条件等関係の助成金(${labourCount}制度)を、目的別にまとめました。各ページで概要・要件・受給額・申請先を確認できます。`)}
<div class="main"><div class="wrap">
<div class="warnbox" style="margin:0 0 20px"><b>助成金に関する勧誘にご注意ください。</b>厚生労働省の委託事業者を名乗り、助成金の申請や受給額の無料査定をうたって勧誘する者の情報が寄せられています。厚生労働省はこの勧誘に関与していません(厚生労働省の公式ページより)。申請窓口は${pages.find((p) => p.slug === "contact") ? `<a href="${href(root, pages.find((p) => p.slug === "contact"))}">都道府県労働局・ハローワーク</a>` : "都道府県労働局・ハローワーク"}です。</div>
<div class="box"><h2 class="jh">助成金と補助金は何が違う?</h2><p style="margin:0">厚生労働省の助成金は、<b>雇用や職場環境の改善などの要件を満たして申請すれば受給できる制度が中心</b>で、多くは通年で受け付けています(予算や公募期間が決まる補助金とは異なります)。ただし、要件を満たす取組を<b>事前に計画して届け出る</b>必要があるコースが多く、取組を始めた後では対象外になることがあります。詳しくは<a href="${root}guide/subsidy-vs-grant/">補助金と助成金の違い</a>と、共通の要件のページをご覧ください。</p></div>
<h2 class="h2">こんなときは、この助成金</h2><div class="needs">${needs}</div>
<h2 class="h2" id="all">制度の一覧</h2>
<div class="jfilter"><label class="sr" for="jq">制度名・キーワードで絞り込み</label><input class="field" id="jq" type="search" placeholder="制度名・キーワードで絞り込み(例: 育児、正社員、障害者、訓練)" autocomplete="off"><span id="jcount" aria-live="polite"></span></div>
<nav class="jnav" aria-label="区分">${catalog.map((c) => `<a href="#cat${c.no}">${c.no}. ${e(c.name.replace(/の助成金$/, ""))}</a>`).join("")}<a href="#roudou">労働条件等関係</a><a href="#others">団体向け・労働者向け</a><a href="#common">共通情報</a></nav>
<p class="jempty" id="jempty" hidden>該当する制度がありません。別のキーワードをお試しください。</p>
${catHtml}${roudouHtml}${othersHtml}${commonHtml}
<p class="src" style="margin-top:28px">出典: <a href="${e(data.source)}" rel="noopener" target="_blank">厚生労働省「各種助成金・奨励金等の制度」</a>およびその下層ページ(${fmt(fetchedDate)}取得)。</p>
</div></div>`;
    return page({ title: "厚生労働省の助成金・奨励金 完全ガイド｜補助金・助成金のひろば", desc: `厚生労働省の雇用関係助成金${courseCount}コースと労働条件等関係の助成金を目的別に一覧。概要・要件・受給額・申請先を確認できます。`, body, root, nav: "厚労省の助成金", head: `<link rel="stylesheet" href="${root}assets/joseikin.css">`, scripts: `<script src="${root}assets/joseikin.js"></script>` });
  }

  return {
    courseCount, labourCount, pageCount: pages.length, fetchedAtJst,
    footerLinks: [["joseikin/", "厚労省の助成金(一覧)"], ...COMMON_ORDER.slice(0, 4).map((s) => pages.find((p) => p.slug === s)).filter(Boolean).map((p) => [`joseikin/${p.slug}/`, p.title])],
    async write(w, ctx) {
      await w("joseikin/index.html", hubPage({ ...ctx, root: "../" }));
      for (const p of pages) await w(`joseikin/${p.slug}/index.html`, detailPage(p, { ...ctx, root: "../../" }));
    },
  };
}
