import express from "express";

const app = express();
app.use(express.text({ type: "*/*" }));

// GAS Web App exec URL（不含 query）
const GAS_BASE =
  "https://script.google.com/macros/s/AKfycbxSpXbJDyGXURmLeu-IBHBUjpaiRjJ4t4PbsgGA0QZq78-p4JzHdhcNOmRaKaKmt4bz7Q/exec";

// 你的前端網域（GitHub Pages）
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || "";
// GAS token 放環境變數（不要放前端）
const GAS_TOKEN = process.env.GAS_TOKEN || "";

// CORS middleware
app.use((req, res, next) => {
  if (ALLOW_ORIGIN) {
    res.setHeader("Access-Control-Allow-Origin", ALLOW_ORIGIN);
  } else {
    // 沒設就先放寬（建議上線一定要設）
    res.setHeader("Access-Control-Allow-Origin", "*");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  next();
});

// Preflight
app.options("/api/state", (req, res) => res.status(200).send("ok"));

// Proxy endpoint
app.all("/api/state", async (req, res) => {
  try {
    const url = new URL(GAS_BASE);

    // 轉送 query（例如 id=JIM）
    for (const [k, v] of Object.entries(req.query)) {
      url.searchParams.set(k, String(v));
    }

    // token 不從前端拿，從環境變數塞
    if (!GAS_TOKEN) {
      return res.status(500).send("Missing GAS_TOKEN env var");
    }
    url.searchParams.set("token", GAS_TOKEN);

    const r = await fetch(url, {
      method: req.method,
      headers: { "Content-Type": req.headers["content-type"] || "text/plain" },
      body: ["GET", "HEAD"].includes(req.method) ? undefined : req.body,
      redirect: "follow"
    });

    const text = await r.text();
    res.status(r.status).send(text);
  } catch (e) {
    console.error(e);
    res.status(500).send(String(e));
  }
});

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`Listening on ${port}`));
