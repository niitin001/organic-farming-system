const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const path = require("path");
const cors = require("cors");
const { Pool } = require("pg");

const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET;
const DATABASE_URL = process.env.DATABASE_URL;

if (!JWT_SECRET) throw new Error("JWT_SECRET is required.");
if (!DATABASE_URL) throw new Error("DATABASE_URL is required.");

const app = express();
app.disable("x-powered-by");

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false
});

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(__dirname));

function createToken(user) {
  return jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: "7d" });
}

function getToken(req) {
  const header = req.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7) : null;
}

function requireAuth(req, res, next) {
  const token = getToken(req);
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  try {
    req.auth = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS crops (
      id SERIAL PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      season VARCHAR(50),
      soil_type VARCHAR(120),
      duration VARCHAR(80),
      water_requirement VARCHAR(80),
      description TEXT
    );
    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      name VARCHAR(160) NOT NULL,
      category VARCHAR(80),
      price NUMERIC(10,2) NOT NULL DEFAULT 0,
      stock INTEGER NOT NULL DEFAULT 0,
      image TEXT
    );
    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      total_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
      status VARCHAR(40) NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS order_items (
      id SERIAL PRIMARY KEY,
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id),
      quantity INTEGER NOT NULL CHECK (quantity > 0)
    );
    CREATE TABLE IF NOT EXISTS contacts (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      message TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

app.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", database: "connected" });
  } catch {
    res.status(503).json({ status: "error", database: "unavailable" });
  }
});

app.post("/api/signup", async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    if (!name || !email || password.length < 6) {
      return res.status(400).json({ error: "Name, valid email and password (6+ characters) are required." });
    }
    const passwordHash = await bcrypt.hash(password, 12);
    const { rows } = await pool.query(
      "INSERT INTO users (name,email,password_hash) VALUES ($1,$2,$3) RETURNING id,name,email",
      [name, email, passwordHash]
    );
    const user = rows[0];
    res.status(201).json({ token: createToken(user), user });
  } catch (error) {
    if (error.code === "23505") return res.status(409).json({ error: "User already exists." });
    console.error(error);
    res.status(500).json({ error: "Unable to create account." });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    const { rows } = await pool.query("SELECT id,name,email,password_hash FROM users WHERE email=$1", [email]);
    if (!rows[0] || !(await bcrypt.compare(password, rows[0].password_hash))) {
      return res.status(401).json({ error: "Invalid email or password." });
    }
    const user = { id: rows[0].id, name: rows[0].name, email: rows[0].email };
    res.json({ token: createToken(user), user });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Unable to login." });
  }
});

app.get("/api/me", requireAuth, async (req, res) => {
  const { rows } = await pool.query("SELECT id,name,email FROM users WHERE id=$1", [req.auth.id]);
  if (!rows[0]) return res.status(404).json({ error: "User not found." });
  res.json({ user: rows[0] });
});

app.get("/api/crop-recommendations", (req, res) => {
  const season = String(req.query.season || "").trim().toLowerCase();
  const soil = String(req.query.soil || "").trim().toLowerCase();
  const water = String(req.query.water || "").trim().toLowerCase();
  const crops = [
    {name:"Rice",icon:"🌾",seasons:["kharif"],soils:["clay","loamy"],water:"high",duration:"120–150 days",reason:"Best fit for Kharif conditions with reliable water and clay/loamy soil."},
    {name:"Soybean",icon:"🫘",seasons:["kharif"],soils:["loamy","black"],water:"medium",duration:"90–110 days",reason:"Suitable for Kharif and commonly grown on well-drained loamy or black soil."},
    {name:"Maize",icon:"🌽",seasons:["kharif","rabi","zaid"],soils:["loamy","black"],water:"medium",duration:"80–120 days",reason:"Flexible season crop with moderate water needs and good performance in loamy/black soil."},
    {name:"Wheat",icon:"🌿",seasons:["rabi"],soils:["loamy","clay"],water:"medium",duration:"120–150 days",reason:"A major Rabi crop suited to fertile loamy or clay soil with moderate irrigation."},
    {name:"Gram (Chickpea)",icon:"🫛",seasons:["rabi"],soils:["loamy","black"],water:"low",duration:"100–120 days",reason:"Works well in Rabi with relatively low water requirement and well-drained soil."},
    {name:"Mustard",icon:"🌼",seasons:["rabi"],soils:["loamy","sandy"],water:"low",duration:"110–140 days",reason:"A low-water Rabi option for well-drained loamy or sandy soil."},
    {name:"Groundnut",icon:"🥜",seasons:["kharif","zaid"],soils:["sandy","loamy"],water:"medium",duration:"100–130 days",reason:"Performs well in loose, well-drained sandy or loamy soil."},
    {name:"Moong Bean",icon:"🌱",seasons:["zaid","kharif"],soils:["sandy","loamy"],water:"low",duration:"60–75 days",reason:"Short-duration crop that fits Zaid conditions and relatively lower water availability."},
    {name:"Vegetables",icon:"🥬",seasons:["kharif","rabi","zaid"],soils:["loamy"],water:"medium",duration:"45–120 days",reason:"Loamy soil and moderate water support a broad range of seasonal vegetables."}
  ];
  const scored=crops.map(c=>{
    let score=0;
    if(season && c.seasons.includes(season)) score+=45;
    if(soil && c.soils.includes(soil)) score+=35;
    if(water && c.water===water) score+=20;
    return {...c,score};
  }).sort((a,b)=>b.score-a.score).slice(0,5);
  res.json({recommendations:scored,inputs:{season,soil,water}});
});

app.get("/api/weather", async (req, res) => {
  const city = String(req.query.city || "").trim();
  const key = process.env.WEATHER_API_KEY;
  if (!city) return res.status(400).json({ error: "City is required." });
  if (!key) return res.status(503).json({ error: "Weather service is not configured." });
  try {
    const response = await fetch(`https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${key}&units=metric`);
    const data = await response.json();
    if (!response.ok) return res.status(response.status === 404 ? 404 : 502).json({ error: data.message || "Weather lookup failed." });
    res.json(data);
  } catch {
    res.status(502).json({ error: "Weather service unavailable." });
  }
});

app.post("/api/contact", requireAuth, async (req, res) => {
  const message = String(req.body?.message || "").trim();
  if (!message) return res.status(400).json({ error: "Message is required." });
  await pool.query("INSERT INTO contacts (user_id,message) VALUES ($1,$2)", [req.auth.id, message]);
  res.status(201).json({ message: "Message received." });
});

app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "index.html")));

async function start() {
  await initDatabase();
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}
start().catch((error) => { console.error("Startup failed:", error); process.exit(1); });

process.on("SIGTERM", async () => { await pool.end(); process.exit(0); });
