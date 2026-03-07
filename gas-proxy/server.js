import express from "express";

const app = express();

// 你的前端網域（GitHub Pages）
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || "";
// GAS token 放環境變數（不要放前端）
const GAS_TOKEN = process.env.GAS_TOKEN || "";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const GROK_API_KEY = process.env.GROK_API_KEY || "";
// GAS Web App exec URL（不含 query）
const GAS_BASE =
  "https://script.google.com/macros/s/AKfycbxSpXbJDyGXURmLeu-IBHBUjpaiRjJ4t4PbsgGA0QZq78-p4JzHdhcNOmRaKaKmt4bz7Q/exec";

function applyCors(res) {
  if (ALLOW_ORIGIN) {
    res.setHeader("Access-Control-Allow-Origin", ALLOW_ORIGIN);
  } else {
    // 沒設就先放寬（建議上線一定要設）
    res.setHeader("Access-Control-Allow-Origin", "*");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

// 先套 CORS，再做 body parser，避免 413 時沒帶 CORS 頭
app.use((req, res, next) => {
  applyCors(res);
  next();
});

// Allow larger JSON/text bodies so sync payload不會 413；Cloud Run 硬上限 32MB
const stateBodyParser = express.text({ type: "*/*", limit: "8MB" });
const jsonParser = express.json({ limit: "2MB" });

// Preflight
app.options("/api/state", (req, res) => res.status(200).send("ok"));
app.options("/api/chat", (req, res) => res.status(200).send("ok"));

// Proxy endpoint
app.all("/api/state", stateBodyParser, async (req, res) => {
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

app.post("/api/chat", jsonParser, async (req, res) => {
  try {
    const body = req.body || {};
    const provider = String(body.provider || "").toLowerCase();
    if (!["openai", "grok"].includes(provider)) {
      return res.status(400).json({ error: "Invalid provider" });
    }

    const messages = Array.isArray(body.messages) ? body.messages : null;
    if (!messages || !messages.length) {
      return res.status(400).json({ error: "Missing messages" });
    }

    const model = String(body.model || "").trim() || (provider === "grok" ? "grok-4" : "gpt-4o-mini");
    const temperature = typeof body.temperature === "number" ? body.temperature : 0.7;
    const clientKey = String(body.apiKey || "").trim();

    const endpoint = provider === "grok"
      ? "https://api.x.ai/v1/chat/completions"
      : "https://api.openai.com/v1/chat/completions";
    const key = clientKey || (provider === "grok" ? GROK_API_KEY : OPENAI_API_KEY);
    if (!key) {
      return res.status(400).json({ error: `Missing API key for ${provider}` });
    }

    const r = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ model, messages, temperature }),
      redirect: "follow"
    });

    const text = await r.text();
    const ct = r.headers.get("content-type") || "application/json; charset=utf-8";
    res.status(r.status).setHeader("Content-Type", ct).send(text);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e) });
  }
});

// 將 body parser 等錯誤也帶上 CORS，並避免吞掉 413
// Express 會把 entity.too.large 丟進來
app.use((err, req, res, next) => {
  console.error(err);
  if (!res.headersSent) applyCors(res);
  if (err && err.type === "entity.too.large") {
    return res.status(413).send("Payload too large");
  }
  res.status(500).send(String(err));
});

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`Listening on ${port}`));
