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
      id         SERIAL PRIMARY KEY,
      timestamp  TIMESTAMPTZ DEFAULT NOW(),
      ip         TEXT,
      country    TEXT,
      city       TEXT,
      region     TEXT,
      isp        TEXT,
      browser    TEXT,
      os         TEXT,
      device     TEXT,
      referrer   TEXT,
      page       TEXT,
      timezone   TEXT,
      screen     TEXT,
      language   TEXT,
      connection TEXT
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS events (
      id         SERIAL PRIMARY KEY,
      timestamp  TIMESTAMPTZ DEFAULT NOW(),
      visitor_id INTEGER,
      type       TEXT,
      data       JSONB
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS inquiries (
      id        SERIAL PRIMARY KEY,
      timestamp TIMESTAMPTZ DEFAULT NOW(),
      name      TEXT,
      email     TEXT,
      services  TEXT,
      budget    TEXT,
      message   TEXT
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
  if (/Windows NT/i.test(ua))       os = 'Windows';
  else if (/iPhone|iPad/i.test(ua)) os = 'iOS';
  else if (/Android/i.test(ua))     os = 'Android';
  else if (/Mac OS X/i.test(ua))    os = 'macOS';
  else if (/Linux/i.test(ua))       os = 'Linux';
  return { browser, os };
}

async function geoLookup(ip) {
  try {
    const cleanIP = (ip || '').replace(/^::ffff:/, '').split(',')[0].trim();
    const res  = await fetch(`http://ip-api.com/json/${cleanIP}?fields=country,city,regionName,isp,timezone`);
    const data = await res.json();
    if (data.country) return data;
  } catch (_) {}
  return {};
}

// ── Routes ────────────────────────────────────────────────────────────────────

// POST /track — initial visit
app.post('/track', async (req, res) => {
  try {
    const ip  = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
    const geo = await geoLookup(ip);
    const { browser, os } = parseUA(req.headers['user-agent']);
    const device     = /Mobi|Android/i.test(req.headers['user-agent'] || '') ? 'Mobile' : 'Desktop';
    const { referrer, page, screen, language, timezone, connection } = req.body;

    const result = await pool.query(
      `INSERT INTO visitors
        (ip,country,city,region,isp,browser,os,device,referrer,page,timezone,screen,language,connection)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING id`,
      [ip, geo.country||'Unknown', geo.city||'Unknown', geo.regionName||'Unknown',
       geo.isp||'Unknown', browser, os, device,
       referrer||'Direct', page||'/', geo.timezone||timezone||'Unknown',
       screen||'Unknown', language||'Unknown', connection||'Unknown']
    );
    res.json({ ok: true, id: result.rows[0].id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false });
  }
});

// POST /event — scroll, clicks, session end
app.post('/event', async (req, res) => {
  try {
    const { type, visitor_id, ...data } = req.body;
    await pool.query(
      'INSERT INTO events (visitor_id, type, data) VALUES ($1,$2,$3)',
      [visitor_id || null, type, JSON.stringify(data)]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false });
  }
});

// POST /inquiry — hire me form
app.post('/inquiry', async (req, res) => {
  try {
    const { name, email, services, budget, message } = req.body;
    await pool.query(
      'INSERT INTO inquiries (name,email,services,budget,message) VALUES ($1,$2,$3,$4,$5)',
      [name, email, services, budget, message]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false });
  }
});

// GET /visitors — raw visitor list
app.get('/visitors', async (req, res) => {
  const result = await pool.query('SELECT * FROM visitors ORDER BY timestamp DESC LIMIT 500');
  res.json(result.rows);
});

// GET /inquiries — all hire me submissions
app.get('/inquiries', async (req, res) => {
  const result = await pool.query('SELECT * FROM inquiries ORDER BY timestamp DESC');
  res.json(result.rows);
});

