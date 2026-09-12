// DIY Electronics — production backend
// Run locally with `npm install && npm start`, or deploy as-is to Render/Railway.
require('dotenv').config();
const express = require('express');
const cors = require('cors');
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

// ---------------------------------------------------------------------------
// Health check — hit this first after deploying to confirm the server + DB
// connection both work: GET /api/health
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
// MARKETPLACE
// ---------------------------------------------------------------------------
app.get('/api/marketplace', async (req, res) => {
  try {
    const result = await pool.query('SELECT payload FROM marketplace_items ORDER BY id');
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

// ---------------------------------------------------------------------------
// REVIEWS — real persistence, this is what makes ratings survive a refresh
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
