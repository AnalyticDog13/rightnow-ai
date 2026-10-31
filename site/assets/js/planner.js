// Postage-meter capacity planner (SITE_SPEC B8.3). Pure plan() + UI. No network, no storage.
// Constants from the source: packages/core/src/accounts/factory.ts (TIER_CAP, maxDailyLimit = floor(cap/2)),
// accounts/open-account.ts (new mailboxes start at min(30, max)), quota.ts effectiveAllowance (slow ramp 2 + 2/day),
// schema.prisma Campaign minGapSec 540 + randomGapSec 300 (690 s average), campaigns/schema.ts officeHours Mon-Fri 09-17,
// deliverability/warmup-settings.ts WARMUP_DEFAULTS (1, +1/day, 10 max) and warmup.ts min(v, 50, floor(cap/10)).
export const TIERS = [["ws", "Google Workspace", 1500, "Google Workspace"], ["gmail", "Gmail (gmail.com)", 400, "Gmail"], ["ms", "Microsoft 365", 5000, "Microsoft 365"], ["outlook", "Outlook.com", 250, "Outlook.com"], ["smtp", "Other IMAP/SMTP", 100, "SMTP"]];
export const AVG_GAP = 690;
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const fmt = dt => `${DOW[dt.getDay()]} ${dt.getDate()} ${MON[dt.getMonth()]}`;
const mins = s => +s.slice(0, 2) * 60 + +s.slice(3);
export const DEFAULTS = { counts: { ws: 3, gmail: 0, ms: 0, outlook: 0, smtp: 0 }, dailyLimit: 30, slowRamp: false, days: [1, 1, 1, 1, 1, 0, 0], from: "09:00", to: "17:00", warmWeeks: 2, leads: 1000, steps: 3 };

// days[] is Mon..Sun; d = 0 is today (the connect day)
export function plan(inp, today) {
  const at = d => new Date(today.getFullYear(), today.getMonth(), today.getDate() + d);
  const sending = d => !!inp.days[(at(d).getDay() + 6) % 7];
  const windowSec = (mins(inp.to) - mins(inp.from)) * 60, pace = Math.max(0, Math.floor(windowSec / AVG_GAP));
  const L = 7 * inp.warmWeeks;
  const tiers = TIERS.map(([k, , cap, short]) => ({ k, short, n: inp.counts[k] || 0, max: Math.floor(cap / 2), limit: Math.min(inp.dailyLimit, Math.floor(cap / 2)), wcap: Math.floor(cap / 10) }));
  const clamps = tiers.filter(t => t.n && inp.dailyLimit > t.max);
  const ramp = d => (inp.slowRamp ? 2 + 2 * d : Infinity);
  const capFor = (t, d) => (sending(d) && d >= L ? Math.min(t.limit, ramp(d), pace) : 0);
  const campaign = d => tiers.reduce((s, t) => s + t.n * capFor(t, d), 0);
  const warmup = d => tiers.reduce((s, t) => s + t.n * Math.min(10, 1 + d, 50, t.wcap), 0);
  const days = Array.from({ length: 60 }, (_, d) => ({ d, date: at(d), campaign: campaign(d), warmup: warmup(d) }));
  const full = tiers.reduce((s, t) => s + t.n * Math.min(t.limit, pace), 0);
  const N = inp.leads * inp.steps, mailboxes = tiers.reduce((s, t) => s + t.n, 0);
  let finish = null;
  if (mailboxes && pace && full && inp.days.some(Boolean)) {
    finish = { over: true };
    for (let d = L, cum = 0, sd = 0; d < L + 3 * 365; d++) {
      const c = campaign(d); if (!c) continue;
      sd++; cum += c;
      if (cum >= N) { finish = { d, sendingDays: sd, date: at(d) }; break; }
    }
  }
  return { valid: windowSec > 0, pace, L, tiers, clamps, capFor, campaign, days, launch: campaign(L), max: Math.max(...days.map(x => x.campaign)), day30: days[30], perWeek: full * inp.days.filter(Boolean).length, N, finish, mailboxes };
}

