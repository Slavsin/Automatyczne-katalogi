
# Dokumentacja aplikacji katalogowej (backend PDF)

## 1. Cel i wymagania biznesowe

Aplikacja ma:

1. **Pobrać zahasłowany plik XML (lub CSV) z FTP** (feed produktowy).
2. **Przetworzyć go po stronie backendu** (Node.js).
3. **Wygenerować PDF-katalog**:
   - ~2500 produktów,
   - **2 produkty na stronę** (czyli ok. 1250 stron),
   - **EAN**:
     - w formie **kod kreskowy** (skanowalny kolektorem),
     - w formie **numerycznej** (tekst).
   - **Zdjęcia** z pola zawierającego URL (np. `foto`).
   - Styl wizualny inspirowany **home & decor / katalogami wnętrzarskimi**.
4. Umożliwić **pobranie gotowego PDF** z poziomu prostego frontendu (HTML/JS).

---

## 2. Architektura – high-level

### 2.1. Komponenty

- **Frontend (statyczny)**:
  - `index.html` + `main.js` + `styles.css`.
  - Przycisk: „Generuj katalog PDF”.
  - Log zdarzeń (statusy).
  - Wywołuje endpoint backendu `GET /api/generate-catalog`.

- **Backend (Node.js)**:
  - Framework: **Express.js** (lub API Routes / Serverless Functions na Vercel).
  - Moduły:
    - `ftpClient` – pobieranie pliku XML/CSV z FTP (z hasłem).
    - `feedParser` – parsowanie XML/CSV do wewnętrznego modelu `Product`.
    - `catalogGenerator` – generacja PDF (pdf-lib).
    - `barcodeGenerator` – generowanie kodów kreskowych EAN jako PNG (bwip-js).
    - `config` – konfiguracja (env).

- **Środowisko uruchomieniowe**:
  - **Mikr.us VPS**:
    - Node.js jako serwis (pm2/systemd).
    - nginx jako reverse proxy (HTTPS, gzip).
  - **Vercel**:
    - Front: statyk.
    - Backend: Serverless Functions (Node 18+).

---

## 3. Model danych

### 3.1. Produkt

```ts
type Product = {
  id: string;
  index: string;        // np. Index z CSV / XML
  name: string;         // nazwa produktu
  description: string;  // opis / Info
  price: number;        // price (netto / brutto – do ustalenia)
  category: string;     // category/__cdata
  imageUrl: string;     // foto (URL)
  b2bLink?: string;     // B2B_Link (opcjonalnie)
  grammage?: string;    // Gramatura (opcjonalnie)
  ean: string;          // pole z EAN-em (często == Index)
};
```

### 3.2. Konfiguracja mapowania pól

Plik `config.js`:

```js
export const ftpConfig = {
  host: process.env.FTP_HOST,
  user: process.env.FTP_USER,
  password: process.env.FTP_PASSWORD,
  filePath: process.env.FTP_FILE_PATH, // np. /feeds/katalog.xml
};

export const catalogConfig = {
  productsPerPage: 2,
  eanField: "Index",   // nazwa pola w feedzie, z którego pobieramy EAN
  maxProducts: 3000,   // safety limit
};
```

---

## 4. Przepływ danych (flow)

### 4.1. Sekwencja kroków

1. Użytkownik wchodzi na `https://twojserwer/katalog`.
2. Widzi przycisk **„Generuj katalog PDF”**.
3. Kliknięcie → frontend wywołuje `GET /api/generate-catalog`.
4. Backend:
   1. Łączy się z FTP z użyciem `ftpConfig`.
   2. Pobiera plik (XML lub CSV).
   3. Parsuje feed → `Product[]`.
   4. (Opcjonalnie) filtruje/sortuje (np. po kategorii).
   5. Tworzy nowy dokument PDF.
   6. Iteruje `products` po 2 na stronę:
      - renderuje layout strony (2 bloki produktowe pionowo).
   7. Zwraca PDF jako `application/pdf` (stream lub buffer).
5. Front odbiera PDF (blob), inicjuje pobranie pliku.

