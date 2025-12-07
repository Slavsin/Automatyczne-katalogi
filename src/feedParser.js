import fs from "fs";
import { parseStringPromise } from "xml2js";
import { parse as parseCsv } from "csv-parse/sync";
import * as XLSX from "xlsx";
import { catalogConfig } from "./config.js";

export async function parseFeed(filePath) {
  const ext = filePath.toLowerCase();

  if (ext.endsWith(".xml")) {
    const raw = fs.readFileSync(filePath, "utf8");
    const xml = await parseStringPromise(raw);
    return mapXmlToProducts(xml);
  } else if (ext.endsWith(".csv")) {
    const raw = fs.readFileSync(filePath, "utf8");
    const records = parseCsv(raw, { columns: true, delimiter: ";" });
    return mapCsvToProducts(records);
  } else if (ext.endsWith(".xlsx") || ext.endsWith(".xls")) {
    return parseXlsxFile(filePath);
  } else {
    throw new Error("Nieobsługiwany format feedu. Użyj XML, CSV lub XLSX.");
  }
}

function parseXlsxFile(filePath) {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const records = XLSX.utils.sheet_to_json(sheet);

  console.log(`Wczytano ${records.length} wierszy z arkusza "${sheetName}"`);

  return mapCsvToProducts(records);
}

function mapCsvToProducts(records) {
  return records.slice(0, catalogConfig.maxProducts).map((row) => ({
    id: String(row.id || ""),
    index: String(row.Index || ""),
    name: row.nazwa || "",
    description: row.Info || "",
    price: Number(row.price) || 0,
    category: row["category/__cdata"] || "",
    imageUrl: row.foto || "",
    b2bLink: row.B2B_Link || "",
    grammage: row.Gramatura || "",
    ean: findEan(row),
  }));
}

// Szukaj kodu EAN zaczynającego się od 590 w różnych kolumnach
function findEan(row) {
  // Lista możliwych nazw kolumn z EAN
  const eanColumns = ["EAN", "ean", "Ean", "kod_kreskowy", "barcode", "GTIN", "gtin"];

  // Najpierw szukaj w dedykowanych kolumnach EAN
  for (const col of eanColumns) {
    const val = String(row[col] || "").trim();
    if (val.startsWith("590") && val.length >= 8) {
      return val;
    }
  }

  // Jeśli nie znaleziono, przeszukaj wszystkie kolumny
  for (const key of Object.keys(row)) {
    const val = String(row[key] || "").trim();
    if (val.startsWith("590") && val.length >= 8 && val.length <= 14) {
      return val;
    }
  }

  // Fallback - użyj Index lub id
  return String(row.Index || row.id || "");
}

function mapXmlToProducts(xml) {
  // Próba automatycznego wykrycia struktury XML
  // Zakładamy strukturę: root > products/items > product/item
  const root = xml;
  let items = [];

  // Szukamy tablicy produktów w różnych możliwych lokalizacjach
  const possiblePaths = [
    root.products?.product,
    root.items?.item,
    root.catalog?.product,
    root.feed?.product,
    root.root?.product,
    root.dane?.produkt,
  ];

  for (const path of possiblePaths) {
    if (Array.isArray(path) && path.length > 0) {
      items = path;
      break;
    }
  }

  if (items.length === 0) {
    console.warn("Nie znaleziono produktów w XML. Sprawdź strukturę pliku.");
    return [];
  }

  return items.slice(0, catalogConfig.maxProducts).map((item) => {
    // Funkcja pomocnicza do wyciągania wartości z XML
    const getValue = (obj, keys) => {
      for (const key of keys) {
        const val = obj[key];
        if (val !== undefined) {
          return Array.isArray(val) ? val[0] : val;
        }
      }
      return "";
    };

    return {
      id: String(getValue(item, ["id", "ID", "Id"]) || ""),
      index: String(getValue(item, ["Index", "index", "sku", "SKU"]) || ""),
      name: getValue(item, ["nazwa", "name", "Name", "title", "Title"]) || "",
      description: getValue(item, ["Info", "info", "description", "Description", "opis"]) || "",
      price: Number(getValue(item, ["price", "Price", "cena", "Cena"])) || 0,
      category: getValue(item, ["category", "Category", "kategoria", "Kategoria"]) || "",
      imageUrl: getValue(item, ["foto", "Foto", "image", "Image", "zdjecie", "img"]) || "",
      b2bLink: getValue(item, ["B2B_Link", "b2b_link", "link"]) || "",
      grammage: getValue(item, ["Gramatura", "gramatura", "weight", "waga"]) || "",
      ean: String(
        getValue(item, [catalogConfig.eanField, "ean", "EAN", "Index", "index"]) || ""
      ),
    };
  });
}
