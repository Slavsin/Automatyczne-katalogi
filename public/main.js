const logEl = document.getElementById("log");
const generateBtn = document.getElementById("generate");
const feedInfoEl = document.getElementById("feedInfo");
const categorySelect = document.getElementById("category");
const colorSelect = document.getElementById("color");
const compositionSelect = document.getElementById("composition");
const uploadPanel = document.getElementById("uploadPanel");
const uploadArea = document.getElementById("uploadArea");
const fileInput = document.getElementById("fileInput");
const uploadStatus = document.getElementById("uploadStatus");
const urlPanel = document.getElementById("urlPanel");
const urlStatus = document.getElementById("urlStatus");
const fetchUrlBtn = document.getElementById("fetchUrlBtn");
const tabBtns = document.querySelectorAll(".tab-btn");

let currentSource = "upload"; // "upload" lub "url"
let fileUploaded = false;
let urlFeedLoaded = false;

function log(msg, type = "info") {
  const time = new Date().toLocaleTimeString();
  const className = type === "error" ? "log-error" : type === "success" ? "log-success" : "";
  logEl.innerHTML += `<div class="${className}">[${time}] ${msg}</div>`;
  logEl.scrollTop = logEl.scrollHeight;
}

function updateFeedInfo(data) {
  const availableProducts = data.availableProducts || data.totalProducts;
  feedInfoEl.innerHTML = `
    <div class="info-grid">
      <div class="info-item">
        <span class="info-label">Produkty</span>
        <span class="info-value">${data.totalProducts}</span>
      </div>
      <div class="info-item">
        <span class="info-label">Dostepne</span>
        <span class="info-value">${availableProducts}</span>
      </div>
      <div class="info-item">
        <span class="info-label">Strony PDF</span>
        <span class="info-value">~${data.estimatedPages}</span>
      </div>
      <div class="info-item">
        <span class="info-label">Ceny</span>
        <span class="info-value">${(data.priceRange.min || 0).toFixed(2)} - ${(data.priceRange.max || 0).toFixed(2)} zl</span>
      </div>
      <div class="info-item">
        <span class="info-label">Kategorie</span>
        <span class="info-value">${data.categories.length}</span>
      </div>
      <div class="info-item">
        <span class="info-label">Kolory</span>
        <span class="info-value">${(data.colors || []).length}</span>
      </div>
    </div>
  `;

  // Wypelnienie listy kategorii
  categorySelect.innerHTML = '<option value="">Wszystkie</option>';
  data.categories.forEach((cat) => {
    const option = document.createElement("option");
    option.value = cat;
    option.textContent = cat;
    categorySelect.appendChild(option);
  });

  // Wypelnienie listy kolorow
  if (colorSelect && data.colors) {
    colorSelect.innerHTML = '<option value="">Wszystkie</option>';
    data.colors.forEach((color) => {
      const option = document.createElement("option");
      option.value = color;
      option.textContent = color;
      colorSelect.appendChild(option);
    });
  }

  // Wypelnienie listy skladow
  if (compositionSelect && data.compositions) {
    compositionSelect.innerHTML = '<option value="">Wszystkie</option>';
    data.compositions.forEach((comp) => {
      const option = document.createElement("option");
      option.value = comp;
      option.textContent = comp;
      compositionSelect.appendChild(option);
    });
  }
}

// === TABS ===
tabBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    tabBtns.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentSource = btn.dataset.source;

    if (currentSource === "upload") {
      uploadPanel.style.display = "block";
      urlPanel.style.display = "none";
      generateBtn.disabled = !fileUploaded;
      if (!fileUploaded) {
        feedInfoEl.innerHTML = "<p>Przeslij plik aby zobaczyc informacje o produktach...</p>";
      }
    } else if (currentSource === "url") {
      uploadPanel.style.display = "none";
      urlPanel.style.display = "block";
      generateBtn.disabled = !urlFeedLoaded;
      if (!urlFeedLoaded) {
        feedInfoEl.innerHTML = "<p>Podaj URL i pobierz feed aby zobaczyc informacje o produktach...</p>";
      }
    }
  });
});

// === UPLOAD ===
uploadArea.addEventListener("click", () => fileInput.click());

uploadArea.addEventListener("dragover", (e) => {
  e.preventDefault();
  uploadArea.classList.add("dragover");
});

uploadArea.addEventListener("dragleave", () => {
  uploadArea.classList.remove("dragover");
});

uploadArea.addEventListener("drop", (e) => {
  e.preventDefault();
  uploadArea.classList.remove("dragover");
  const file = e.dataTransfer.files[0];
  if (file) uploadFile(file);
});

fileInput.addEventListener("change", () => {
  const file = fileInput.files[0];
  if (file) uploadFile(file);
});

