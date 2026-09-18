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
  try { req.auth = jwt.verify(token, JWT_SECRET); next(); }
  catch { return res.status(401).json({ error: "Invalid or expired token" }); }
}

const cropProfiles = [
  {name:"Rice",icon:"🌾",seasons:["kharif"],soils:["clay","loamy"],water:"high",duration:"120–150 days",reason:"Best fit for Kharif conditions with reliable water and clay/loamy soil.",description:"A major Kharif cereal requiring reliable water and suitable fertile soil."},
  {name:"Soybean",icon:"🫘",seasons:["kharif"],soils:["loamy","black"],water:"medium",duration:"90–110 days",reason:"Suitable for Kharif and commonly grown on well-drained loamy or black soil.",description:"A Kharif oilseed and pulse crop suited to well-drained soil."},
  {name:"Maize",icon:"🌽",seasons:["kharif","rabi","zaid"],soils:["loamy","black"],water:"medium",duration:"80–120 days",reason:"Flexible season crop with moderate water needs and good performance in loamy/black soil.",description:"A versatile cereal that can be grown across multiple seasons."},
  {name:"Wheat",icon:"🌿",seasons:["rabi"],soils:["loamy","clay"],water:"medium",duration:"120–150 days",reason:"A major Rabi crop suited to fertile loamy or clay soil with moderate irrigation.",description:"A major Rabi cereal generally grown with moderate irrigation."},
  {name:"Gram (Chickpea)",icon:"🫛",seasons:["rabi"],soils:["loamy","black"],water:"low",duration:"100–120 days",reason:"Works well in Rabi with relatively low water requirement and well-drained soil.",description:"A Rabi pulse crop with relatively low water requirement."},
  {name:"Mustard",icon:"🌼",seasons:["rabi"],soils:["loamy","sandy"],water:"low",duration:"110–140 days",reason:"A low-water Rabi option for well-drained loamy or sandy soil.",description:"A Rabi oilseed that can suit well-drained loamy or sandy soils."},
  {name:"Groundnut",icon:"🥜",seasons:["kharif","zaid"],soils:["sandy","loamy"],water:"medium",duration:"100–130 days",reason:"Performs well in loose, well-drained sandy or loamy soil.",description:"An oilseed crop suited to loose, well-drained soil."},
  {name:"Moong Bean",icon:"🌱",seasons:["zaid","kharif"],soils:["sandy","loamy"],water:"low",duration:"60–75 days",reason:"Short-duration crop that fits Zaid conditions and relatively lower water availability.",description:"A short-duration pulse suitable for Zaid and some Kharif conditions."},
  {name:"Vegetables",icon:"🥬",seasons:["kharif","rabi","zaid"],soils:["loamy"],water:"medium",duration:"45–120 days",reason:"Loamy soil and moderate water support a broad range of seasonal vegetables.",description:"A broad category covering seasonal vegetables with varied crop cycles."}
];

