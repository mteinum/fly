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
