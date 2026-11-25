// jGrants 公開APIから公募中の補助金を取得し data/subsidies.json に保存する。
// 使い方: node scripts/fetch.mjs
import { readFile, writeFile, mkdir } from "node:fs/promises";

const BASE = "https://api.jgrants-portal.go.jp/exp/v1/public/subsidies";
const OUT = new URL("../data/subsidies.json", import.meta.url);

async function getJson(url, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (i === tries) throw e;
      await new Promise((r) => setTimeout(r, 1000 * i));
    }
  }
}

async function pool(items, size, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

// 前回の取得結果(詳細取得に失敗したときの穴埋め・件数の急減検知に使う)
let prev = { items: [] };
try {
  prev = JSON.parse(await readFile(OUT, "utf8"));
} catch {}
const prevById = new Map(prev.items.map((i) => [i.id, i]));

// 「補助金」だけだと助成金・給付金を取りこぼすため、複数キーワードを統合する
// APIにキーワード無指定の一覧がないため、名称に使われやすい語を広めに取って統合する(IDで重複排除)。
const KEYWORDS = [
  "補助金", "助成金", "給付金", "支援金", "交付金", "奨励金", "補助", "助成", "支援",
  "事業", "応援", "融資", "貸付", "認定", "募集", "令和", "制度", "支給", "実績報告",
];
const byId = new Map();
for (const kw of KEYWORDS) {
  const r = await getJson(
    `${BASE}?keyword=${encodeURIComponent(kw)}&sort=acceptance_end_datetime&order=ASC&acceptance=1`,
  );
  const got = r.result ?? [];
  const total = r.metadata?.resultset?.count;
  if (typeof total === "number" && total > got.length)
    console.warn(`警告: ${kw} は ${total}件中 ${got.length}件しか返りませんでした(取りこぼしの可能性)`);
  for (const s of got) byId.set(s.id, s);
  console.log(`キーワード「${kw}」: ${got.length}件 (累計 ${byId.size}件)`);
}
const list = { result: [...byId.values()] };

// 件数が前回の半分未満なら、障害とみなして既存データを上書きしない
if (prev.items.length >= 20 && list.result.length < prev.items.length * 0.5) {
  console.error(`取得件数が急減(${prev.items.length}→${list.result.length})。保存を中止しました。`);
  process.exit(1);
}

const items = await pool(list.result, 5, async (s) => {
  let d = {};
  try {
    d = (await getJson(`${BASE}/id/${s.id}`)).result?.[0] ?? {};
  } catch (e) {
    console.warn(`詳細取得失敗 ${s.id}: ${e.message}`);
    const p = prevById.get(s.id); // 前回値で穴埋め
    if (p) d = { subsidy_rate: p.rate, use_purpose: p.purpose, industry: p.industry, institution_name: p.institution, project_end_deadline: p.projectEnd, front_subsidy_detail_page_url: p.url };
  }
  return {
    id: s.id,
    title: s.title,
    area: s.target_area_search ?? "",
    employees: s.target_number_of_employees ?? "",
    maxLimit: s.subsidy_max_limit ?? null,
    rate: d.subsidy_rate ?? null,
    purpose: d.use_purpose ?? "",
    industry: d.industry ?? "",
    institution: d.institution_name ?? "",
    start: s.acceptance_start_datetime ?? null, // 公募開始 (UTC ISO)
    end: s.acceptance_end_datetime ?? null, // 申請締切 (UTC ISO)
    projectEnd: d.project_end_deadline ?? null, // 事業終了期限
    url: d.front_subsidy_detail_page_url ?? `https://www.jgrants-portal.go.jp/subsidy/${s.id}`,
  };
});

await mkdir(new URL("../data/", import.meta.url), { recursive: true });
await writeFile(
  OUT,
  JSON.stringify({ fetchedAt: new Date().toISOString(), items }, null, 1),
);
console.log(`保存: data/subsidies.json (${items.length}件)`);
