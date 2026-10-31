// Unified inbox + CRM demo (SITE_SPEC B8.2). Sample threads only; nothing is sent or fetched.
// Label -> stage mapping follows PS-CRM-03 (Interested -> Interested, Meeting requested -> Meeting Scheduled).
import { $, $$, reduced, announce } from "./site.js";

const T = [
  [1, "Dana Reyes", "Harbor Ops", "maya@outreach-one.example", "Re: Quick question about Harbor Ops", "Sounds good, can you send times for next week?", "Interested", "2 · B"],
  [2, "Tomás Okafor", "Fernway Logistics", "jon@outreach-two.example", "Re: Shipping audits", "I'm out of the office until Monday 3 Nov.", "Out of office", "1 · A"],
  [3, "Priya Nair", "Lattice Dental", "maya@outreach-one.example", "Re: Front desk follow-ups", "Not for us right now, thanks.", "Not interested", "3 · A"],
  [4, "Sam Whitlock", "Northgate Studio", "ops@mail.outreach-three.example", "Re: Studio bookings", "Please remove me from your list.", "Unsubscribe", "2 · A"],
  [5, "Lena Fischer", "Brightwater Labs", "jon@outreach-two.example", "Re: Lab scheduling", "Can we do a call Thursday at 2?", "Meeting requested", "2 · B"],
  [6, "Auto-notify", "Kestrel Freight", "maya@outreach-one.example", "Automatic reply: Kestrel Freight", "Thanks for your message. This mailbox is not monitored.", "Automated", "1 · B"],
].map(([id, name, co, via, subj, snip, label, sv]) => ({ id, name, co, via, subj, snip, label, sv, unread: false }));
const LABELS = ["Interested", "Meeting requested", "Not interested", "Wrong person", "Neutral", "Out of office", "Unsubscribe", "Automated"];
const TONE = { Interested: "ok", "Meeting requested": "ok", "Out of office": "info", Unsubscribe: "bad" };
const STAGES = ["Replied", "Interested", "Meeting Scheduled", "Proposal Sent", "Closed Won"];
const STAGE_FOR = { Interested: "Interested", "Meeting requested": "Meeting Scheduled" };
const FILTERS = ["All", "Interested", "Meeting requested", "Out of office", "Unsubscribe", "Other"];
const pill = l => `<span class="pill ${TONE[l] || ""}">${l}</span>`;
const ini = n => n.split(/[\s-]/).map(w => w[0]).join("").slice(0, 2).toUpperCase();
const byId = id => T.find(t => t.id === id);

