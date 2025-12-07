import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import fetch from "node-fetch";
import { generateBarcodePngBuffer } from "./barcodeGenerator.js";

// Funkcja do zamiany polskich znaków na ASCII (fallback)
function sanitizeText(text) {
  if (!text) return "";
  const polishChars = {
    'ą': 'a', 'ć': 'c', 'ę': 'e', 'ł': 'l', 'ń': 'n', 'ó': 'o', 'ś': 's', 'ź': 'z', 'ż': 'z',
    'Ą': 'A', 'Ć': 'C', 'Ę': 'E', 'Ł': 'L', 'Ń': 'N', 'Ó': 'O', 'Ś': 'S', 'Ź': 'Z', 'Ż': 'Z',
  };
  return text.replace(/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/g, char => polishChars[char] || char);
}

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 40;

// Kolory w stylu home & decor
const COLORS = {
  background: rgb(0.99, 0.98, 0.96),
  border: rgb(0.85, 0.82, 0.78),
  textPrimary: rgb(0.2, 0.2, 0.2),
  textSecondary: rgb(0.4, 0.4, 0.4),
  accent: rgb(0.6, 0.5, 0.4),
};

export async function generateCatalogPdf(products) {
  const pdfDoc = await PDFDocument.create();
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const availableHeight = PAGE_HEIGHT - MARGIN * 2;
  const productBlockHeight = availableHeight / 2 - 10;

  console.log(`Generowanie PDF dla ${products.length} produktów...`);

  for (let i = 0; i < products.length; i += 2) {
    const page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);

    // Tło strony
    page.drawRectangle({
      x: 0,
      y: 0,
      width: PAGE_WIDTH,
      height: PAGE_HEIGHT,
      color: COLORS.background,
    });

    const [p1, p2] = [products[i], products[i + 1]].filter(Boolean);

    if (p1) {
      await renderProductBlock(pdfDoc, page, p1, {
        x: MARGIN,
        y: PAGE_HEIGHT - MARGIN - productBlockHeight,
        width: PAGE_WIDTH - MARGIN * 2,
        height: productBlockHeight,
        fontRegular,
        fontBold,
      });
    }

    if (p2) {
      await renderProductBlock(pdfDoc, page, p2, {
        x: MARGIN,
        y: MARGIN,
        width: PAGE_WIDTH - MARGIN * 2,
        height: productBlockHeight,
        fontRegular,
        fontBold,
      });
    }

    // Log co 100 stron
    if ((i / 2 + 1) % 100 === 0) {
      console.log(`Wygenerowano ${i / 2 + 1} stron...`);
    }
  }

  console.log(`Finalizacja PDF...`);
  const pdfBytes = await pdfDoc.save();
  console.log(`PDF wygenerowany: ${(pdfBytes.length / 1024 / 1024).toFixed(2)} MB`);

  return pdfBytes;
}

