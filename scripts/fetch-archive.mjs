// jGrants 公開APIから「受付終了・公募予定」の補助金を取得し data/archive.json に保存する(再開可能)。
// 使い方: node scripts/fetch-archive.mjs
// 公募中の制度は fetch.mjs の担当。詳細(目的・業種・補助率)は1件ずつAPIから取得するため時間がかかる。
import { readFile, writeFile } from "node:fs/promises";

const BASE = "https://api.jgrants-portal.go.jp/exp/v1/public/subsidies";
const OUT = new URL("../data/archive.json", import.meta.url);
const OPEN = new URL("../data/subsidies.json", import.meta.url);

async function getJson(url, tries = 4) {
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (i === tries) throw e;
      await new Promise((r) => setTimeout(r, 800 * i));
    }
  }
}
async function pool(items, size, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: size }, async () => { while (next < items.length) { const i = next++; await fn(items[i], i); } }));
}

let prev = { items: [] };
try { prev = JSON.parse(await readFile(OUT, "utf8")); } catch {}
const byId = new Map(prev.items.map((i) => [i.id, i]));
const openIds = new Set(JSON.parse(await readFile(OPEN, "utf8")).items.map((i) => i.id));

const KEYWORDS = ["補助金", "助成金", "給付金", "支援金", "交付金", "奨励金", "補助", "事業", "支援", "補償"];
const list = new Map();
for (const kw of KEYWORDS) {
  const r = await getJson(`${BASE}?keyword=${encodeURIComponent(kw)}&sort=acceptance_end_datetime&order=DESC&acceptance=0`);
  for (const s of r.result ?? []) if (!openIds.has(s.id)) list.set(s.id, s);
  console.log(`「${kw}」: ${r.result?.length ?? 0}件 (累計 ${list.size}件)`);
}
if (prev.items.length >= 100 && list.size < prev.items.length * 0.5) { console.error("取得件数が急減。中止しました。"); process.exit(1); }

const todo = [...list.values()].filter((s) => !byId.get(s.id)?.detail);
console.log(`詳細を取得: ${todo.length}件 (取得済み ${list.size - todo.length}件)`);
let done = 0, failed = 0;
const save = () => writeFile(OUT, JSON.stringify({ fetchedAt: new Date().toISOString(), items: [...byId.values()] }));
await pool(todo, 8, async (s) => {
  let d = null;
  try { d = (await getJson(`${BASE}/id/${s.id}`)).result?.[0] ?? null; } catch (e) { failed++; }
  byId.set(s.id, {
    id: s.id, title: s.title, area: s.target_area_search ?? "", employees: s.target_number_of_employees ?? "", maxLimit: s.subsidy_max_limit ?? null,
    institution: d?.institution_name ?? s.institution_name ?? "", start: s.acceptance_start_datetime ?? null, end: s.acceptance_end_datetime ?? null,
    rate: d?.subsidy_rate ?? null, purpose: d?.use_purpose ?? "", industry: d?.industry ?? "", projectEnd: d?.project_end_deadline ?? null,
    url: d?.front_subsidy_detail_page_url ?? `https://www.jgrants-portal.go.jp/subsidy/${s.id}`, detail: !!d,
  });
  if (++done % 200 === 0) { await save(); console.log(`  ${done}/${todo.length} (失敗 ${failed})`); }
});
// 一覧に出なくなったものは残す(過去の公募実績として価値がある)
await save();
console.log(`保存: data/archive.json (${byId.size}件, 詳細失敗 ${failed}件)。失敗分は再実行で再取得されます。`);