export function init(sec) {
  const card = $("#ibx", sec), main = $(".ibx-main", card), rows = $(".rows", card), th = $(".thread", card);
  const fl = $(".filters", card), kan = $(".kan", card), toast = $("[data-toast]", card), pauseB = $("[data-pause]", card);
  let shown = reduced ? [1, 2, 4, 5, 3, 6] : [3, 6], queue = reduced ? [] : [1, 2, 4, 5];
  let sel = shown[0], filter = "All", deals = {}, lifted = null, paused = false, hover = false, timer = null;
  if (reduced) { deals[1] = "Interested"; deals[5] = "Meeting Scheduled"; }
  kan.insertAdjacentHTML("beforeend", '<p class="kan-note" aria-live="polite"></p>');
  const note = t => ($(".kan-note", kan).textContent = t);

  const inFilter = t => filter === "All" || (filter === "Other" ? !FILTERS.includes(t.label) : t.label === filter);
  function renderFilters() {
    fl.innerHTML = FILTERS.map(f => `<button type="button" aria-pressed="${f === filter}">${f === "All" ? `All ${shown.length}` : f}</button>`).join("");
  }
  function renderList(newId) {
    rows.innerHTML = shown.map(byId).filter(inFilter).map(t => `<li${t.id === newId ? ' class="new"' : ""}><button type="button" class="row${t.unread ? " unread" : ""}" data-id="${t.id}" aria-current="${t.id === sel}"><span class="av" aria-hidden="true">${ini(t.name)}</span><span class="nm">${t.name}${t.unread ? '<span class="sr">, unread</span>' : ""}</span>${pill(t.label)}<span class="sj">${t.subj}</span><span class="mb">via ${t.via} · step ${t.sv}</span></button></li>`).join("") || '<li class="note">No threads with this label.</li>';
  }
  function renderThread() {
    const t = byId(sel); if (!t) return (th.innerHTML = "");
    const [step, v] = t.sv.split(" · ");
    th.innerHTML = `<button type="button" class="textbtn back" data-back>← Back to inbox</button>
      <div class="th-h"><h3>${t.subj}</h3>${pill(t.label)}<div class="menu-w"><button type="button" class="btn btn-out btn-sm" aria-haspopup="menu" aria-expanded="false" data-lab>Label</button></div></div>
      <p class="lead-line">${t.name} · ${t.co} · from step ${step}, variant ${v} · sent by ${t.via}</p>
      <div class="msg ours"><small>${t.via} · step ${step}</small>${step === "1" ? `Hi ${t.name.split(" ")[0]}, a quick question about ${t.co}.` : "Following up on my last note. Worth a quick call?"}</div>
      <div class="msg"><small>${t.name}</small>${t.snip}</div>
      <div class="composer"><span>Reply from ${t.via}</span><button type="button" class="btn btn-ink btn-sm" data-reply>Reply</button></div>
      <p class="note" aria-live="polite"></p>`;
  }
  function renderKan() {
    kan.querySelectorAll(".col").forEach(c => c.remove());
    kan.insertAdjacentHTML("afterbegin", STAGES.map(s => {
      const ids = Object.keys(deals).filter(id => deals[id] === s).map(Number);
      return `<div class="col" data-stage="${s}"><p class="kh">${s} <span>${ids.length}</span></p>${ids.map(id => { const t = byId(id); return `<div class="crmcard kc" tabindex="0" draggable="true" data-id="${id}" aria-roledescription="draggable deal" aria-grabbed="${lifted?.id === id}" aria-label="${t.name}, ${t.co}, ${s}"><b>${t.name}</b><span>${t.co}</span><span class="mono">from Harbor Ops intro</span><span>value —</span></div>`; }).join("")}</div>`;
    }).join(""));
  }
  const render = n => { renderFilters(); renderList(n); renderThread(); renderKan(); };

  function relabel(id, label) {
    const t = byId(id); t.label = label;
    const stage = STAGE_FOR[label], had = deals[id];
    if (stage) { deals[id] = stage; note(`${label}: deal ${had ? "moved" : "opened"} in ${stage}.`); }
    else {
      if (had) { const c = $(`.kc[data-id="${id}"]`, kan); c?.classList.add("gone"); }
      setTimeout(() => { delete deals[id]; renderKan(); }, reduced ? 0 : 160);
      note(label === "Unsubscribe" ? "Unsubscribe: address suppressed, sequences stopped." : `${label}: no deal`);
    }
    renderList(); renderThread(); if (stage) renderKan();
    $("[data-lab]", th)?.focus();
  }

  // label menu
  function openMenu(btn) {
    const t = byId(sel), w = btn.parentElement;
    w.insertAdjacentHTML("beforeend", `<div class="menu" role="menu" aria-label="Label">${LABELS.map(l => `<button type="button" role="menuitemradio" aria-checked="${l === t.label}" tabindex="-1">${l}</button>`).join("")}</div>`);
    btn.setAttribute("aria-expanded", "true");
    const items = $$("[role=menuitemradio]", w);
    (items.find(i => i.getAttribute("aria-checked") === "true") || items[0]).focus();
    const close = f => { $(".menu", w)?.remove(); btn.setAttribute("aria-expanded", "false"); document.removeEventListener("pointerdown", outside); if (f) btn.focus(); };
    const outside = e => { if (!w.contains(e.target)) close(); };
    document.addEventListener("pointerdown", outside);
    $(".menu", w).addEventListener("keydown", e => {
      const i = items.indexOf(document.activeElement), k = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: items.length - 1 }[e.key];
      if (k != null) { e.preventDefault(); items[(k + items.length) % items.length].focus(); }
      else if (e.key === "Escape" || e.key === "Tab") { if (e.key === "Escape") e.preventDefault(); close(e.key === "Escape"); }
    });
    $(".menu", w).addEventListener("click", e => { const it = e.target.closest("[role=menuitemradio]"); if (it) { close(); relabel(sel, it.textContent); } });
  }

  card.addEventListener("click", e => {
    const r = e.target.closest(".row"), f = e.target.closest(".filters button");
    if (r) { sel = +r.dataset.id; byId(sel).unread = false; renderList(); renderThread(); main.classList.add("open"); if (matchMedia("(max-width: 767px)").matches) $(".back", th).focus(); }
    else if (f) { filter = FILTERS[$$(".filters button", card).indexOf(f)]; renderFilters(); renderList(); $$(".filters button", card).find(b => b.getAttribute("aria-pressed") === "true").focus(); }
    else if (e.target.closest("[data-back]")) { main.classList.remove("open"); $(`.row[data-id="${sel}"]`, card)?.focus(); }
    else if (e.target.closest("[data-lab]")) openMenu(e.target.closest("[data-lab]"));
    else if (e.target.closest("[data-reply]")) $(".note", th).textContent = "In the app this sends from the same mailbox, in the same thread.";
  });

  // Kanban: keyboard (Space lift, Left/Right move, Space drop, Esc cancel) and pointer drag
  const move = (id, stage, say) => { deals[id] = stage; renderKan(); if (say) { announce(`Moved to ${stage}`); note(`Moved to ${stage}.`); } };
  kan.addEventListener("keydown", e => {
    const c = e.target.closest(".kc"); if (!c) return;
    const id = +c.dataset.id, i = STAGES.indexOf(deals[id]);
    if (e.key === " ") {
      e.preventDefault();
      if (!lifted) { lifted = { id, from: deals[id] }; announce(`Lifted ${byId(id).name}. Left and Right move, Space drops, Escape cancels.`); renderKan(); }
      else { const s = deals[id]; lifted = null; move(id, s, true); }
    } else if (lifted && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      e.preventDefault(); const n = Math.max(0, Math.min(STAGES.length - 1, i + (e.key === "ArrowRight" ? 1 : -1)));
      move(id, STAGES[n]); announce(STAGES[n]);
    } else if (lifted && e.key === "Escape") { const f = lifted.from; lifted = null; move(id, f); announce("Move cancelled"); }
    else return;
    $(`.kc[data-id="${id}"]`, kan)?.focus();
  });
  kan.addEventListener("dragstart", e => { const c = e.target.closest(".kc"); if (c) e.dataTransfer.setData("text/plain", c.dataset.id); });
  kan.addEventListener("dragover", e => { const col = e.target.closest(".col"); if (col) { e.preventDefault(); $$(".col", kan).forEach(x => x.classList.toggle("over", x === col)); } });
  kan.addEventListener("dragleave", e => { if (!kan.contains(e.relatedTarget)) $$(".col", kan).forEach(x => x.classList.remove("over")); });
  kan.addEventListener("drop", e => { const col = e.target.closest(".col"), id = +e.dataTransfer.getData("text/plain"); e.preventDefault(); if (col && deals[id]) move(id, col.dataset.stage, true); });

  // arrivals: four sample replies, one every 2.4 s, once; pausable
  const tick = () => {
    if (paused || hover || !queue.length) return;
    const id = queue.shift(), t = byId(id);
    t.unread = true; shown.unshift(id);
    if (STAGE_FOR[t.label]) deals[id] = STAGE_FOR[t.label];
    toast.textContent = `Synced ${t.via} · 1 new reply`;
    renderFilters(); renderList(id); renderKan();
    if (!queue.length) { clearInterval(timer); pauseB.hidden = true; }
  };
  pauseB.addEventListener("click", () => { paused = !paused; pauseB.setAttribute("aria-pressed", paused); pauseB.textContent = paused ? "Resume" : "Pause"; });
  card.addEventListener("pointerenter", () => (hover = true));
  card.addEventListener("pointerleave", () => (hover = card.contains(document.activeElement)));
  card.addEventListener("focusin", () => (hover = true));
  card.addEventListener("focusout", e => { if (!card.contains(e.relatedTarget)) hover = false; });
  if (reduced) pauseB.hidden = true;
  else new IntersectionObserver((es, o) => { if (es[0].isIntersecting) { o.disconnect(); timer = setInterval(tick, 2400); } }, { threshold: 0.5 }).observe(card);
  render();
}