async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY,name VARCHAR(120) NOT NULL,email VARCHAR(255) UNIQUE NOT NULL,password_hash TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS crops (id SERIAL PRIMARY KEY,name VARCHAR(120) UNIQUE NOT NULL,season VARCHAR(120),soil_type VARCHAR(200),duration VARCHAR(80),water_requirement VARCHAR(80),description TEXT);
    CREATE TABLE IF NOT EXISTS products (id SERIAL PRIMARY KEY,name VARCHAR(160) NOT NULL,category VARCHAR(80),price NUMERIC(10,2) NOT NULL DEFAULT 0,stock INTEGER NOT NULL DEFAULT 0,image TEXT);
    CREATE TABLE IF NOT EXISTS orders (id SERIAL PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,total_amount NUMERIC(10,2) NOT NULL DEFAULT 0,status VARCHAR(40) NOT NULL DEFAULT 'pending',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS order_items (id SERIAL PRIMARY KEY,order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,product_id INTEGER NOT NULL REFERENCES products(id),quantity INTEGER NOT NULL CHECK (quantity > 0));
    CREATE TABLE IF NOT EXISTS contacts (id SERIAL PRIMARY KEY,user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,message TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS saved_crops (id SERIAL PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,crop_id INTEGER NOT NULL REFERENCES crops(id) ON DELETE CASCADE,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(user_id,crop_id));
  `);
  await pool.query("DELETE FROM crops a USING crops b WHERE a.name = b.name AND a.id > b.id");
  await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS crops_name_unique ON crops(name)");
  for (const crop of cropProfiles) {
    await pool.query(
      `INSERT INTO crops (name,season,soil_type,duration,water_requirement,description)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (name) DO UPDATE SET season=EXCLUDED.season, soil_type=EXCLUDED.soil_type,
       duration=EXCLUDED.duration, water_requirement=EXCLUDED.water_requirement, description=EXCLUDED.description`,
      [crop.name,crop.seasons.join(","),crop.soils.join(","),crop.duration,crop.water,crop.description]
    );
  }
}

app.get("/health", async (_req,res) => {
  try { await pool.query("SELECT 1"); res.json({status:"ok",database:"connected"}); }
  catch { res.status(503).json({status:"error",database:"unavailable"}); }
});

app.post("/api/signup", async (req,res) => {
  try {
    const name=String(req.body?.name||"").trim(), email=String(req.body?.email||"").trim().toLowerCase(), password=String(req.body?.password||"");
    if(!name||!email||password.length<6) return res.status(400).json({error:"Name, valid email and password (6+ characters) are required."});
    const passwordHash=await bcrypt.hash(password,12);
    const {rows}=await pool.query("INSERT INTO users (name,email,password_hash) VALUES ($1,$2,$3) RETURNING id,name,email",[name,email,passwordHash]);
    const user=rows[0]; res.status(201).json({token:createToken(user),user});
  } catch(error) { if(error.code==="23505") return res.status(409).json({error:"User already exists."}); console.error(error); res.status(500).json({error:"Unable to create account."}); }
});

app.post("/api/login", async (req,res) => {
  try {
    const email=String(req.body?.email||"").trim().toLowerCase(), password=String(req.body?.password||"");
    const {rows}=await pool.query("SELECT id,name,email,password_hash FROM users WHERE email=$1",[email]);
    if(!rows[0]||!(await bcrypt.compare(password,rows[0].password_hash))) return res.status(401).json({error:"Invalid email or password."});
    const user={id:rows[0].id,name:rows[0].name,email:rows[0].email}; res.json({token:createToken(user),user});
  } catch(error) { console.error(error); res.status(500).json({error:"Unable to login."}); }
});

app.get("/api/me",requireAuth,async(req,res)=>{
  const {rows}=await pool.query("SELECT id,name,email FROM users WHERE id=$1",[req.auth.id]);
  if(!rows[0]) return res.status(404).json({error:"User not found."}); res.json({user:rows[0]});
});

app.get("/api/crop-recommendations",async(req,res)=>{
  const season=String(req.query.season||"").trim().toLowerCase(),soil=String(req.query.soil||"").trim().toLowerCase(),water=String(req.query.water||"").trim().toLowerCase();
  const scored=cropProfiles.map(c=>{let score=0;if(season&&c.seasons.includes(season))score+=45;if(soil&&c.soils.includes(soil))score+=35;if(water&&c.water===water)score+=20;return {...c,score};}).sort((a,b)=>b.score-a.score).slice(0,5);
  const names=scored.map(c=>c.name),{rows}=await pool.query("SELECT id,name FROM crops WHERE name = ANY($1::text[])",[names]),ids=Object.fromEntries(rows.map(r=>[r.name,r.id]));
  res.json({recommendations:scored.map(c=>({...c,id:ids[c.name]})),inputs:{season,soil,water}});
});

app.post("/api/soil-analysis",async(req,res)=>{
  const ph=Number(req.body?.ph), n=Number(req.body?.nitrogen), p=Number(req.body?.phosphorus), k=Number(req.body?.potassium), soil=String(req.body?.soil||"").toLowerCase();
  if(![ph,n,p,k].every(Number.isFinite)) return res.status(400).json({error:"Enter valid pH, nitrogen, phosphorus and potassium values."});
  if(ph<3||ph>10) return res.status(400).json({error:"pH should be between 3 and 10."});
  const pHStatus=ph<5.5?"Acidic":ph>8?"Alkaline":"Balanced";
  const nutrientStatus=(n<140||p<12||k<120)?"Needs improvement":"Good";
  const issues=[]; if(ph<5.5)issues.push("Soil is acidic; consider a locally recommended liming plan after a soil test."); if(ph>8)issues.push("Soil is alkaline; organic matter and locally recommended amendments may help."); if(n<140)issues.push("Nitrogen appears low."); if(p<12)issues.push("Phosphorus appears low."); if(k<120)issues.push("Potassium appears low.");
  const crops=soil==="black"?["Soybean","Wheat","Gram (Chickpea)"]:soil==="clay"?["Rice","Wheat","Vegetables"]:soil==="sandy"?["Groundnut","Mustard","Moong Bean"]:["Soybean","Maize","Wheat"];
  res.json({summary:{pHStatus,nutrientStatus},issues,crops,values:{ph,nitrogen:n,phosphorus:p,potassium:k}});
});

app.get("/api/saved-crops",requireAuth,async(req,res)=>{
  const {rows}=await pool.query(`SELECT c.id,c.name,c.season,c.duration,c.water_requirement,s.created_at FROM saved_crops s JOIN crops c ON c.id=s.crop_id WHERE s.user_id=$1 ORDER BY s.created_at DESC`,[req.auth.id]);
  res.json({savedCrops:rows});
});
app.post("/api/saved-crops",requireAuth,async(req,res)=>{
  const cropId=Number(req.body?.cropId); if(!Number.isInteger(cropId))return res.status(400).json({error:"Valid cropId is required."});
  try {const {rows}=await pool.query("INSERT INTO saved_crops (user_id,crop_id) VALUES ($1,$2) ON CONFLICT (user_id,crop_id) DO NOTHING RETURNING id",[req.auth.id,cropId]);res.status(201).json({saved:true,alreadySaved:rows.length===0});}
  catch(error){if(error.code==="23503")return res.status(404).json({error:"Crop not found."});throw error;}
});
app.delete("/api/saved-crops/:cropId",requireAuth,async(req,res)=>{
  const cropId=Number(req.params.cropId);if(!Number.isInteger(cropId))return res.status(400).json({error:"Invalid cropId."});
  await pool.query("DELETE FROM saved_crops WHERE user_id=$1 AND crop_id=$2",[req.auth.id,cropId]);res.json({saved:false});
});

app.get("/api/weather",async(req,res)=>{
  const city=String(req.query.city||"").trim(),key=process.env.WEATHER_API_KEY;
  if(!city)return res.status(400).json({error:"City is required."}); if(!key)return res.status(503).json({error:"Weather service is not configured."});
  try {
    const currentResponse=await fetch(`https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${key}&units=metric`),current=await currentResponse.json();
    if(!currentResponse.ok)return res.status(currentResponse.status===404?404:502).json({error:current.message||"Weather lookup failed."});
    const forecastResponse=await fetch(`https://api.openweathermap.org/data/2.5/forecast?q=${encodeURIComponent(city)}&appid=${key}&units=metric`),forecast=await forecastResponse.json();
    res.json({current,forecast:forecastResponse.ok?forecast:null});
  } catch {res.status(502).json({error:"Weather service unavailable."});}
});

app.post("/api/contact",requireAuth,async(req,res)=>{
  const message=String(req.body?.message||"").trim();if(!message)return res.status(400).json({error:"Message is required."});
  await pool.query("INSERT INTO contacts (user_id,message) VALUES ($1,$2)",[req.auth.id,message]);res.status(201).json({message:"Message received."});
});

app.get("*",(_req,res)=>res.sendFile(path.join(__dirname,"index.html")));
async function start(){await initDatabase();app.listen(PORT,()=>console.log(`Server running on port ${PORT}`));}
start().catch(error=>{console.error("Startup failed:",error);process.exit(1);});
process.on("SIGTERM",async()=>{await pool.end();process.exit(0);});
