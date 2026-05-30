const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// ── Database ──────────────────────────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS visitors (
      id        SERIAL PRIMARY KEY,
      timestamp TIMESTAMPTZ DEFAULT NOW(),
      ip        TEXT,
      country   TEXT,
      city      TEXT,
      region    TEXT,
      isp       TEXT,
      browser   TEXT,
      os        TEXT,
      device    TEXT,
      referrer  TEXT,
      page      TEXT,
      timezone  TEXT
    )
  `);
  console.log('✅ DB ready');
}
initDB().catch(console.error);

// ── Helpers ───────────────────────────────────────────────────────────────────
function parseUA(ua = '') {
  let browser = 'Unknown', os = 'Unknown';

  if (/Edg\//i.test(ua))          browser = 'Edge';
  else if (/OPR\//i.test(ua))     browser = 'Opera';
  else if (/Chrome\//i.test(ua))  browser = 'Chrome';
  else if (/Firefox\//i.test(ua)) browser = 'Firefox';
  else if (/Safari\//i.test(ua))  browser = 'Safari';

  if (/Windows NT/i.test(ua))     os = 'Windows';
  else if (/iPhone|iPad/i.test(ua)) os = 'iOS';
  else if (/Android/i.test(ua))   os = 'Android';
  else if (/Mac OS X/i.test(ua))  os = 'macOS';
  else if (/Linux/i.test(ua))     os = 'Linux';

  return { browser, os };
}

async function geoLookup(ip) {
  try {
    // Strip IPv6 wrapping e.g. ::ffff:1.2.3.4
    const cleanIP = (ip || '').replace(/^::ffff:/, '').split(',')[0].trim();
    const res  = await fetch(`http://ip-api.com/json/${cleanIP}?fields=country,city,regionName,isp,timezone`);
    const data = await res.json();
    if (data.country) return data;
  } catch (_) {}
  return {};
}

// ── Routes ────────────────────────────────────────────────────────────────────

