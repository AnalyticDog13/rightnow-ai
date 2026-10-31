// Sequence simulator (SITE_SPEC B8.1). Scripted sample events; nothing is sent or fetched.
// Rules shown come from packages/db/prisma/schema.prisma (stopOnReply true, stopOnAutoReply false,
// bounceThresholdPct 3, crmAutoOpportunity true), SYNC_MAX_STALENESS_SEC=300 and docs/COMPLIANCE.md.
import { $, $$, reduced } from "./site.js";

const M = "maya@…";
const S1 = v => ({ t: "D0 09:41", x: `Step 1 sent from ${M}: "${v === "A" ? "Hi" : "Hello"} Dana," (variant ${v})`, n: [0, "sent", "09:41"] });
const S2 = { t: "D3 10:12", x: `Step 2 sent from ${M} (same mailbox, same thread)`, n: [1, "sent", "10:12"] };
const S3 = { t: "D7 09:58", x: `Step 3 sent from ${M}`, n: [2, "sent", "09:58"] };
const SCEN = [
  ["none", "No reply", v => [{ ...S1(v), x: S1(v).x + " · quota reserved: 1 of 30" }, S2, S3,
    { t: "D7", x: "Sequence complete. Lead status: Completed.", end: "sequence complete, 3 steps sent" }]],
  ["interested", "Replies interested", v => [S1(v), S2,
    { t: "D4 08:03", x: 'Reply received ("Sounds good, can you send times for next week?")' },
    { t: "D4 08:04", x: "Mailbox synced → reply matched to the thread" },
    { t: "D4 08:04", x: "Labelled by the rule classifier", p: ["Interested", "ok"] },
    { t: "D4 08:04", x: "Step 3 cancelled (stop on reply)", n: [2, "cancelled"] },
    { t: "D4 08:04", x: "Deal opened in CRM: stage Interested, campaign Harbor Ops intro", crm: 1 },
    { t: "D4 08:04", x: 'Automation "When a lead replies interested" can move the stage or call a webhook (lead_interested).', end: "deal opened, 1 step cancelled" }]],
  ["ooo", "Out of office", v => [S1(v),
    { t: "D0 09:42", x: 'Auto-reply received ("I\'m away until Monday")' },
    { t: "D0 09:42", x: "Labelled and counted apart from real replies", p: ["Out of office", "info"] },
    { t: "D0 09:42", x: "Sequence continues (stop on auto-reply is off by default; you can turn it on per campaign)" },
    S2, S3, { t: "D7", x: "Complete.", end: "sequence complete, auto-reply counted apart" }]],
  ["bounce", "Hard bounce", v => [S1(v),
    { t: "D0 09:43", x: "Bounce received (550 5.1.1 user unknown)" },
    { t: "D0 09:43", x: "Classified", p: ["Hard bounce", "bad"] },
    { t: "D0 09:43", x: "Lead stopped; remaining steps cancelled", n: [1, "cancelled"], n2: [2, "cancelled"] },
    { t: "D0 09:43", x: "Counts toward the mailbox's bounce rate. If bounces pass the workspace threshold (3% by default) the mailbox slows down automatically.", end: "lead stopped, 2 steps cancelled" }]],
  ["unsub", "Asks to unsubscribe", v => [S1(v), S2,
    { t: "D3 13:20", x: 'Reply "please unsubscribe me"' },
    { t: "D3 13:20", x: "Labelled", p: ["Unsubscribe", "bad"] },
    { t: "D3 13:20", x: "Address suppressed and sequences stopped in the same transaction", n: [2, "cancelled"] },
    { t: "D3 13:20", x: "Dana is never emailed again from this workspace.", end: "address suppressed, 1 step cancelled" }]],
  ["asleep", "Laptop asleep", v => [S1(v),
    { t: "D2 18:00", x: "Laptop sleeps (nothing syncs or sends)" },
    { t: "D3", x: "Step 2 is due, but the app is asleep", n: [1, "asleep"] },
    { t: "D3 11:30", x: "Dana replies while the laptop is asleep" },
    { t: "D4 09:05", x: "Laptop wakes" },
    { t: "D4 09:05", x: "Mailbox must sync before it can send (last sync is older than 5 minutes)" },
    { t: "D4 09:06", x: "Sync finds Dana's reply → labelled", p: ["Interested", "ok"], crm: 1 },
    { t: "D4 09:06", x: "Step 2 cancelled: nothing was sent late or twice.", n: [1, "cancelled"], n2: [2, "cancelled"], end: "nothing sent late or twice, 2 steps cancelled" }]],
];

