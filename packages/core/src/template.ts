import { pick } from "./spintax";

export { pick };

export type RenderContext = {
  lead: Record<string, string | number | boolean | null>;
  sender: { firstName: string; lastName: string; email: string };
  unsubscribeLink?: string;
};
export type TemplateIssue = {
  code: "unknown_variable" | "unmatched_braces" | "missing_random_keyword" | "empty_fallback" | "unclosed_if" | "bad_if";
  message: string;
  index: number;
  variable?: string;
};

export class TemplateError extends Error {
  constructor(
    message: string,
    readonly issues: TemplateIssue[] = [],
  ) {
    super(message);
    this.name = "TemplateError";
  }
}

export const MAX_TEMPLATE_LENGTH = 100_000;
export const MAX_TEMPLATE_DEPTH = 20;

const LEAD_STANDARD = ["email", "firstName", "lastName", "companyName", "companyDomain", "jobTitle", "website", "industry", "phone", "personalization"];
const SENDER_VARS = ["sendingAccountFirstName", "sendingAccountLastName", "sendingAccountEmail", "unsubscribeLink"];
/** Names that are always valid; custom fields are valid when present in the lead map. */
export const TEMPLATE_VARIABLES: readonly string[] = [...LEAD_STANDARD, ...SENDER_VARS];
const STANDARD = new Set(TEMPLATE_VARIABLES);
const IDENT = /^[A-Za-z_]\w*$/;

type Node =
  | { k: "t"; v: string }
  | { k: "v"; parts: string[]; index: number }
  | { k: "r"; opts: Node[][]; n: number }
  | { k: "i"; name: string; op?: "==" | "!="; val?: string; a: Node[]; b: Node[]; index: number };

class Fatal extends Error {
  constructor(readonly issue: TemplateIssue) {
    super(issue.message);
  }
}
const fatal = (code: TemplateIssue["code"], message: string, index: number): never => {
  throw new Fatal({ code, message, index });
};

