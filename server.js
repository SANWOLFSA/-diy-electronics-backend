// DIY Electronics — production backend
// Run locally with `npm install && npm start`, or deploy as-is to Render/Railway.
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('localhost')
    ? false
    : { rejectUnauthorized: false } // required by most managed Postgres hosts (Neon/Supabase/Render)
});

// Stripe is optional — only loaded/used if a real secret key is configured.
// This lets the whole app keep working (minus real checkout) before you've
// set up a Stripe account.
let stripe = null;
if (process.env.STRIPE_SECRET_KEY) {
  stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
}

// ---------------------------------------------------------------------------
// SCHEMA — auto-creates any new tables needed for accounts on every server
// start. Safe to run repeatedly (IF NOT EXISTS everywhere).
// ---------------------------------------------------------------------------
async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id             SERIAL PRIMARY KEY,
      email          TEXT UNIQUE NOT NULL,
      password_hash  TEXT NOT NULL,
      name           TEXT NOT NULL,
      session_token  TEXT,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}
ensureSchema().catch(err => console.error('Schema setup failed:', err.message));

// ---------------------------------------------------------------------------
// AUTH HELPERS
// ---------------------------------------------------------------------------
function newToken() {
  return crypto.randomBytes(24).toString('hex');
}

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Log in first.' });
  try {
    const result = await pool.query('SELECT id, email, name FROM users WHERE session_token = $1', [token]);
    if (result.rows.length === 0) return res.status(401).json({ error: 'Session expired — log in again.' });
    req.user = result.rows[0];
    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ---------------------------------------------------------------------------
// ADMIN — one-time (or repeatable) database seeding, triggered by visiting
// a URL from any browser. Protected by ADMIN_SEED_KEY.
// ---------------------------------------------------------------------------
app.get('/api/admin/seed', async (req, res) => {
  if (!process.env.ADMIN_SEED_KEY || req.query.key !== process.env.ADMIN_SEED_KEY) {
    return res.status(401).json({ error: 'Missing or incorrect key. Add ?key=YOUR_KEY to the URL.' });
  }
  try {
    const sql = fs.readFileSync(path.join(__dirname, 'seed.sql'), 'utf8');
    await pool.query(sql);
    res.json({ status: 'ok', message: 'Database seeded successfully.' });
  } catch (err) {
    res.status(500).json({ status: 'error', detail: err.message });
  }
});

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected' });
  } catch (err) {
    res.status(500).json({ status: 'error', db: 'unreachable', detail: err.message });
  }
});

