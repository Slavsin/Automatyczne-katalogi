# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Opis projektu

Aplikacja do generowania katalogów PDF z feedów produktowych (XML/CSV/XLSX). Obsługuje trzy źródła danych:
- Upload pliku (CSV, XML, XLSX)
- Pobieranie z URL (z opcjonalną autoryzacją Basic Auth)
- FTP (legacy)

Generuje profesjonalny katalog w stylu "home & decor" z kodami kreskowymi EAN i opcjonalnym rabatem handlowym.

## Stack technologiczny

- **Backend:** Node.js 18+, Express.js
- **PDF:** pdf-lib
- **Kody kreskowe:** bwip-js (EAN-13)
- **FTP:** basic-ftp
- **Parsery:** xml2js, csv-parse, xlsx
- **Frontend:** statyczny HTML + CSS + JS
- **SSE:** Server-Sent Events dla postępu generacji

## Komendy

```bash
npm install           # Instalacja zależności
npm start             # Uruchomienie serwera (node src/index.js)
```

## Zmienne środowiskowe

```env
FTP_HOST=
FTP_USER=
FTP_PASSWORD=
FTP_FILE_PATH=        # np. /feeds/katalog.xml
PORT=3000
```

## Architektura

```
src/
  index.js                    # Start Express
  config.js                   # Konfiguracja FTP i katalogu
  ftpClient.js                # Pobieranie feedu z FTP
  feedParser.js               # Parser XML/CSV/XLSX -> Product[]
  barcodeGenerator.js         # Generacja PNG kodów EAN (bwip-js)
  catalogGenerator.js         # Generacja PDF (pdf-lib) + progress callback
  routes/
    generateCatalogRoute.js   # Routing API (upload, URL, SSE)
public/
  index.html                  # Dashboard z tabami (upload/URL)
  main.js                     # Logika frontendu + SSE + progress bar
  styles.css                  # Style z progress bar i discount panel
temp/                         # Tymczasowe pliki PDF (auto-cleanup 5 min)
uploads/                      # Uploadowane feedy
```

## Model danych

```typescript
type Product = {
  id: string;
  index: string;
  name: string;
  description: string;
  price: number;           // Cena brutto
  priceNet?: number;       // Cena netto (dla rabatów)
  category: string;
  imageUrl: string;
  b2bLink?: string;
  grammage?: string;
  ean: string;
  color?: string;
  composition?: string;
  stock?: number;
  available?: boolean;
};

type DiscountOptions = {
  percent: number;         // Procent rabatu (0-100)
  label: string;           // Etykieta np. "Warunki handlowe"
};
```

## API

### POST /api/upload-feed
Upload pliku z feedem (CSV, XML, XLSX).
- **Body:** multipart/form-data z polem `file`
- **Zwraca:** JSON z informacjami o feedzie (produkty, kategorie, kolory, etc.)

### POST /api/fetch-url-feed
Pobiera feed z URL z opcjonalną autoryzacją Basic Auth.
- **Body:** `{ url, login?, password? }`
- **Zwraca:** JSON z informacjami o feedzie

### GET /api/upload-info
Sprawdza czy jest dostępny wcześniej uploadowany plik.

### GET /api/generate-from-upload-sse
SSE endpoint - generuje PDF z uploadowanego pliku ze streamingiem postępu.

Query params:
- `category`, `color`, `composition` - filtrowanie
- `minPrice`, `maxPrice` - zakres cen
- `minStock` - minimalny stan magazynowy
- `onlyAvailable` - tylko dostępne produkty
- `sortBy` - sortowanie (name, price, category, stock)
- `searchPhrase` - szukanie w nazwie
- `discountPercent` - rabat handlowy (%)
- `discountLabel` - etykieta rabatu

SSE Events:
- `{ type: "progress", current, total, message }` - postęp generacji
- `{ type: "done", downloadUrl, size }` - zakończono, link do pobrania
- `{ type: "error", message }` - błąd

### GET /api/generate-from-url-sse
SSE endpoint - generuje PDF z feedu URL (jak wyżej).

### GET /api/download-pdf?file=...
Pobiera wygenerowany PDF z folderu temp.

### GET /api/generate-catalog (legacy)
Stary endpoint dla FTP, zwraca PDF bezpośrednio.

## Funkcjonalności

### Progress Bar (SSE)
Frontend używa EventSource do odbioru postępu generacji PDF:
```javascript
const eventSource = new EventSource('/api/generate-from-upload-sse?...');
eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);
  if (data.type === 'progress') updateProgress(data.current, data.total, data.message);
  if (data.type === 'done') window.location.href = data.downloadUrl;
};
```

### Rabat handlowy
- Użytkownik podaje % rabatu i opcjonalną etykietę
- Na stronie tytułowej wyświetlany jest rabat w kolorze czerwonym
- Przy każdym produkcie cena netto po rabacie wyświetlana jest w kolorze czerwonym
- Obliczenie: `priceNet * (1 - discountPercent / 100)`

### Autoryzacja URL (Basic Auth)
Feed z URL może wymagać autoryzacji. Implementacja używa nagłówka HTTP:
```javascript
headers["Authorization"] = `Basic ${Buffer.from(`${login}:${password}`).toString("base64")}`;
```

## Przepływ generacji PDF

1. Źródło danych: upload pliku LUB pobieranie z URL LUB FTP
2. Parsowanie do `Product[]` (feedParser.js)
3. Filtrowanie i sortowanie wg parametrów
4. Generacja PDF z callbackiem postępu:
   - Strona tytułowa (z info o rabacie jeśli podany)
   - 2 produkty na stronę A4
   - Dla każdego produktu: zdjęcie, dane, kod kreskowy EAN
   - Cena netto po rabacie (czerwona) jeśli rabat aktywny
5. Zapis do temp/ z auto-cleanup po 5 minutach
6. Zwrot URL do pobrania

## Kluczowe założenia

- **2 produkty na stronę** A4 (ok. 1250 stron dla ~2500 produktów)
- **EAN jako kod kreskowy** (skanowalny kolektorem) + tekst
- **Odporność na błędy:** brak zdjęcia lub błąd kodu kreskowego nie przerywa generacji
- **Styl:** jasne beżowe tło, elegancka typografia (Helvetica)
- **Progress bar:** aktualizacja co 10 stron
- **Rabat handlowy:** ceny netto w kolorze czerwonym

## Deployment

### Mikr.us VPS (produkcja)
- **URL:** http://katalog.byst.re
- **Serwer:** 65.21.202.148 (SSH port 10161)
- **Ścieżka:** `/var/www/Automatyczne-katalogi`
- **Process manager:** PM2 (`pm2 start src/index.js --name "katalog-pdf"`)
- **Reverse proxy:** Nginx (config: `/etc/nginx/sites-available/katalog`)

### Komendy deployment
```bash
# Połączenie SSH
ssh -p 10161 root@65.21.202.148

# Aktualizacja kodu
cd /var/www/Automatyczne-katalogi
git pull

# Restart aplikacji
pm2 restart katalog-pdf

# Logi
pm2 logs katalog-pdf
```

### Szybki deploy (z lokalnej maszyny)
```bash
git push && ssh -p 10161 root@65.21.202.148 "cd /var/www/Automatyczne-katalogi && git pull && pm2 restart katalog-pdf"
```
