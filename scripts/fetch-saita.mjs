// サイタくん「補助金公開データフィード」(国・都道府県・市区町村、日次更新、CDLA-Permissive-2.0) を取得し data/saita.json に保存する。
// 出典: https://www.subsidy-support.tech/data  (利用時は出典「サイタくん (www.subsidy-support.tech)」の表示が必要)
// 使い方: node scripts/fetch-saita.mjs
import { writeFile, readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";

const META = "https://www.subsidy-support.tech/feed/v1/meta.json";
const OUT = new URL("../data/saita.json", import.meta.url);
const UA = { "user-agent": "hojokin-hiroba-build/1.0" };

const get = async (url, tries = 3) => {
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(url, { headers: UA, redirect: "follow", signal: AbortSignal.timeout(60000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      if (i === tries) throw e;
      await new Promise((r) => setTimeout(r, 1000 * i));
    }
  }
};

const meta = JSON.parse((await get(META)).toString("utf8"));
if (meta.license !== "CDLA-Permissive-2.0") { console.error(`ライセンス表記が想定と異なります: ${meta.license}。取り込みを中止しました。`); process.exit(1); }
const file = meta.files["subsidies.json.gz"];
const gz = await get(new URL("subsidies.json.gz", META).href);
const sha = createHash("sha256").update(gz).digest("hex");
if (sha !== file.sha256) { console.error("sha256 が一致しません。保存を中止しました。"); process.exit(1); }
const rows = JSON.parse(gunzipSync(gz)).subsidies;

let prev = { items: [] };
try { prev = JSON.parse(await readFile(OUT, "utf8")); } catch {}
if (prev.items.length >= 1000 && rows.length < prev.items.length * 0.5) { console.error(`件数が急減(${prev.items.length}→${rows.length})。保存を中止しました。`); process.exit(1); }

const keep = ["id", "title", "description", "prefectures", "municipality", "gov_level", "application_deadline", "acceptance_start", "maximum_amount", "subsidy_rate", "eligible_scale", "support_type", "institution_name", "detailed_url"];
const items = rows.map((r) => {
  const o = Object.fromEntries(keep.map((k) => [k, r[k] ?? null]));
  o.flags = Object.keys(r).filter((k) => /^(category|purpose)_/.test(k) && r[k] === 1);
  return o;
});
await writeFile(OUT, JSON.stringify({ fetchedAt: new Date().toISOString(), generatedAt: meta.generated_at, license: meta.license, attribution: meta.attribution, items }));
console.log(`保存: data/saita.json (${items.length}件, スナップショット ${meta.generated_at})`);