### 4.2. Diagram (ASCII)

```text
[User] 
  |
  | klik "Generuj katalog"
  v
[Frontend HTML/JS] 
  |
  | GET /api/generate-catalog
  v
[Backend Node/Express]
  |
  |--(1) connect FTP --> [FTP Server]
  |       download feed.xml/csv
  |
  |--(2) parse feed -> Product[]
  |
  |--(3) for products in chunks of 2:
  |        - generate barcode PNG
  |        - download image from imageUrl
  |        - render product block to PDF page
  |
  |--(4) finalize PDF (pdfBytes)
  |
  |--> response application/pdf
  v
[Frontend]
  |
  | createObjectURL(blob)
  v
[pobranie katalog.pdf przez użytkownika]
```

---

## 5. Backend – szczegóły implementacji

### 5.1. Struktura katalogów

```text
project-root/
  package.json
  src/
    index.js             // start Express
    config.js
    ftpClient.js
    feedParser.js
    barcodeGenerator.js
    catalogGenerator.js
    routes/
      generateCatalogRoute.js
  public/
    index.html
    main.js
    styles.css
```

### 5.2. FTP client (pobieranie feedu)

```js
// src/ftpClient.js
import ftp from "basic-ftp";
import fs from "fs";
import { ftpConfig } from "./config.js";
import path from "path";
import os from "os";

export async function downloadFeed() {
  const client = new ftp.Client();
  const tempPath = path.join(os.tmpdir(), "feed.xml"); // lub feed.csv

  try {
    await client.access({
      host: ftpConfig.host,
      user: ftpConfig.user,
      password: ftpConfig.password,
      secure: false,
    });

    await client.downloadTo(tempPath, ftpConfig.filePath);
    return tempPath;
  } finally {
    client.close();
  }
}
```

### 5.3. Parser XML/CSV

```js
// src/feedParser.js
import fs from "fs";
import { parseStringPromise } from "xml2js";
import { parse as parseCsv } from "csv-parse/sync";
import { catalogConfig } from "./config.js";

export async function parseFeed(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");

  if (filePath.endsWith(".xml")) {
    const xml = await parseStringPromise(raw);
    return mapXmlToProducts(xml);
  } else if (filePath.endsWith(".csv")) {
    const records = parseCsv(raw, { columns: true, delimiter: ";" });
    return mapCsvToProducts(records);
  } else {
    throw new Error("Unsupported feed format");
  }
}

// PRZYKŁAD NA PODSTAWIE CSV JAK W ZAŁĄCZNIKU
function mapCsvToProducts(records) {
  return records.slice(0, catalogConfig.maxProducts).map((row) => ({
    id: String(row.id),
    index: String(row.Index),
    name: row.nazwa,
    description: row.Info,
    price: Number(row.price),
    category: row["category/__cdata"],
    imageUrl: row.foto,
    b2bLink: row.B2B_Link,
    grammage: row.Gramatura,
    ean: String(row[catalogConfig.eanField] || row.Index || row.id),
  }));
}

// mapXmlToProducts – implementacja zależna od formatu XML
function mapXmlToProducts(xml) {
  // TODO: dopasować do konkretnego XML
  // zwrócić tablicę Product[]
  return [];
}
```

### 5.4. Kody kreskowe (EAN)

```js
// src/barcodeGenerator.js
import bwipjs from "bwip-js";

export async function generateBarcodePngBuffer(ean) {
  return new Promise((resolve, reject) => {
    bwipjs.toBuffer(
      {
        bcid: "ean13",   // lub "code128" jeśli EAN ma niestandardową długość
        text: ean,
        scale: 3,
        height: 10,
        includetext: false,
      },
      (err, png) => {
        if (err) reject(err);
        else resolve(png);
      }
    );
  });
}
```

### 5.5. Generacja PDF (pdf-lib)

Założenia:

- Format: A4 (595.28 × 841.89 pt).
- Marginesy: 40 pt.
- 2 produkty na stronę: górny i dolny blok.
- W każdym bloku:
  - zdjęcie (po lewej),
  - dane tekstowe (po prawej),
  - kod kreskowy + EAN tekstowo w dolnej części bloku.

