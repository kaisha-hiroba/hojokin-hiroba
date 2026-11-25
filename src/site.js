// 全ページ共通: 「気になる」保存(localStorage)と、閲覧時点での残り日数の再計算
(() => {
  const KEY = "hh-fav";
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; } };
  const write = (a) => { try { localStorage.setItem(KEY, JSON.stringify(a)); } catch {} };
  const fav = {
    list: read,
    has: (id) => read().includes(id),
    toggle(id) { const a = read(); const i = a.indexOf(id); i < 0 ? a.push(id) : a.splice(i, 1); write(a); fav.sync(); return i < 0; },
    sync() {
      const a = read();
      document.querySelectorAll("[data-fav]").forEach((b) => { const on = a.includes(b.dataset.fav); b.setAttribute("aria-pressed", on); b.title = on ? "気になるから外す" : "気になるに追加"; const t = b.querySelector(".t"); if (t) t.textContent = on ? "気になる済み" : "気になる"; const s = b.querySelector(".s"); if (s) s.textContent = on ? "★" : "☆"; else if (!t) b.textContent = on ? "★" : "☆"; });
      document.querySelectorAll(".favlink b").forEach((b) => { b.textContent = a.length || ""; b.dataset.n = a.length; });
      window.dispatchEvent(new Event("hh-fav"));
    },
  };
  window.HH = { fav };
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-fav]");
    if (b) { e.preventDefault(); e.stopPropagation(); fav.toggle(b.dataset.fav); }
  });
  const today = new Date(Date.now() + 9 * 36e5).toISOString().slice(0, 10);
  const diff = (d) => Math.round((Date.parse(d) - Date.parse(today)) / 864e5);
  window.HH.today = today; window.HH.diff = diff;
  // 静的に出力されたカード/表示の残り日数を更新
  document.querySelectorAll("[data-deadline]").forEach((el) => {
    const dd = diff(el.dataset.deadline);
    const p = el.querySelector(".pill");
    if (!p) return;
    if (dd < 0) { p.textContent = "受付終了"; p.className = "pill long"; return; }
    if (dd > 365) return;
    p.textContent = dd === 0 ? "締切は本日" : `あと${dd}日`;
    p.className = "pill" + (dd <= 7 ? " urgent" : dd <= 30 ? " soon" : "");
  });
  document.addEventListener("DOMContentLoaded", fav.sync);
  if (document.readyState !== "loading") fav.sync();
})();