async function uploadFile(file) {
  const allowedExt = [".csv", ".xml", ".xlsx", ".xls"];
  const ext = file.name.toLowerCase().slice(file.name.lastIndexOf("."));

  if (!allowedExt.includes(ext)) {
    log("Niedozwolony format pliku. Uzyj CSV, XML lub XLSX.", "error");
    return;
  }

  uploadStatus.innerHTML = `<span class="uploading">Przesylanie: ${file.name}...</span>`;
  log(`Przesylanie pliku: ${file.name}`);

  const formData = new FormData();
  formData.append("file", file);

  try {
    const res = await fetch("/api/upload-feed", {
      method: "POST",
      body: formData,
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.message || "Blad uploadu");
    }

    const data = await res.json();

    uploadStatus.innerHTML = `<span class="upload-success">Plik zaladowany: ${data.filename}</span>`;
    log(`Plik zaladowany: ${data.totalProducts} produktow`, "success");

    updateFeedInfo(data);
    fileUploaded = true;
    generateBtn.disabled = false;
  } catch (err) {
    uploadStatus.innerHTML = `<span class="upload-error">Blad: ${err.message}</span>`;
    log("Blad uploadu: " + err.message, "error");
  }
}

// === URL FEED ===
fetchUrlBtn.addEventListener("click", fetchUrlFeed);

async function fetchUrlFeed() {
  const feedUrl = document.getElementById("feedUrl").value.trim();
  const feedLogin = document.getElementById("feedLogin").value.trim();
  const feedPassword = document.getElementById("feedPassword").value;

  if (!feedUrl) {
    log("Podaj adres URL feedu", "error");
    return;
  }

  fetchUrlBtn.disabled = true;
  fetchUrlBtn.textContent = "Pobieranie...";
  urlStatus.innerHTML = '<span class="uploading">Pobieranie feedu z URL...</span>';
  log(`Pobieranie feedu z: ${feedUrl}`);

  try {
    const res = await fetch("/api/fetch-url-feed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: feedUrl,
        login: feedLogin || undefined,
        password: feedPassword || undefined,
      }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.message || "Blad pobierania feedu");
    }

    const data = await res.json();

    urlStatus.innerHTML = `<span class="upload-success">Feed pobrany: ${data.totalProducts} produktow</span>`;
    log(`Feed pobrany: ${data.totalProducts} produktow`, "success");

    updateFeedInfo(data);
    urlFeedLoaded = true;
    generateBtn.disabled = false;
  } catch (err) {
    urlStatus.innerHTML = `<span class="upload-error">Blad: ${err.message}</span>`;
    log("Blad pobierania feedu: " + err.message, "error");
  } finally {
    fetchUrlBtn.disabled = false;
    fetchUrlBtn.textContent = "Pobierz feed";
  }
}

// === GENERATE PDF ===
async function generateCatalog() {
  generateBtn.disabled = true;
  generateBtn.textContent = "Generowanie...";

  log("Rozpoczynam generowanie katalogu...");

  try {
    const params = new URLSearchParams();
    const searchPhrase = document.getElementById("searchPhrase").value.trim();
    const category = document.getElementById("category").value;
    const minPrice = document.getElementById("minPrice").value;
    const maxPrice = document.getElementById("maxPrice").value;
    const sortBy = document.getElementById("sortBy").value;
    const minStock = document.getElementById("minStock").value;
    const onlyAvailable = document.getElementById("onlyAvailable").checked;
    const color = document.getElementById("color").value;
    const composition = document.getElementById("composition").value;

    if (searchPhrase) params.set("searchPhrase", searchPhrase);
    if (category) params.set("category", category);
    if (minPrice) params.set("minPrice", minPrice);
    if (maxPrice) params.set("maxPrice", maxPrice);
    if (sortBy) params.set("sortBy", sortBy);
    if (minStock) params.set("minStock", minStock);
    if (onlyAvailable) params.set("onlyAvailable", "true");
    if (color) params.set("color", color);
    if (composition) params.set("composition", composition);

    const queryString = params.toString() ? "?" + params.toString() : "";

    let url;
    let method = "POST";
    if (currentSource === "upload") {
      url = "/api/generate-from-upload" + queryString;
      log("Generowanie z uploadowanego pliku...");
    } else if (currentSource === "url") {
      url = "/api/generate-from-url" + queryString;
      log("Generowanie z feedu URL...");
    } else {
      url = "/api/generate-catalog" + queryString;
      method = "GET";
      log("Pobieranie danych z FTP...");
    }

    const startTime = Date.now();
    const res = await fetch(url, { method });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.message || `Blad serwera: ${res.status}`);
    }

    log("Pobieranie PDF...");

    const blob = await res.blob();
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    const sizeMB = (blob.size / 1024 / 1024).toFixed(2);

    log(`PDF wygenerowany (${sizeMB} MB) w ${duration}s`, "success");

    const downloadUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = downloadUrl;
    a.download = "katalog_spod-igly-i-nitki.pdf";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(downloadUrl);

    log("Plik zapisany!", "success");
  } catch (err) {
    log("Blad: " + err.message, "error");
  } finally {
    generateBtn.disabled = false;
    generateBtn.textContent = "Generuj katalog PDF";
  }
}

generateBtn.addEventListener("click", generateCatalog);

// Sprawdz czy jest juz uploadowany plik
async function checkUploadedFile() {
  try {
    const res = await fetch("/api/upload-info");
    const data = await res.json();

    if (data.uploaded) {
      updateFeedInfo(data);
      fileUploaded = true;
      generateBtn.disabled = false;
      uploadStatus.innerHTML = '<span class="upload-success">Poprzednio zaladowany plik jest dostepny</span>';
      log("Znaleziono poprzednio zaladowany plik");
    }
  } catch (err) {
    // ignore
  }
}

checkUploadedFile();