```js
// src/catalogGenerator.js
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import fetch from "node-fetch";
import { generateBarcodePngBuffer } from "./barcodeGenerator.js";

export async function generateCatalogPdf(products) {
  const pdfDoc = await PDFDocument.create();
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const margin = 40;

  const availableHeight = pageHeight - margin * 2;
  const productBlockHeight = availableHeight / 2 - 10;

  for (let i = 0; i < products.length; i += 2) {
    const page = pdfDoc.addPage([pageWidth, pageHeight]);

    // delikatne tło w stylu home&decor
    page.drawRectangle({
      x: 0,
      y: 0,
      width: pageWidth,
      height: pageHeight,
      color: rgb(0.99, 0.98, 0.96), // bardzo jasny beż
    });

    const [p1, p2] = [products[i], products[i + 1]].filter(Boolean);

    if (p1) {
      await renderProductBlock(pdfDoc, page, p1, {
        x: margin,
        y: pageHeight - margin - productBlockHeight,
        width: pageWidth - margin * 2,
        height: productBlockHeight,
        fontRegular,
        fontBold,
      });
    }

    if (p2) {
      await renderProductBlock(pdfDoc, page, p2, {
        x: margin,
        y: margin,
        width: pageWidth - margin * 2,
        height: productBlockHeight,
        fontRegular,
        fontBold,
      });
    }
  }

  const pdfBytes = await pdfDoc.save();
  return pdfBytes;
}

async function renderProductBlock(pdfDoc, page, product, layout) {
  const { x, y, width, height, fontRegular, fontBold } = layout;

  // delikatna ramka bloku
  page.drawRectangle({
    x,
    y,
    width,
    height,
    borderColor: rgb(0.85, 0.82, 0.78),
    borderWidth: 0.5,
  });

  // Zdjęcie produktu
  let imgWidth = width * 0.35;
  let imgHeight = imgWidth;

  try {
    const imageBytes = await fetch(product.imageUrl).then((res) =>
      res.arrayBuffer()
    );
    const image = await pdfDoc.embedJpg(imageBytes).catch(() => null);
    if (image) {
      const imgX = x + 10;
      const imgY = y + height - imgHeight - 10;
      page.drawImage(image, {
        x: imgX,
        y: imgY,
        width: imgWidth,
        height: imgHeight,
      });
    }
  } catch (e) {
    // brak zdjęcia = pomijamy, ale nie przerywamy generacji
  }

  // Tekst
  const textX = x + imgWidth + 20;
  let textY = y + height - 20;

  page.drawText(product.name || "", {
    x: textX,
    y: textY,
    size: 14,
    font: fontBold,
  });
  textY -= 18;

  const desc = (product.description || "").slice(0, 300);
  page.drawText(desc, {
    x: textX,
    y: textY,
    size: 10,
    font: fontRegular,
    lineHeight: 12,
    maxWidth: width - imgWidth - 30,
  });
  textY -= 60;

  if (product.price) {
    const priceText = `${product.price.toFixed(2)} zł`;
    page.drawText(priceText, {
      x: textX,
      y: textY,
      size: 12,
      font: fontBold,
    });
    textY -= 16;
  }

  const metaLine = [
    product.category || "",
    product.grammage ? `${product.grammage} g/m²` : "",
  ]
    .filter(Boolean)
    .join(" | ");

  if (metaLine) {
    page.drawText(metaLine, {
      x: textX,
      y: textY,
      size: 9,
      font: fontRegular,
    });
  }

  // Kod kreskowy na dole bloku
  if (product.ean) {
    try {
      const barcodePng = await generateBarcodePngBuffer(product.ean);
      const barcodeImage = await pdfDoc.embedPng(barcodePng);
      const barcodeWidth = 140;
      const barcodeHeight = 40;
      const barcodeX = x + 10;
      const barcodeY = y + 10;

      page.drawImage(barcodeImage, {
        x: barcodeX,
        y: barcodeY,
        width: barcodeWidth,
        height: barcodeHeight,
      });

      page.drawText(product.ean, {
        x: barcodeX,
        y: barcodeY - 12,
        size: 10,
        font: fontRegular,
      });
    } catch (e) {
      // brak kodu kreskowego nie psuje strony
    }
  }
}
```

