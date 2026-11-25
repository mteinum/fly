import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchSized } from "./terrain";

/** Et svar som kommer i biter, slik en stor fil gjør over nettet. */
function chunked(chunks: number[][], status = 200): Response {
  const body = new ReadableStream<Uint8Array>({
    start(c) { for (const ch of chunks) c.enqueue(new Uint8Array(ch)); c.close(); },
  });
  return new Response(body, { status });
}

afterEach(() => vi.unstubAllGlobals());

describe("fetchSized", () => {
  it("setter bitene sammen i rekkefølge og melder framdrift som ender på 1", async () => {
    vi.stubGlobal("fetch", async () => chunked([[1, 2], [3], [4, 5, 6, 7, 8]]));
    const seen: number[] = [];
    const buf = await fetchSized("heightmap.f32", 8, (f) => seen.push(f));
    expect([...new Uint8Array(buf)]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(seen).toEqual([0.25, 0.375, 1]);
  });

  it("feiler når fila er kortere eller lengre enn metadata sier", async () => {
    vi.stubGlobal("fetch", async () => chunked([[1, 2, 3]]));
    await expect(fetchSized("heightmap.f32", 8)).rejects.toThrow("expected 8 bytes, got 3");
    vi.stubGlobal("fetch", async () => chunked([[1, 2, 3], [4, 5]]));
    await expect(fetchSized("heightmap.f32", 4)).rejects.toThrow("expected 4 bytes");
  });

  it("feiler på HTTP-feil i stedet for å lese feilsiden som høyder", async () => {
    vi.stubGlobal("fetch", async () => chunked([[1, 2, 3, 4]], 404));
    await expect(fetchSized("heightmap.f32", 4)).rejects.toThrow("HTTP 404");
  });
});