const pmSvg = t => `<svg class="pm thunk" viewBox="0 0 112 112" aria-hidden="true"><g filter="url(#rough)"><circle cx="56" cy="56" r="53" stroke-width="4"/><circle cx="56" cy="56" r="40" stroke-width="2"/><text class="pm-date" x="56" y="54" text-anchor="middle" font-size="22">SENT</text><text class="pm-date" x="56" y="78" text-anchor="middle" font-size="20">${t}</text></g></svg>`;

export function init(sec) {
  const card = $("#sim", sec), scen = $(".scen", card), tl = $(".tl", card), led = $(".ledger", card), out = $(".outcome", card);
  const play = $("[data-play]", card), stepB = $("[data-step]", card), nodes = $$(".node", tl);
  scen.removeAttribute("role"); scen.removeAttribute("aria-label");
  scen.innerHTML = SCEN.map(([id, l], i) => `<label><input type="radio" name="scen" value="${id}"${i === 1 ? " checked" : ""}>${l}</label>`).join("");
  const token = document.createElement("span");
  token.className = "token"; token.setAttribute("aria-hidden", "true"); token.textContent = "DR"; tl.append(token);
  let events = [], i = 0, timer = null;

  const moveToken = n => {
    const el = nodes[n], mob = matchMedia("(max-width: 767px)").matches;
    token.style.transform = mob ? `translate(0, ${el.offsetTop + 8}px)` : `translate(${el.offsetLeft + el.offsetWidth / 2 - 12}px, 0)`;
  };
  const setNode = ([n, st, time]) => {
    const el = nodes[n], s = $("[data-st]", el);
    el.className = "node" + (st === "planned" ? "" : " " + st);
    $(".pm", el)?.remove();
    s.innerHTML = { planned: "Planned", sent: `Sent ${time}`, cancelled: '<span class="pill">Cancelled</span>', asleep: '<span class="pill warn">Due, app asleep</span>' }[st];
    if (st === "sent") el.insertAdjacentHTML("beforeend", pmSvg(`D${["0", "3", "7"][n]}`));
    moveToken(n);
  };
  const reset = () => {
    stop(); i = 0;
    const id = $("input:checked", scen).value;
    events = SCEN.find(s => s[0] === id)[2](Math.random() < 0.5 ? "A" : "B");
    led.innerHTML = ""; out.innerHTML = "";
    nodes.forEach((_, n) => setNode([n, "planned"]));
    moveToken(0); play.textContent = "Play";
  };
  const show = e => {
    const li = document.createElement("li");
    li.innerHTML = `<time>${e.t}</time><span>${e.x}${e.p ? ` <span class="pill ${e.p[1]}">${e.p[0]}</span>` : ""}</span>`;
    led.append(li); led.scrollTop = led.scrollHeight;
    if (e.n) setNode(e.n);
    if (e.n2) setNode(e.n2);
    if (e.crm) out.insertAdjacentHTML("beforeend", '<div class="crmcard"><b>Dana Reyes</b><span>Harbor Ops</span><span class="mono">from Harbor Ops intro</span><span><span class="pill ok">Interested</span> · value —</span></div>');
    if (e.end) out.insertAdjacentHTML("afterbegin", `<span class="chip">Outcome: ${e.end}</span>`);
  };
  const next = () => {
    if (i >= events.length) return stop();
    show(events[i++]);
    if (i >= events.length) { stop(); play.textContent = "Play again"; }
  };
  function stop() { clearInterval(timer); timer = null; if (play.textContent === "Pause") play.textContent = "Play"; }
  const start = () => {
    if (i >= events.length) reset();
    if (reduced) { while (i < events.length) next(); return; }
    next(); if (i < events.length) { timer = setInterval(next, 1100); play.textContent = "Pause"; }
  };
  play.addEventListener("click", () => (timer ? stop() : start()));
  stepB.addEventListener("click", () => { stop(); if (i >= events.length) reset(); next(); });
  $("[data-reset]", card).addEventListener("click", reset);
  scen.addEventListener("change", () => { stop(); reset(); start(); });
  addEventListener("resize", () => { const last = [...events.slice(0, i)].reverse().find(e => e.n); moveToken(last ? last.n[0] : 0); });
  reset();
  // auto-play once, default scenario only, when half visible
  if (!reduced) new IntersectionObserver((es, o) => {
    if (!es[0].isIntersecting) return; o.disconnect();
    if ($("input:checked", scen).value === "interested" && i === 0) start();
  }, { threshold: 0.5 }).observe(card);
}
