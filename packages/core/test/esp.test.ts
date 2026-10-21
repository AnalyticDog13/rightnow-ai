import { describe, expect, test } from "vitest";
import { detectEsp } from "../src/leads/esp";

const mx =
  (...hosts: string[]) =>
  async () =>
    hosts.map((exchange, i) => ({ exchange, priority: i }));
const fail = (code: string) => async () => {
  throw Object.assign(new Error(code), { code });
};

describe("detectEsp", () => {
  test("maps MX hosts to an ESP", async () => {
    expect(await detectEsp("a.test", mx("aspmx.l.google.com"))).toMatchObject({ esp: "GOOGLE" });
    expect(await detectEsp("a.test", mx("acme-test.mail.protection.outlook.com"))).toMatchObject({
      esp: "MICROSOFT",
    });
    expect(await detectEsp("a.test", mx("mx.zoho.eu"))).toMatchObject({ esp: "ZOHO" });
    expect(await detectEsp("a.test", mx("mta5.am0.yahoodns.net"))).toMatchObject({ esp: "YAHOO" });
    expect(await detectEsp("a.test", mx("mx.yandex.net"))).toMatchObject({ esp: "YANDEX" });
    expect(await detectEsp("a.test", mx("mail.selfhosted.test"))).toEqual({
      esp: "OTHER",
      esg: null,
    });
  });

  test("gateways set the ESG with ESP OTHER", async () => {
    expect(await detectEsp("a.test", mx("mx1.acme.pphosted.com"))).toEqual({
      esp: "OTHER",
      esg: "Proofpoint",
    });
    expect(await detectEsp("a.test", mx("us-smtp-inbound-1.mimecast.com"))).toMatchObject({
      esg: "Mimecast",
    });
    expect(await detectEsp("a.test", mx("x.barracudanetworks.com"))).toMatchObject({
      esg: "Barracuda",
    });
    expect(await detectEsp("a.test", mx("x.iphmx.com"))).toMatchObject({ esg: "Cisco" });
  });

  test("ENOTFOUND/ENODATA is invalid, any other error is NOT_FOUND only, a hang times out", async () => {
    expect(await detectEsp("a.test", fail("ENOTFOUND"))).toMatchObject({
      esp: "NOT_FOUND",
      invalid: true,
    });
    expect(await detectEsp("a.test", fail("ENODATA"))).toMatchObject({
      esp: "NOT_FOUND",
      invalid: true,
    });
    const other = await detectEsp("a.test", fail("ESERVFAIL"));
    expect(other.esp).toBe("NOT_FOUND");
    expect(other.invalid).toBeFalsy();
    const hang = await detectEsp("a.test", () => new Promise(() => {}), 20);
    expect(hang.esp).toBe("NOT_FOUND");
    expect(hang.invalid).toBeFalsy();
  });
});
