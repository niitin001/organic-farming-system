const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');

const JWT_SECRET = 'change_this_to_a_strong_secret';
const PORT = process.env.PORT || 3000;
const app = express();

app.use(cors({ origin: true, credentials: true }));
app.use(bodyParser.json());

// serve static frontend from 'public' folder (or root)
app.use(express.static(path.join(__dirname, 'public')));

// init sqlite db (file users.db in project)
const db = new sqlite3.Database(path.join(__dirname, 'users.db'));
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    email TEXT UNIQUE,
    password TEXT
  )`);
});

// Helper: create token
function createToken(payload){ return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' }); }
function verifyToken(token){ try{ return jwt.verify(token, JWT_SECRET); }catch(e){return null;} }

// Signup
app.post('/api/signup', (req, res) => {
  const { name, email, password } = req.body || {};
  if(!name || !email || !password) return res.status(400).json({ error: 'Name, email & password required' });
  const hashed = bcrypt.hashSync(password, 10);
  const stmt = db.prepare('INSERT INTO users (name,email,password) VALUES (?,?,?)');
  stmt.run(name.trim(), email.toLowerCase().trim(), hashed, function(err){
    if(err){
      if(err.message && err.message.includes('UNIQUE')) return res.status(409).json({ error: 'User already exists' });
      return res.status(500).json({ error: 'DB error' });
    }
    const token = createToken({ id: this.lastID, email });
    res.json({ token, user: { id: this.lastID, name, email } });
  });
});

// Login
app.post('/api/login', (req, res) => {
  const { email, password } = req.body || {};
  if(!email || !password) return res.status(400).json({ error: 'Email & password required' });
  db.get('SELECT id,name,email,password FROM users WHERE email = ?', [email.toLowerCase().trim()], (err, row) => {
    if(err) return res.status(500).json({ error: 'DB error' });
    if(!row) return res.status(401).json({ error: 'Invalid credentials' });
    if(!bcrypt.compareSync(password, row.password)) return res.status(401).json({ error: 'Invalid credentials' });
    const token = createToken({ id: row.id, email: row.email });
    res.json({ token, user: { id: row.id, name: row.name, email: row.email } });
  });
});

// Me (protected)
app.get('/api/me', (req, res) => {
  const auth = req.headers.authorization || '';
  const token = auth.split(' ')[1];
  const payload = verifyToken(token);
  if(!payload) return res.status(401).json({ error: 'Unauthorized' });
  db.get('SELECT id,name,email FROM users WHERE id = ?', [payload.id], (err,row) => {
    if(err) return res.status(500).json({ error: 'DB error' });
    if(!row) return res.status(404).json({ error: 'User not found' });
    res.json({ user: row });
  });
});

// fallback to index.html for SPA (optional)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});