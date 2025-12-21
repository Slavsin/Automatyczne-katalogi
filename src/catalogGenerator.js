import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import { generateBarcodePngBuffer } from "./barcodeGenerator.js";
import QRCode from "qrcode";

// Funkcja do zamiany polskich znaków na ASCII (fallback dla Helvetica)
function sanitizeText(text) {
  if (!text) return "";
  const polishChars = {
    'ą': 'a', 'ć': 'c', 'ę': 'e', 'ł': 'l', 'ń': 'n', 'ó': 'o', 'ś': 's', 'ź': 'z', 'ż': 'z',
    'Ą': 'A', 'Ć': 'C', 'Ę': 'E', 'Ł': 'L', 'Ń': 'N', 'Ó': 'O', 'Ś': 'S', 'Ź': 'Z', 'Ż': 'Z',
  };
  return text.replace(/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/g, char => polishChars[char] || char);
}

// ============================================
// BRAND COLORS - Spod Igły i Nitki
// ============================================
const BRAND = {
  white: rgb(1, 1, 1),                           // #FFFFFF
  cream: rgb(247/255, 243/255, 237/255),         // #F7F3ED
  taupe: rgb(209/255, 185/255, 165/255),         // #D1B9A5
  black: rgb(0, 0, 0),                           // #000000

  // Derived colors
  textPrimary: rgb(0.1, 0.1, 0.1),               // Almost black
  textSecondary: rgb(0.45, 0.45, 0.45),          // Medium gray
  textMuted: rgb(0.6, 0.6, 0.6),                 // Light gray
  divider: rgb(0.88, 0.85, 0.82),                // Subtle line
  success: rgb(0.4, 0.6, 0.4),                   // Green for stock
};

// ============================================
// PAGE DIMENSIONS
// ============================================
const PAGE_WIDTH = 595.28;   // A4
const PAGE_HEIGHT = 841.89;  // A4
const MARGIN = 50;
const INNER_WIDTH = PAGE_WIDTH - MARGIN * 2;

// ============================================
// LOGO PATH
// ============================================
const LOGO_PATH = path.join(process.cwd(), "identyfikacja", "Logo.png");

// ============================================
// MAIN EXPORT FUNCTION
// ============================================
export async function generateCatalogPdf(products) {
  const pdfDoc = await PDFDocument.create();
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontLight = await pdfDoc.embedFont(StandardFonts.Helvetica);

  // Embed logo
  let logoImage = null;
  try {
    const logoBytes = fs.readFileSync(LOGO_PATH);
    logoImage = await pdfDoc.embedPng(logoBytes);
  } catch (e) {
    console.warn("Nie można załadować logo:", e.message);
  }

  console.log(`Generowanie PDF dla ${products.length} produktów...`);

  // ========== TITLE PAGE ==========
  await renderTitlePage(pdfDoc, logoImage, fontRegular, fontBold, products.length);

  // ========== PRODUCT PAGES ==========
  const productBlockHeight = (PAGE_HEIGHT - MARGIN * 2 - 40) / 2; // 40px for footer

  for (let i = 0; i < products.length; i += 2) {
    const page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    const pageNumber = Math.floor(i / 2) + 2; // +2 because title page is 1

    // White background
    page.drawRectangle({
      x: 0,
      y: 0,
      width: PAGE_WIDTH,
      height: PAGE_HEIGHT,
      color: BRAND.white,
    });

    const [p1, p2] = [products[i], products[i + 1]].filter(Boolean);

    // Product 1 - top half
    if (p1) {
      await renderProductBlock(pdfDoc, page, p1, {
        x: MARGIN,
        y: PAGE_HEIGHT - MARGIN - productBlockHeight,
        width: INNER_WIDTH,
        height: productBlockHeight,
        fontRegular,
        fontBold,
      });
    }

    // Subtle divider line between products
    if (p1 && p2) {
      page.drawLine({
        start: { x: MARGIN + 50, y: PAGE_HEIGHT / 2 },
        end: { x: PAGE_WIDTH - MARGIN - 50, y: PAGE_HEIGHT / 2 },
        thickness: 0.5,
        color: BRAND.divider,
      });
    }

    // Product 2 - bottom half
    if (p2) {
      await renderProductBlock(pdfDoc, page, p2, {
        x: MARGIN,
        y: MARGIN + 30, // Space for footer
        width: INNER_WIDTH,
        height: productBlockHeight,
        fontRegular,
        fontBold,
      });
    }

    // Footer with page number and logo hint
    renderPageFooter(page, pageNumber, fontRegular, logoImage, pdfDoc);

    // Log progress
    if ((i / 2 + 1) % 100 === 0) {
      console.log(`Wygenerowano ${i / 2 + 1} stron...`);
    }
  }

  console.log(`Finalizacja PDF...`);
  const pdfBytes = await pdfDoc.save();
  console.log(`PDF wygenerowany: ${(pdfBytes.length / 1024 / 1024).toFixed(2)} MB`);

  return pdfBytes;
}

