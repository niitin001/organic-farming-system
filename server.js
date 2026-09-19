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

const allowedOrigin = process.env.FRONTEND_URL || null;
app.use(cors(allowedOrigin ? { origin: allowedOrigin, credentials: true } : { origin: false }));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));
app.use((req,res,next)=>{
  const p=req.path.toLowerCase();
  if(p.startsWith("/.git") || ["/server.js","/package.json","/package-lock.json","/render.yaml","/.env.example"].includes(p)) return res.status(404).end();
  next();
});
app.use(express.static(__dirname,{dotfiles:"deny",index:false}));

function createToken(user) {
  return jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: "7d" });
}
async function requireAdmin(req,res,next){
  try{const {rows}=await pool.query("SELECT role FROM users WHERE id=$1",[req.auth.id]);if(rows[0]?.role!=="admin")return res.status(403).json({error:"Admin access required."});next();}
  catch(error){console.error(error);res.status(500).json({error:"Unable to verify admin access."});}
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

async function sendContactEmail({name,email,phone,subject,message}) {
  const apiKey = process.env.RESEND_API_KEY;
  const recipient = process.env.CONTACT_EMAIL;
  if (!apiKey || !recipient) return {sent:false};

  const from = process.env.RESEND_FROM_EMAIL || "Organic Farming System <onboarding@resend.dev>";
  const html = `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#183b22">
    <h2>New Contact Form Message</h2>
    <p><strong>Name:</strong> ${escapeHtml(name)}</p>
    <p><strong>Email:</strong> ${escapeHtml(email)}</p>
    <p><strong>Phone:</strong> ${escapeHtml(phone || "Not provided")}</p>
    <p><strong>Subject:</strong> ${escapeHtml(subject)}</p>
    <hr><p style="white-space:pre-wrap">${escapeHtml(message)}</p>
  </div>`;
  const response = await fetch("https://api.resend.com/emails", {
    method:"POST",
    headers:{"Authorization":`Bearer ${apiKey}`,"Content-Type":"application/json"},
    body:JSON.stringify({from,to:[recipient],reply_to:email,subject:`Contact Form: ${subject}`,html})
  });
  if (!response.ok) throw new Error(`Email delivery failed: ${response.status}`);
  return {sent:true};
}
function escapeHtml(value){
  return String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
}

async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY,name VARCHAR(120) NOT NULL,email VARCHAR(255) UNIQUE NOT NULL,password_hash TEXT NOT NULL,role VARCHAR(20) NOT NULL DEFAULT 'farmer',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS crops (id SERIAL PRIMARY KEY,name VARCHAR(120) UNIQUE NOT NULL,season VARCHAR(120),soil_type VARCHAR(200),duration VARCHAR(80),water_requirement VARCHAR(80),description TEXT);
    CREATE TABLE IF NOT EXISTS seller_profiles (id SERIAL PRIMARY KEY,user_id INTEGER UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,store_name VARCHAR(160) NOT NULL,phone VARCHAR(20) NOT NULL,address TEXT NOT NULL,city VARCHAR(100) NOT NULL,state VARCHAR(100) NOT NULL,pincode VARCHAR(10) NOT NULL,status VARCHAR(20) NOT NULL DEFAULT 'pending',verified_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS products (id SERIAL PRIMARY KEY,name VARCHAR(160) NOT NULL,category VARCHAR(80),price NUMERIC(10,2) NOT NULL DEFAULT 0,stock INTEGER NOT NULL DEFAULT 0,image TEXT,seller_id INTEGER REFERENCES seller_profiles(id) ON DELETE SET NULL);
    CREATE TABLE IF NOT EXISTS orders (id SERIAL PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,total_amount NUMERIC(10,2) NOT NULL DEFAULT 0,status VARCHAR(40) NOT NULL DEFAULT 'pending',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS order_items (id SERIAL PRIMARY KEY,order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,product_id INTEGER NOT NULL REFERENCES products(id),quantity INTEGER NOT NULL CHECK (quantity > 0));
    CREATE TABLE IF NOT EXISTS seller_orders (id SERIAL PRIMARY KEY,order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,seller_id INTEGER NOT NULL REFERENCES seller_profiles(id) ON DELETE CASCADE,status VARCHAR(30) NOT NULL DEFAULT 'pending',seller_total NUMERIC(10,2) NOT NULL DEFAULT 0,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(order_id,seller_id));
    CREATE TABLE IF NOT EXISTS contacts (id SERIAL PRIMARY KEY,user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,message TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS saved_crops (id SERIAL PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,crop_id INTEGER NOT NULL REFERENCES crops(id) ON DELETE CASCADE,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(user_id,crop_id));
    CREATE TABLE IF NOT EXISTS farm_tasks (id SERIAL PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,crop_name VARCHAR(120) NOT NULL,sowing_date DATE NOT NULL,task_title VARCHAR(180) NOT NULL,task_type VARCHAR(80) NOT NULL,due_date DATE NOT NULL,status VARCHAR(30) NOT NULL DEFAULT 'pending',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  `);
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'farmer'");
  await pool.query("ALTER TABLE products ADD COLUMN IF NOT EXISTS seller_id INTEGER REFERENCES seller_profiles(id) ON DELETE SET NULL");
  await pool.query("ALTER TABLE order_items ADD COLUMN IF NOT EXISTS seller_order_id INTEGER REFERENCES seller_orders(id) ON DELETE SET NULL");
  if(process.env.ADMIN_EMAIL){await pool.query("UPDATE users SET role='admin' WHERE lower(email)=lower($1)",[String(process.env.ADMIN_EMAIL).trim()]);}
  await pool.query("DELETE FROM crops a USING crops b WHERE a.name = b.name AND a.id > b.id");
  await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS crops_name_unique ON crops(name)");
  await pool.query("DELETE FROM products a USING products b WHERE a.name = b.name AND a.id > b.id");
  await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS products_name_unique ON products(name)");
  for (const product of marketplaceProducts) {
    await pool.query(
      `INSERT INTO products (name,category,price,stock,image) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (name) DO UPDATE SET category=EXCLUDED.category,image=EXCLUDED.image`,
      [product.name,product.category,product.price,product.stock,product.image]
    );
  }
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

const farmTimelines = {
  "Rice":[["Land & seed preparation","Preparation",0],["Nursery / sowing check","Sowing",7],["Transplanting / establishment","Field Work",25],["Weed and water management","Maintenance",45],["Nutrient management check","Nutrition",60],["Pest & disease scouting","Scouting",75],["Harvest readiness check","Harvest",115]],
  "Wheat":[["Seed and field preparation","Preparation",0],["Sowing","Sowing",7],["First irrigation check","Irrigation",25],["Weed and crop scouting","Maintenance",45],["Nutrient management check","Nutrition",65],["Disease scouting","Scouting",90],["Harvest readiness check","Harvest",120]],
  "Soybean":[["Seed and field preparation","Preparation",0],["Sowing","Sowing",5],["Plant stand check","Field Work",20],["Weed management","Maintenance",30],["Nutrient / moisture check","Maintenance",50],["Pest & disease scouting","Scouting",70],["Harvest readiness check","Harvest",95]],
  "Maize":[["Field and seed preparation","Preparation",0],["Sowing","Sowing",5],["Plant stand check","Field Work",20],["Weed management","Maintenance",30],["Nutrient management check","Nutrition",45],["Pest scouting","Scouting",65],["Harvest readiness check","Harvest",90]],
  "Gram (Chickpea)":[["Seed and field preparation","Preparation",0],["Sowing","Sowing",5],["Germination / stand check","Field Work",20],["Weed management","Maintenance",35],["Flowering stage scouting","Scouting",60],["Pod development check","Maintenance",80],["Harvest readiness check","Harvest",105]],
  "Mustard":[["Field and seed preparation","Preparation",0],["Sowing","Sowing",5],["Plant stand check","Field Work",20],["Weed management","Maintenance",35],["Aphid / disease scouting","Scouting",55],["Pod development check","Maintenance",85],["Harvest readiness check","Harvest",115]],
  "Groundnut":[["Seed and field preparation","Preparation",0],["Sowing","Sowing",5],["Plant stand check","Field Work",20],["Weed management","Maintenance",35],["Pegging stage field check","Field Work",50],["Pest & disease scouting","Scouting",80],["Harvest readiness check","Harvest",105]],
  "Moong Bean":[["Seed and field preparation","Preparation",0],["Sowing","Sowing",5],["Plant stand check","Field Work",18],["Weed management","Maintenance",30],["Flowering / pest scouting","Scouting",42],["Pod development check","Maintenance",55],["Harvest readiness check","Harvest",65]],
  "Vegetables":[["Bed and seedling preparation","Preparation",0],["Sowing / transplanting","Sowing",7],["Plant stand check","Field Work",20],["Weed and irrigation check","Maintenance",35],["Nutrition check","Nutrition",50],["Pest & disease scouting","Scouting",70],["Harvest readiness check","Harvest",90]]
};

app.post("/api/farm-plans",requireAuth,async(req,res)=>{
  const cropName=String(req.body?.cropName||"").trim();
  const sowingDate=String(req.body?.sowingDate||"").trim();
  const timeline=farmTimelines[cropName];
  if(!timeline)return res.status(400).json({error:"Select a supported crop."});
  if(!/^\d{4}-\d{2}-\d{2}$/.test(sowingDate))return res.status(400).json({error:"Enter a valid sowing date."});
  const start=new Date(sowingDate+"T00:00:00Z");
  if(Number.isNaN(start.getTime()))return res.status(400).json({error:"Enter a valid sowing date."});
  await pool.query("DELETE FROM farm_tasks WHERE user_id=$1 AND crop_name=$2 AND sowing_date=$3",[req.auth.id,cropName,sowingDate]);
  const values=[];
  for(const [title,type,offset] of timeline){
    const due=new Date(start); due.setUTCDate(due.getUTCDate()+offset);
    values.push([req.auth.id,cropName,sowingDate,title,type,due.toISOString().slice(0,10)]);
  }
  for(const v of values)await pool.query("INSERT INTO farm_tasks (user_id,crop_name,sowing_date,task_title,task_type,due_date) VALUES ($1,$2,$3,$4,$5,$6)",v);
  const {rows}=await pool.query("SELECT * FROM farm_tasks WHERE user_id=$1 AND crop_name=$2 AND sowing_date=$3 ORDER BY due_date,id",[req.auth.id,cropName,sowingDate]);
  res.status(201).json({tasks:rows});
});

app.get("/api/farm-tasks",requireAuth,async(req,res)=>{
  const {rows}=await pool.query("SELECT * FROM farm_tasks WHERE user_id=$1 ORDER BY due_date,id",[req.auth.id]);
  res.json({tasks:rows});
});

app.patch("/api/farm-tasks/:id",requireAuth,async(req,res)=>{
  const id=Number(req.params.id);
  if(!Number.isInteger(id))return res.status(400).json({error:"Invalid task id."});
  const status=String(req.body?.status||"").toLowerCase();
  if(!["pending","completed"].includes(status))return res.status(400).json({error:"Invalid task status."});
  const {rows}=await pool.query("UPDATE farm_tasks SET status=$1 WHERE id=$2 AND user_id=$3 RETURNING *",[status,id,req.auth.id]);
  if(!rows[0])return res.status(404).json({error:"Task not found."});
  res.json({task:rows[0]});
});

app.delete("/api/farm-tasks/:id",requireAuth,async(req,res)=>{
  const id=Number(req.params.id);
  if(!Number.isInteger(id))return res.status(400).json({error:"Invalid task id."});
  await pool.query("DELETE FROM farm_tasks WHERE id=$1 AND user_id=$2",[id,req.auth.id]);
  res.json({deleted:true});
});

app.post("/api/irrigation-calculator",async(req,res)=>{
  const area=Number(req.body?.area), crop=String(req.body?.crop||"").trim(), soil=String(req.body?.soil||"").trim().toLowerCase(), method=String(req.body?.method||"").trim().toLowerCase();
  if(!Number.isFinite(area)||area<=0||area>10000)return res.status(400).json({error:"Enter a valid area."});
  const base={Rice:8,Wheat:5,Soybean:4,Maize:5,Groundnut:4,Mustard:3.5,"Gram (Chickpea)":3,"Moong Bean":3,Vegetables:5}[crop];
  if(!base)return res.status(400).json({error:"Select a supported crop."});
  const soilFactor={sandy:1.15,loamy:1,clay:.9,black:.95}[soil]||1;
  const methodFactor={drip:.75,sprinkler:.85,flood:1}[method]||1;
  const daily=area*base*soilFactor*methodFactor;
  res.json({area,crop,soil,method,daily_liters:Math.round(daily),weekly_liters:Math.round(daily*7),note:"Planning estimate only. Actual irrigation depends on crop stage, weather, soil moisture, rainfall and local practice."});
});

app.post("/api/farm-cost",async(req,res)=>{
  const area=Number(req.body?.area),seed=Number(req.body?.seed),fertilizer=Number(req.body?.fertilizer),labour=Number(req.body?.labour),irrigation=Number(req.body?.irrigation),other=Number(req.body?.other),revenue=Number(req.body?.revenue);
  if(!Number.isFinite(area)||area<=0)return res.status(400).json({error:"Enter a valid area."});
  const values=[seed,fertilizer,labour,irrigation,other,revenue];
  if(values.some(v=>!Number.isFinite(v)||v<0))return res.status(400).json({error:"Enter valid non-negative cost and revenue values."});
  const total=seed+fertilizer+labour+irrigation+other,profit=revenue-total,margin=revenue?profit/revenue*100:0;
  res.json({total_cost:Math.round(total),expected_revenue:Math.round(revenue),estimated_profit:Math.round(profit),margin_percent:Math.round(margin*10)/10,per_acre_cost:Math.round(total/area)});
});

app.get("/health", async (_req,res) => {
  try { await pool.query("SELECT 1"); res.json({status:"ok",database:"connected"}); }
  catch { res.status(503).json({status:"error",database:"unavailable"}); }
});

app.post("/api/signup", async (req,res) => {
  try {
    const name=String(req.body?.name||"").trim(), email=String(req.body?.email||"").trim().toLowerCase(), password=String(req.body?.password||"");
    if(!name||!email||password.length<6) return res.status(400).json({error:"Name, valid email and password (6+ characters) are required."});
    const passwordHash=await bcrypt.hash(password,12);
    const {rows}=await pool.query("INSERT INTO users (name,email,password_hash) VALUES ($1,$2,$3) RETURNING id,name,email,role",[name,email,passwordHash]);
    const user=rows[0]; res.status(201).json({token:createToken(user),user});
  } catch(error) { if(error.code==="23505") return res.status(409).json({error:"User already exists."}); console.error(error); res.status(500).json({error:"Unable to create account."}); }
});

app.post("/api/login", async (req,res) => {
  try {
    const email=String(req.body?.email||"").trim().toLowerCase(), password=String(req.body?.password||"");
    const {rows}=await pool.query("SELECT id,name,email,password_hash,role FROM users WHERE email=$1",[email]);
    if(!rows[0]||!(await bcrypt.compare(password,rows[0].password_hash))) return res.status(401).json({error:"Invalid email or password."});
    const user={id:rows[0].id,name:rows[0].name,email:rows[0].email,role:rows[0].role}; res.json({token:createToken(user),user});
  } catch(error) { console.error(error); res.status(500).json({error:"Unable to login."}); }
});

app.get("/api/me",requireAuth,async(req,res)=>{
  const {rows}=await pool.query("SELECT id,name,email,role FROM users WHERE id=$1",[req.auth.id]);
  if(!rows[0]) return res.status(404).json({error:"User not found."}); res.json({user:rows[0]});
});

app.get("/api/crops/:name",async(req,res)=>{
  const name=decodeURIComponent(String(req.params.name||"")).trim();
  const profile=cropProfiles.find(c=>c.name.toLowerCase()===name.toLowerCase());
  if(!profile)return res.status(404).json({error:"Crop not found."});
  const {rows}=await pool.query("SELECT id,name,season,soil_type,duration,water_requirement,description FROM crops WHERE name=$1",[profile.name]);
  if(!rows[0])return res.status(404).json({error:"Crop not found."});
  res.json({crop:{...rows[0],icon:profile.icon,seasons:profile.seasons,soils:profile.soils,water:profile.water,reason:profile.reason}});
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

const diseaseGuides = [
  {crop:"Rice",issue:"Rice Blast",symptoms:["Diamond-shaped spots on leaves","Gray centers with brown margins","Neck or panicle lesions"],cause:"Fungal disease favored by humid conditions and prolonged leaf wetness.",prevention:["Use clean seed and balanced nutrition","Avoid excessive nitrogen","Keep the field and irrigation practices well managed"],organic:["Remove badly affected plant material where practical","Use locally recommended biological or botanical options","Improve field ventilation and avoid unnecessary leaf wetness"],dont:"Do not treat a symptom match as a confirmed diagnosis; consult a local agriculture expert if the crop is worsening."},
  {crop:"Rice",issue:"Stem Borer",symptoms:["Dead hearts in young plants","White earheads at panicle stage","Bore holes or frass near stems"],cause:"Larval feeding inside rice stems.",prevention:["Monitor the crop regularly","Remove heavily affected tillers where practical","Maintain field sanitation"],organic:["Use locally recommended pheromone traps or biological controls","Encourage natural enemies"],dont:"Avoid applying any pesticide solely from this guide without local label and extension guidance."},
  {crop:"Wheat",issue:"Wheat Rust",symptoms:["Orange, yellow or brown powdery pustules","Rust-colored marks on leaves"],cause:"Fungal rust pathogens that spread under favorable weather conditions.",prevention:["Use locally recommended resistant varieties","Monitor leaves regularly","Maintain balanced fertilization"],organic:["Remove volunteer hosts where appropriate","Seek locally recommended biological or cultural management"],dont:"Do not assume every leaf discoloration is rust; confirmation is important."},
  {crop:"Wheat",issue:"Aphids",symptoms:["Small soft-bodied insects on leaves or ears","Leaf curling or yellowing","Sticky honeydew"],cause:"Sap-feeding aphids.",prevention:["Inspect crop edges and new growth","Protect beneficial insects","Avoid unnecessary broad-spectrum sprays"],organic:["Encourage ladybirds and other natural enemies","Use locally recommended neem-based or biological options"],dont:"Do not spray during pollinator activity or ignore label directions."},
  {crop:"Soybean",issue:"Leaf Spot",symptoms:["Small brown or reddish leaf spots","Spots may enlarge and cause premature leaf drop"],cause:"Several fungal or bacterial pathogens can cause similar leaf symptoms.",prevention:["Use clean seed","Maintain field sanitation","Avoid prolonged leaf wetness where possible"],organic:["Remove severely affected debris after harvest","Use locally recommended biological/cultural measures"],dont:"Leaf spots have multiple causes, so use this as a screening guide only."},
  {crop:"Groundnut",issue:"Tikka / Leaf Spot",symptoms:["Brown or black circular leaf spots","Yellowing and early leaf drop"],cause:"Fungal leaf-spot diseases.",prevention:["Use healthy seed","Maintain crop spacing and sanitation","Monitor lower leaves early"],organic:["Use locally recommended resistant varieties and biological options","Remove crop debris after harvest"],dont:"Do not use an exact treatment schedule without local diagnosis and label guidance."},
  {crop:"Mustard",issue:"Aphids",symptoms:["Clusters of small insects on tender shoots or flowers","Curling, yellowing or sticky leaves"],cause:"Sap-feeding aphids.",prevention:["Regular scouting","Protect beneficial insects","Avoid excessive nitrogen"],organic:["Encourage ladybirds and lacewings","Use locally recommended neem-based or biological measures"],dont:"Avoid broad-spectrum spraying when beneficial insects are controlling the pest."},
  {crop:"Tomato / Vegetables",issue:"Early Blight / Leaf Spot",symptoms:["Dark leaf spots","Concentric rings may appear on older leaves","Yellowing and leaf drop"],cause:"Fungal leaf-spot pathogens can produce similar symptoms.",prevention:["Use clean planting material","Water at soil level where possible","Remove infected debris"],organic:["Improve airflow and sanitation","Use locally recommended biological or botanical products"],dont:"Do not treat every spot as early blight; confirmation may be needed."},
  {crop:"Vegetables",issue:"Whitefly",symptoms:["Tiny white insects flying when leaves are disturbed","Yellowing or weakening leaves","Sticky honeydew"],cause:"Sap-feeding whiteflies.",prevention:["Inspect leaf undersides","Remove heavily infested leaves where practical","Control weeds that can host pests"],organic:["Use yellow sticky traps","Encourage natural enemies","Use locally recommended neem-based or biological options"],dont:"Do not rely on repeated spraying without monitoring pest levels."}
];

app.get("/api/disease-guide",async(req,res)=>{
  const crop=String(req.query.crop||"").trim().toLowerCase();
  const symptom=String(req.query.symptom||"").trim().toLowerCase();
  let guides=diseaseGuides.filter(g=>!crop||g.crop.toLowerCase().includes(crop)||crop.includes(g.crop.split(" ")[0].toLowerCase()));
  if(symptom) guides=guides.filter(g=>g.symptoms.some(s=>s.toLowerCase().includes(symptom))||g.issue.toLowerCase().includes(symptom)||g.cause.toLowerCase().includes(symptom));
  res.json({guides});
});


const marketplaceProducts = [
  {name:"Organic Rice Seeds",category:"Seeds",price:299,stock:40,image:"https://images.unsplash.com/photo-1536633052449-94d8b4b2a8d0?auto=format&fit=crop&w=900&q=80"},
  {name:"Soybean Seeds",category:"Seeds",price:349,stock:35,image:"https://images.unsplash.com/photo-1582515073490-dc9c1c3d2b1c?auto=format&fit=crop&w=900&q=80"},
  {name:"Organic Vegetable Seed Kit",category:"Seeds",price:249,stock:50,image:"https://images.unsplash.com/photo-1416879595882-3373a0480b5b?auto=format&fit=crop&w=900&q=80"},
  {name:"Vermicompost 25 kg",category:"Fertilizers",price:499,stock:25,image:"https://images.unsplash.com/photo-1589923188900-85dae523342b?auto=format&fit=crop&w=900&q=80"},
  {name:"Neem Cake Organic Fertilizer",category:"Fertilizers",price:399,stock:30,image:"https://images.unsplash.com/photo-1625246333195-78d9c38ad449?auto=format&fit=crop&w=900&q=80"},
  {name:"Neem Based Bio-Pesticide",category:"Bio-Pesticides",price:449,stock:20,image:"https://images.unsplash.com/photo-1492496913980-501348b61469?auto=format&fit=crop&w=900&q=80"},
  {name:"Manual Hand Weeder",category:"Farm Tools",price:699,stock:15,image:"https://images.unsplash.com/photo-1592982537447-7440770cbfc9?auto=format&fit=crop&w=900&q=80"}
];

app.get("/api/products",async(req,res)=>{
  const category=String(req.query.category||"").trim();
  const q=String(req.query.q||"").trim();
  const city=String(req.query.city||"").trim();
  const params=[]; const where=["(p.seller_id IS NULL OR sp.status='approved')"];
  if(category){params.push(category);where.push("p.category=$"+params.length);}
  if(q){params.push("%"+q+"%");where.push("(p.name ILIKE $"+params.length+" OR p.category ILIKE $"+params.length+" OR COALESCE(sp.store_name,'') ILIKE $"+params.length+")");}
  if(city){params.push(city);where.push("COALESCE(sp.city,'') ILIKE $"+params.length);}
  const sql="SELECT p.id,p.name,p.category,p.price,p.stock,p.image,COALESCE(sp.store_name,'KisanSetu Direct') AS seller_name,COALESCE(sp.city,'Platform') AS seller_city,CASE WHEN sp.status='approved' THEN true ELSE false END AS seller_verified FROM products p LEFT JOIN seller_profiles sp ON sp.id=p.seller_id WHERE "+where.join(" AND ")+" ORDER BY seller_verified DESC,p.id DESC";
  const {rows}=await pool.query(sql,params); res.json({products:rows});
});
app.post("/api/seller/apply",requireAuth,async(req,res)=>{
  const storeName=String(req.body?.storeName||"").trim(),phone=String(req.body?.phone||"").trim(),address=String(req.body?.address||"").trim(),city=String(req.body?.city||"").trim(),state=String(req.body?.state||"").trim(),pincode=String(req.body?.pincode||"").trim();
  if(!storeName||!phone||!address||!city||!state||!/^[0-9]{6}$/.test(pincode)) return res.status(400).json({error:"Store name, phone, address, city, state and 6-digit pincode are required."});
  const existing=await pool.query("SELECT id,status FROM seller_profiles WHERE user_id=$1",[req.auth.id]);
  if(existing.rows[0]) return res.status(409).json({error:"Seller application already exists with status: "+existing.rows[0].status+"."});
  const {rows}=await pool.query("INSERT INTO seller_profiles (user_id,store_name,phone,address,city,state,pincode) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id,store_name,status,city,state,pincode,created_at",[req.auth.id,storeName,phone,address,city,state,pincode]);
  res.status(201).json({seller:rows[0],message:"Application submitted. Products become visible after admin verification."});
});
app.get("/api/seller/me",requireAuth,async(req,res)=>{
  const {rows}=await pool.query("SELECT id,store_name,phone,address,city,state,pincode,status,verified_at,created_at FROM seller_profiles WHERE user_id=$1",[req.auth.id]);
  res.json({seller:rows[0]||null});
});
async function requireSeller(req,res,next){
  try{
    const {rows}=await pool.query("SELECT sp.id,sp.status FROM seller_profiles sp WHERE sp.user_id=$1",[req.auth.id]);
    if(!rows[0]||rows[0].status!=="approved") return res.status(403).json({error:"Approved seller account required."});
    req.seller=rows[0]; next();
  }catch(error){console.error(error);res.status(500).json({error:"Unable to verify seller access."});}
}
app.get("/api/seller/products",requireAuth,requireSeller,async(req,res)=>{
  const {rows}=await pool.query("SELECT id,name,category,price,stock,image FROM products WHERE seller_id=$1 ORDER BY id DESC",[req.seller.id]);
  res.json({products:rows});
});
app.post("/api/seller/products",requireAuth,requireSeller,async(req,res)=>{
  const name=String(req.body?.name||"").trim(),category=String(req.body?.category||"").trim(),price=Number(req.body?.price),stock=Number(req.body?.stock),image=String(req.body?.image||"").trim();
  if(!name||!category||!Number.isFinite(price)||price<0||!Number.isInteger(stock)||stock<0) return res.status(400).json({error:"Enter valid product details."});
  const {rows}=await pool.query("INSERT INTO products (name,category,price,stock,image,seller_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",[name,category,price,stock,image,req.seller.id]);
  res.status(201).json({product:rows[0]});
});
app.patch("/api/seller/products/:id",requireAuth,requireSeller,async(req,res)=>{
  const id=Number(req.params.id),name=String(req.body?.name||"").trim(),category=String(req.body?.category||"").trim(),price=Number(req.body?.price),stock=Number(req.body?.stock),image=String(req.body?.image||"").trim();
  if(!Number.isInteger(id)||!name||!category||!Number.isFinite(price)||price<0||!Number.isInteger(stock)||stock<0)return res.status(400).json({error:"Enter valid product details."});
  const {rows}=await pool.query("UPDATE products SET name=$1,category=$2,price=$3,stock=$4,image=$5 WHERE id=$6 AND seller_id=$7 RETURNING *",[name,category,price,stock,image,id,req.seller.id]);
  if(!rows[0])return res.status(404).json({error:"Seller product not found."});
  res.json({product:rows[0]});
});
app.delete("/api/seller/products/:id",requireAuth,requireSeller,async(req,res)=>{
  const id=Number(req.params.id); if(!Number.isInteger(id))return res.status(400).json({error:"Invalid product id."});
  const result=await pool.query("DELETE FROM products WHERE id=$1 AND seller_id=$2 AND NOT EXISTS (SELECT 1 FROM order_items WHERE product_id=$1)",[id,req.seller.id]);
  if(!result.rowCount)return res.status(409).json({error:"Product cannot be removed after it has been ordered. Set stock to 0 instead."});
  res.json({deleted:true});
});
app.get("/api/admin/sellers",requireAuth,requireAdmin,async(_req,res)=>{
  const {rows}=await pool.query("SELECT sp.id,sp.user_id,sp.store_name,sp.phone,sp.address,sp.city,sp.state,sp.pincode,sp.status,sp.verified_at,sp.created_at,u.name,u.email FROM seller_profiles sp JOIN users u ON u.id=sp.user_id ORDER BY sp.created_at DESC");
  res.json({sellers:rows});
});
app.patch("/api/admin/sellers/:id",requireAuth,requireAdmin,async(req,res)=>{
  const id=Number(req.params.id),status=String(req.body?.status||"").trim().toLowerCase();
  if(!Number.isInteger(id)||!["pending","approved","rejected"].includes(status))return res.status(400).json({error:"Invalid seller status."});
  const {rows}=await pool.query("UPDATE seller_profiles SET status=$1,verified_at=CASE WHEN $1=$3 THEN NOW() ELSE NULL END WHERE id=$2 RETURNING *",[status,id,"approved"]);
  if(!rows[0])return res.status(404).json({error:"Seller application not found."});
  await pool.query("UPDATE users SET role=CASE WHEN $1=$3 THEN $4 ELSE $5 END WHERE id=$2 AND role<>$6",[status,rows[0].user_id,"approved","seller","farmer","admin"]);
  res.json({seller:rows[0]});
});
app.post("/api/orders",requireAuth,async(req,res)=>{
  const items=Array.isArray(req.body?.items)?req.body.items:[];
  const clean=items.map(i=>({productId:Number(i.productId),quantity:Number(i.quantity)})).filter(i=>Number.isInteger(i.productId)&&Number.isInteger(i.quantity)&&i.quantity>0);
  if(!clean.length)return res.status(400).json({error:"Cart is empty."});
  const client=await pool.connect();
  try{await client.query("BEGIN");
    let total=0; const verified=[];
    for(const item of clean){
      const {rows}=await client.query("SELECT p.id,p.name,p.price,p.stock,p.seller_id,sp.store_name FROM products p LEFT JOIN seller_profiles sp ON sp.id=p.seller_id WHERE p.id=$1 FOR UPDATE",[item.productId]);
      if(!rows[0])throw Object.assign(new Error("Product not found."),{status:404});
      if(rows[0].seller_id && !rows[0].store_name)throw Object.assign(new Error("Seller product is unavailable."),{status:409});
      if(rows[0].stock<item.quantity)throw Object.assign(new Error("Not enough stock for "+rows[0].name+"."),{status:409});
      total+=Number(rows[0].price)*item.quantity; verified.push({...item,price:Number(rows[0].price),sellerId:rows[0].seller_id});
    }
    const order=await client.query("INSERT INTO orders (user_id,total_amount,status) VALUES ($1,$2,'pending') RETURNING id,total_amount,status,created_at",[req.auth.id,total]);
    const sellerGroups=new Map();
    for(const item of verified){if(item.sellerId){if(!sellerGroups.has(item.sellerId))sellerGroups.set(item.sellerId,[]);sellerGroups.get(item.sellerId).push(item);} await client.query("INSERT INTO order_items (order_id,product_id,quantity) VALUES ($1,$2,$3)",[order.rows[0].id,item.productId,item.quantity]); await client.query("UPDATE products SET stock=stock-$1 WHERE id=$2",[item.quantity,item.productId]);}
    for(const [sellerId,group] of sellerGroups){const sellerTotal=group.reduce((sum,item)=>sum+item.price*item.quantity,0);const so=await client.query("INSERT INTO seller_orders (order_id,seller_id,status,seller_total) VALUES ($1,$2,'pending',$3) RETURNING id",[order.rows[0].id,sellerId,sellerTotal]);for(const item of group)await client.query("UPDATE order_items SET seller_order_id=$1 WHERE order_id=$2 AND product_id=$3",[so.rows[0].id,order.rows[0].id,item.productId]);}
    await client.query("COMMIT");res.status(201).json({order:order.rows[0]});
  }catch(error){await client.query("ROLLBACK");console.error(error);res.status(error.status||500).json({error:error.message||"Unable to place order."});}finally{client.release();}
});
app.get("/api/orders",requireAuth,async(req,res)=>{
  const {rows}=await pool.query("SELECT o.id,o.total_amount,o.status,o.created_at,COALESCE(json_agg(json_build_object('productId',p.id,'name',p.name,'quantity',oi.quantity,'price',p.price,'seller',COALESCE(sp.store_name,'KisanSetu Direct'),'sellerStatus',COALESCE(so.status,'pending')) ORDER BY p.name) FILTER (WHERE p.id IS NOT NULL),'[]') AS items,COALESCE((SELECT json_agg(json_build_object('seller',sp2.store_name,'status',so2.status,'total',so2.seller_total) ORDER BY sp2.store_name) FROM seller_orders so2 JOIN seller_profiles sp2 ON sp2.id=so2.seller_id WHERE so2.order_id=o.id),'[]') AS seller_orders FROM orders o LEFT JOIN order_items oi ON oi.order_id=o.id LEFT JOIN products p ON p.id=oi.product_id LEFT JOIN seller_orders so ON so.id=oi.seller_order_id LEFT JOIN seller_profiles sp ON sp.id=p.seller_id WHERE o.user_id=$1 GROUP BY o.id ORDER BY o.created_at DESC",[req.auth.id]);
  res.json({orders:rows});
});
app.get("/api/seller/orders",requireAuth,requireSeller,async(req,res)=>{
  const {rows}=await pool.query("SELECT so.id AS seller_order_id,so.order_id,so.status,so.seller_total,so.created_at,o.created_at AS order_created,u.name AS customer_name,u.email AS customer_email,COALESCE(json_agg(json_build_object('productId',p.id,'name',p.name,'quantity',oi.quantity,'price',p.price) ORDER BY p.name) FILTER (WHERE p.id IS NOT NULL),'[]') AS items FROM seller_orders so JOIN orders o ON o.id=so.order_id JOIN users u ON u.id=o.user_id JOIN order_items oi ON oi.seller_order_id=so.id JOIN products p ON p.id=oi.product_id WHERE so.seller_id=$1 GROUP BY so.id,o.id,u.name,u.email ORDER BY so.created_at DESC",[req.seller.id]);
  res.json({orders:rows});
});
app.patch("/api/seller/orders/:id",requireAuth,requireSeller,async(req,res)=>{
  const id=Number(req.params.id),status=String(req.body?.status||"").trim().toLowerCase(),allowed=["pending","confirmed","packed","shipped","delivered","cancelled"];
  if(!Number.isInteger(id)||!allowed.includes(status))return res.status(400).json({error:"Invalid seller order status."});
  const client=await pool.connect();
  try{await client.query("BEGIN");const current=await client.query("SELECT id,status FROM seller_orders WHERE id=$1 AND seller_id=$2 FOR UPDATE",[id,req.seller.id]);if(!current.rows[0])throw Object.assign(new Error("Seller order not found."),{status:404});if(current.rows[0].status==="cancelled"&&status!=="cancelled")throw Object.assign(new Error("Cancelled seller orders cannot be reopened."),{status:409});if(status==="cancelled"&&current.rows[0].status!=="cancelled"){const items=await client.query("SELECT product_id,quantity FROM order_items WHERE seller_order_id=$1",[id]);for(const item of items.rows)await client.query("UPDATE products SET stock=stock+$1 WHERE id=$2",[item.quantity,item.product_id]);}const updated=await client.query("UPDATE seller_orders SET status=$1 WHERE id=$2 RETURNING id,order_id,status,seller_total,created_at",[status,id]);await client.query("COMMIT");res.json({order:updated.rows[0]});}
  catch(error){await client.query("ROLLBACK");console.error(error);res.status(error.status||500).json({error:error.message||"Unable to update seller order."});}finally{client.release();}
});

app.get("/api/admin/stats",requireAuth,requireAdmin,async(_req,res)=>{
  const [users,products,orders,pending,contacts,value]=await Promise.all([
    pool.query("SELECT COUNT(*)::int AS count FROM users"),
    pool.query("SELECT COUNT(*)::int AS count FROM products"),
    pool.query("SELECT COUNT(*)::int AS count FROM orders"),
    pool.query("SELECT COUNT(*)::int AS count FROM orders WHERE status='pending'"),
    pool.query("SELECT COUNT(*)::int AS count FROM contacts"),
    pool.query("SELECT COALESCE(SUM(total_amount),0)::numeric AS total FROM orders WHERE status<>'cancelled'")
  ]);
  res.json({stats:{users:users.rows[0].count,products:products.rows[0].count,orders:orders.rows[0].count,pendingOrders:pending.rows[0].count,contacts:contacts.rows[0].count,orderValue:Number(value.rows[0].total)}});
});
app.get("/api/admin/users",requireAuth,requireAdmin,async(_req,res)=>{
  const {rows}=await pool.query("SELECT id,name,email,role,created_at FROM users ORDER BY created_at DESC LIMIT 100");
  res.json({users:rows});
});
app.get("/api/admin/products",requireAuth,requireAdmin,async(_req,res)=>{
  const {rows}=await pool.query("SELECT p.id,p.name,p.category,p.price,p.stock,p.image,p.seller_id,COALESCE(sp.store_name,'KisanSetu Direct') AS seller_name,COALESCE(sp.city,'Platform') AS seller_city,COALESCE(sp.status,'platform') AS seller_status FROM products p LEFT JOIN seller_profiles sp ON sp.id=p.seller_id ORDER BY p.id");
  res.json({products:rows});
});
app.post("/api/admin/products",requireAuth,requireAdmin,async(req,res)=>{
  const name=String(req.body?.name||"").trim(),category=String(req.body?.category||"").trim(),price=Number(req.body?.price),stock=Number(req.body?.stock),image=String(req.body?.image||"").trim();
  if(!name||!category||!Number.isFinite(price)||price<0||!Number.isInteger(stock)||stock<0)return res.status(400).json({error:"Enter valid product details."});
  try{const {rows}=await pool.query("INSERT INTO products (name,category,price,stock,image) VALUES ($1,$2,$3,$4,$5) RETURNING *",[name,category,price,stock,image]);res.status(201).json({product:rows[0]});}
  catch(error){if(error.code==="23505")return res.status(409).json({error:"A product with this name already exists."});console.error(error);res.status(500).json({error:"Unable to create product."});}
});
app.patch("/api/admin/products/:id",requireAuth,requireAdmin,async(req,res)=>{
  const id=Number(req.params.id),name=String(req.body?.name||"").trim(),category=String(req.body?.category||"").trim(),price=Number(req.body?.price),stock=Number(req.body?.stock),image=String(req.body?.image||"").trim();
  if(!Number.isInteger(id)||!name||!category||!Number.isFinite(price)||price<0||!Number.isInteger(stock)||stock<0)return res.status(400).json({error:"Enter valid product details."});
  try{const {rows}=await pool.query("UPDATE products SET name=$1,category=$2,price=$3,stock=$4,image=$5 WHERE id=$6 RETURNING *",[name,category,price,stock,image,id]);if(!rows[0])return res.status(404).json({error:"Product not found."});res.json({product:rows[0]});}
  catch(error){if(error.code==="23505")return res.status(409).json({error:"A product with this name already exists."});console.error(error);res.status(500).json({error:"Unable to update product."});}
});
app.delete("/api/admin/products/:id",requireAuth,requireAdmin,async(req,res)=>{
  const id=Number(req.params.id);if(!Number.isInteger(id))return res.status(400).json({error:"Invalid product id."});
  const {rows}=await pool.query("SELECT 1 FROM order_items WHERE product_id=$1 LIMIT 1",[id]);
  if(rows[0])return res.status(409).json({error:"This product is linked to an order and cannot be deleted. Set stock to 0 instead."});
  const result=await pool.query("DELETE FROM products WHERE id=$1",[id]);if(!result.rowCount)return res.status(404).json({error:"Product not found."});res.json({deleted:true});
});
app.get("/api/admin/orders",requireAuth,requireAdmin,async(_req,res)=>{
  const {rows}=await pool.query("SELECT o.id,o.total_amount,o.status,o.created_at,u.name,u.email,COALESCE(json_agg(json_build_object('productId',p.id,'name',p.name,'quantity',oi.quantity,'price',p.price) ORDER BY p.name) FILTER (WHERE p.id IS NOT NULL),'[]') AS items FROM orders o JOIN users u ON u.id=o.user_id LEFT JOIN order_items oi ON oi.order_id=o.id LEFT JOIN products p ON p.id=oi.product_id GROUP BY o.id,u.name,u.email ORDER BY o.created_at DESC LIMIT 200");
  res.json({orders:rows});
});
app.patch("/api/admin/orders/:id",requireAuth,requireAdmin,async(req,res)=>{
  const id=Number(req.params.id),status=String(req.body?.status||"").trim().toLowerCase(),allowed=["pending","confirmed","packed","shipped","delivered","cancelled"];
  if(!Number.isInteger(id)||!allowed.includes(status))return res.status(400).json({error:"Invalid order status."});
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    const current=await client.query("SELECT status FROM orders WHERE id=$1 FOR UPDATE",[id]);
    if(!current.rows[0])throw Object.assign(new Error("Order not found."),{status:404});
    if(current.rows[0].status==="cancelled"&&status!=="cancelled")throw Object.assign(new Error("Cancelled orders cannot be reopened."),{status:409});
    if(status==="cancelled"&&current.rows[0].status!=="cancelled"){
      const items=await client.query("SELECT oi.product_id,oi.quantity FROM order_items oi LEFT JOIN seller_orders so ON so.id=oi.seller_order_id WHERE oi.order_id=$1 AND COALESCE(so.status,'pending')<>'cancelled'",[id]);
      for(const item of items.rows)await client.query("UPDATE products SET stock=stock+$1 WHERE id=$2",[item.quantity,item.product_id]);
    }
    const updated=await client.query("UPDATE orders SET status=$1 WHERE id=$2 RETURNING id,total_amount,status,created_at",[status,id]);
    await client.query("COMMIT");res.json({order:updated.rows[0]});
  }catch(error){await client.query("ROLLBACK");console.error(error);res.status(error.status||500).json({error:error.message||"Unable to update order."});}
  finally{client.release();}
});
app.get("/api/admin/contacts",requireAuth,requireAdmin,async(_req,res)=>{
  const {rows}=await pool.query("SELECT id,user_id,message,created_at FROM contacts ORDER BY created_at DESC LIMIT 100");
  res.json({contacts:rows});
});


app.post("/api/contact",requireAuth,async(req,res)=>{
  const name=String(req.body?.name||"").trim();
  const email=String(req.body?.email||"").trim().toLowerCase();
  const phone=String(req.body?.phone||"").trim();
  const subject=String(req.body?.subject||"").trim();
  const message=String(req.body?.message||"").trim();
  if(!name||!email||!subject||!message)return res.status(400).json({error:"Name, email, subject and message are required."});
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return res.status(400).json({error:"Enter a valid email."});
  if(phone && !/^\d{10}$/.test(phone))return res.status(400).json({error:"Enter a valid 10-digit phone number."});
  const storedMessage=JSON.stringify({name,email,phone,subject,message});
  await pool.query("INSERT INTO contacts (user_id,message) VALUES ($1,$2)",[req.auth.id,storedMessage]);
  try {
    const emailResult = await sendContactEmail({name,email,phone,subject,message});
    res.status(201).json({message:emailResult.sent ? "Message received and email notification sent." : "Message received. Email notification is not configured yet.",emailSent:emailResult.sent});
  } catch(error) {
    console.error("Contact email error:",error);
    res.status(201).json({message:"Message received, but email notification could not be sent.",emailSent:false});
  }
});
app.get("*",(_req,res)=>res.sendFile(path.join(__dirname,"index.html")));
async function start(){await initDatabase();app.listen(PORT,()=>console.log("Server running on port "+PORT));}
start().catch(error=>{console.error("Startup failed:",error);process.exit(1);});
process.on("SIGTERM",async()=>{await pool.end();process.exit(0);});