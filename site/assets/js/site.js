// Shared page behaviour. Section modules (simulator, inbox-demo, planner, terminal) load lazily near the viewport.
const d = document, root = d.documentElement;
export const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
export const $ = (s, el = d) => el.querySelector(s);
export const $$ = (s, el = d) => [...el.querySelectorAll(s)];
const io = (cb, opt) => new IntersectionObserver((es, o) => es.forEach(e => cb(e, o)), opt);

// polite announcer for copy and other confirmations
const live = d.createElement("div");
live.className = "sr"; live.setAttribute("aria-live", "polite");
d.body.append(live);
export const announce = t => { live.textContent = ""; setTimeout(() => (live.textContent = t), 30); };

/* nav */
const nav = $("#nav"), menuBtn = $("[data-menu]"), menu = $("#nav-menu");
if (nav) {
  const onScroll = () => nav.classList.toggle("scrolled", scrollY > 8);
  addEventListener("scroll", onScroll, { passive: true }); onScroll();
  const setMenu = open => { menu.classList.toggle("open", open); menuBtn.setAttribute("aria-expanded", open); };
  menuBtn.addEventListener("click", () => setMenu(!menu.classList.contains("open")));
  menu.addEventListener("click", e => { if (e.target.closest("a")) setMenu(false); });
  d.addEventListener("keydown", e => { if (e.key === "Escape" && menu.classList.contains("open")) { setMenu(false); menuBtn.focus(); } });
}

/* theme: localStorage["rn-theme"] = light | dark, absent = system */
const sysDark = matchMedia("(prefers-color-scheme: dark)");
function applyTheme() {
  const t = root.getAttribute("data-theme"), eff = t || (sysDark.matches ? "dark" : "light");
  root.setAttribute("data-eff", eff);
  const b = $("[data-theme-toggle]");
  if (b) { b.setAttribute("aria-pressed", eff === "dark"); b.setAttribute("aria-label", `Switch to ${eff === "dark" ? "light" : "dark"} theme`); }
  $$("[data-set-theme]").forEach(x => x.setAttribute("aria-pressed", x.dataset.setTheme === (t || "system")));
  // <source media> cannot see the toggle, so the dark screenshots follow the effective theme here
  $$("source[data-dark]").forEach(s => (s.media = eff === "dark" ? "all" : "not all"));
}
function setTheme(t) {
  if (t === "system") root.removeAttribute("data-theme"); else root.setAttribute("data-theme", t);
  try { t === "system" ? localStorage.removeItem("rn-theme") : localStorage.setItem("rn-theme", t); } catch {}
  applyTheme();
}
$("[data-theme-toggle]")?.addEventListener("click", () => setTheme(root.getAttribute("data-eff") === "dark" ? "light" : "dark"));
$$("[data-set-theme]").forEach(b => b.addEventListener("click", () => setTheme(b.dataset.setTheme)));
sysDark.addEventListener("change", applyTheme);
applyTheme();

/* GitHub star pill: the only third-party request; hidden number on any failure */
(async () => {
  const pills = $$("[data-star]"); if (!pills.length) return;
  let n;
  try { const c = JSON.parse(sessionStorage.getItem("rn-stars")); if (c && Date.now() - c.t < 36e5) n = c.n; } catch {}
  if (n == null) try {
    const r = await fetch("https://api.github.com/repos/AnalyticDog13/rightnow-ai", { signal: AbortSignal.timeout(3000) });
    if (!r.ok) return;
    n = (await r.json()).stargazers_count;
    if (typeof n !== "number") return;
    try { sessionStorage.setItem("rn-stars", JSON.stringify({ n, t: Date.now() })); } catch {}
  } catch { return; }
  // a bare "★ 0" reads as a negative signal; keep the plain "Star on GitHub" label until there are stars
  if (!(n > 0)) return;
  pills.forEach(p => {
    p.lastElementChild.innerHTML = `Star <span class="num">★ ${n}</span>`;
    p.title = "GitHub stars, fetched live";
    p.setAttribute("aria-label", `Star rightnow-ai on GitHub, ${n} stars`);
  });
})();

/* reveals and postmarks */
const rv = io((e, o) => { if (e.isIntersecting) { e.target.classList.add("seen"); o.unobserve(e.target); } }, { threshold: 0.15 });
$$(".rv").forEach(el => rv.observe(el));
const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
export function stamp(pm, l1, l2 = "") {
  const t = $$(".pm-date", pm);
  if (l1) { t[0].textContent = l1; t[1].textContent = l2; }
  if (reduced) return pm.classList.remove("wait");
  pm.classList.remove("wait"); pm.classList.add("thunk");
  const host = pm.parentElement; host.classList.remove("pressed"); void host.offsetWidth; host.classList.add("pressed");
}
const now = new Date(), day = String(now.getDate()).padStart(2, "0");
const pmo = io((e, o) => { if (e.isIntersecting) { stamp(e.target); o.unobserve(e.target); } }, { threshold: 0.5 });
$$(".pm.wait").forEach(pm => { const t = $$(".pm-date", pm); t[0].textContent = `${day} ${MON[now.getMonth()]}`; t[1].textContent = now.getFullYear(); pmo.observe(pm); });

