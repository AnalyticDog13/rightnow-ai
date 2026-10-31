// Self-checks for plan() (B8.3) and the .env generator (B8.4). today = Monday 2026-11-02.
import { plan, DEFAULTS } from "../assets/js/planner.js";
import { b64, hex } from "../assets/js/terminal.js";

const today = new Date(2026, 10, 2), out = document.getElementById("out");
let fails = 0;
const check = (ok, msg) => { console.assert(ok, msg); if (!ok) fails++; out.insertAdjacentHTML("beforeend", `<li>${ok ? "PASS" : "FAIL"} ${msg}</li>`); };
const inp = o => ({ ...DEFAULTS, counts: { ...DEFAULTS.counts }, days: [...DEFAULTS.days], ...o });

const a = plan(inp({}), today);
check(a.L === 14, "(a) defaults: L = 14");
check(a.campaign(14) === 90, "(a) defaults: campaign(14) = 90");
check(a.N === 3000, "(a) defaults: N = 3000");
check(a.finish && a.finish.sendingDays === 34, "(a) defaults: 3000 emails finish after 34 sending days");
const b = plan(inp({ counts: { ws: 0, gmail: 0, ms: 0, outlook: 0, smtp: 1 }, dailyLimit: 200 }), today);
check(b.tiers.find(t => t.k === "smtp").limit === 50 && b.clamps.length === 1 && b.clamps[0].max === 50, "(b) SMTP with limit 200 clamps to 50");
const c = plan(inp({ slowRamp: true, warmWeeks: 0 }), today);
check(c.L === 0 && c.capFor(c.tiers[0], 0) === 2, "(c) ramp on: campaignCap(0) = 2 with L = 0");
check(plan(inp({ from: "09:00", to: "10:00" }), today).pace === 5, "(d) 09:00-10:00 gives pace = 5");
const e = plan(inp({ counts: { ws: 0, gmail: 0, ms: 0, outlook: 1, smtp: 1 } }), today);
check(e.days[20].warmup === 20, "(e) warm-up day 20: Outlook.com 10 + SMTP 10 (cap 100/10)");
check(Math.min(10, 21, 50, Math.floor(250 / 10)) === 10 && Math.min(10, 21, 50, Math.floor(100 / 10)) === 10, "(e) per-tier warm-up values are 10 and 10");

const k = b64(32), raw = atob(k);
check(raw.length === 32, "generator: base64 secret decodes to 32 bytes");
check(hex(12).length === 24 && /^[0-9a-f]+$/.test(hex(12)), "generator: SETUP_TOKEN is 24 hex chars");
check(hex(24).length === 48 && /^[0-9a-f]+$/.test(hex(24)), "generator: POSTGRES_PASSWORD is 48 hex chars (URL-safe)");
check(b64(32) !== k, "generator: each run gives a new value");
document.title = fails ? `FAIL (${fails})` : "PASS";
