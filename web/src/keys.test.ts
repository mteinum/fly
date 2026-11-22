import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";

// Node har ikke DOM-klassene; lag dem så isTyping kan skille skrivefelt fra resten
class FakeInput {}
class FakeTextArea {}
beforeAll(() => { Object.assign(globalThis, { HTMLInputElement: FakeInput, HTMLTextAreaElement: FakeTextArea }); });

describe("taster mens man skriver", () => {
  it("regner tastetrykk i et skrivefelt som skriving, ikke styring", async () => {
    const { isTyping } = await import("./game");
    // «Morten» inneholder både R og T, som ellers starter ny innflyging
    expect(isTyping({ target: new FakeInput() } as unknown as Event)).toBe(true);
    expect(isTyping({ target: new FakeTextArea() } as unknown as Event)).toBe(true);
    expect(isTyping({ target: {} } as unknown as Event)).toBe(false);
    expect(isTyping({ target: null } as unknown as Event)).toBe(false);
  });
});

describe("tastene", () => {
  it("har én oppgave hver, og står i hjelpen", () => {
    const read = (f: string) => readFileSync(new URL(f, import.meta.url), "utf-8");
    const keys = [...(read("./game.ts") + read("./main.ts")).matchAll(/e\.code [!=]== "Key([A-Z])"/g)].map((m) => m[1]);
    // R og T lukker også diplomet (main.ts); ellers skal ingen bokstav være bundet to steder. L var det: figurer og flylogg.
    const twice = [...new Set(keys.filter((k, i) => keys.indexOf(k) !== i))].filter((k) => k !== "R" && k !== "T");
    expect(twice).toEqual([]);
    const help = read("../index.html");
    expect([...new Set(keys)].filter((k) => !help.includes(`<kbd>${k}</kbd>`))).toEqual([]);
  });
});