async function renderProductBlock(pdfDoc, page, product, layout) {
  const { x, y, width, height, fontRegular, fontBold } = layout;

  // Ramka bloku
  page.drawRectangle({
    x,
    y,
    width,
    height,
    borderColor: COLORS.border,
    borderWidth: 0.5,
  });

  // Zdjęcie produktu (powiększone)
  const imgWidth = width * 0.45;
  const imgHeight = imgWidth;
  const imgX = x + 10;
  const imgY = y + height - imgHeight - 10;

  if (product.imageUrl) {
    try {
      const imageBytes = await fetchImage(product.imageUrl);
      if (imageBytes) {
        let image = null;

        // Próba osadzenia jako JPG
        try {
          image = await pdfDoc.embedJpg(imageBytes);
        } catch {
          // Próba osadzenia jako PNG
          try {
            image = await pdfDoc.embedPng(imageBytes);
          } catch (e) {
            console.warn(`Nie można osadzić obrazu dla: ${product.name}`);
          }
        }

        if (image) {
          // Zachowaj proporcje obrazu
          const scale = Math.min(imgWidth / image.width, imgHeight / image.height);
          const scaledWidth = image.width * scale;
          const scaledHeight = image.height * scale;

          page.drawImage(image, {
            x: imgX + (imgWidth - scaledWidth) / 2,
            y: imgY + (imgHeight - scaledHeight) / 2,
            width: scaledWidth,
            height: scaledHeight,
          });
        }
      }
    } catch (e) {
      // Brak zdjęcia - kontynuuj bez obrazu
    }
  }

  // Tekst - prawa strona
  const textX = x + imgWidth + 30;
  const textMaxWidth = width - imgWidth - 50;
  let textY = y + height - 30;

  // Nazwa produktu
  if (product.name) {
    const nameLines = wrapText(sanitizeText(product.name), fontBold, 14, textMaxWidth);
    for (const line of nameLines.slice(0, 2)) {
      page.drawText(sanitizeText(line), {
        x: textX,
        y: textY,
        size: 14,
        font: fontBold,
        color: COLORS.textPrimary,
      });
      textY -= 18;
    }
  }

  textY -= 5;

  // Opis
  if (product.description) {
    const descLines = wrapText(sanitizeText(product.description.slice(0, 400)), fontRegular, 10, textMaxWidth);
    for (const line of descLines.slice(0, 6)) {
      page.drawText(sanitizeText(line), {
        x: textX,
        y: textY,
        size: 10,
        font: fontRegular,
        color: COLORS.textSecondary,
      });
      textY -= 14;
    }
  }

  textY -= 10;

  // Cena
  if (product.price) {
    const priceText = `${product.price.toFixed(2)} zl`;
    page.drawText(priceText, {
      x: textX,
      y: textY,
      size: 16,
      font: fontBold,
      color: COLORS.accent,
    });
    textY -= 22;
  }

  // Kategoria i gramatura
  const metaParts = [];
  if (product.category) metaParts.push(sanitizeText(product.category));
  if (product.grammage) metaParts.push(`${product.grammage} g/m2`);

  if (metaParts.length > 0) {
    page.drawText(sanitizeText(metaParts.join(" | ")), {
      x: textX,
      y: textY,
      size: 9,
      font: fontRegular,
      color: COLORS.textSecondary,
    });
  }

  // Kod kreskowy - na dole bloku
  if (product.ean) {
    const barcodeX = x + 10;
    const barcodeY = y + 15;

    try {
      const barcodePng = await generateBarcodePngBuffer(product.ean);
      const barcodeImage = await pdfDoc.embedPng(barcodePng);

      page.drawImage(barcodeImage, {
        x: barcodeX,
        y: barcodeY + 15,
        width: 140,
        height: 40,
      });

      // Numer EAN pod kodem
      page.drawText(product.ean, {
        x: barcodeX,
        y: barcodeY,
        size: 10,
        font: fontRegular,
        color: COLORS.textPrimary,
      });
    } catch (e) {
      // Wyświetl tylko numer EAN jeśli barcode się nie udał
      page.drawText(`EAN: ${product.ean}`, {
        x: barcodeX,
        y: barcodeY,
        size: 10,
        font: fontRegular,
        color: COLORS.textPrimary,
      });
    }
  }

  // Index produktu w prawym dolnym rogu
  if (product.index) {
    page.drawText(`Index: ${product.index}`, {
      x: x + width - 120,
      y: y + 10,
      size: 8,
      font: fontRegular,
      color: COLORS.textSecondary,
    });
  }
}

async function fetchImage(url) {
  try {
    const response = await fetch(url, { timeout: 10000 });
    if (!response.ok) return null;

    const buffer = await response.arrayBuffer();
    return new Uint8Array(buffer);
  } catch {
    return null;
  }
}

function wrapText(text, font, fontSize, maxWidth) {
  const words = text.split(/\s+/);
  const lines = [];
  let currentLine = "";

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    const width = font.widthOfTextAtSize(testLine, fontSize);

    if (width <= maxWidth) {
      currentLine = testLine;
    } else {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
    }
  }

  if (currentLine) lines.push(currentLine);
  return lines;
}
