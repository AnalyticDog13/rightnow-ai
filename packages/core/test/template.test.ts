import { describe, expect, it } from "vitest";
import { pick, render, renderBody, renderDetailed, renderSubject, templateVariables, validateTemplate } from "../src/template";

const sender = { firstName: "Sam", lastName: "Sender", email: "sam@x.io" };
const ctx = (lead: Record<string, string | number | boolean | null>, unsubscribeLink?: string) => ({ lead, sender, unsubscribeLink });
const o = { seed: "l1:s1:v1", html: false };
const known = new Set(["firstName", "lastName", "industry", "a", "b", "x"]);
const codes = (t: string) => validateTemplate(t, known).map((i) => i.code);

describe("fallbacks", () => {
  it("uses fallbacks in order", () => {
    expect(render("Hi {{firstName | there}}", ctx({ firstName: "" }), o)).toBe("Hi there");
    expect(render("{{firstName | lastName | for you}}", ctx({ lastName: "Li" }), o)).toBe("Li");
    expect(render("{{firstName | lastName | for you}}", ctx({}), o)).toBe("for you");
  });
  it("renders empty and reports missing[]", () => {
    expect(renderDetailed("[{{firstName}}] {{lastName | x}}", ctx({ firstName: null }), o)).toEqual({ text: "[] x", missing: ["firstName"] });
  });
  it("throws on unknown variable", () => {
    expect(() => render("{{nope}}", ctx({}), o)).toThrow(/nope/);
  });
  it("custom fields and sender vars", () => {
    expect(render("{{size}} {{sendingAccountFirstName}} {{sendingAccountLastName}} {{sendingAccountEmail}} {{unsubscribeLink}}", ctx({ size: 5 }, "https://u"), o)).toBe("5 Sam Sender sam@x.io https://u");
  });
});

describe("spintax", () => {
  const t = "{{RANDOM | Hi {{firstName}} | Hello}}";
  it("is deterministic and valid", () => {
    const first = render(t, ctx({ firstName: "Ann" }), o);
    expect(["Hi Ann", "Hello"]).toContain(first);
    for (let i = 0; i < 100; i++) expect(render(t, ctx({ firstName: "Ann" }), o)).toBe(first);
  });
  it("spreads fairly", () => {
    let hello = 0;
    for (let i = 0; i < 1000; i++) if (render(t, ctx({ firstName: "Ann" }), { ...o, seed: `l${i}` }) === "Hello") hello++;
    expect(hello).toBeGreaterThan(400);
    expect(hello).toBeLessThan(600);
  });
  it("nests deeply and indexes occurrences independently", () => {
    expect(render("{{RANDOM | {{RANDOM | a | a}} | {{RANDOM | a | a}}}}", ctx({}), o)).toBe("a");
    const outs = new Set<string>();
    for (let i = 0; i < 50; i++) outs.add(render("{{RANDOM | x | y}}{{RANDOM | x | y}}", ctx({}), { ...o, seed: `s${i}` }));
    expect(outs.size).toBe(4);
  });
  it("pick is stable and in range", () => {
    expect(pick("s", 0, 3)).toBe(pick("s", 0, 3));
    expect(pick("s", 1, 1)).toBe(0);
  });
});

describe("if blocks", () => {
  const t = '{% if industry == "SaaS" %}A{% else %}B{% endif %}';
  it("compares case-sensitively", () => {
    expect(render(t, ctx({ industry: "SaaS" }), o)).toBe("A");
    expect(render(t, ctx({ industry: "saas" }), o)).toBe("B");
  });
  it("supports truthiness, !=, and nesting", () => {
    const n = '{% if industry %}{% if firstName != "Bob" %}in{% else %}bob{% endif %}{% else %}none{% endif %}';
    expect(render(n, ctx({ industry: "x", firstName: "Ann" }), o)).toBe("in");
    expect(render(n, ctx({ industry: "x", firstName: "Bob" }), o)).toBe("bob");
    expect(render(n, ctx({ industry: "", firstName: "Bob" }), o)).toBe("none");
  });
});

describe("safety", () => {
  it("singleLine collapses breaks (subject)", () => {
    expect(render("Hi {{firstName}}", ctx({ firstName: "A\r\nBcc: x@y" }), { ...o, singleLine: true })).toBe("Hi A Bcc: x@y");
    expect(render("Hi {{firstName}}", ctx({ firstName: "A\r\nB" }), o)).toBe("Hi A\r\nB");
  });
  it("never re-parses values", () => {
    expect(render("{{firstName}}", ctx({ firstName: "{{RANDOM | a | b}}" }), o)).toBe("{{RANDOM | a | b}}");
  });
  it("escapes values in html only", () => {
    const l = { firstName: "<img src=x onerror=alert(1)>" };
    expect(render("{{firstName}}", ctx(l), { ...o, html: true })).toBe("&lt;img src=x onerror=alert(1)&gt;");
    expect(render("{{firstName}}", ctx(l), o)).toBe(l.firstName);
    expect(render("<b>{{x | a&b}}</b>", ctx({ x: "\"'&" }), { ...o, html: true })).toBe("<b>&quot;&#39;&amp;</b>");
  });
});

