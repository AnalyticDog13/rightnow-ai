import { describe, expect, test } from "vitest";
import { autoMap, parseCsv } from "../src/leads/csv";

describe("parseCsv", () => {
  test("UTF-8 BOM and semicolons: delimiter sniffed, no BOM char in the first header", () => {
    const r = parseCsv(Buffer.from("﻿email;name\r\na@x.test;Al\r\n"));
    expect(r.delimiter).toBe(";");
    expect(r.headers).toEqual(["email", "name"]);
    expect(r.rows).toEqual([["a@x.test", "Al"]]);
  });

  test("tab separated, and quoted cells holding the delimiter", () => {
    expect(parseCsv(Buffer.from("email\tname\na@x.test\tAl\n")).delimiter).toBe("\t");
    const r = parseCsv(Buffer.from('email;company\na@x.test;"Acme; Inc"\nb@x.test;"say ""hi"""\n'));
    expect(r.rows).toEqual([
      ["a@x.test", "Acme; Inc"],
      ["b@x.test", 'say "hi"'],
    ]);
  });
});

describe("autoMap", () => {
  test("aliases ignore case, spaces, _ and -; unknown headers become custom:<header>", () => {
    expect(autoMap(["E-mail", "First Name", "COMPANY", "Shoe Size"])).toEqual([
      "email",
      "firstName",
      "companyName",
      "custom:Shoe Size",
    ]);
    expect(autoMap(["email_address", "surname", "Position", "URL", "Phone-Number"])).toEqual([
      "email",
      "lastName",
      "jobTitle",
      "website",
      "phone",
    ]);
  });

  test("a second header with the same target stays custom", () => {
    expect(autoMap(["email", "Email Address"])).toEqual(["email", "custom:Email Address"]);
  });
});