// GET /stats — aggregated stats
app.get('/stats', async (req, res) => {
  const [total, byCountry, byBrowser, byDevice, byPage, recent,
         totalInquiries, recentInquiries, avgSession, topSections] = await Promise.all([
    pool.query('SELECT COUNT(*) FROM visitors'),
    pool.query('SELECT country, COUNT(*) as count FROM visitors GROUP BY country ORDER BY count DESC LIMIT 10'),
    pool.query('SELECT browser, COUNT(*) as count FROM visitors GROUP BY browser ORDER BY count DESC'),
    pool.query('SELECT device, COUNT(*) as count FROM visitors GROUP BY device ORDER BY count DESC'),
    pool.query('SELECT page, COUNT(*) as count FROM visitors GROUP BY page ORDER BY count DESC LIMIT 10'),
    pool.query('SELECT * FROM visitors ORDER BY timestamp DESC LIMIT 20'),
    pool.query('SELECT COUNT(*) FROM inquiries'),
    pool.query('SELECT * FROM inquiries ORDER BY timestamp DESC LIMIT 5'),
    pool.query(`SELECT ROUND(AVG((data->>'duration_seconds')::numeric)) as avg_sec
                FROM events WHERE type='session_end' AND data->>'duration_seconds' IS NOT NULL`),
    pool.query(`SELECT data->>'section' as section, COUNT(*) as count
                FROM events WHERE type='scroll_section'
                GROUP BY section ORDER BY count DESC`),
  ]);
  res.json({
    total:           parseInt(total.rows[0].count),
    byCountry:       byCountry.rows,
    byBrowser:       byBrowser.rows,
    byDevice:        byDevice.rows,
    byPage:          byPage.rows,
    recent:          recent.rows,
    totalInquiries:  parseInt(totalInquiries.rows[0].count),
    recentInquiries: recentInquiries.rows,
    avgSessionSec:   parseInt(avgSession.rows[0]?.avg_sec || 0),
    topSections:     topSections.rows,
  });
});