### 5.6. Route API

```js
// src/routes/generateCatalogRoute.js
import express from "express";
import { downloadFeed } from "../ftpClient.js";
import { parseFeed } from "../feedParser.js";
import { generateCatalogPdf } from "../catalogGenerator.js";

export const router = express.Router();

router.get("/generate-catalog", async (req, res) => {
  try {
    const filePath = await downloadFeed();
    const products = await parseFeed(filePath);

    if (!products || products.length === 0) {
      return res.status(500).send("No products found in feed");
    }

    const pdfBytes = await generateCatalogPdf(products);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="katalog_spod-igly-i-nitki.pdf"'
    );
    res.send(Buffer.from(pdfBytes));
  } catch (err) {
    console.error(err);
    res.status(500).send("Error generating catalog");
  }
});
```

### 5.7. Start serwera

```js
// src/index.js
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { router as generateCatalogRouter } from "./routes/generateCatalogRoute.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "..", "public")));

app.use("/api", generateCatalogRouter);

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
```

---

## 6. Frontend (prosty, statyczny)

```html
<!-- public/index.html -->
<!doctype html>
<html lang="pl">
  <head>
    <meta charset="UTF-8" />
    <title>Katalog Spod Igły i Nitki</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body>
    <main class="container">
      <h1>Katalog produktowy</h1>
      <p>Wygeneruj aktualny katalog PDF z feedu FTP.</p>
      <button id="generate">Generuj katalog PDF</button>
      <div id="log"></div>
    </main>
    <script src="/main.js"></script>
  </body>
</html>
```

```js
// public/main.js
const logEl = document.getElementById("log");

function log(msg) {
  const time = new Date().toLocaleTimeString();
  logEl.innerHTML += `[${time}] ${msg}<br>`;
}

document.getElementById("generate").addEventListener("click", async () => {
  log("Start generowania katalogu...");
  try {
    const res = await fetch("/api/generate-catalog");
    if (!res.ok) throw new Error("Błąd serwera: " + res.status);

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "katalog_spod-igly-i-nitki.pdf";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    log("Katalog wygenerowany ✅");
  } catch (err) {
    log("Błąd: " + err.message);
  }
});
```

---

## 7. Performance i 2500 produktów

- **2500 produktów / 2 na stronę = ok. 1250 stron PDF**.
- pdf-lib spokojnie to udźwignie na backendzie, ale:
  - unikamy trzymania gigantycznych obrazów w pamięci naraz – pobieramy i osadzamy obraz **per produkt** (tak jak w kodzie).
  - możemy dodać:
    - limit rozmiaru obrazków (np. maks szerokość),
    - ewentualne cache obrazków na dysku (jeśli generacja będzie cykliczna).
- Opcjonalnie:
  - możliwość generowania osobnych katalogów per kategoria (np. `katalog_reczniki.pdf`, `katalog_posciele.pdf`).

---

## 8. Deployment – skrót

### 8.1. Mikr.us (VPS)

1. Zainstalować Node (18+).
2. Sklonować repo: `git clone ...`.
3. `npm install`.
4. Ustawić zmienne env (`FTP_HOST`, `FTP_USER`, `FTP_PASSWORD`, `FTP_FILE_PATH`, `PORT`).
5. Uruchomić przez `pm2`:
   ```bash
   pm2 start src/index.js --name katalog-app
   pm2 save
   ```
6. nginx:
   - reverse proxy z domeny na `localhost:PORT`.

### 8.2. Vercel

- Build jako Node app / Express na serverless (np. vercel.json + adaptacja do API Routes).
- Front – statyczny.

---

## 9. Testy

1. **Testy feedu**:
   - CSV z realnymi danymi (~2500 produktów).
   - XML w docelowym formacie.
