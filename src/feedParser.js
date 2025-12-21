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
  const root = xml;
  let items = [];

  // Szukamy tablicy produktów w różnych możliwych lokalizacjach
  const possiblePaths = [
    root.list?.product,        // abstore format: <list><product>...
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

  console.log(`Znaleziono ${items.length} produktów w XML`);

  return items.slice(0, catalogConfig.maxProducts).map((item) => {
    // Funkcja pomocnicza do wyciągania wartości z XML (obsługuje CDATA)
    const getValue = (obj, keys) => {
      for (const key of keys) {
        const val = obj[key];
        if (val !== undefined) {
          const result = Array.isArray(val) ? val[0] : val;
          // Obsługa CDATA - może być string lub obiekt z _
          if (typeof result === "object" && result._) {
            return String(result._).trim();
          }
          return String(result || "").trim();
        }
      }
      return "";
    };

    // Ekstrakcja atrybutu z sekcji <attributes> (format abstore)
    const getAttributeValue = (item, eid) => {
      const attributes = item.attributes?.[0]?.attribute;
      if (!Array.isArray(attributes)) return "";

      const attr = attributes.find((a) => a.$?.eid === eid);
      if (!attr) return "";

      const val = attr.value?.[0];
      if (typeof val === "object" && val._) {
        return String(val._).trim();
      }
      return String(val || "").trim();
    };

    // Ekstrakcja gramatury z longDescription (np. "Gramatura: 123 gsm")
    const extractGrammage = (item) => {
      // Najpierw sprawdź dedykowany atrybut
      const gramFromAttr = getAttributeValue(item, "34"); // eid="34" to Gramatura w abstore
      if (gramFromAttr) return gramFromAttr + " gsm";

      // Sprawdź longDescription
      const longDesc = getValue(item, ["longDescription", "LongDescription"]);
      const match = longDesc.match(/Gramatura[:\s]+(\d+)\s*(gsm|g\/m)/i);
      if (match) return match[1] + " gsm";

      // Fallback do starego pola
      return getValue(item, ["Gramatura", "gramatura", "weight", "waga"]);
    };

    // Znajdź EAN - najpierw w atrybutach abstore, potem w standardowych polach
    const findEanInXml = (item) => {
      // Format abstore: <attributes><attribute eid="EAN_CODE"><value>...</value></attribute>
      const eanFromAttr = getAttributeValue(item, "EAN_CODE");
      if (eanFromAttr && eanFromAttr.length >= 8) return eanFromAttr;

      // Standardowe pola
      const standardEan = getValue(item, ["ean", "EAN", "Ean", "kod_kreskowy", "barcode", "GTIN"]);
      if (standardEan && standardEan.length >= 8) return standardEan;

      // Fallback do indexCatalogue lub Index
      return getValue(item, ["indexCatalogue", "IndexCatalogue", "Index", "index", "eid"]);
    };

    // Pobierz kategorię (obsługuje format abstore z atrybutem eid)
    const getCategory = (item) => {
      const cat = item.category?.[0];
      if (typeof cat === "object" && cat._) {
        return String(cat._).trim();
      }
      return getValue(item, ["category", "Category", "kategoria", "Kategoria"]);
    };

    return {
      id: String(getValue(item, ["id", "ID", "Id", "eid"]) || ""),
      index: String(getValue(item, ["indexCatalogue", "IndexCatalogue", "Index", "index", "sku", "SKU", "eid"]) || ""),
      name: getValue(item, ["name", "nazwa", "Name", "title", "Title"]) || "",
      description: getValue(item, ["longDescription", "LongDescription", "description", "Description", "Info", "info", "opis"]) || "",
      price: Number(getValue(item, ["price", "Price", "cena", "Cena"])) || 0,
      priceNet: Number(getValue(item, ["priceNet", "PriceNet", "cena_netto"])) || 0,
      category: getCategory(item),
      imageUrl: getValue(item, ["imageUrl", "ImageUrl", "foto", "Foto", "image", "Image", "zdjecie", "img"]) || "",
      b2bLink: getValue(item, ["url", "B2B_Link", "b2b_link", "link"]) || "",
      grammage: extractGrammage(item),
      ean: findEanInXml(item),
      // Nowe pola
      availabilityCount: Number(getValue(item, ["availabilityCount", "stock", "stan"])) || 0,
      color: getAttributeValue(item, "36") || "",
      composition: getAttributeValue(item, "35") || "",
      piecesInCarton: getAttributeValue(item, "33") || "",
      packageWidth: getAttributeValue(item, "WIDTH_PACKAGE") || "",
      packageHeight: getAttributeValue(item, "HEIGHT_PACKAGE") || "",
      packageDepth: getAttributeValue(item, "DEPTH_PACKAGE") || "",
      packageWeight: getValue(item, ["weightPackage", "WeightPackage"]) || getAttributeValue(item, "WEIGHT_PACKAGE") || "",
    };
  });
}
