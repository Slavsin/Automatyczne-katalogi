import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { router as generateCatalogRouter } from "./routes/generateCatalogRoute.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serwowanie plików statycznych
app.use(express.static(path.join(__dirname, "..", "public")));

// API routes
app.use("/api", generateCatalogRouter);

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
  console.log(`Dashboard: http://localhost:${PORT}/`);
  console.log(`API: http://localhost:${PORT}/api/generate-catalog`);
});
