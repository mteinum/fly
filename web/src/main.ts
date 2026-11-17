/* Velger modus: 3D (standard) eller ?mode=pixel. Modulene lastes dynamisk, så
 * pikselmodus slipper å laste three.js og 3D-modus slipper 50 m-flisene. */
const pixel = new URLSearchParams(location.search).get("mode") === "pixel";
document.body.classList.add(pixel ? "pixel" : "gl");
const info = document.getElementById("info")!;
const dataUrl = `${import.meta.env.BASE_URL}data`;

const other = document.getElementById("mode") as HTMLAnchorElement;
other.textContent = pixel ? "Bytt til 3D" : "Bytt til pikselmodus";
other.href = pixel ? "?" : "?mode=pixel";

(pixel ? import("./pixelMain") : import("./glMain"))
  .then((m) => m.run(dataUrl, info))
  .then((attribution) => { document.getElementById("credits")!.textContent = attribution.join(" · "); })
  .catch((err) => {
    info.textContent = `Feil: ${err.message}. Har du kjørt pipeline (uv run flypipe build ${pixel ? "kjevik" : "kjevik10"})?`;
    throw err;
  });
