const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");
const { spawn } = require("child_process");

const app = express();
const PORT = 3200;
const CONTENT_DIR = "./content";
const RTSP_URL = "rtsp://127.0.0.1:8554/live2";

// Crea la cartella se non esiste
if (!fs.existsSync(CONTENT_DIR)) fs.mkdirSync(CONTENT_DIR);

// Configurazione Multer con nomi file originali
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, CONTENT_DIR),
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/\s+/g, "_");
    cb(null, safeName);
  },
});
const upload = multer({ storage });

// Middleware statici
app.use(express.static("public"));
app.use("/content", express.static(CONTENT_DIR));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Upload immagini e testo
app.post("/upload", upload.array("images"), (req, res) => {
  if (req.body.text) {
    fs.writeFileSync(path.join(CONTENT_DIR, "testo.txt"), req.body.text);
  }
  console.log("✅ File caricati:", req.files.map(f => f.originalname));
  res.redirect("/manage.html");
});

// Elenco file
app.get("/api/files", (req, res) => {
  const files = fs.readdirSync(CONTENT_DIR).map((name) => {
    const stat = fs.statSync(path.join(CONTENT_DIR, name));
    return { name, size: stat.size };
  });
  res.json(files);
});

// Cancella file
app.delete("/api/files/:name", (req, res) => {
  const file = path.join(CONTENT_DIR, req.params.name);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  res.json({ ok: true });
});

// Avvio server
app.listen(PORT, () => console.log(`✅ Web server su http://localhost:${PORT}`));

// ---------------------------------------------------------------------------
// Puppeteer headless + streaming RTSP stabile
// ---------------------------------------------------------------------------
async function startStreaming() {
  console.log("🚀 Avvio Puppeteer headless...");

  const browser = await puppeteer.launch({
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-gpu",
      "--window-size=1280,720",
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  await page.goto(`http://localhost:${PORT}/preview.html`, {
    waitUntil: "networkidle0",
  });

  console.log("✅ Pagina caricata, avvio streaming RTSP...");

  // Lancia FFmpeg per creare lo stream RTSP
  const ffmpeg = spawn("ffmpeg", [
    "-f", "image2pipe",
    "-vcodec", "mjpeg",
    "-r", "25",
    "-i", "-",
    "-vcodec", "libx264",
    "-preset", "veryfast",
    "-tune", "zerolatency",
    "-pix_fmt", "yuv420p",
    "-f", "rtsp",
    RTSP_URL,
  ]);

  ffmpeg.stderr.on("data", (data) => {
    const msg = data.toString();
    if (msg.includes("frame=")) process.stdout.write(".");
  });
  ffmpeg.on("exit", (code) =>
    console.log("❌ FFmpeg terminato con codice:", code)
  );

  // Screenshot continui → FFmpeg stdin
  const FPS = 25;
  const interval = 1000 / FPS;

  setInterval(async () => {
    try {
      const buffer = await page.screenshot({ type: "jpeg", quality: 80 });
      ffmpeg.stdin.write(buffer);
    } catch (err) {
      console.error("⚠️ Screenshot error:", err.message);
    }
  }, interval);
}

startStreaming().catch((err) => console.error("⚠️ Errore Puppeteer:", err));