// POST /track  – called by portfolio JS
app.post('/track', async (req, res) => {
  try {
    const ip  = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
    const geo = await geoLookup(ip);
    const { browser, os } = parseUA(req.headers['user-agent']);
    const device   = /Mobi|Android/i.test(req.headers['user-agent'] || '') ? 'Mobile' : 'Desktop';
    const referrer = req.body.referrer || 'Direct';
    const page     = req.body.page     || '/';

    await pool.query(
      `INSERT INTO visitors (ip,country,city,region,isp,browser,os,device,referrer,page,timezone)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [ip, geo.country||'Unknown', geo.city||'Unknown', geo.regionName||'Unknown',
       geo.isp||'Unknown', browser, os, device, referrer, page, geo.timezone||'Unknown']
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false });
  }
});

// GET /visitors – raw JSON data (protect this in production!)
app.get('/visitors', async (req, res) => {
  const result = await pool.query(
    'SELECT * FROM visitors ORDER BY timestamp DESC LIMIT 500'
  );
  res.json(result.rows);
});

// GET /stats – aggregated counts
app.get('/stats', async (req, res) => {
  const [total, byCountry, byBrowser, byDevice, byPage, recent] = await Promise.all([
    pool.query('SELECT COUNT(*) FROM visitors'),
    pool.query('SELECT country, COUNT(*) as count FROM visitors GROUP BY country ORDER BY count DESC LIMIT 10'),
    pool.query('SELECT browser, COUNT(*) as count FROM visitors GROUP BY browser ORDER BY count DESC'),
    pool.query('SELECT device, COUNT(*) as count FROM visitors GROUP BY device ORDER BY count DESC'),
    pool.query('SELECT page, COUNT(*) as count FROM visitors GROUP BY page ORDER BY count DESC LIMIT 10'),
    pool.query('SELECT * FROM visitors ORDER BY timestamp DESC LIMIT 20'),
  ]);
  res.json({
    total:     parseInt(total.rows[0].count),
    byCountry: byCountry.rows,
    byBrowser: byBrowser.rows,
    byDevice:  byDevice.rows,
    byPage:    byPage.rows,
    recent:    recent.rows,
  });
});

// GET /dashboard – HTML dashboard
app.get('/dashboard', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Visitor Dashboard – Basit Ahmed</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Segoe UI',sans-serif;background:#0f172a;color:#e2e8f0;min-height:100vh}
  header{background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:24px 32px;display:flex;align-items:center;gap:16px}
  header h1{font-size:1.5rem;font-weight:700}
  header span{font-size:.9rem;opacity:.8}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;padding:24px 32px 0}
  .stat{background:#1e293b;border-radius:12px;padding:20px;text-align:center}
  .stat .num{font-size:2.2rem;font-weight:700;color:#818cf8}
  .stat .label{font-size:.85rem;color:#94a3b8;margin-top:4px}
  .section{margin:24px 32px;background:#1e293b;border-radius:12px;overflow:hidden}
  .section h2{padding:16px 20px;font-size:1rem;font-weight:600;border-bottom:1px solid #334155;color:#a5b4fc}
  table{width:100%;border-collapse:collapse;font-size:.85rem}
  th{padding:10px 16px;text-align:left;color:#64748b;font-weight:500;border-bottom:1px solid #334155}
  td{padding:10px 16px;border-bottom:1px solid #1e293b}
  tr:hover td{background:#273449}
  .bar-row{display:flex;align-items:center;gap:12px;padding:10px 20px;border-bottom:1px solid #334155}
  .bar-row:last-child{border:none}
  .bar-label{width:110px;font-size:.85rem;color:#cbd5e1;flex-shrink:0}
  .bar-wrap{flex:1;background:#334155;border-radius:99px;height:10px;overflow:hidden}
  .bar-fill{height:100%;background:linear-gradient(90deg,#6366f1,#8b5cf6);border-radius:99px;transition:width .6s ease}
  .bar-count{width:40px;text-align:right;font-size:.8rem;color:#94a3b8;flex-shrink:0}
  .tag{display:inline-block;padding:2px 8px;border-radius:99px;font-size:.75rem;font-weight:600}
  .mobile{background:#1d4ed830;color:#60a5fa}
  .desktop{background:#16533030;color:#34d399}
  footer{text-align:center;padding:24px;color:#475569;font-size:.8rem}
</style>
</head>
<body>
<header>
  <div>
    <h1>📊 Portfolio Visitor Dashboard</h1>
    <span>Basit Ahmed · Real-time analytics</span>
  </div>
  <div style="margin-left:auto;font-size:.8rem;color:rgba(255,255,255,.7)" id="updated"></div>
</header>

<div class="grid" id="stats-grid">
  <div class="stat"><div class="num" id="s-total">—</div><div class="label">Total Visits</div></div>
  <div class="stat"><div class="num" id="s-countries">—</div><div class="label">Countries</div></div>
  <div class="stat"><div class="num" id="s-mobile">—</div><div class="label">Mobile Visits</div></div>
  <div class="stat"><div class="num" id="s-desktop">—</div><div class="label">Desktop Visits</div></div>
</div>

<div style="display:grid;grid-template-columns:1fr 1fr;gap:0 24px;margin:24px 32px;gap:24px">
  <div class="section" style="margin:0">
    <h2>🌍 Top Countries</h2>
    <div id="countries"></div>
  </div>
  <div class="section" style="margin:0">
    <h2>🌐 Browsers</h2>
    <div id="browsers"></div>
  </div>
</div>

<div class="section">
  <h2>🕒 Recent Visitors</h2>
  <table>
    <thead><tr><th>Time</th><th>Location</th><th>Browser</th><th>Device</th><th>OS</th><th>ISP</th><th>Referrer</th></tr></thead>
    <tbody id="recent"></tbody>
  </table>
</div>

<footer>Auto-refreshes every 30s · Built for basitahmed1412@gmail.com</footer>

<script>
async function load() {
  const data = await fetch('/stats').then(r=>r.json());

  document.getElementById('s-total').textContent    = data.total.toLocaleString();
  document.getElementById('s-countries').textContent = data.byCountry.length;

  const mobile  = data.byDevice.find(d=>d.device==='Mobile')?.count || 0;
  const desktop = data.byDevice.find(d=>d.device==='Desktop')?.count || 0;
  document.getElementById('s-mobile').textContent  = parseInt(mobile).toLocaleString();
  document.getElementById('s-desktop').textContent = parseInt(desktop).toLocaleString();

  function bars(el, rows) {
    const max = Math.max(...rows.map(r=>parseInt(r.count)),1);
    el.innerHTML = rows.map(r=>\`
      <div class="bar-row">
        <span class="bar-label">\${r[Object.keys(r)[0]]}</span>
        <div class="bar-wrap"><div class="bar-fill" style="width:\${Math.round(parseInt(r.count)/max*100)}%"></div></div>
        <span class="bar-count">\${parseInt(r.count).toLocaleString()}</span>
      </div>\`).join('');
  }

  bars(document.getElementById('countries'), data.byCountry);
  bars(document.getElementById('browsers'),  data.byBrowser);

  document.getElementById('recent').innerHTML = data.recent.map(v=>\`
    <tr>
      <td>\${new Date(v.timestamp).toLocaleString()}</td>
      <td>\${v.city}, \${v.country}</td>
      <td>\${v.browser}</td>
      <td><span class="tag \${v.device.toLowerCase()}">\${v.device}</span></td>
      <td>\${v.os}</td>
      <td>\${v.isp}</td>
      <td>\${v.referrer}</td>
    </tr>\`).join('');

  document.getElementById('updated').textContent = 'Updated: ' + new Date().toLocaleTimeString();
}

load();
setInterval(load, 30000);
</script>
</body>
</html>`);
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Tracker running on port ${PORT}`));
