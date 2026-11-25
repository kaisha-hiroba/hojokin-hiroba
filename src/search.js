// トップページの検索アプリ: キーワード + 多軸ファセット(件数つき) + 並び替え。状態は URL のハッシュに保持する。
(() => {
  const D = JSON.parse(document.getElementById("data").textContent);
  if (!window.__ITEMS__) {
    // 検索データ(assets/items.js)を読み込めなかった場合は、0件ではなく原因が分かる表示にする
    document.getElementById("count").textContent = "検索データを読み込めませんでした";
    document.getElementById("list").innerHTML = `<div class="empty"><h3>検索データを読み込めませんでした</h3><p>通信状況を確認して、ページを再読み込みしてください。解決しない場合は、<a href="purpose/">目的別</a>・<a href="area/">地域別</a>のページから探せます。</p><button class="btn" type="button" onclick="location.reload()">再読み込み</button></div>`;
    return;
  }
  const items = window.__ITEMS__;
  const { purposes, industries, regions, base } = D;
  const allPrefs = regions.flatMap((r) => r.prefs);
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const today = HH.today, diff = HH.diff;

  // ---- 正規化と同義語 ----
  const norm = (s) => String(s).normalize("NFKC").toLowerCase().replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
  const SYN = [["創業", "起業", "スタートアップ", "開業"], ["省エネ", "省エネルギー", "エネルギー", "脱炭素", "再エネ"], ["賃上げ", "賃金", "最低賃金"], ["it", "デジタル", "dx", "システム", "ソフトウェア"], ["設備", "機械", "装置"], ["雇用", "採用", "人材", "従業員"], ["海外", "輸出", "海外展開", "販路"], ["承継", "事業承継", "m&a", "引継ぎ"], ["防災", "安全", "bcp", "耐震"], ["研究", "開発", "実証", "r&d"], ["観光", "インバウンド", "宿泊"], ["農業", "農林", "農林水産", "就農"]].map((g) => g.map(norm));
  const variants = (t) => { const g = SYN.find((g) => g.includes(t)); return g ? g : [t]; };

  const prep = (s) => {
    s.dd = s.x ? diff(s.x) : 99999;
    s.st = s.dd < 0 ? "c" : s.u && diff(s.s) > 0 ? "u" : "o";
    s.title = s.t;
    s._t = norm(s.t); s._o = norm(s.o || "");
    s._h = norm([s.t, s.o, s.a.join(" "), s.mu || "", s.ds || "", s.p.map((i) => purposes[i]).join(" "), s.ia ? "" : s.d.map((i) => industries[i]).join(" "), s.r || ""].join(" "));
    s.isNew = s.st === "o" && s.s && diff(s.s) >= -30;
  };
  items.forEach(prep);
  let pool = items;
  let archiveState = 0; // 0:未取得 1:取得中 2:取得済み
  function loadArchive(cb) {
    if (archiveState === 2) return cb();
    if (archiveState === 1) return;
    archiveState = 1; document.body.classList.add("loading");
    const sc = document.createElement("script"); sc.src = base + "assets/archive.js";
    sc.onload = () => { const a = window.__ARCHIVE__ || []; a.forEach(prep); pool = items.concat(a); archiveState = 2; document.body.classList.remove("loading"); cb(); };
    sc.onerror = () => { archiveState = 0; document.body.classList.remove("loading"); };
    document.head.appendChild(sc);
  }

  // ---- 状態 ----
  const GROUPS = ["purpose", "area", "ind"];
  const S = { status: "", q: "", purpose: new Set(), area: new Set(), ind: new Set(), nat: true, size: "", min: "", max: "", dl: "", rate: false, isNew: false, fav: false, sort: "", page: 1 };
  const SIZES = [["", "指定なし"], ["5", "5名以下"], ["20", "6〜20名"], ["100", "21〜100名"], ["300", "101〜300名"], ["900", "301〜900名"], ["901", "901名以上"]];
  const SIZE_RANGE = { 5: [1, 5], 20: [6, 20], 100: [21, 100], 300: [101, 300], 900: [301, 900], 901: [901, 1e9] };
  const STS = [["", "公募中・公募予定"], ["o", "公募中のみ"], ["u", "公募予定"], ["c", "公募終了(過去の公募)"]];
  const DLS = [["", "指定なし"], ["7", "7日以内"], ["30", "30日以内"], ["90", "90日以内"], ["long", "長期公募(1年超)"], ["none", "随時・期限の記載なし"]];

  function parseHash() {
    const p = new URLSearchParams(location.hash.slice(1));
    S.q = p.get("q") || "";
    for (const g of GROUPS) S[g] = new Set((p.get(g) || "").split("|").filter(Boolean));
    S.nat = p.get("nat") !== "0";
    S.size = p.get("size") || ""; S.min = num(p.get("min")); S.max = num(p.get("max")); S.dl = p.get("dl") || "";
    S.rate = p.get("rate") === "1"; S.isNew = p.get("new") === "1"; S.fav = p.get("fav") === "1";
    S.sort = p.get("sort") || ""; S.status = p.get("st") || ""; S.page = 1;
    if (!SIZE_RANGE[S.size]) S.size = "";
    if (!DLS.some((x) => x[0] === S.dl)) S.dl = "";
    if (!STS.some((x) => x[0] === S.status)) S.status = "";
    if (!["", "rel", "dl", "new", "max"].includes(S.sort)) S.sort = "";
  }
  function writeHash() {
    const p = new URLSearchParams();
    if (S.q) p.set("q", S.q);
    for (const g of GROUPS) if (S[g].size) p.set(g, [...S[g]].join("|"));
    if (!S.nat) p.set("nat", "0");
    for (const k of ["size", "min", "max", "dl", "sort"]) if (S[k]) p.set(k, S[k]);
    if (S.status) p.set("st", S.status);
    if (S.rate) p.set("rate", "1"); if (S.isNew) p.set("new", "1"); if (S.fav) p.set("fav", "1");
    const h = p.toString();
    history.replaceState(null, "", location.pathname + location.search + (h ? "#" + h : ""));
  }

  // ---- 判定 ----
  function sizeOk(s, key) {
    if (!key) return true;
    if (s.emin == null && s.emax == null) return true;
    const [lo, hi] = SIZE_RANGE[key];
    return (s.emax != null && hi <= s.emax) || (s.emin != null && lo >= s.emin);
  }
  const num = (v) => { const t = String(v ?? "").normalize("NFKC").replace(/[,\s]/g, ""); return /^\d+(\.\d+)?$/.test(t) ? t : ""; };
  const terms = () => norm(S.q).split(/[\s　]+/).filter(Boolean).map(variants);
  function match(s, skip, T) {
    if (skip !== "status" && !(S.status === "" ? s.st !== "c" : S.status === s.st)) return false;
    if (T.length && !T.every((vs) => vs.some((v) => s._h.includes(v)))) return false;
    if (skip !== "purpose" && S.purpose.size && !s.p.some((i) => S.purpose.has(purposes[i]))) return false;
    if (skip !== "area" && S.area.size && !((S.nat && s.an) || s.a.some((a) => S.area.has(a)))) return false;
    if (skip !== "ind" && S.ind.size && !(s.ia || s.d.some((i) => S.ind.has(industries[i])))) return false;
    if (skip !== "size" && !sizeOk(s, S.size)) return false;
    if (skip !== "money") {
      if (S.min !== "" && (s.m || 0) < +S.min * 1e4) return false;
      if (S.max !== "" && (!s.m || s.m > +S.max * 1e4)) return false;
    }
    if (skip !== "dl" && S.dl) {
      if (s.st === "c") return false;
      if (S.dl === "none") { if (s.x) return false; } else if (S.dl === "long") { if (!s.x || s.dd <= 365) return false; } else if (s.dd > +S.dl) return false;
    }
    if (S.rate && !s.r) return false;
    if (S.isNew && !s.isNew) return false;
    if (S.fav && !HH.fav.has(s.i)) return false;
    return true;
  }

  // ---- 描画: 結果 ----
  const yen = (n) => { if (!n) return "—"; if (n >= 1e8) return `${+(n / 1e8).toFixed(4)}億円`; if (n >= 1e4) { const v = n / 1e4; return `${(Number.isInteger(v) ? v : +v.toFixed(2)).toLocaleString()}万円`; } return `${n.toLocaleString()}円`; };
  const fmt = (d) => { const [y, m, dd] = d.split("-"); return `${y}年${+m}月${+dd}日`; };
  function pill(s) {
    if (s.st === "c") return `<span class="pill long">受付終了</span>`;
    if (s.st === "u") return `<span class="pill">${fmt(s.s)} 公募開始予定</span>`;
    if (!s.x) return `<span class="pill long">随時・要確認</span>`;
    if (s.dd > 365) return `<span class="pill long">長期公募</span>`;
    const c = s.dd <= 7 ? "urgent" : s.dd <= 30 ? "soon" : "";
    return `<span class="pill ${c}">${s.dd === 0 ? "締切は本日" : `あと${s.dd}日`}</span>`;
  }
  function card(s) {
    const area = s.mu ? `<span class="badge area">${esc((s.a[0] ? s.a[0] + " " : "") + s.mu)}</span>` : s.an ? `<span class="badge nat">全国</span>` : `<span class="badge area">${esc(s.a.length > 3 ? s.a.slice(0, 3).join("・") + `ほか${s.a.length - 3}`: s.a.join("・"))}</span>`;
    const tags = s.p.slice(0, 3).map((i) => `<a class="tag" href="${base}purpose/${D.pslug[i]}/">${esc(purposes[i])}</a>`).join("") + (s.p.length > 3 ? `<span class="tag">+${s.p.length - 3}</span>` : "");
    const fav = HH.fav.has(s.i);
    return `<article class="card"${s.x ? ` data-deadline="${s.x}"` : ""}>
<div class="card-top">${area}${s.isNew ? `<span class="badge new">新着</span>` : ""}${pill(s)}</div>
<h3><a href="${base}subsidy/${s.i}/">${esc(s.t)}</a></h3>
<dl class="kv"><div><dt>上限額</dt><dd class="big">${yen(s.m)}</dd></div><div><dt>補助率</dt><dd>${s.r && s.r.length < 20 ? esc(s.r) : s.r ? "公募要領を確認" : "—"}</dd></div><div><dt>申請締切</dt><dd>${!s.x ? "随時・要確認" : s.dd > 365 ? "随時(長期)" : fmt(s.x)}</dd></div><div><dt>対象規模</dt><dd>${esc(s.e)}</dd></div></dl>
${s.ds ? `<p class="desc">${esc(s.ds)}${s.ds.length >= 70 ? "…" : ""}</p>` : ""}<div class="tags">${tags}</div>${s.o ? `<p class="org">実施: ${esc(s.o)}</p>` : ""}
<button class="fav" type="button" data-fav="${s.i}" aria-pressed="${fav}" aria-label="気になる: ${esc(s.t)}" title="気になるに追加">${fav ? "★" : "☆"}</button></article>`;
  }

  const PAGE = 20;
  function sortFn(T) {
    const by = S.sort || (T.length ? "rel" : "dl");
    const rank = (s) => (s.st === "o" ? 0 : s.st === "u" ? 1 : 2);
    const xk = (s) => s.x || "9999-12-31";
    const dl = (a, b) => rank(a) - rank(b) || (a.st === "c" ? xk(b).localeCompare(xk(a)) : xk(a).localeCompare(xk(b)));
    if (by === "rel" && T.length) return (a, b) => b._sc - a._sc || dl(a, b);
    if (by === "new") return (a, b) => (b.s || "").localeCompare(a.s || "") || dl(a, b);
    if (by === "max") return (a, b) => (b.m || 0) - (a.m || 0) || dl(a, b);
    return dl;
  }
  const list = $("#list"), countEl = $("#count"), chipsEl = $("#chips"), moreBtn = $("#more"), sortEl = $("#sort");

  function render() {
    if (S.status === "c" && archiveState !== 2) loadArchive(render);
    const T = terms();
    const res = pool.filter((s) => match(s, null, T));
    if (T.length) for (const s of res) s._sc = T.reduce((n, vs) => n + (vs.some((v) => s._t.includes(v)) ? 3 : 0) + (vs.some((v) => s._o.includes(v)) ? 1 : 0), 0);
    res.sort(sortFn(T));
    countEl.innerHTML = `<b>${res.length.toLocaleString()}</b>件の補助金・助成金`;
    const shown = res.slice(0, S.page * PAGE);
    list.innerHTML = shown.length ? shown.map(card).join("") : `<div class="empty"><h3>条件に合う補助金が見つかりませんでした</h3><p>キーワードを短くする、地域や業種の絞り込みを外すと見つかることがあります。</p><button class="btn" type="button" id="reset2">条件をすべてクリア</button></div>`;
    moreBtn.hidden = res.length <= shown.length;
    moreBtn.textContent = `さらに表示（残り ${(res.length - shown.length).toLocaleString()} 件）`;
    $("#reset2")?.addEventListener("click", reset);
    renderChips(); renderFacetCounts(T, res.length);
    $("#q").value = S.q; $("#hq").value = S.q;
    sortEl.value = S.sort || (T.length ? "rel" : "dl");
    $$("[data-pressed]").forEach((b) => b.setAttribute("aria-pressed", S[b.dataset.pressed].has(b.dataset.v)));
    writeHash();
  }

  function renderChips() {
    const c = [];
    if (S.q) c.push(["q", "", `「${S.q}」`]);
    for (const g of GROUPS) for (const v of S[g]) c.push([g, v, v]);
    if (!S.nat) c.push(["nat", "", "全国対象を除く"]);
    if (S.status) c.push(["status", "", { o: "公募中のみ", u: "公募予定", c: "公募終了(過去の公募)" }[S.status]]);
    if (S.size) c.push(["size", "", `従業員 ${SIZES.find((x) => x[0] === S.size)[1]}`]);
    if (S.min !== "" || S.max !== "") c.push(["money", "", `上限額 ${S.min !== "" ? S.min + "万円" : ""}〜${S.max !== "" ? S.max + "万円" : ""}`]);
    if (S.dl) c.push(["dl", "", `締切 ${DLS.find((x) => x[0] === S.dl)[1]}`]);
    if (S.rate) c.push(["rate", "", "補助率あり"]);
    if (S.isNew) c.push(["new", "", "新着"]);
    if (S.fav) c.push(["fav", "", "気になるのみ"]);
    chipsEl.innerHTML = c.map(([k, v, l]) => `<span class="fchip">${esc(l)}<button type="button" aria-label="${esc(l)}を解除" data-k="${k}" data-v="${esc(v)}">✕</button></span>`).join("") + (c.length > 1 ? `<button type="button" class="clear" id="clr">すべてクリア</button>` : "");
    $("#clr")?.addEventListener("click", reset);
  }
  chipsEl.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-k]"); if (!b) return;
    const { k, v } = b.dataset;
    if (k === "q") S.q = ""; else if (GROUPS.includes(k)) S[k].delete(v);
    else if (k === "money") { S.min = S.max = ""; $("#min").value = $("#max").value = ""; }
    else if (k === "rate" || k === "new" || k === "fav") S[k === "new" ? "isNew" : k] = false;
    else if (k === "nat") S.nat = true;
    else S[k] = "";
    S.page = 1; syncControls(); render();
  });
  function reset() { S.q = ""; for (const g of GROUPS) S[g].clear(); Object.assign(S, { status: "", nat: true, size: "", min: "", max: "", dl: "", rate: false, isNew: false, fav: false, sort: "", page: 1 }); $("#min").value = $("#max").value = ""; syncControls(); render(); }

  // ---- 描画: サイドバー(件数は他条件を適用した場合の件数) ----
  const opt = (name, val, label, n, type = "checkbox", checked = false) => `<label class="opt${n === 0 ? " zero" : ""}"><input type="${type}" name="${name}" value="${esc(val)}"${checked ? " checked" : ""}><span>${esc(label)}</span><span class="n">${n}</span></label>`;
  function buildSide() {
    $("#f-purpose").innerHTML = purposes.map((p) => opt("purpose", p, p, 0)).join("");
    $("#f-area").innerHTML = `<label class="opt"><input type="checkbox" id="nat" checked><span>全国対象の補助金も含める</span></label>` + regions.map((r) => `<details class="sub"><summary>${esc(r.name)}</summary><div class="opts">${r.prefs.map((p) => opt("area", p, p, 0)).join("")}</div></details>`).join("");
    $("#f-ind").innerHTML = industries.map((p) => opt("ind", p, p, 0)).join("");
    $("#f-size").innerHTML = SIZES.map(([v, l]) => opt("size", v, l, 0, "radio", v === "")).join("");
    $("#f-status").innerHTML = STS.map(([v, l]) => opt("status", v, l, 0, "radio", v === "")).join("");
    $("#f-dl").innerHTML = DLS.map(([v, l]) => opt("dl", v, l, 0, "radio", v === "")).join("");
  }
  function renderFacetCounts(T, total) {
    const cnt = (g, pred) => { const m = new Map(); for (const s of pool) if (match(s, g, T)) pred(s, (k) => m.set(k, (m.get(k) || 0) + 1)); return m; };
    const set = (sel, name, m, key = (x) => x) => $$(`${sel} .opt`).forEach((l) => { if (!$(".n", l)) return; const i = $("input", l); const v = i.value; const n = m.get(key(v)) || 0; $(".n", l).textContent = n; l.classList.toggle("zero", n === 0 && !i.checked); });
    const pm = cnt("purpose", (s, add) => s.p.forEach((i) => add(purposes[i])));
    const am = cnt("area", (s, add) => (S.nat && s.an ? allPrefs : s.a).forEach(add));
    const im = cnt("ind", (s, add) => (s.ia ? industries : s.d.map((i) => industries[i])).forEach(add));
    set("#f-purpose", "purpose", pm); set("#f-area", "area", am); set("#f-ind", "ind", im);
    const sz = new Map(); for (const [v] of SIZES) sz.set(v, pool.filter((s) => match(s, "size", T) && sizeOk(s, v)).length);
    set("#f-size", "size", sz);
    const stm = new Map(); for (const [v] of STS) stm.set(v, pool.filter((s) => match(s, "status", T) && (v === "" ? s.st !== "c" : s.st === v)).length);
    if (archiveState !== 2) stm.set("c", D.archiveCount);
    set("#f-status", "status", stm);
    const dm = new Map(); for (const [v] of DLS) dm.set(v, pool.filter((s) => match(s, "dl", T) && (!v || s.st !== "c") && (!v || (v === "none" ? !s.x : v === "long" ? s.x && s.dd > 365 : s.dd <= +v))).length);
    set("#f-dl", "dl", dm);
    // タブ内タイル
    const maps = { purpose: pm, area: am, ind: im };
    $$("[data-pressed]").forEach((b) => { const n = maps[b.dataset.pressed].get(b.dataset.v) || 0; $("small", b).textContent = n.toLocaleString(); b.classList.toggle("zero", n === 0); });
    $("#side-n").textContent = total.toLocaleString();
  }
  function syncControls() {
    $$("#f-purpose input,#f-area input[name=area],#f-ind input").forEach((i) => (i.checked = S[i.name].has(i.value)));
    $$("#f-size input,#f-dl input,#f-status input").forEach((i) => (i.checked = S[i.name] === i.value));
    $("#nat").checked = S.nat; $("#min").value = S.min; $("#max").value = S.max;
    $("#rate").checked = S.rate; $("#isnew").checked = S.isNew; $("#favonly").checked = S.fav;
    $$("#f-area details").forEach((d) => { if ($$("input:checked", d).length) d.open = true; });
  }
  const on = (id, ev, fn) => $(id).addEventListener(ev, fn);
  const upd = () => { S.page = 1; render(); };
  document.addEventListener("change", (e) => {
    const t = e.target; if (!t.closest("#side")) return;
    if (t.name === "purpose" || t.name === "area" || t.name === "ind") t.checked ? S[t.name].add(t.value) : S[t.name].delete(t.value);
    else if (t.name === "size" || t.name === "dl" || t.name === "status") S[t.name] = t.value;
    else if (t.id === "nat") S.nat = t.checked;
    else if (t.id === "rate") S.rate = t.checked; else if (t.id === "isnew") S.isNew = t.checked; else if (t.id === "favonly") S.fav = t.checked;
    upd();
  });
  ["#min", "#max"].forEach((id) => on(id, "input", () => { S.min = num($("#min").value); S.max = num($("#max").value); upd(); }));

  // ---- 検索ボックス ----
  const setQ = (v) => { S.q = v; upd(); };
  let tmr; const later = (fn) => { clearTimeout(tmr); tmr = setTimeout(fn, 160); };
  ["#hq", "#q"].forEach((id) => on(id, "input", (e) => { S.q = e.target.value; S.page = 1; later(render); }));
  on("#hform", "submit", (e) => { e.preventDefault(); $("#results").scrollIntoView(); });
  $$("[data-q]").forEach((b) => b.addEventListener("click", () => { setQ(b.dataset.q); $("#results").scrollIntoView(); }));
  sortEl.addEventListener("change", () => { S.sort = sortEl.value; upd(); });
  moreBtn.addEventListener("click", () => { S.page++; render(); });
  window.addEventListener("hh-fav", () => { if (S.fav) render(); });
  window.addEventListener("hashchange", () => { parseHash(); syncControls(); render(); });

  // ---- タブ & タイル ----
  const tabBtns = $$(".tabs button");
  tabBtns.forEach((b) => { const id = b.getAttribute("aria-controls"); b.id = "tab-" + id; const p = document.getElementById(id); p.setAttribute("aria-labelledby", b.id); p.tabIndex = 0; b.tabIndex = b.getAttribute("aria-selected") === "true" ? 0 : -1; });
  $(".tabs").addEventListener("keydown", (e) => {
    const i = tabBtns.indexOf(document.activeElement); if (i < 0) return;
    const j = e.key === "ArrowRight" ? (i + 1) % tabBtns.length : e.key === "ArrowLeft" ? (i - 1 + tabBtns.length) % tabBtns.length : e.key === "Home" ? 0 : e.key === "End" ? tabBtns.length - 1 : -1;
    if (j < 0) return; e.preventDefault(); tabBtns[j].focus(); tabBtns[j].click();
  });
  tabBtns.forEach((b) => b.addEventListener("click", () => {
    tabBtns.forEach((x) => { x.setAttribute("aria-selected", x === b); x.tabIndex = x === b ? 0 : -1; });
    $$(".panel").forEach((p) => (p.hidden = p.id !== b.getAttribute("aria-controls")));
  }));
  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-pressed]"); if (t) { const set = S[t.dataset.pressed]; set.has(t.dataset.v) ? set.delete(t.dataset.v) : set.add(t.dataset.v); syncControls(); upd(); $("#results").scrollIntoView(); }
    const q = e.target.closest("[data-apply]"); if (q) { const a = JSON.parse(q.dataset.apply); Object.assign(S, a); syncControls(); upd(); $("#results").scrollIntoView(); }
  });
  on("#diag-go", "click", () => {
    S.purpose = new Set($("#d-p").value ? [$("#d-p").value] : []);
    S.area = new Set($("#d-a").value ? [$("#d-a").value] : []);
    S.size = $("#d-s").value; syncControls(); upd(); $("#results").scrollIntoView();
  });

  // ---- モバイルの絞り込みドロワー ----
  const side = $("#side"), scrim = $("#scrim");
  const mq = window.matchMedia("(max-width:980px)");
  let opener = null;
  const drawer = (o) => {
    side.classList.toggle("open", o); scrim.hidden = !o; document.body.style.overflow = o ? "hidden" : "";
    if (mq.matches) { side.setAttribute("role", "dialog"); side.setAttribute("aria-modal", o ? "true" : "false"); } else { side.removeAttribute("role"); side.removeAttribute("aria-modal"); }
    if (o) { opener = document.activeElement; $("#side-reset")?.focus(); } else if (opener && mq.matches) { opener.focus?.(); opener = null; }
  };
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && side.classList.contains("open")) drawer(false); });
  mq.addEventListener("change", () => { if (!mq.matches && side.classList.contains("open")) drawer(false); });
  $$("[data-open-side]").forEach((b) => b.addEventListener("click", () => drawer(true)));
  $$("[data-close-side]").forEach((b) => b.addEventListener("click", () => drawer(false)));
  scrim.addEventListener("click", () => drawer(false));
  on("#side-reset", "click", reset);

  buildSide(); parseHash(); syncControls(); render();
})();
