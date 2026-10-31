// Step-through setup walkthrough + .env generator (SITE_SPEC B8.4). Not a shell; nothing leaves the browser.
// Sources: README §1, docs/ops/LOCAL.md First run, docs/ops/VPS.md §1-§3, .env.example, scripts/start.sh,
// docker-compose.yml (caddy runs only with profiles: ["vps"]).
import { $, $$, reduced, copyText, initTabs } from "./site.js";

const rand = n => crypto.getRandomValues(new Uint8Array(n));
export const b64 = n => btoa(String.fromCharCode(...rand(n)));
export const hex = n => [...rand(n)].map(b => b.toString(16).padStart(2, "0")).join("");
export const HOST = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

const P = s => ["p", s], C = s => ["c", s], E = (s, c) => ["l", s, c];
const CLONE = ["Clone", [P("git clone https://github.com/AnalyticDog13/rightnow-ai.git"), P("cd rightnow-ai")]];
const env = (vps, v, dom) => [
  E(`MODE=${vps ? "vps" : "local"}`), ...(vps ? [E(`DOMAIN=${dom}`)] : []), E(`APP_URL=${vps ? "https://" + dom : "http://localhost:3000"}`),
  E(`ENCRYPTION_KEY=${v.ENCRYPTION_KEY || "<openssl rand -base64 32>"}`), E(`BETTER_AUTH_SECRET=${v.BETTER_AUTH_SECRET || "<openssl rand -base64 32>"}`),
  E(`SETUP_TOKEN=${v.SETUP_TOKEN || "<16+ random characters>"}`), ...(vps ? [E(`POSTGRES_PASSWORD=${v.POSTGRES_PASSWORD || "<openssl rand -hex 24>"}`, "   # set before the first start")] : []),
];
const STEPS = {
  laptop: (v) => [["01", ...CLONE], ["02", "Configure", [P("cp .env.example .env"), ...env(false, v), C("# Back up ENCRYPTION_KEY with your database.")], "env"],
    ["03", "Start", [P("scripts/start.sh"), C("# Windows (PowerShell): scripts\\start.ps1"), C("# The first build takes a few minutes.")]],
    ["04", "Sign up", [C("# Open http://localhost:3000/sign-up and create the owner with your SETUP_TOKEN."), C("# Always use the exact host in APP_URL (localhost, not 127.0.0.1).")], "done"]],
  vps: (v, dom) => [["00", "Server and DNS", [C("# A Linux VPS with Docker Engine + Compose and git (1 vCPU / 2 GB RAM)."), C(`# Point an A record for ${dom} at the server, then:`), P("ufw allow 22,80,443/tcp && ufw enable")]],
    ["01", ...CLONE], ["02", "Configure", [P("cp .env.example .env"), ...env(true, v, dom)], "env"],
    ["03", "Start", [P("scripts/start.sh"), C("# MODE=vps adds Caddy, which gets a Let's Encrypt certificate automatically.")]],
    ["04", "Sign up", [C(`# Open https://${dom}/sign-up and create the owner with your SETUP_TOKEN.`)], "done"],
    ["05", "Back up nightly", [E("0 3 * * * cd /home/you/rightnow-ai && mkdir -p backups && scripts/backup.sh >> backups/cron.log 2>&1 && find backups -name '*.dump' -mtime +14 -delete"), C("# Copy backups/ off the server and keep ENCRYPTION_KEY somewhere separate.")]]],
};
const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const line = ([k, s, c]) => k === "c" ? `<span class="tline c">${esc(s)}</span>` : `<span class="tline"><span class="${k}">${esc(s)}</span>${c ? `<span class="c">${esc(c)}</span>` : ""}</span>`;
const cmds = ls => ls.filter(l => l[0] !== "c").map(l => l[1]).join("\n");

