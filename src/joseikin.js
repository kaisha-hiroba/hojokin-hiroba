// 厚労省の助成金一覧: キーワード絞り込み(#q=… でも指定可)
(() => {
  const input = document.getElementById("jq");
  if (!input) return;
  const cards = [...document.querySelectorAll(".jcard")];
  const cats = [...document.querySelectorAll(".jcat[data-cat]")];
  const count = document.getElementById("jcount");
  const empty = document.getElementById("jempty");
  const norm = (s) => s.normalize("NFKC").toLowerCase();
  const apply = () => {
    const terms = norm(input.value).split(/\s+/).filter(Boolean);
    let n = 0;
    for (const c of cards) {
      const hit = !terms.length || terms.every((t) => norm(c.dataset.s).includes(t));
      c.hidden = !hit; if (hit) n++;
    }
    for (const s of document.querySelectorAll(".jsub")) { const g = s.nextElementSibling?.classList.contains("jlead") ? s.nextElementSibling.nextElementSibling : s.nextElementSibling; const none = terms.length > 0 && g && !g.querySelector(".jcard:not([hidden])"); s.hidden = none; if (s.nextElementSibling?.classList.contains("jlead")) s.nextElementSibling.hidden = none; }
    for (const sec of cats) sec.hidden = terms.length > 0 && !sec.querySelector(".jcard:not([hidden])");
    if (count) count.textContent = terms.length ? `${n}件が該当` : "";
    if (empty) empty.hidden = !(terms.length && n === 0);
    try { history.replaceState(null, "", terms.length ? `#q=${encodeURIComponent(input.value)}` : location.pathname); } catch {}
  };
  input.addEventListener("input", apply);
  const m = /^#q=(.*)$/.exec(location.hash);
  if (m) { try { input.value = decodeURIComponent(m[1]); } catch {} apply(); }
})();