/* UI */
const n0 = x => x.toLocaleString("en-US");
const step = (id, label, v, max) => `<div class="stp"><span id="l-${id}">${label}</span><div class="stp-c"><button type="button" data-dec="${id}" aria-label="Fewer: ${label}">−</button><input type="number" id="${id}" min="${id === "steps" ? 1 : 0}" max="${max}" value="${v}" inputmode="numeric" aria-labelledby="l-${id}"><button type="button" data-inc="${id}" aria-label="More: ${label}">+</button></div></div>`;
const hours = (id, v, lab) => `<select id="${id}" aria-label="${lab}">${Array.from({ length: 49 }, (_, i) => { const t = `${String(i >> 1).padStart(2, "0")}:${i % 2 ? "30" : "00"}`; return `<option${t === v ? " selected" : ""}>${t}</option>`; }).join("")}</select>`;

export function init(sec) {
  const box = sec.querySelector("[data-pl]"), nowEl = sec.querySelector("[data-now]"), D = DEFAULTS;
  sec.querySelector(".consts").open = false;
  box.innerHTML = `<div class="pin">
    <fieldset><legend>Mailboxes by type</legend>${TIERS.map(([k, l]) => step(k, l, D.counts[k], 50)).join("")}</fieldset>
    <div><label class="lbl" for="lim">Daily limit per mailbox</label><div class="rng"><input type="range" id="lim" min="1" max="200" value="30" aria-describedby="lim-h"><output for="lim" data-o="lim">30</output></div><p class="help" id="lim-h">The app starts new mailboxes at 30 a day.</p><div data-o="clamp"></div></div>
    <div><button type="button" class="sw" role="switch" aria-checked="false" aria-describedby="ramp-h" data-ramp><i></i>Slow ramp-up</button><p class="help" id="ramp-h">Optional per mailbox in the app: 2 on day one, then +2 a day.</p></div>
    <fieldset><legend>Sending days</legend><div class="days">${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((x, i) => `<button type="button" aria-pressed="${!!D.days[i]}" data-day="${i}">${x}</button>`).join("")}</div></fieldset>
    <fieldset><legend>Sending hours</legend><div class="hrs">${hours("from", D.from, "Start time")}<span>to</span>${hours("to", D.to, "End time")}</div><p class="err" data-o="err" aria-live="polite"></p></fieldset>
    <fieldset><legend>Warm-up before launch</legend><div class="seg">${["None", "2 weeks", "3 weeks", "4 weeks"].map((x, i) => `<label><input type="radio" name="wu" value="${i ? i + 1 : 0}"${i === 1 ? " checked" : ""}><span>${x}</span></label>`).join("")}</div></fieldset>
    <fieldset><legend>Campaign size</legend><div class="lds"><label>Leads<input type="number" id="leads" min="1" max="1000000" value="1000" inputmode="numeric"></label>${step("steps", "Steps per lead", 3, 10)}</div></fieldset>
  </div>
  <div class="out">
    <div><span class="eyebrow">CAMPAIGN SENDS ON LAUNCH DAY</span><p class="big"><span data-o="launch"></span><small>/ day on launch day</small></p><div class="bar"><i data-o="bar"></i></div><p class="small muted" data-o="full"></p></div>
    <div class="tiles"><div><span>Launch day</span><b data-o="t1"></b><em data-o="t1d"></em></div><div><span>Day 30</span><b data-o="t2"></b><em data-o="t2d"></em></div><div><span>Per week at full pace</span><b data-o="t3"></b><em>after any ramp-up</em></div></div>
    <div><p class="camp-out" data-o="camp"></p><p class="small subtle">A lower bound: follow-up delays, replies (which stop sequences), bounces, health slow-downs and provider limits change the real pace.</p></div>
    <div class="legend" aria-hidden="true"><span><i></i>Campaign sends</span><span><i class="w"></i>Warm-up (separate, square every 7 days)</span></div>
    <div class="chart" data-o="chart" aria-hidden="true"></div>
    <div class="inspect"><label class="small" for="insp">Inspect day</label><input type="range" id="insp" min="0" max="59" value="14"><output for="insp" data-o="insp"></output></div>
    <div><button type="button" class="textbtn" aria-expanded="false" data-tbl>Show as table</button><div class="dtable sr" data-o="tbl"></div></div>
    <p class="sr" aria-live="polite" data-o="sum"></p>
  </div>`;
  const q = s => box.querySelector(s), o = k => q(`[data-o="${k}"]`);
  const st = { ...D, counts: { ...D.counts }, days: [...D.days] };
  let last = null, tmr;

  const read = () => {
    TIERS.forEach(([k]) => (st.counts[k] = clampInt(q("#" + k), 0, 50)));
    st.dailyLimit = +q("#lim").value; st.steps = clampInt(q("#steps"), 1, 10); st.leads = clampInt(q("#leads"), 1, 1e6);
    st.from = q("#from").value; st.to = q("#to").value; st.warmWeeks = +q("input[name=wu]:checked").value;
  };
  function update() {
    read(); o("lim").textContent = st.dailyLimit;
    const p = plan(st, new Date());
    o("err").textContent = p.valid ? "" : "End time must be after start time";
    rightNow();
    if (!p.valid) return; // keep the last valid result
    last = p;
    o("clamp").innerHTML = p.clamps.map(t => `<p class="clamp">Clamped to ${t.max} for ${t.short}: the app never allows more than half the provider's cap.</p>`).join("");
    const none = !p.finish;
    o("launch").textContent = n0(p.launch);
    o("bar").style.width = (p.max ? (100 * p.launch) / p.max : 0) + "%";
    o("full").textContent = `At full pace: ${n0(p.max)} a day (highest day in the next 60). One mailbox sends at most ${p.pace} a day in this window (690 s average gap).`;
    o("t1").textContent = n0(p.launch); o("t1d").textContent = fmt(p.days[p.L].date);
    o("t2").textContent = n0(p.day30.campaign); o("t2d").textContent = fmt(p.day30.date) + (p.day30.campaign ? "" : " (no sending)");
    o("t3").textContent = n0(p.perWeek);
    o("camp").textContent = none ? "Add a mailbox and a sending window to see a plan."
      : `Your campaign: ${n0(st.leads)} leads × ${st.steps} steps = ${n0(p.N)} emails → ` + (p.finish.over ? "More than 3 years at this volume." : `about ${n0(p.finish.sendingDays)} sending days, done around ${fmt(p.finish.date)}.`);
    o("sum").textContent = none ? o("camp").textContent : `${n0(p.launch)} emails per sending day from launch day. ${o("camp").textContent}`;
    o("tbl").innerHTML = `<table class="tbl"><caption class="sr">Campaign and warm-up sends for the next 60 days</caption><thead><tr><th scope="col">Day</th><th scope="col">Date</th><th scope="col">Campaign</th><th scope="col">Warm-up</th></tr></thead><tbody>${p.days.map(x => `<tr><td class="n">${x.d}</td><td>${fmt(x.date)}</td><td class="n">${x.campaign}</td><td class="n">${x.warmup}</td></tr>`).join("")}</tbody></table>`;
    chart();
  }
  function chart() {
    const p = last, el = o("chart"), W = el.clientWidth || 600, H = el.clientHeight || 200, top = 18, base = H - 20;
    const ymax = Math.max(1, p.max, ...p.days.map(x => x.warmup)), y = v => base - (v / ymax) * (base - top), bw = W / 60, hi = +q("#insp").value;
    let s = `<line class="grid" x1="0" x2="${W}" y1="${top}" y2="${top}"/><text class="ax" x="${W}" y="${top - 5}" text-anchor="end">${n0(ymax)} a day</text>`;
    p.days.forEach((x, i) => {
      s += x.campaign ? `<rect class="b${i === hi ? " hi" : ""}" x="${i * bw + 1}" y="${y(x.campaign)}" width="${Math.max(1, bw - 2)}" height="${base - y(x.campaign)}"/>` : `<rect class="tick" x="${i * bw + 1}" y="${base - 1}" width="${Math.max(1, bw - 2)}" height="1"/>`;
      if (i % 7 === 0) s += `<text class="ax" x="${i * bw}" y="${H - 4}">D${i}</text><rect class="wm" x="${i * bw + bw / 2 - 2}" y="${y(x.warmup) - 2}" width="4" height="4"/>`;
    });
    s += `<path class="wl" d="M0 ${y(p.days[0].warmup)}${p.days.map((x, i) => `H${(i + 1) * bw}${i < 59 ? `V${y(p.days[i + 1].warmup)}` : ""}`).join("")}"/>`;
    const lx = p.L * bw; s += `<line class="ln" x1="${lx}" x2="${lx}" y1="${top}" y2="${base}"/><text class="ax" x="${Math.min(lx + 4, W - 44)}" y="${top - 5}">Launch</text>`;
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${s}</svg>`;
    const x = p.days[hi]; o("insp").textContent = `Day ${hi} · ${fmt(x.date)} · campaign ${x.campaign} · warm-up ${x.warmup}`;
  }
  function rightNow() {
    const now = new Date(), dow = (now.getDay() + 6) % 7, m = now.getHours() * 60 + now.getMinutes(), f = mins(st.from), t = mins(st.to);
    const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    let msg = `Right now it's ${DOW[now.getDay()]} ${hhmm} where you are: `;
    if (t <= f || !st.days.some(Boolean)) msg += "no sending window set.";
    else if (st.days[dow] && m >= f && m < t) msg += "inside your sending window.";
    else for (let k = 0; k < 8; k++) { const dd = (dow + k) % 7; if (st.days[dd] && (k || m < f)) { msg += `outside your sending window. Next window opens ${DOW[(dd + 1) % 7]} ${st.from}.`; break; } }
    nowEl.textContent = msg;
  }
  const later = () => { clearTimeout(tmr); tmr = setTimeout(update, 50); };
  box.addEventListener("input", e => (e.target.id === "insp" ? chart() : later()));
  box.addEventListener("change", e => { if (e.target.type === "number") clampInt(e.target, +e.target.min, +e.target.max, true); later(); });
  box.addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.inc || b.dataset.dec) { const i = q("#" + (b.dataset.inc || b.dataset.dec)); i.value = clampInt(i, +i.min, +i.max) + (b.dataset.inc ? 1 : -1); clampInt(i, +i.min, +i.max, true); later(); }
    else if (b.dataset.day) { const i = +b.dataset.day; st.days[i] = st.days[i] ? 0 : 1; b.setAttribute("aria-pressed", !!st.days[i]); later(); }
    else if (b.hasAttribute("data-ramp")) { st.slowRamp = !st.slowRamp; b.setAttribute("aria-checked", st.slowRamp); later(); }
    else if (b.hasAttribute("data-tbl")) { const open = b.getAttribute("aria-expanded") !== "true"; b.setAttribute("aria-expanded", open); b.textContent = open ? "Hide table" : "Show as table"; o("tbl").classList.toggle("sr", !open); }
  });
  new ResizeObserver(() => last && chart()).observe(o("chart"));
  let clock;
  new IntersectionObserver(es => { clearInterval(clock); if (es[0].isIntersecting) clock = setInterval(rightNow, 60000); }).observe(sec);
  update();
}
function clampInt(input, lo, hi, write) { const v = Math.round(+input.value); const c = Number.isFinite(v) && input.value !== "" ? Math.min(hi, Math.max(lo, v)) : lo; if (write && String(c) !== input.value) input.value = c; return c; }