/** Parses once. Structural problems throw Fatal (fail fast keeps pathological input cheap); soft ones collect in `issues`. */
function analyze(src: string): { nodes: Node[]; issues: TemplateIssue[] } | { fatal: TemplateIssue } {
  const issues: TemplateIssue[] = [];
  let randoms = 0;
  if (src.length > MAX_TEMPLATE_LENGTH) {
    return { fatal: { code: "unmatched_braces", message: `Template exceeds ${MAX_TEMPLATE_LENGTH} characters`, index: 0 } };
  }

  const matchClose = (from: number, to: number): number => {
    let d = 1;
    for (let i = from; i < to - 1; i++) {
      if (src[i] === "{" && src[i + 1] === "{") {
        d++;
        i++;
      } else if (src[i] === "}" && src[i + 1] === "}") {
        if (--d === 0) return i;
        i++;
      }
    }
    return fatal("unmatched_braces", "Unmatched {{", from - 2);
  };

  // Splits [from,to) on top-level pipes (not inside nested {{ }} or {% %}).
  const splitPipes = (from: number, to: number): [number, number][] => {
    const out: [number, number][] = [];
    let start = from;
    let d = 0;
    for (let i = from; i < to; i++) {
      const c = src[i];
      const c2 = src[i + 1];
      if (c === "{" && c2 === "{") {
        d++;
        i++;
      } else if (c === "}" && c2 === "}") {
        d--;
        i++;
      } else if (c === "{" && c2 === "%") {
        const e = src.indexOf("%}", i + 2);
        i = e < 0 || e >= to ? to : e + 1;
      } else if (c === "|" && d === 0) {
        out.push([start, i]);
        start = i + 1;
      }
    }
    out.push([start, to]);
    return out;
  };

  // Options are trimmed by range, so absolute indexes stay valid.
  const lead = (a: number, b: number) => src.slice(a, b).length - src.slice(a, b).trimStart().length;
  const trail = (a: number, b: number) => src.slice(a, b).length - src.slice(a, b).trimEnd().length;

  const tag = (from: number, to: number, depth: number): Node => {
    const ranges = splitPipes(from, to);
    const [a0, b0] = ranges[0]!;
    const first = src.slice(a0, b0).trim();
    if (first === "RANDOM") {
      if (ranges.length < 2) fatal("empty_fallback", "RANDOM needs at least one option", from);
      const n = randoms++;
      return { k: "r", n, opts: ranges.slice(1).map(([a, b]) => seq(a + lead(a, b), b - trail(a, b), depth + 1, false).nodes) };
    }
    const parts = ranges.map(([a, b]) => src.slice(a, b).trim());
    if (parts.length > 1 && !IDENT.test(first)) {
      issues.push({ code: "missing_random_keyword", message: `"${first}" is not a variable; did you mean {{RANDOM | ...}}?`, index: from });
    } else if (!IDENT.test(first)) {
      issues.push({ code: first ? "unknown_variable" : "empty_fallback", message: first ? `Unknown variable "${first}"` : "Empty variable", index: from, variable: first || undefined });
    }
    if (parts.slice(1).some((p) => !p)) issues.push({ code: "empty_fallback", message: "Empty fallback", index: from });
    if (parts.slice(1).some((p) => p.includes("{{") || p.includes("{%"))) {
      issues.push({ code: "unmatched_braces", message: "Fallback text cannot contain {{ or {% (nest variables inside {{RANDOM | ...}} instead)", index: from });
    }
    return { k: "v", parts, index: from };
  };

  const cond = (body: string, index: number): { name: string; op?: "==" | "!="; val?: string } => {
    const m = /^if\s+([A-Za-z_]\w*)(?:\s*(==|!=)\s*(?:"([^"]*)"|'([^']*)'))?$/.exec(body);
    if (!m) return fatal("bad_if", `Malformed condition "{% ${body} %}"`, index);
    return { name: m[1]!, op: m[2] as "==" | "!=" | undefined, val: m[3] ?? m[4] };
  };

  function seq(from: number, to: number, depth: number, inIf: boolean): { nodes: Node[]; stop?: "else" | "endif"; at: number } {
    if (depth > MAX_TEMPLATE_DEPTH) fatal("unmatched_braces", `Nesting deeper than ${MAX_TEMPLATE_DEPTH}`, from);
    const nodes: Node[] = [];
    let i = from;
    let a = -2; // -1 = none left; otherwise re-search only once passed, keeping the scan linear
    let b = -2;
    while (i < to) {
      if (a !== -1 && a < i) a = src.indexOf("{{", i);
      if (b !== -1 && b < i) b = src.indexOf("{%", i);
      const ia = a < 0 || a >= to ? Infinity : a;
      const ib = b < 0 || b >= to ? Infinity : b;
      const next = Math.min(ia, ib);
      if (next === Infinity) break;
      if (next > i) nodes.push({ k: "t", v: src.slice(i, next) });
      if (next === ia) {
        const close = matchClose(a + 2, to);
        nodes.push(tag(a + 2, close, depth));
        i = close + 2;
        continue;
      }
      const e = src.indexOf("%}", b + 2);
      if (e < 0 || e + 2 > to) fatal("unmatched_braces", "Unmatched {%", b);
      const body = src.slice(b + 2, e).trim();
      i = e + 2;
      if (body === "else" || body === "endif") {
        if (!inIf) fatal("bad_if", `Unexpected {% ${body} %}`, b);
        return { nodes, stop: body, at: i };
      }
      const c = cond(body, b);
      const th = seq(i, to, depth + 1, true);
      let el: Node[] = [];
      let end = th;
      if (th.stop === "else") {
        end = seq(th.at, to, depth + 1, true);
        el = end.nodes;
        if (end.stop === "else") fatal("bad_if", "Second {% else %}", b);
      }
      if (end.stop !== "endif") fatal("unclosed_if", "{% if %} is never closed", b);
      nodes.push({ k: "i", ...c, a: th.nodes, b: el, index: b });
      i = end.at;
    }
    if (i < to) nodes.push({ k: "t", v: src.slice(i, to) });
    return { nodes, at: to };
  }

  try {
    return { nodes: seq(0, src.length, 0, false).nodes, issues };
  } catch (e) {
    if (e instanceof Fatal) return { fatal: e.issue };
    throw e;
  }
}

function walk(nodes: Node[], f: (n: Node) => void): void {
  for (const n of nodes) {
    f(n);
    if (n.k === "r") n.opts.forEach((o) => walk(o, f));
    else if (n.k === "i") {
      walk(n.a, f);
      walk(n.b, f);
    }
  }
}