/* copy buttons: copy only command/.env lines (.p/.l), never prompts or comments */
export async function copyText(text, btn, src) {
  const label = btn.querySelector("span") || btn;
  try { await navigator.clipboard.writeText(text); label.textContent = "Copied"; btn.classList.add("done"); announce("Copied to clipboard"); }
  catch { if (src) getSelection().selectAllChildren(src); label.textContent = "Press Ctrl+C"; }
  clearTimeout(btn._t); btn._t = setTimeout(() => { label.textContent = "Copy"; btn.classList.remove("done"); }, 1600);
}
export const codeText = el => { const ls = $$(".p,.l", el); return ls.length ? ls.map(l => l.textContent).join("\n") : el.textContent.trim(); };
d.addEventListener("click", e => { const b = e.target.closest("[data-copy]"); if (b) { const src = $(b.dataset.copy); copyText(codeText(src), b, src); } });

/* WAI-ARIA tabs with a sliding indicator */
export function initTabs(list, onChange) {
  const tabs = $$("[role=tab]", list), ind = d.createElement("span");
  ind.className = "tab-ind"; list.append(ind);
  const place = t => { ind.style.setProperty("--tx", t.offsetLeft + "px"); ind.style.setProperty("--tw", t.offsetWidth + "px"); };
  const select = (t, focus) => {
    const panel = x => d.getElementById(x.getAttribute("aria-controls"));
    tabs.forEach(x => { const on = x === t; x.setAttribute("aria-selected", on); x.tabIndex = on ? 0 : -1; if (panel(x)) panel(x).hidden = true; });
    if (panel(t)) panel(t).hidden = false;
    place(t); if (focus) t.focus(); onChange?.(tabs.indexOf(t));
  };
  tabs.forEach(t => {
    t.type = "button";
    t.addEventListener("click", () => select(t));
    t.addEventListener("keydown", e => {
      const i = tabs.indexOf(t), n = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
      if (n == null) return; e.preventDefault(); select(tabs[(n + tabs.length) % tabs.length], true);
    });
  });
  const cur = tabs.find(t => t.getAttribute("aria-selected") === "true") || tabs[0];
  requestAnimationFrame(() => place(cur));
  new ResizeObserver(() => place(tabs.find(t => t.getAttribute("aria-selected") === "true"))).observe(list);
  return i => select(tabs[i]);
}
$$("main [role=tablist]").forEach(l => initTabs(l));

/* how-it-works rail: scroll-spy + smooth jump */
const rail = $$(".rail a");
if (rail.length) {
  const spy = io(e => { if (e.isIntersecting) rail.forEach(a => a.classList.toggle("on", a.hash === "#" + e.target.id)); }, { rootMargin: "-40% 0px -55% 0px" });
  $$(".step").forEach(s => spy.observe(s));
  rail.forEach(a => a.addEventListener("click", e => { e.preventDefault(); const t = $(a.hash); t.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" }); history.replaceState(null, "", a.hash); }));
}

/* reliability band: single-open disclosure + diagram highlight + pausable dot */
const rel = $("[data-rel]");
if (rel) {
  const bs = $$(".rel-b", rel), groups = $$("[data-n]", rel);
  const pick = i => {
    bs.forEach((b, j) => { b.setAttribute("aria-expanded", i === j); d.getElementById(b.getAttribute("aria-controls")).hidden = i !== j; });
    groups.forEach(g => g.classList.toggle("on", g.dataset.n.split(" ").includes(String(i))));
  };
  bs.forEach((b, i) => b.addEventListener("click", () => pick(i)));
  pick(0);
  const svg = $("svg", rel), pb = $("[data-diag-pause]", rel);
  let paused = reduced, inView = false;
  const sync = () => (paused || !inView ? svg.pauseAnimations() : svg.unpauseAnimations());
  pb.addEventListener("click", () => { paused = !paused; pb.setAttribute("aria-pressed", paused); pb.textContent = paused ? "Play animation" : "Pause animation"; sync(); });
  io(e => { inView = e.isIntersecting; sync(); }).observe(svg);
  sync();
}

/* lazy section modules */
const mods = io((e, o) => { if (!e.isIntersecting) return; o.unobserve(e.target); import(`./${e.target.dataset.mod}.js`).then(m => m.init(e.target)); }, { rootMargin: "600px 0px" });
$$("[data-mod]").forEach(s => mods.observe(s));
