import bwipjs from "bwip-js";

export async function generateBarcodePngBuffer(ean) {
  // Walidacja i normalizacja EAN
  const cleanEan = String(ean).replace(/\D/g, "");

  if (!cleanEan) {
    throw new Error("Pusty kod EAN");
  }

  // Wybór typu kodu kreskowego w zależności od długości
  let bcid = "code128"; // domyślnie code128 dla dowolnej długości

  if (cleanEan.length === 13) {
    bcid = "ean13";
  } else if (cleanEan.length === 8) {
    bcid = "ean8";
  } else if (cleanEan.length === 12) {
    bcid = "upca";
  }

  return bwipjs.toBuffer({
    bcid,
    text: cleanEan,
    scale: 3,
    height: 10,
    includetext: false,
  });
}
