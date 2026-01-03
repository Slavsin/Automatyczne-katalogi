import express from "express";
import multer from "multer";
import path from "path";
import os from "os";
import fs from "fs";
import got from "got";
import { CookieJar } from "tough-cookie";
import { downloadFeed } from "../ftpClient.js";
import { parseFeed } from "../feedParser.js";
import { generateCatalogPdf } from "../catalogGenerator.js";

export const router = express.Router();

// Konfiguracja multer dla uploadu plików
const storage = multer.diskStorage({
  destination: os.tmpdir(),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `feed-${Date.now()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
  fileFilter: (req, file, cb) => {
    const allowedExt = [".csv", ".xml", ".xlsx", ".xls"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedExt.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error("Dozwolone formaty: CSV, XML, XLSX"));
    }
  },
});

// Zmienna do przechowywania ścieżki ostatnio uploadowanego pliku
let uploadedFilePath = null;
let urlFeedFilePath = null;

// Funkcja do pobierania feedu z URL
// Obsługuje Basic Auth w nagłówkach oraz cookies dla sesji
async function fetchFeedFromUrl(url, login, password) {
  console.log(`Pobieranie feedu z: ${url}`);

  try {
    // Cookie jar do przechowywania sesji
    const cookieJar = new CookieJar();

    // Przygotuj nagłówki
    const headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "application/xml, text/xml, */*",
    };

    // Dodaj Basic Auth jeśli podano credentials
    if (login && password) {
      const credentials = Buffer.from(`${login}:${password}`).toString("base64");
      headers["Authorization"] = `Basic ${credentials}`;
      console.log(`Autoryzacja: Basic Auth dla użytkownika "${login}"`);
    }

    // Użyj got z cookie jar
    const response = await got(url, {
      headers,
      cookieJar,
      followRedirect: true,
      maxRedirects: 10,
      timeout: { request: 180000 },
      https: { rejectUnauthorized: false },
    });

    const content = response.body;

    // Zapisz do pliku tymczasowego
    const tempPath = path.join(os.tmpdir(), `url-feed-${Date.now()}.xml`);
    fs.writeFileSync(tempPath, content, "utf8");

    console.log(`Feed zapisany do: ${tempPath} (${(content.length / 1024).toFixed(1)} KB)`);
    return tempPath;
  } catch (error) {
    console.error("Błąd pobierania:", error.message);
    if (error.response) {
      throw new Error(`Błąd HTTP ${error.response.statusCode}: ${error.response.statusMessage || "Nieznany błąd"}`);
    }
    throw error;
  }
}

router.get("/generate-catalog", async (req, res) => {
  const startTime = Date.now();

  try {
    console.log("=== Rozpoczynam generowanie katalogu ===");

    // Pobieranie feedu z FTP
    console.log("1. Pobieranie feedu z FTP...");
    const filePath = await downloadFeed();

    // Parsowanie feedu
    console.log("2. Parsowanie feedu...");
    let products = await parseFeed(filePath);

    if (!products || products.length === 0) {
      console.error("Brak produktów w feedzie");
      return res.status(500).json({ error: "Brak produktów w feedzie" });
    }

    console.log(`Znaleziono ${products.length} produktów`);

    // Opcjonalne filtrowanie
    const { searchPhrase, category, minPrice, maxPrice, sortBy, minStock, onlyAvailable, color, composition } = req.query;

    if (searchPhrase) {
      const phrase = searchPhrase.toLowerCase();
      products = products.filter((p) =>
        p.name.toLowerCase().includes(phrase)
      );
      console.log(`Po filtrze frazy "${searchPhrase}": ${products.length} produktów`);
    }

    if (category) {
      products = products.filter((p) =>
        p.category.toLowerCase().includes(category.toLowerCase())
      );
      console.log(`Po filtrze kategorii: ${products.length} produktów`);
    }

    if (minPrice) {
      products = products.filter((p) => p.price >= Number(minPrice));
    }

    if (maxPrice) {
      products = products.filter((p) => p.price <= Number(maxPrice));
    }

    // Nowe filtry
    if (minStock) {
      products = products.filter((p) => p.availabilityCount >= Number(minStock));
      console.log(`Po filtrze min. stanu (${minStock}): ${products.length} produktów`);
    }

    if (onlyAvailable === "true" || onlyAvailable === "1") {
      products = products.filter((p) => p.availabilityCount > 0);
      console.log(`Po filtrze dostępności: ${products.length} produktów`);
    }

    if (color) {
      products = products.filter((p) =>
        p.color && p.color.toLowerCase().includes(color.toLowerCase())
      );
      console.log(`Po filtrze koloru (${color}): ${products.length} produktów`);
    }

    if (composition) {
      products = products.filter((p) =>
        p.composition && p.composition.toLowerCase().includes(composition.toLowerCase())
      );
      console.log(`Po filtrze składu (${composition}): ${products.length} produktów`);
    }

    if (sortBy === "price") {
      products.sort((a, b) => a.price - b.price);
    } else if (sortBy === "name") {
      products.sort((a, b) => a.name.localeCompare(b.name, "pl"));
    } else if (sortBy === "category") {
      products.sort((a, b) => a.category.localeCompare(b.category, "pl"));
    } else if (sortBy === "stock") {
      products.sort((a, b) => b.availabilityCount - a.availabilityCount);
    }

    // Generowanie PDF
    console.log("3. Generowanie PDF...");
    const pdfBytes = await generateCatalogPdf(products);

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`=== Katalog wygenerowany w ${duration}s ===`);

    // Wysyłanie PDF
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="katalog_spod-igly-i-nitki.pdf"'
    );
    res.setHeader("Content-Length", pdfBytes.length);
    res.send(Buffer.from(pdfBytes));
  } catch (err) {
    console.error("Błąd generowania katalogu:", err);
    res.status(500).json({
      error: "Błąd generowania katalogu",
      message: err.message,
    });
  }
});

// Upload pliku z dysku
router.post("/upload-feed", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Nie przesłano pliku" });
    }

    uploadedFilePath = req.file.path;
    console.log(`Plik uploadowany: ${req.file.originalname} -> ${uploadedFilePath}`);

    // Parsowanie i zwrócenie info
    const products = await parseFeed(uploadedFilePath);
    const categories = [...new Set(products.map((p) => p.category).filter(Boolean))];
    const colors = [...new Set(products.map((p) => p.color).filter(Boolean))];
    const compositions = [...new Set(products.map((p) => p.composition).filter(Boolean))];
    const availableCount = products.filter((p) => p.availabilityCount > 0).length;

    res.json({
      success: true,
      filename: req.file.originalname,
      totalProducts: products.length,
      availableProducts: availableCount,
      estimatedPages: Math.ceil(products.length / 2),
      categories: categories.sort(),
      colors: colors.sort(),
      compositions: compositions.sort(),
      priceRange: {
        min: Math.min(...products.map((p) => p.price).filter((p) => p > 0)) || 0,
        max: Math.max(...products.map((p) => p.price)) || 0,
      },
      stockRange: {
        min: Math.min(...products.map((p) => p.availabilityCount)) || 0,
        max: Math.max(...products.map((p) => p.availabilityCount)) || 0,
      },
    });
  } catch (err) {
    console.error("Błąd uploadu:", err);
    res.status(500).json({
      error: "Błąd przetwarzania pliku",
      message: err.message,
    });
  }
});

// Generowanie PDF z uploadowanego pliku
router.post("/generate-from-upload", async (req, res) => {
  const startTime = Date.now();

  // Zwiększ timeout dla długich operacji (10 minut)
  req.setTimeout(600000);
  res.setTimeout(600000);

  try {
    if (!uploadedFilePath || !fs.existsSync(uploadedFilePath)) {
      return res.status(400).json({ error: "Najpierw prześlij plik" });
    }

    console.log("=== Generowanie katalogu z uploadowanego pliku ===");
    console.log(`Plik źródłowy: ${uploadedFilePath}`);

    let products = await parseFeed(uploadedFilePath);

    if (!products || products.length === 0) {
      return res.status(500).json({ error: "Brak produktów w pliku" });
    }

    console.log(`Znaleziono ${products.length} produktów`);

    // Filtrowanie (z body lub query)
    const { searchPhrase, category, minPrice, maxPrice, sortBy, minStock, onlyAvailable, color, composition } = { ...req.query, ...req.body };

    if (searchPhrase) {
      const phrase = searchPhrase.toLowerCase();
      products = products.filter((p) =>
        p.name.toLowerCase().includes(phrase)
      );
      console.log(`Po filtrze frazy "${searchPhrase}": ${products.length} produktów`);
    }

    if (category) {
      products = products.filter((p) =>
        p.category.toLowerCase().includes(category.toLowerCase())
      );
      console.log(`Po filtrze kategorii: ${products.length} produktów`);
    }

    if (minPrice) {
      products = products.filter((p) => p.price >= Number(minPrice));
    }

    if (maxPrice) {
      products = products.filter((p) => p.price <= Number(maxPrice));
    }

    // Nowe filtry
    if (minStock) {
      products = products.filter((p) => p.availabilityCount >= Number(minStock));
      console.log(`Po filtrze min. stanu (${minStock}): ${products.length} produktów`);
    }

    if (onlyAvailable === true || onlyAvailable === "true" || onlyAvailable === "1") {
      products = products.filter((p) => p.availabilityCount > 0);
      console.log(`Po filtrze dostępności: ${products.length} produktów`);
    }

    if (color) {
      products = products.filter((p) =>
        p.color && p.color.toLowerCase().includes(color.toLowerCase())
      );
      console.log(`Po filtrze koloru (${color}): ${products.length} produktów`);
    }

    if (composition) {
      products = products.filter((p) =>
        p.composition && p.composition.toLowerCase().includes(composition.toLowerCase())
      );
      console.log(`Po filtrze składu (${composition}): ${products.length} produktów`);
    }

    if (sortBy === "price") {
      products.sort((a, b) => a.price - b.price);
    } else if (sortBy === "name") {
      products.sort((a, b) => a.name.localeCompare(b.name, "pl"));
    } else if (sortBy === "category") {
      products.sort((a, b) => a.category.localeCompare(b.category, "pl"));
    } else if (sortBy === "stock") {
      products.sort((a, b) => b.availabilityCount - a.availabilityCount);
    }

    console.log(`Generowanie PDF dla ${products.length} produktów...`);
    const pdfBytes = await generateCatalogPdf(products);

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`=== Katalog wygenerowany w ${duration}s ===`);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="katalog_spod-igly-i-nitki.pdf"'
    );
    res.setHeader("Content-Length", pdfBytes.length);
    res.send(Buffer.from(pdfBytes));
  } catch (err) {
    console.error("Błąd generowania katalogu:", err);
    res.status(500).json({
      error: "Błąd generowania katalogu",
      message: err.message,
    });
  }
});

// Endpoint do sprawdzenia statusu i info o feedzie (FTP)
router.get("/feed-info", async (req, res) => {
  try {
    const filePath = await downloadFeed();
    const products = await parseFeed(filePath);

    const categories = [...new Set(products.map((p) => p.category).filter(Boolean))];

    res.json({
      source: "ftp",
      totalProducts: products.length,
      estimatedPages: Math.ceil(products.length / 2),
      categories: categories.sort(),
      priceRange: {
        min: Math.min(...products.map((p) => p.price).filter((p) => p > 0)),
        max: Math.max(...products.map((p) => p.price)),
      },
    });
  } catch (err) {
    res.status(500).json({
      error: "Błąd pobierania informacji o feedzie",
      message: err.message,
    });
  }
});

// Info o uploadowanym pliku
router.get("/upload-info", async (req, res) => {
  try {
    if (!uploadedFilePath || !fs.existsSync(uploadedFilePath)) {
      return res.json({ uploaded: false });
    }

    const products = await parseFeed(uploadedFilePath);
    const categories = [...new Set(products.map((p) => p.category).filter(Boolean))];

    res.json({
      uploaded: true,
      source: "upload",
      totalProducts: products.length,
      estimatedPages: Math.ceil(products.length / 2),
      categories: categories.sort(),
      priceRange: {
        min: Math.min(...products.map((p) => p.price).filter((p) => p > 0)) || 0,
        max: Math.max(...products.map((p) => p.price)) || 0,
      },
    });
  } catch (err) {
    res.status(500).json({
      error: "Błąd odczytu uploadowanego pliku",
      message: err.message,
    });
  }
});

// === URL FEED ENDPOINTS ===

// Pobierz feed z URL
router.post("/fetch-url-feed", async (req, res) => {
  try {
    const { url, login, password } = req.body;

    if (!url) {
      return res.status(400).json({ error: "Brak adresu URL" });
    }

    urlFeedFilePath = await fetchFeedFromUrl(url, login, password);

    const products = await parseFeed(urlFeedFilePath);
    const categories = [...new Set(products.map((p) => p.category).filter(Boolean))];
    const colors = [...new Set(products.map((p) => p.color).filter(Boolean))];
    const compositions = [...new Set(products.map((p) => p.composition).filter(Boolean))];
    const availableCount = products.filter((p) => p.availabilityCount > 0).length;

    res.json({
      success: true,
      source: "url",
      totalProducts: products.length,
      availableProducts: availableCount,
      estimatedPages: Math.ceil(products.length / 2),
      categories: categories.sort(),
      colors: colors.sort(),
      compositions: compositions.sort(),
      priceRange: {
        min: Math.min(...products.map((p) => p.price).filter((p) => p > 0)) || 0,
        max: Math.max(...products.map((p) => p.price)) || 0,
      },
      stockRange: {
        min: Math.min(...products.map((p) => p.availabilityCount)) || 0,
        max: Math.max(...products.map((p) => p.availabilityCount)) || 0,
      },
    });
  } catch (err) {
    console.error("Błąd pobierania feedu z URL:", err);
    res.status(500).json({
      error: "Błąd pobierania feedu z URL",
      message: err.message,
    });
  }
});

// Generowanie PDF z feedu URL
router.post("/generate-from-url", async (req, res) => {
  const startTime = Date.now();

  req.setTimeout(600000);
  res.setTimeout(600000);

  try {
    if (!urlFeedFilePath || !fs.existsSync(urlFeedFilePath)) {
      return res.status(400).json({ error: "Najpierw pobierz feed z URL" });
    }

    console.log("=== Generowanie katalogu z feedu URL ===");
    console.log(`Plik źródłowy: ${urlFeedFilePath}`);

    let products = await parseFeed(urlFeedFilePath);

    if (!products || products.length === 0) {
      return res.status(500).json({ error: "Brak produktów w feedzie" });
    }

    console.log(`Znaleziono ${products.length} produktów`);

    // Filtrowanie
    const { searchPhrase, category, minPrice, maxPrice, sortBy, minStock, onlyAvailable, color, composition } = { ...req.query, ...req.body };

    if (searchPhrase) {
      const phrase = searchPhrase.toLowerCase();
      products = products.filter((p) =>
        p.name.toLowerCase().includes(phrase)
      );
      console.log(`Po filtrze frazy "${searchPhrase}": ${products.length} produktów`);
    }

    if (category) {
      products = products.filter((p) =>
        p.category.toLowerCase().includes(category.toLowerCase())
      );
      console.log(`Po filtrze kategorii: ${products.length} produktów`);
    }

    if (minPrice) {
      products = products.filter((p) => p.price >= Number(minPrice));
    }

    if (maxPrice) {
      products = products.filter((p) => p.price <= Number(maxPrice));
    }

    if (minStock) {
      products = products.filter((p) => p.availabilityCount >= Number(minStock));
      console.log(`Po filtrze min. stanu (${minStock}): ${products.length} produktów`);
    }

    if (onlyAvailable === true || onlyAvailable === "true" || onlyAvailable === "1") {
      products = products.filter((p) => p.availabilityCount > 0);
      console.log(`Po filtrze dostępności: ${products.length} produktów`);
    }

    if (color) {
      products = products.filter((p) =>
        p.color && p.color.toLowerCase().includes(color.toLowerCase())
      );
      console.log(`Po filtrze koloru (${color}): ${products.length} produktów`);
    }

    if (composition) {
      products = products.filter((p) =>
        p.composition && p.composition.toLowerCase().includes(composition.toLowerCase())
      );
      console.log(`Po filtrze składu (${composition}): ${products.length} produktów`);
    }

    if (sortBy === "price") {
      products.sort((a, b) => a.price - b.price);
    } else if (sortBy === "name") {
      products.sort((a, b) => a.name.localeCompare(b.name, "pl"));
    } else if (sortBy === "category") {
      products.sort((a, b) => a.category.localeCompare(b.category, "pl"));
    } else if (sortBy === "stock") {
      products.sort((a, b) => b.availabilityCount - a.availabilityCount);
    }

    console.log(`Generowanie PDF dla ${products.length} produktów...`);
    const pdfBytes = await generateCatalogPdf(products);

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`=== Katalog wygenerowany w ${duration}s ===`);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="katalog_spod-igly-i-nitki.pdf"'
    );
    res.setHeader("Content-Length", pdfBytes.length);
    res.send(Buffer.from(pdfBytes));
  } catch (err) {
    console.error("Błąd generowania katalogu:", err);
    res.status(500).json({
      error: "Błąd generowania katalogu",
      message: err.message,
    });
  }
});
