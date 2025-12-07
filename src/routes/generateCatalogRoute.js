import express from "express";
import multer from "multer";
import path from "path";
import os from "os";
import fs from "fs";
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

    // Opcjonalne filtrowanie po kategorii
    const { category, minPrice, maxPrice, sortBy } = req.query;

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

    if (sortBy === "price") {
      products.sort((a, b) => a.price - b.price);
    } else if (sortBy === "name") {
      products.sort((a, b) => a.name.localeCompare(b.name, "pl"));
    } else if (sortBy === "category") {
      products.sort((a, b) => a.category.localeCompare(b.category, "pl"));
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

    res.json({
      success: true,
      filename: req.file.originalname,
      totalProducts: products.length,
      estimatedPages: Math.ceil(products.length / 2),
      categories: categories.sort(),
      priceRange: {
        min: Math.min(...products.map((p) => p.price).filter((p) => p > 0)) || 0,
        max: Math.max(...products.map((p) => p.price)) || 0,
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
    const { category, minPrice, maxPrice, sortBy } = { ...req.query, ...req.body };

    if (category) {
      products = products.filter((p) =>
        p.category.toLowerCase().includes(category.toLowerCase())
      );
    }

    if (minPrice) {
      products = products.filter((p) => p.price >= Number(minPrice));
    }

    if (maxPrice) {
      products = products.filter((p) => p.price <= Number(maxPrice));
    }

    if (sortBy === "price") {
      products.sort((a, b) => a.price - b.price);
    } else if (sortBy === "name") {
      products.sort((a, b) => a.name.localeCompare(b.name, "pl"));
    } else if (sortBy === "category") {
      products.sort((a, b) => a.category.localeCompare(b.category, "pl"));
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