// ============================================
// TITLE PAGE
// ============================================
async function renderTitlePage(pdfDoc, logoImage, fontRegular, fontBold, productCount) {
  const page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);

  // Cream background
  page.drawRectangle({
    x: 0,
    y: 0,
    width: PAGE_WIDTH,
    height: PAGE_HEIGHT,
    color: BRAND.cream,
  });

  // Decorative taupe rectangle at bottom
  page.drawRectangle({
    x: 0,
    y: 0,
    width: PAGE_WIDTH,
    height: 180,
    color: BRAND.taupe,
  });

  // Logo centered
  if (logoImage) {
    const logoScale = 0.5;
    const logoWidth = logoImage.width * logoScale;
    const logoHeight = logoImage.height * logoScale;

    page.drawImage(logoImage, {
      x: (PAGE_WIDTH - logoWidth) / 2,
      y: PAGE_HEIGHT / 2 + 50,
      width: logoWidth,
      height: logoHeight,
    });
  }

  // Subtitle
  const subtitle = "KATALOG PRODUKTOW";
  const subtitleWidth = fontRegular.widthOfTextAtSize(subtitle, 14);
  page.drawText(subtitle, {
    x: (PAGE_WIDTH - subtitleWidth) / 2,
    y: PAGE_HEIGHT / 2 - 30,
    size: 14,
    font: fontRegular,
    color: BRAND.textSecondary,
  });

  // Decorative line
  page.drawLine({
    start: { x: PAGE_WIDTH / 2 - 60, y: PAGE_HEIGHT / 2 - 50 },
    end: { x: PAGE_WIDTH / 2 + 60, y: PAGE_HEIGHT / 2 - 50 },
    thickness: 1,
    color: BRAND.taupe,
  });

  // Year
  const year = new Date().getFullYear().toString();
  const yearWidth = fontBold.widthOfTextAtSize(year, 24);
  page.drawText(year, {
    x: (PAGE_WIDTH - yearWidth) / 2,
    y: PAGE_HEIGHT / 2 - 90,
    size: 24,
    font: fontBold,
    color: BRAND.textPrimary,
  });

  // Product count info (on taupe background)
  const countText = `${productCount} produktow`;
  const countWidth = fontRegular.widthOfTextAtSize(countText, 12);
  page.drawText(countText, {
    x: (PAGE_WIDTH - countWidth) / 2,
    y: 100,
    size: 12,
    font: fontRegular,
    color: BRAND.white,
  });

  // Website
  const website = "www.spodiglyinitki.pl";
  const websiteWidth = fontRegular.widthOfTextAtSize(website, 11);
  page.drawText(website, {
    x: (PAGE_WIDTH - websiteWidth) / 2,
    y: 70,
    size: 11,
    font: fontRegular,
    color: BRAND.white,
  });
}