export function init(sec) {
  const term = $("#term", sec), cards = $$("[data-dep]", sec);
  const secrets = {}; // in memory only: never stored, logged or put in the URL
  let tab = "laptop", cur = 0, dom = "app.example.com", typing;
  term.innerHTML = `<div class="term-h"><div class="dots" aria-hidden="true"><i></i><i></i><i></i></div>
    <div class="tabs" role="tablist" aria-label="Where you run it"><button role="tab" id="tt-laptop" aria-controls="tview" aria-selected="true">Laptop</button><button role="tab" id="tt-vps" aria-controls="tview" aria-selected="false" tabindex="-1">VPS</button></div>
    <p class="lbl">Walkthrough, not a live terminal</p></div>
    <div class="tmob"><button type="button" class="btn btn-out btn-sm" data-prev>Prev</button><span data-pos aria-live="polite"></span><button type="button" class="btn btn-out btn-sm" data-next>Next</button></div>
    <div class="term-b"><nav class="tsteps" aria-label="Setup steps"></nav><div class="tview" id="tview" role="tabpanel" aria-labelledby="tt-laptop"></div></div>`;
  const view = $(".tview", term), list = $(".tsteps", term);
  const steps = () => STEPS[tab](secrets, dom);

  function render(animate) {
    clearInterval(typing);
    const all = steps(), [num, name, ls, kind] = all[cur];
    list.innerHTML = all.map(([n, t], i) => `<button type="button" data-go="${i}"${i === cur ? ' aria-current="step"' : ""}>${n} ${t}</button>`).join("");
    $("[data-pos]", term).textContent = `Step ${cur + 1} of ${all.length}: ${name}`;
    view.setAttribute("aria-labelledby", "tt-" + tab);
    view.innerHTML = `<div class="trow"><span class="small muted">Step ${num} · ${name}</span>${ls.some(l => l[0] !== "c") ? '<button type="button" class="copy" data-c="step"><span>Copy</span></button>' : ""}</div>
      <pre tabindex="0" aria-label="Step ${num} commands"><code>${ls.map(line).join("")}</code></pre>
      ${kind === "env" ? `<div class="gen"><div class="trow"><button type="button" class="btn btn-ink btn-sm" data-gen>Generate secrets in this browser</button><button type="button" class="copy" data-c="env"><span>Copy .env</span></button></div>
        ${tab === "vps" ? `<div class="dom"><label for="dom">Your domain</label><input id="dom" value="${dom}" spellcheck="false" autocomplete="off" aria-describedby="dom-e"><span class="err" id="dom-e"></span></div>` : ""}
        <p class="small muted">Generated with your browser's crypto.getRandomValues. Nothing is sent anywhere; this page has no server. Prefer the terminal? Run openssl rand -base64 32.</p></div>` : ""}
      ${kind === "done" ? `<pre><code><span class="tline c"># Next: connect a mailbox under Accounts.</span></code></pre><svg class="pm" viewBox="0 0 112 112" aria-hidden="true"><g filter="url(#rough)"><circle cx="56" cy="56" r="53" stroke-width="2"/><circle cx="56" cy="56" r="37"/><path id="pmr-t" d="M12 56a44 44 0 1 1 88 0a44 44 0 1 1-88 0" fill="none"/><text class="pm-ring"><textPath href="#pmr-t" textLength="262">SENT FROM YOUR OWN SERVER · RIGHTNOW-AI ·</textPath></text><text class="pm-date" x="56" y="61" text-anchor="middle">RUNNING</text></g></svg>` : ""}
      <div class="trow"><button type="button" class="btn btn-out btn-sm" data-c="all">Copy all steps</button></div>`;
    $("[data-prev]", term).disabled = cur === 0; $("[data-next]", term).disabled = cur === all.length - 1;
    const pm = $(".pm", view); if (pm && !reduced) pm.classList.add("thunk");
    if (animate && !reduced) type();
  }
  function type() {
    const spans = $$(".tline > .p, .tline > .l", view), full = spans.map(s => s.textContent);
    const total = full.join("").length, per = Math.max(1, Math.ceil(total / (900 / 14)));
    spans.forEach(s => (s.textContent = "")); let si = 0, ci = 0;
    const caret = document.createElement("span"); caret.className = "caret"; caret.setAttribute("aria-hidden", "true");
    typing = setInterval(() => {
      for (let k = 0; k < per && si < spans.length; k++) { ci++; if (ci > full[si].length) { si++; ci = 0; } else spans[si].textContent = full[si].slice(0, ci); }
      if (si < spans.length) spans[si].after(caret); else { caret.remove(); clearInterval(typing); }
    }, 14);
  }
  const go = (i, anim) => { cur = Math.max(0, Math.min(steps().length - 1, i)); render(anim); };
  const selectTab = initTabs($("[role=tablist]", term), i => {
    const t = i ? "vps" : "laptop"; if (t === tab) return;
    tab = t; cur = 0; render(true);
    cards.forEach(c => { const on = c.dataset.dep === tab; c.classList.toggle("on", on); $("button", c).setAttribute("aria-pressed", on); });
  });
  cards.forEach((c, i) => c.addEventListener("click", () => selectTab(i)));
  term.addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.go) go(+b.dataset.go);
    else if (b.hasAttribute("data-prev")) go(cur - 1);
    else if (b.hasAttribute("data-next")) go(cur + 1);
    else if (b.hasAttribute("data-gen")) {
      Object.assign(secrets, { ENCRYPTION_KEY: b64(32), BETTER_AUTH_SECRET: b64(32), SETUP_TOKEN: hex(12) }, tab === "vps" ? { POSTGRES_PASSWORD: hex(24) } : {});
      render(); $("[data-gen]", view).focus();
    } else if (b.dataset.c) {
      const all = steps(), text = b.dataset.c === "all" ? all.map(s => cmds(s[2])).filter(Boolean).join("\n") : b.dataset.c === "env" ? cmds(all[cur][2].filter(l => l[0] === "l")) : cmds(all[cur][2]);
      copyText(text, b, $("pre", view));
    }
  });
  term.addEventListener("change", e => {
    if (e.target.id !== "dom") return;
    const v = e.target.value.trim().toLowerCase(), ok = HOST.test(v);
    e.target.setAttribute("aria-invalid", !ok);
    if (!ok) return ($("#dom-e", view).textContent = "Enter a hostname like app.example.com");
    dom = v; render(); $("#dom", view).focus();
  });
  let started = false;
  new IntersectionObserver((es, o) => { if (es[0].isIntersecting && !started) { started = true; o.disconnect(); render(true); } }, { threshold: 0.3 }).observe(term);
  render();
}
