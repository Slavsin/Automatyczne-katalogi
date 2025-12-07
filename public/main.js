const logEl = document.getElementById("log");
const generateBtn = document.getElementById("generate");
const feedInfoEl = document.getElementById("feedInfo");
const categorySelect = document.getElementById("category");
const uploadPanel = document.getElementById("uploadPanel");
const uploadArea = document.getElementById("uploadArea");
const fileInput = document.getElementById("fileInput");
const uploadStatus = document.getElementById("uploadStatus");
const tabBtns = document.querySelectorAll(".tab-btn");

let currentSource = "upload"; // "upload" lub "ftp"
let fileUploaded = false;

function log(msg, type = "info") {
  const time = new Date().toLocaleTimeString();
  const className = type === "error" ? "log-error" : type === "success" ? "log-success" : "";
  logEl.innerHTML += `<div class="${className}">[${time}] ${msg}</div>`;
  logEl.scrollTop = logEl.scrollHeight;
}

function updateFeedInfo(data) {
  feedInfoEl.innerHTML = `
    <div class="info-grid">
      <div class="info-item">
        <span class="info-label">Produkty</span>
        <span class="info-value">${data.totalProducts}</span>
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
}

// === TABS ===
tabBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    tabBtns.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentSource = btn.dataset.source;

    if (currentSource === "upload") {
      uploadPanel.style.display = "block";
      generateBtn.disabled = !fileUploaded;
      if (!fileUploaded) {
        feedInfoEl.innerHTML = "<p>Przeslij plik aby zobaczyc informacje o produktach...</p>";
      }
    } else {
      uploadPanel.style.display = "none";
      generateBtn.disabled = false;
      loadFtpFeedInfo();
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

// === FTP ===
async function loadFtpFeedInfo() {
  feedInfoEl.innerHTML = "<p>Ladowanie informacji z FTP...</p>";

  try {
    const res = await fetch("/api/feed-info");
    if (!res.ok) throw new Error("Nie mozna pobrac informacji o feedzie");

    const data = await res.json();
    updateFeedInfo(data);
    log("Informacje z FTP zaladowane");
  } catch (err) {
    feedInfoEl.innerHTML = `<p class="error">Nie mozna zaladowac feedu z FTP. Sprawdz konfiguracje.</p>`;
    log("Blad ladowania feedu z FTP: " + err.message, "error");
  }
}

// === GENERATE PDF ===
async function generateCatalog() {
  generateBtn.disabled = true;
  generateBtn.textContent = "Generowanie...";

  log("Rozpoczynam generowanie katalogu...");

  try {
    const params = new URLSearchParams();
    const category = document.getElementById("category").value;
    const minPrice = document.getElementById("minPrice").value;
    const maxPrice = document.getElementById("maxPrice").value;
    const sortBy = document.getElementById("sortBy").value;

    if (category) params.set("category", category);
    if (minPrice) params.set("minPrice", minPrice);
    if (maxPrice) params.set("maxPrice", maxPrice);
    if (sortBy) params.set("sortBy", sortBy);

    const queryString = params.toString() ? "?" + params.toString() : "";

    let url;
    if (currentSource === "upload") {
      url = "/api/generate-from-upload" + queryString;
      log("Generowanie z uploadowanego pliku...");
    } else {
      url = "/api/generate-catalog" + queryString;
      log("Pobieranie danych z FTP...");
    }

    const startTime = Date.now();
    const res = await fetch(url, {
      method: currentSource === "upload" ? "POST" : "GET",
    });

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