// GET /dashboard — HTML dashboard
app.get('/dashboard', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dashboard — Basit Ahmad Ganie</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Segoe UI',sans-serif;background:#0f172a;color:#e2e8f0;min-height:100vh}
  header{background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:20px 28px;display:flex;align-items:center;gap:16px}
  header h1{font-size:1.3rem;font-weight:700}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;padding:20px 28px 0}
  .stat{background:#1e293b;border-radius:12px;padding:18px;text-align:center}
  .stat .num{font-size:2rem;font-weight:700;color:#818cf8}
  .stat .label{font-size:.8rem;color:#94a3b8;margin-top:4px}
  .section{margin:20px 28px;background:#1e293b;border-radius:12px;overflow:hidden}
  .section h2{padding:14px 18px;font-size:.95rem;font-weight:600;border-bottom:1px solid #334155;color:#a5b4fc}
  table{width:100%;border-collapse:collapse;font-size:.82rem}
  th{padding:9px 14px;text-align:left;color:#64748b;font-weight:500;border-bottom:1px solid #334155}
  td{padding:9px 14px;border-bottom:1px solid #1a2539}
  tr:hover td{background:#1a2d45}
  .bar-row{display:flex;align-items:center;gap:10px;padding:9px 18px;border-bottom:1px solid #334155}
  .bar-row:last-child{border:none}
  .bar-label{width:100px;font-size:.82rem;color:#cbd5e1;flex-shrink:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .bar-wrap{flex:1;background:#334155;border-radius:99px;height:9px;overflow:hidden}
  .bar-fill{height:100%;background:linear-gradient(90deg,#6366f1,#8b5cf6);border-radius:99px}
  .bar-count{width:36px;text-align:right;font-size:.78rem;color:#94a3b8;flex-shrink:0}
  .two-col{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin:20px 28px}
  .two-col .section{margin:0}
  .tag{display:inline-block;padding:2px 8px;border-radius:99px;font-size:.72rem;font-weight:600}
  .mobile{background:#1d4ed830;color:#60a5fa}.desktop{background:#16533030;color:#34d399}
  .inquiry-card{padding:14px 18px;border-bottom:1px solid #334155}
  .inquiry-card:last-child{border:none}
  .inquiry-card .meta{font-size:.78rem;color:#64748b;margin-bottom:4px}
  .inquiry-card .name{font-weight:600;color:#a5b4fc}
  .inquiry-card .services{font-size:.8rem;color:#34d399;margin:3px 0}
  .inquiry-card .msg{font-size:.82rem;color:#94a3b8}
  footer{text-align:center;padding:20px;color:#475569;font-size:.78rem}
  #updated{margin-left:auto;font-size:.78rem;color:rgba(255,255,255,.6)}
</style>
</head>
<body>
<header>
  <div>
    <h1>📊 Visitor Dashboard</h1>
    <div style="font-size:.82rem;opacity:.8">Basit Ahmad Ganie · portfolio-b4ut.onrender.com</div>
  </div>
  <div id="updated"></div>
</header>

<div class="grid">
  <div class="stat"><div class="num" id="s-total">—</div><div class="label">Total Visits</div></div>
  <div class="stat"><div class="num" id="s-countries">—</div><div class="label">Countries</div></div>
  <div class="stat"><div class="num" id="s-mobile">—</div><div class="label">Mobile</div></div>
  <div class="stat"><div class="num" id="s-desktop">—</div><div class="label">Desktop</div></div>
  <div class="stat"><div class="num" id="s-avgsession">—</div><div class="label">Avg Session</div></div>
  <div class="stat"><div class="num" id="s-inquiries">—</div><div class="label">Inquiries</div></div>
</div>

<div class="two-col">
  <div class="section"><h2>🌍 Top Countries</h2><div id="countries"></div></div>
  <div class="section"><h2>🌐 Browsers</h2><div id="browsers"></div></div>
</div>

<div class="two-col">
  <div class="section"><h2>📜 Sections Reached</h2><div id="sections"></div></div>
  <div class="section"><h2>📩 Recent Inquiries</h2><div id="inquiries"></div></div>
</div>

<div class="section">
  <h2>🕒 Recent Visitors</h2>
  <table>
    <thead><tr><th>Time</th><th>Location</th><th>Browser</th><th>Device</th><th>OS</th><th>Screen</th><th>Language</th><th>ISP</th><th>Referrer</th></tr></thead>
    <tbody id="recent"></tbody>
  </table>
</div>

<footer>Auto-refreshes every 30s</footer>

<script>
function fmt(sec) {
  if (!sec || sec===0) return '—';
  if (sec < 60) return sec + 's';
  return Math.floor(sec/60) + 'm ' + (sec%60) + 's';
}
function bars(el, rows, key) {
  if (!rows.length) { el.innerHTML='<div style="padding:14px 18px;color:#475569;font-size:.82rem">No data yet</div>'; return; }
  const max = Math.max(...rows.map(r=>parseInt(r.count)),1);
  el.innerHTML = rows.map(r=>\`
    <div class="bar-row">
      <span class="bar-label" title="\${r[key]}">\${r[key]||'Unknown'}</span>
      <div class="bar-wrap"><div class="bar-fill" style="width:\${Math.round(parseInt(r.count)/max*100)}%"></div></div>
      <span class="bar-count">\${parseInt(r.count)}</span>
    </div>\`).join('');
}
async function load() {
  const data = await fetch('/stats').then(r=>r.json());
  document.getElementById('s-total').textContent       = data.total.toLocaleString();
  document.getElementById('s-countries').textContent   = data.byCountry.length;
  document.getElementById('s-inquiries').textContent   = data.totalInquiries;
  document.getElementById('s-avgsession').textContent  = fmt(data.avgSessionSec);
  const mob = data.byDevice.find(d=>d.device==='Mobile')?.count||0;
  const dsk = data.byDevice.find(d=>d.device==='Desktop')?.count||0;
  document.getElementById('s-mobile').textContent  = parseInt(mob).toLocaleString();
  document.getElementById('s-desktop').textContent = parseInt(dsk).toLocaleString();

  bars(document.getElementById('countries'), data.byCountry, 'country');
  bars(document.getElementById('browsers'),  data.byBrowser, 'browser');
  bars(document.getElementById('sections'),  data.topSections, 'section');

  document.getElementById('inquiries').innerHTML = data.recentInquiries.length
    ? data.recentInquiries.map(i=>\`
        <div class="inquiry-card">
          <div class="meta">\${new Date(i.timestamp).toLocaleString()} · \${i.budget||'no budget'}</div>
          <div class="name">\${i.name} &lt;\${i.email}&gt;</div>
          <div class="services">\${i.services}</div>
          <div class="msg">\${i.message.substring(0,120)}\${i.message.length>120?'…':''}</div>
        </div>\`).join('')
    : '<div style="padding:14px 18px;color:#475569;font-size:.82rem">No inquiries yet</div>';

  document.getElementById('recent').innerHTML = data.recent.map(v=>\`
    <tr>
      <td>\${new Date(v.timestamp).toLocaleString()}</td>
      <td>\${v.city}, \${v.country}</td>
      <td>\${v.browser}</td>
      <td><span class="tag \${v.device.toLowerCase()}">\${v.device}</span></td>
      <td>\${v.os}</td>
      <td>\${v.screen||'—'}</td>
      <td>\${v.language||'—'}</td>
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
app.listen(PORT, () => console.log('🚀 Tracker running on port ' + PORT));
