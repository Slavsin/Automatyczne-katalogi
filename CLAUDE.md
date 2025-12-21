# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Opis projektu

Aplikacja do generowania katalogów PDF z feedów produktowych (XML/CSV) pobieranych z FTP. Generuje profesjonalny katalog w stylu "home & decor" z kodami kreskowymi EAN.

## Stack technologiczny

- **Backend:** Node.js 18+, Express.js
- **PDF:** pdf-lib
- **Kody kreskowe:** bwip-js (EAN-13)
- **FTP:** basic-ftp
- **Parsery:** xml2js, csv-parse
- **Frontend:** statyczny HTML + CSS + JS

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
  feedParser.js               # Parser XML/CSV -> Product[]
  barcodeGenerator.js         # Generacja PNG kodów EAN (bwip-js)
  catalogGenerator.js         # Generacja PDF (pdf-lib)
  routes/
    generateCatalogRoute.js   # GET /api/generate-catalog
public/
  index.html                  # Dashboard
  main.js                     # Logika frontendu
  styles.css
```

## Model danych

```typescript
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
```

## API

### GET /api/generate-catalog

Opcjonalne query params:
- `category` - filtrowanie po kategorii
- `minPrice`, `maxPrice` - filtrowanie po cenie
- `sortBy` - sortowanie

Zwraca: `application/pdf`

## Przepływ generacji PDF

1. Pobieranie feedu z FTP
2. Parsowanie XML/CSV do `Product[]`
3. Generacja stron PDF (2 produkty na stronę A4)
4. Dla każdego produktu:
   - Pobieranie zdjęcia z URL
   - Generowanie kodu kreskowego EAN
   - Renderowanie bloku produktu
5. Zwrot PDF jako blob

## Kluczowe założenia

- **2 produkty na stronę** A4 (ok. 1250 stron dla ~2500 produktów)
- **EAN jako kod kreskowy** (skanowalny kolektorem) + tekst
- **Odporność na błędy:** brak zdjęcia lub błąd kodu kreskowego nie przerywa generacji
- **Styl:** jasne beżowe tło, elegancka typografia (Helvetica)

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
