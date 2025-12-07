# Dokumentacja aplikacji do generowania katalogu PDF z pliku XML/CSV (FTP)

## 1. Cel aplikacji

Aplikacja webowa (HTML + JS + Node backend), osadzona na VPS (Mikr.us)
lub Vercel, która: - pobiera zahasłowany plik XML (lub CSV) z FTP, -
parsuje dane produktów, - generuje katalog PDF w stylistyce home &
decor, - na jednej stronie PDF umieszcza **2 produkty**, - dodaje EAN
jako **kod kreskowy** i **numer tekstowy**, - pobiera zdjęcie z pola
zawierającego URL.

------------------------------------------------------------------------

## 2. Technologia i stack

### Frontend

-   HTML5 + CSS3 + JavaScript.
-   Jednostronicowy dashboard: przycisk „Generuj katalog", logi, filtry.

### Backend (Node.js)

-   Express.js lub Vercel Serverless Functions.
-   Moduły:
    -   FTP client: `basic-ftp`
    -   XML parser: `xml2js`
    -   CSV parser: `csv-parse`
    -   PDF generator: `pdf-lib`
    -   Kody kreskowe: `bwip-js`

### Hosting

-   **Mikr.us VPS** (Node + nginx)
-   **Vercel** (frontend statyczny + backend serverless)

------------------------------------------------------------------------

## 3. Model danych produktu

``` ts
type Product = {
  id: string;
  index: string;
  name: string;
  description: string;
  price: number;
  category: string;
  imageUrl: string;
  b2bLink: string;
  grammage: string;
  ean: string;
};
```

------------------------------------------------------------------------

## 4. Przepływ działania

1.  Użytkownik klika „Generuj katalog".
2.  Front wykonuje request do `/api/generate-catalog`.
3.  Backend:
    -   pobiera plik z FTP,
    -   parsuje XML/CSV do Product\[\],
    -   generuje PDF,
    -   zwraca PDF.
4.  Front pobiera PDF jako blob i zapisuje.

------------------------------------------------------------------------

## 5. Moduły backendowe

### 5.1. Konfiguracja

``` js
export const ftpConfig = {
  host: process.env.FTP_HOST,
  user: process.env.FTP_USER,
  password: process.env.FTP_PASSWORD,
  filePath: process.env.FTP_FILE_PATH,
};

export const catalogConfig = {
  productsPerPage: 2,
  eanField: "Index",
};
```

### 5.2. Pobieranie z FTP

``` js
import ftp from "basic-ftp";
import fs from "fs";

export async function downloadFeed() {
  const client = new ftp.Client();
  const tempPath = "/tmp/feed.xml";

  await client.access({
    host: ftpConfig.host,
    user: ftpConfig.user,
    password: ftpConfig.password,
    secure: false
  });

  await client.downloadTo(tempPath, ftpConfig.filePath);
  client.close();
  return tempPath;
}
```

### 5.3. Parser XML/CSV

``` js
import { parseStringPromise } from "xml2js";
import csvParse from "csv-parse/sync";

function mapCsvToProducts(records) {
  return records.map(row => ({
    id: row.id,
    index: row.Index,
    name: row.nazwa,
    description: row.Info,
    price: Number(row.price),
    category: row["category/__cdata"],
    imageUrl: row.foto,
    b2bLink: row.B2B_Link,
    grammage: row.Gramatura,
    ean: row.Index,
  }));
}
```

------------------------------------------------------------------------

## 6. Generowanie kodów kreskowych

``` js
import bwipjs from "bwip-js";

export async function generateBarcodePngBuffer(ean) {
  return bwipjs.toBuffer({
    bcid: "ean13",
    text: ean,
    scale: 3,
    height: 10,
    includetext: false
  });
}
```

------------------------------------------------------------------------

## 7. Generowanie PDF (`pdf-lib`)

Strona PDF (A4): - dwa bloki produktów: górny i dolny, - zdjęcie, nazwa,
opis, cena, kategoria, gramatura, EAN + barcode.

Fragment funkcji:

``` js
import { PDFDocument, StandardFonts } from "pdf-lib";

export async function generateCatalogPdf(products) {
  const pdfDoc = await PDFDocument.create();
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // logika: iteracja po 2 produkty → 1 strona PDF
}
```

------------------------------------------------------------------------

## 8. Endpoint API

### GET `/api/generate-catalog`

Parametry query opcjonalne: - `category` - `minPrice`, `maxPrice` -
`sortBy`

Wynik: - PDF (`application/pdf`)

------------------------------------------------------------------------

## 9. Frontend

``` html
<button id="generate">Generuj katalog PDF</button>
<script>
document.getElementById("generate").onclick = async () => {
  const res = await fetch("/api/generate-catalog");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "katalog.pdf";
  a.click();
};
</script>
```

------------------------------------------------------------------------

## 10. Stylistyka katalogu (home & decor)

-   kolory: beż, złamana biel, delikatne szarości,
-   typografia: Helvetica / Inter,
-   layout: duże marginesy, elegancka siatka,
-   strona tytułowa: logo, claim, opis jakości + Oeko-Tex.

------------------------------------------------------------------------

## 11. Testowanie

-   test parsera,
-   test generacji PDF (czy skanery czytają kod),
-   test integracji na VPS / Vercel.

------------------------------------------------------------------------

## 12. Bezpieczeństwo

-   dane FTP tylko w env,
-   możliwość basic-auth na interfejsie frontu,
-   odporność na duże feedy (opcjonalnie filtry).