// ============================================
// PAGE FOOTER
// ============================================
function renderPageFooter(page, pageNumber, fontRegular, logoImage, pdfDoc) {
  // Page number - centered
  const pageText = `${pageNumber}`;
  const pageWidth = fontRegular.widthOfTextAtSize(pageText, 9);

  page.drawText(pageText, {
    x: (PAGE_WIDTH - pageWidth) / 2,
    y: 25,
    size: 9,
    font: fontRegular,
    color: BRAND.textMuted,
  });

  // Small decorative lines around page number
  page.drawLine({
    start: { x: PAGE_WIDTH / 2 - 30, y: 28 },
    end: { x: PAGE_WIDTH / 2 - 15, y: 28 },
    thickness: 0.5,
    color: BRAND.divider,
  });
  page.drawLine({
    start: { x: PAGE_WIDTH / 2 + 15, y: 28 },
    end: { x: PAGE_WIDTH / 2 + 30, y: 28 },
    thickness: 0.5,
    color: BRAND.divider,
  });
}

// ============================================
// PRODUCT BLOCK
// ============================================
async function renderProductBlock(pdfDoc, page, product, layout) {
  const { x, y, width, height, fontRegular, fontBold } = layout;

  // Layout calculations - large images for maximum visibility
  const imageSize = Math.min(width * 0.55, height - 60);
  const imageX = x + 8;
  const imageY = y + height - imageSize - 8;

  const textX = x + imageSize + 20;
  const textMaxWidth = width - imageSize - 35;
  let textY = y + height - 18;

  // ========== PRODUCT IMAGE ==========
  if (product.imageUrl) {
    try {
      const imageBytes = await fetchImage(product.imageUrl);
      if (imageBytes) {
        let image = null;
        try {
          image = await pdfDoc.embedJpg(imageBytes);
        } catch {
          try {
            image = await pdfDoc.embedPng(imageBytes);
          } catch (e) {
            // Skip image
          }
        }

        if (image) {
          const scale = Math.min(imageSize / image.width, imageSize / image.height);
          const scaledWidth = image.width * scale;
          const scaledHeight = image.height * scale;

          // Subtle shadow effect (rectangle behind image)
          page.drawRectangle({
            x: imageX + (imageSize - scaledWidth) / 2 + 3,
            y: imageY + (imageSize - scaledHeight) / 2 - 3,
            width: scaledWidth,
            height: scaledHeight,
            color: rgb(0.92, 0.90, 0.88),
          });

          page.drawImage(image, {
            x: imageX + (imageSize - scaledWidth) / 2,
            y: imageY + (imageSize - scaledHeight) / 2,
            width: scaledWidth,
            height: scaledHeight,
          });
        }
      }
    } catch (e) {
      // No image
    }
  }

  // ========== CATEGORY (small, above name) ==========
  if (product.category) {
    page.drawText(sanitizeText(product.category.toUpperCase()), {
      x: textX,
      y: textY,
      size: 8,
      font: fontRegular,
      color: BRAND.taupe,
    });
    textY -= 16;
  }

  // ========== PRODUCT NAME ==========
  if (product.name) {
    const nameLines = wrapText(sanitizeText(product.name), fontBold, 13, textMaxWidth);
    for (const line of nameLines.slice(0, 2)) {
      page.drawText(line, {
        x: textX,
        y: textY,
        size: 13,
        font: fontBold,
        color: BRAND.textPrimary,
      });
      textY -= 17;
    }
  }

  textY -= 8;

  // ========== PRICES ==========
  if (product.price) {
    // Price gross - prominent
    const priceGross = `${product.price.toFixed(2)} PLN`;
    page.drawText(priceGross, {
      x: textX,
      y: textY,
      size: 16,
      font: fontBold,
      color: BRAND.black,
    });

    // Price net - smaller, next to it
    if (product.priceNet) {
      const grossWidth = fontBold.widthOfTextAtSize(priceGross, 16);
      page.drawText(`(${product.priceNet.toFixed(2)} netto)`, {
        x: textX + grossWidth + 8,
        y: textY + 2,
        size: 10,
        font: fontRegular,
        color: BRAND.textSecondary,
      });
    }
    textY -= 20;
  }

  // ========== AVAILABILITY ==========
  if (product.availabilityCount > 0) {
    const stockText = `Stan: ${Math.floor(product.availabilityCount)} szt.`;
    page.drawText(stockText, {
      x: textX,
      y: textY,
      size: 9,
      font: fontRegular,
      color: BRAND.success,
    });
    textY -= 14;
  }

  textY -= 6;

  // ========== PRODUCT DETAILS (compact grid) ==========
  const details = [];
  if (product.color) details.push({ label: "Kolor", value: product.color });
  if (product.composition) details.push({ label: "Sklad", value: product.composition });
  if (product.grammage) details.push({ label: "Gramatura", value: product.grammage });
  if (product.piecesInCarton) details.push({ label: "W kartonie", value: `${product.piecesInCarton} szt.` });

  for (const detail of details.slice(0, 4)) {
    const detailText = `${detail.label}: ${sanitizeText(detail.value)}`;
    page.drawText(detailText, {
      x: textX,
      y: textY,
      size: 9,
      font: fontRegular,
      color: BRAND.textSecondary,
    });
    textY -= 12;
  }

  // Package dimensions (one line)
  if (product.packageWidth || product.packageHeight || product.packageDepth) {
    const dims = [product.packageWidth, product.packageHeight, product.packageDepth]
      .filter(Boolean)
      .join(" x ");
    if (dims) {
      page.drawText(`Wymiary: ${dims} cm`, {
        x: textX,
        y: textY,
        size: 8,
        font: fontRegular,
        color: BRAND.textMuted,
      });
      textY -= 11;
    }
  }

  if (product.packageWeight) {
    page.drawText(`Waga: ${product.packageWeight} kg`, {
      x: textX,
      y: textY,
      size: 8,
      font: fontRegular,
      color: BRAND.textMuted,
    });
  }

  // ========== BARCODE - bottom left of image area ==========
  if (product.ean) {
    const barcodeX = imageX;
    const barcodeY = y + 15;

    try {
      const barcodePng = await generateBarcodePngBuffer(product.ean);
      const barcodeImage = await pdfDoc.embedPng(barcodePng);

      page.drawImage(barcodeImage, {
        x: barcodeX,
        y: barcodeY + 12,
        width: 120,
        height: 35,
      });

      page.drawText(product.ean, {
        x: barcodeX,
        y: barcodeY,
        size: 8,
        font: fontRegular,
        color: BRAND.textSecondary,
      });
    } catch (e) {
      page.drawText(`EAN: ${product.ean}`, {
        x: barcodeX,
        y: barcodeY,
        size: 8,
        font: fontRegular,
        color: BRAND.textSecondary,
      });
    }
  }

  // ========== INDEX - top right corner (prominent) ==========
  if (product.index) {
    const indexText = `${product.index}`;
    const indexWidth = fontBold.widthOfTextAtSize(indexText, 11);

    // Background rectangle for index
    page.drawRectangle({
      x: x + width - indexWidth - 20,
      y: y + height - 25,
      width: indexWidth + 14,
      height: 18,
      color: BRAND.cream,
    });

    page.drawText(indexText, {
      x: x + width - indexWidth - 13,
      y: y + height - 21,
      size: 11,
      font: fontBold,
      color: BRAND.textPrimary,
    });
  }

  // ========== QR CODE - bottom right corner ==========
  if (product.b2bLink) {
    try {
      const qrDataUrl = await QRCode.toDataURL(product.b2bLink, {
        width: 150,
        margin: 0,
        color: { dark: "#000000", light: "#ffffff" }
      });

      // Convert data URL to buffer
      const qrBase64 = qrDataUrl.replace(/^data:image\/png;base64,/, "");
      const qrBuffer = Buffer.from(qrBase64, "base64");
      const qrImage = await pdfDoc.embedPng(qrBuffer);

      const qrSize = 45;
      page.drawImage(qrImage, {
        x: x + width - qrSize - 10,
        y: y + 10,
        width: qrSize,
        height: qrSize,
      });

      // Small label under QR
      page.drawText("Zamow B2B", {
        x: x + width - qrSize - 5,
        y: y + 2,
        size: 6,
        font: fontRegular,
        color: BRAND.textMuted,
      });
    } catch (e) {
      // QR generation failed, skip
    }
  }
}

// ============================================
// UTILITIES
// ============================================
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