// ---------------------------------------------------------------------------
// AUTH — real signup/login backed by the database. Sessions are a single
// random token stored on the user row (simple, no extra table needed).
// ---------------------------------------------------------------------------
app.post('/api/auth/signup', async (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password || !name) return res.status(400).json({ error: 'name, email, and password are required.' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  try {
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase().trim()]);
    if (existing.rows.length > 0) return res.status(409).json({ error: 'An account with that email already exists.' });
    const hash = await bcrypt.hash(password, 10);
    const token = newToken();
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, name, session_token)
       VALUES ($1, $2, $3, $4) RETURNING id, email, name`,
      [email.toLowerCase().trim(), hash, name.trim(), token]
    );
    res.status(201).json({ token, user: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password are required.' });
  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase().trim()]);
    if (result.rows.length === 0) return res.status(401).json({ error: 'No account with that email.' });
    const user = result.rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Incorrect password.' });
    const token = newToken();
    await pool.query('UPDATE users SET session_token = $1 WHERE id = $2', [token, user.id]);
    res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// ---------------------------------------------------------------------------
// DIAGNOSTICS
// ---------------------------------------------------------------------------
app.get('/api/diagnostics', async (req, res) => {
  try {
    const result = await pool.query('SELECT device_id FROM diagnostics ORDER BY device_id');
    res.json({ device_ids: result.rows.map(r => r.device_id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/diagnostics/:device_id', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT payload FROM diagnostics WHERE device_id = $1',
      [req.params.device_id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: `No diagnostic record for device_id '${req.params.device_id}'` });
    }
    res.json(result.rows[0].payload);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// MARKETPLACE — browsing is open to everyone; creating a listing requires
// a real logged-in account (this is the real "seller signup" flow).
// ---------------------------------------------------------------------------
app.get('/api/marketplace', async (req, res) => {
  try {
    const result = await pool.query('SELECT payload FROM marketplace_items ORDER BY updated_at DESC');
    res.json(result.rows.map(r => r.payload));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/marketplace/:id', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT payload FROM marketplace_items WHERE id = $1',
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Listing not found' });
    res.json(result.rows[0].payload);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/marketplace', requireAuth, async (req, res) => {
  const { name, cat, price, desc } = req.body;
  if (!name || !cat || price === undefined) return res.status(400).json({ error: 'name, cat, and price are required.' });
  const id = 'u' + crypto.randomBytes(5).toString('hex');
  const payload = {
    id, name: name.trim(), cat, price: Number(price),
    desc: (desc || '').trim(),
    seller: req.user.name, sellerId: req.user.id, sellerRating: 5.0, verified: false
  };
  try {
    await pool.query(
      `INSERT INTO marketplace_items (id, payload) VALUES ($1, $2::jsonb)`,
      [id, JSON.stringify(payload)]
    );
    res.status(201).json(payload);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// CHECKOUT — real Stripe payment session. Requires STRIPE_SECRET_KEY to be
// set; otherwise returns a clear error instead of pretending to charge a card.
// ---------------------------------------------------------------------------
app.post('/api/checkout/create-session', async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Payments are not configured yet (missing STRIPE_SECRET_KEY on the server).' });
  const { itemId, qty, successUrl, cancelUrl } = req.body;
  try {
    const result = await pool.query('SELECT payload FROM marketplace_items WHERE id = $1', [itemId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Listing not found' });
    const item = result.rows[0].payload;
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: item.name },
          unit_amount: Math.round(item.price * 100)
        },
        quantity: Math.max(1, Number(qty) || 1)
      }],
      success_url: successUrl,
      cancel_url: cancelUrl
    });
    res.json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// AI TECH ASSISTANT — real AI, backed by the Anthropic API. Requires
// ANTHROPIC_API_KEY on the server; otherwise returns a clear error so the
// frontend can fall back to canned responses instead of hanging.
// ---------------------------------------------------------------------------
app.post('/api/assistant', async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'AI assistant is not configured yet (missing ANTHROPIC_API_KEY on the server).' });
  const { message, deviceContext } = req.body;
  if (!message || !message.trim()) return res.status(400).json({ error: 'message is required.' });
  try {
    const systemPrompt = deviceContext
      ? `You are a concise electronics repair assistant helping with a ${deviceContext.brand} ${deviceContext.model}, issue: ${deviceContext.problem}. Suspected faulty part: ${deviceContext.faulty_component?.type} (${deviceContext.faulty_component?.part_number}). Keep answers short and practical, 2-4 sentences.`
      : 'You are a concise electronics repair assistant. Keep answers short and practical, 2-4 sentences.';
    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 300,
        system: systemPrompt,
        messages: [{ role: 'user', content: message }]
      })
    });
    const data = await apiRes.json();
    if (!apiRes.ok) return res.status(500).json({ error: data.error?.message || 'AI request failed.' });
    const reply = (data.content || []).map(b => b.text || '').join('').trim() || "Sorry, I couldn't generate a reply.";
    res.json({ reply });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// REVIEWS
// ---------------------------------------------------------------------------
app.get('/api/reviews/:itemId', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT stars, comment, author, created_at FROM reviews WHERE item_id = $1 ORDER BY created_at DESC',
      [req.params.itemId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/reviews/:itemId', async (req, res) => {
  const { stars, comment, author } = req.body;
  if (!stars || stars < 1 || stars > 5) return res.status(400).json({ error: 'stars must be 1-5' });
  if (!comment || !comment.trim()) return res.status(400).json({ error: 'comment is required' });
  try {
    const result = await pool.query(
      `INSERT INTO reviews (item_id, stars, comment, author, created_at)
       VALUES ($1, $2, $3, $4, now()) RETURNING stars, comment, author, created_at`,
      [req.params.itemId, stars, comment.trim(), author || 'anonymous']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`DIY Electronics API listening on port ${PORT}`));