2. **Testy PDF**:
   - sprawdzenie ilości stron (czy ilość się zgadza).
   - losowe produkty – czy dane są poprawne (nazwa, cena, EAN).
   - skanowanie kodów EAN kolektorem.
3. **Testy wydajności / stabilności**:
   - pomiar czasu generacji dla 2500 produktów.
   - logowanie błędów pobierania zdjęć (nie może przerwać generacji).

---

## 10. PROMPT DLA AI-DEVA (gotowiec)

Możesz to wkleić np. do Claude / innego agenta jako **single source of truth**:

```text
Jesteś doświadczonym fullstack developerem (Node.js + Express + pdf-lib + bwip-js),
masz wygenerować kompletną aplikację zgodnie z poniższą specyfikacją.

CEL:
Stworzyć aplikację do generowania katalogu PDF z feedu XML/CSV pobieranego z
zahasłowanego FTP. PDF zawiera ok. 2500 produktów, 2 produkty na stronę,
EAN jako barcode + tekst, zdjęcia z URL. Styl: katalog home & decor.

STACK:
- Backend: Node.js 18+, Express.js.
- Moduły:
  - basic-ftp (pobieranie feedu z FTP),
  - xml2js (parser XML),
  - csv-parse/sync (parser CSV),
  - pdf-lib (generacja PDF),
  - bwip-js (EAN jako PNG),
  - node-fetch (pobieranie zdjęć).
- Frontend: statyczne HTML + CSS + JS (bez frameworków).

WYMAGANIA:
1. Endpoint GET /api/generate-catalog:
   - backend łączy się z FTP (zmienne env: FTP_HOST, FTP_USER, FTP_PASSWORD, FTP_FILE_PATH),
   - pobiera plik feedu (xml/csv),
   - parsuje do modelu Product:
     type Product = {
       id: string;
       index: string;
       name: string;
       description: string;
       price: number;
       category: string;
       imageUrl: string;
       b2bLink?: string;
       grammage?: string;
       ean: string;
     };
   - generuje PDF z A4, 2 produkty na stronę:
     - jasne beżowe tło,
     - każdy produkt w prostokątnym bloku:
       - po lewej zdjęcie (35% szerokości),
       - po prawej tekst: nazwa (bold), opis, cena, kategoria+gramatura,
       - na dole kod kreskowy EAN (PNG z bwip-js) + tekstowo EAN.
   - zwraca PDF jako application/pdf (attachment).

2. Konfiguracja (config.js):
   - ftpConfig: host, user, password, filePath (env).
   - catalogConfig: productsPerPage=2, eanField="Index", maxProducts=3000.

3. Frontend (public/index.html + main.js):
   - przycisk "Generuj katalog PDF",
   - kliknięcie wywołuje fetch("/api/generate-catalog"),
   - pobrany blob zapisuje jako "katalog_spod-igly-i-nitki.pdf",
   - wyświetla logi w <div id="log">.

4. Struktura projektu:
   - src/index.js – start Express.
   - src/config.js – konfiguracja.
   - src/ftpClient.js – pobieranie feedu z FTP.
   - src/feedParser.js – parser XML/CSV.
   - src/barcodeGenerator.js – generacja PNG EAN.
   - src/catalogGenerator.js – generacja PDF.
   - src/routes/generateCatalogRoute.js – endpoint.
   - public/index.html, public/main.js, public/styles.css.

5. Wymagania jakości:
   - Kod w ES Modules (import/export),
   - sensowne logowanie błędów (console.error),
   - brak hardcodowania haseł – tylko process.env,
   - brak crasha przy brakującym zdjęciu lub błędzie kodu kreskowego – produkt ma się nadal
     pojawić (bez obrazka / bez barcode, ale aplikacja ma generować dokument do końca).

ZADANIE:
Na podstawie tej specyfikacji wygeneruj pełen kod projektu, gotowy do `npm install` i `npm start`.
Uwzględnij package.json z zależnościami, skrypty startowe i minimalnie estetyczny frontend.
```