export function validateTemplate(template: string, known: ReadonlySet<string>): TemplateIssue[] {
  const r = analyze(template);
  if ("fatal" in r) return [r.fatal];
  const out = [...r.issues];
  const unknown = (name: string, index: number) => out.push({ code: "unknown_variable", message: `Unknown variable "${name}"`, index, variable: name });
  walk(r.nodes, (n) => {
    if (n.k === "v" && IDENT.test(n.parts[0]!) && !known.has(n.parts[0]!)) unknown(n.parts[0]!, n.index);
    else if (n.k === "i" && !known.has(n.name)) unknown(n.name, n.index);
  });
  return out.sort((a, b) => a.index - b.index);
}

/** Variables a template reads (first part of each chain, plus if-conditions), deduped in order of appearance. */
export function templateVariables(template: string): string[] {
  const r = analyze(template);
  if ("fatal" in r) return [];
  const seen = new Set<string>();
  walk(r.nodes, (n) => {
    if (n.k === "v" && IDENT.test(n.parts[0]!)) seen.add(n.parts[0]!);
    else if (n.k === "i") seen.add(n.name);
  });
  return [...seen];
}

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]!);

/**
 * `html` escapes merge values (lead data is untrusted); `singleLine` (subjects) turns every [\r\n\t]+ in the
 * output into one space so lead data can never inject headers. A chain that ends empty is listed in `missing`.
 */
export function renderDetailed(
  template: string,
  ctx: RenderContext,
  opts: { seed: string; html: boolean; singleLine?: boolean },
): { text: string; missing: string[] } {
  const r = analyze(template);
  if ("fatal" in r) throw new TemplateError(r.fatal.message, [r.fatal]);
  if (r.issues.length) throw new TemplateError(r.issues[0]!.message, r.issues);

  const isVar = (name: string) => STANDARD.has(name) || Object.hasOwn(ctx.lead, name);
  const value = (name: string): string => {
    const s = ctx.sender;
    const v =
      name === "sendingAccountFirstName" ? s.firstName
      : name === "sendingAccountLastName" ? s.lastName
      : name === "sendingAccountEmail" ? s.email
      : name === "unsubscribeLink" ? ctx.unsubscribeLink
      : Object.hasOwn(ctx.lead, name) ? ctx.lead[name]
      : undefined;
    return v == null || String(v).trim() === "" ? "" : String(v);
  };
  const need = (name: string, index: number) => {
    if (!isVar(name)) {
      const message = `Unknown variable "${name}"`;
      throw new TemplateError(message, [{ code: "unknown_variable", message, index, variable: name }]);
    }
  };

  const missing = new Set<string>();
  const run = (nodes: Node[]): string => {
    let out = "";
    for (const n of nodes) {
      if (n.k === "t") out += n.v;
      else if (n.k === "r") out += run(n.opts[pick(opts.seed, n.n, n.opts.length)]!);
      else if (n.k === "i") {
        need(n.name, n.index);
        const v = value(n.name);
        const yes = n.op === "==" ? v === n.val : n.op === "!=" ? v !== n.val : v !== "";
        out += run(yes ? n.a : n.b);
      } else {
        need(n.parts[0]!, n.index);
        let done = false;
        for (let j = 0; j < n.parts.length && !done; j++) {
          const p = n.parts[j]!;
          if (j === 0 || (IDENT.test(p) && isVar(p))) {
            const v = value(p);
            if (v !== "") {
              out += opts.html ? escapeHtml(v) : v;
              done = true;
            }
          } else {
            out += p; // literal fallback, authored by the template owner
            done = true;
          }
        }
        if (!done) missing.add(n.parts[0]!);
      }
    }
    return out;
  };
  const text = run(r.nodes);
  return { text: opts.singleLine ? text.replace(/[\r\n\t]+/g, " ") : text, missing: [...missing] };
}

export function render(template: string, ctx: RenderContext, opts: { seed: string; html: boolean; singleLine?: boolean }): string {
  return renderDetailed(template, ctx, opts).text;
}

/** Subjects: always single-line and plain text, whatever the lead data holds. Seeded as `${seed}:subject`. */
export function renderSubject(template: string, ctx: RenderContext, seed: string): { text: string; missing: string[] } {
  return renderDetailed(template, ctx, { seed: `${seed}:subject`, html: false, singleLine: true });
}

/** Bodies: seeded as `${seed}:body`, so subject and body RANDOM picks are independent but both stable per seed. */
export function renderBody(template: string, ctx: RenderContext, opts: { seed: string; html: boolean }): { text: string; missing: string[] } {
  return renderDetailed(template, ctx, { seed: `${opts.seed}:body`, html: opts.html });
}
