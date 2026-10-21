import type { EspType } from "@rightnow/db/client";

type Mx = { exchange: string; priority: number }[];
export type ResolveMx = (domain: string) => Promise<Mx>;

const ESP: [RegExp, EspType][] = [
  [/(^|\.)(google|googlemail)\.com$/, "GOOGLE"],
  [/(^|\.)outlook\.com$/, "MICROSOFT"],
  [/(^|\.)zoho\./, "ZOHO"],
  [/(^|\.)yahoodns\.net$/, "YAHOO"],
  [/(^|\.)yandex\./, "YANDEX"],
];
const ESG: [string, string][] = [
  ["pphosted.com", "Proofpoint"],
  ["mimecast.com", "Mimecast"],
  ["barracudanetworks.com", "Barracuda"],
  ["iphmx.com", "Cisco"],
];

const notFound = (invalid: boolean) => ({ esp: "NOT_FOUND" as EspType, esg: null, invalid });

/** One MX lookup, bounded by `timeoutMs`. `invalid` marks a domain that cannot receive mail (ENOTFOUND/ENODATA). */
export async function detectEsp(
  domain: string,
  resolveMx: ResolveMx,
  timeoutMs = 5000,
): Promise<{ esp: EspType; esg: string | null; invalid?: boolean }> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const mx = await Promise.race([
      resolveMx(domain),
      new Promise<never>((_, rej) => {
        timer = setTimeout(() => rej(new Error("MX lookup timed out")), timeoutMs);
      }),
    ]);
    const host = [...mx].sort((a, b) => a.priority - b.priority)[0]?.exchange;
    if (!host) return notFound(true);
    const h = host.toLowerCase().replace(/\.$/, "");
    const esp = ESP.find(([re]) => re.test(h))?.[1];
    if (esp) return { esp, esg: null };
    const esg = ESG.find(([d]) => h === d || h.endsWith(`.${d}`))?.[1] ?? null;
    return { esp: "OTHER", esg };
  } catch (e) {
    const code = (e as { code?: string }).code;
    return notFound(code === "ENOTFOUND" || code === "ENODATA");
  } finally {
    clearTimeout(timer);
  }
}