describe("validateTemplate", () => {
  it("flags each code", () => {
    expect(validateTemplate("{{frstName}}", known)).toMatchObject([{ code: "unknown_variable", variable: "frstName" }]);
    expect(codes("{{firstName")).toEqual(["unmatched_braces"]);
    expect(codes("{{Hi there | Hello}}")).toEqual(["missing_random_keyword"]);
    expect(codes("{{firstName | }}")).toEqual(["empty_fallback"]);
    expect(codes("{% if x %}hi")).toEqual(["unclosed_if"]);
    expect(codes("{% if %}hi{% endif %}")).toEqual(["bad_if"]);
    expect(codes("{% endif %}")).toEqual(["bad_if"]);
    expect(codes("{% if nope %}a{% endif %}")).toEqual(["unknown_variable"]);
  });
  it("accepts valid templates", () => {
    expect(codes('Hi {{firstName | there}} {{RANDOM | a | {{lastName}}}} {% if industry == "x" %}y{% endif %}')).toEqual([]);
  });
  it("templateVariables", () => {
    expect(templateVariables("{{a}} {{RANDOM | {{b}} | c}}")).toEqual(["a", "b"]);
  });
});

describe("fix round 1", () => {
  it("flags braces inside fallback literals", () => {
    expect(codes("{{firstName | Hi {{lastName}}}}")).toEqual(["unmatched_braces"]);
    expect(codes("{{firstName | lastName | {% if x %}}}")).toEqual(["unmatched_braces"]);
    expect(() => render("{{firstName | Hi {{lastName}}}}", ctx({}), o)).toThrow();
  });
  it("renderSubject can never be multi-line or html-escaped", () => {
    const r = renderSubject("Hi {{firstName}} <{{lastName}}>", ctx({ firstName: "A\r\nBcc: x@y\t", lastName: "L\nM" }), "s");
    expect(r.text).toBe("Hi A Bcc: x@y  <L M>");
    expect(r.text).not.toMatch(/[\r\n]/);
  });
  it("subject and body seeds are independent but deterministic", () => {
    const t = "{{RANDOM | a | b}}";
    const pairs = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const s = `l${i}:s:v`;
      const subj = renderSubject(t, ctx({}), s).text;
      expect(renderSubject(t, ctx({}), s).text).toBe(subj);
      pairs.add(subj + renderBody(t, ctx({}), { seed: s, html: false }).text);
    }
    expect(pairs.size).toBe(4);
  });
  it("RANDOM inside if, whitespace variants, case sensitivity, literal tags in values", () => {
    expect(render('{% if industry == "x" %}{{RANDOM | p | p}}{% endif %}', ctx({ industry: "x" }), o)).toBe("p");
    expect(render("{{firstName|there}}|{{  firstName  |  there  }}", ctx({}), o)).toBe("there|there");
    expect(render('{%if industry=="x"%}Y{%else%}N{%endif%}', ctx({ industry: "x" }), o)).toBe("Y");
    expect(() => render("{{FirstName}}", ctx({ firstName: "a" }), o)).toThrow();
    expect(render("{{firstName}}", ctx({ firstName: "{% if x %}" }), o)).toBe("{% if x %}");
  });
  it("many tags stay fast", () => {
    const t0 = Date.now();
    render("{{firstName}}".repeat(7000), ctx({ firstName: "a" }), o);
    expect(Date.now() - t0).toBeLessThan(500);
  });
});

describe("robustness", () => {
  it("bounds depth and size, fast", () => {
    const t0 = Date.now();
    const inputs = [
      "{{".repeat(50_000),
      "{{a ".repeat(20_000),
      "{{RANDOM | ".repeat(5_000),
      "{% if x %}".repeat(5_000),
      "}}".repeat(50_000) + "{%".repeat(50_000),
      "{{RANDOM | a | ".repeat(25) + "z" + "}}".repeat(25),
      "x".repeat(2_000_000),
    ];
    for (const i of inputs) {
      expect(validateTemplate(i, known)).toHaveLength(1);
      expect(() => render(i, ctx({}), o)).toThrow();
    }
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});
