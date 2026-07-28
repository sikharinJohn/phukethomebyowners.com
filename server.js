require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const nodemailer = require('nodemailer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const ASSETS_DIR = path.join(__dirname, 'assets');

const ALLOWED_ORIGINS = [
  'https://phukethomebyowners.com',
  'https://www.phukethomebyowners.com',
  'http://localhost:3000',
  'http://127.0.0.1:3000'
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    callback(new Error('Not allowed by CORS'));
  }
}));

if (!fs.existsSync(ASSETS_DIR)) {
  fs.mkdirSync(ASSETS_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, ASSETS_DIR);
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const ext = path.extname(file.originalname).toLowerCase();
    const name = path.basename(file.originalname, ext)
      .replace(/[^a-zA-Z0-9-_]/g, '-')
      .replace(/-+/g, '-');
    cb(null, `${timestamp}-${name}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024
  },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files are allowed'), false);
    }
    cb(null, true);
  }
});

app.use(express.static(__dirname));
app.use(express.json());

const uploadViewingFiles = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Only images allowed'), false);
    cb(null, true);
  }
});

const GMAIL_USER = process.env.GMAIL_USER || 'sikharin.wandee@gmail.com';
const GMAIL_PASS = process.env.GMAIL_PASS || '';

// Simple in-memory rate limiter: max 5 submissions per IP per hour
const rateLimitMap = new Map();
function rateLimit(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  const windowMs = 60 * 60 * 1000;
  const max = 5;
  const entry = rateLimitMap.get(ip) || { count: 0, start: now };
  if (now - entry.start > windowMs) { entry.count = 0; entry.start = now; }
  entry.count++;
  rateLimitMap.set(ip, entry);
  if (entry.count > max) return res.status(429).json({ ok: false, error: 'Too many requests. Please try again later.' });
  next();
}

app.post('/api/submit-viewing', rateLimit, uploadViewingFiles.fields([
  { name: 'petPhoto1', maxCount: 1 },
  { name: 'petPhoto2', maxCount: 1 }
]), async (req, res) => {
  const f = req.body;
  // Honeypot: bots fill hidden field, humans leave it empty
  if (f.website) return res.status(400).json({ ok: false, error: 'Bot detected' });

  const rows = [
    ['ประเภท', f.contactType === 'agent' ? 'Agent' : 'Customer'],
    ['ชื่อ', f.fullName],
    ['เบอร์โทร', f.phone],
    ['Email', f.email || '-'],
    ['LINE / WhatsApp', f.contactAlt || '-'],
    ['จำนวนผู้อยู่อาศัย', f.residentCount],
    ['วันที่ต้องการดู', `${f.viewingDate || '-'} เวลา ${f.viewingTime || '-'}`],
    ['วันที่ต้องการเข้าอยู่', f.moveInDate || '-'],
    ['สัตว์เลี้ยง', f.hasPets === 'yes' ? `ใช่ — ${f.petType || ''} จำนวน ${f.petCount || '?'} ตัว` : 'ไม่มี'],
    ['หมายเหตุ', f.notes || '-'],
  ];

  const residents = [];
  for (let i = 0; i < parseInt(f.residentCount) || 0; i++) {
    const age = f[`resident_age_${i}`];
    const nat = f[`resident_nationality_${i}`];
    if (age || nat) residents.push(`Person ${i+1}: อายุ ${age || '?'}, สัญชาติ ${nat || '?'}`);
  }

  const tableRows = rows.map(([k, v]) =>
    `<tr><td style="padding:8px 12px;font-weight:600;color:#003c8f;white-space:nowrap">${k}</td><td style="padding:8px 12px;color:#1a2340">${v}</td></tr>`
  ).join('');

  const residentsHtml = residents.length
    ? `<h3 style="margin:20px 0 8px;color:#003c8f">ผู้อยู่อาศัย</h3><ul style="padding-left:20px;color:#1a2340">${residents.map(r => `<li>${r}</li>`).join('')}</ul>`
    : '';

  const html = `
    <div style="font-family:Poppins,sans-serif;max-width:600px;margin:0 auto">
      <div style="background:linear-gradient(90deg,#003c8f,#0056d6);padding:28px 32px;border-radius:12px 12px 0 0">
        <h2 style="color:white;margin:0;font-size:20px">🏠 Viewing Request — Supalai Bella Thalang</h2>
      </div>
      <div style="background:#f6f8fc;padding:28px 32px;border-radius:0 0 12px 12px">
        <table style="width:100%;border-collapse:collapse;background:white;border-radius:10px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.06)">
          ${tableRows}
        </table>
        ${residentsHtml}
        <div style="margin-top:24px;background:#e8f0fe;border-left:4px solid #003c8f;padding:16px 20px;border-radius:0 8px 8px 0">
          <p style="margin:0 0 6px;font-weight:700;color:#003c8f;font-size:14px">📋 ขั้นตอนถัดไป</p>
          <p style="margin:0;font-size:13px;color:#1a2340">กรุณาติดต่อกลับเพื่อ <strong>Confirm นัดหมาย</strong> หรือ <strong>นัดวันและเวลาอื่น</strong> ที่สะดวกกว่า</p>
          <p style="margin:8px 0 0;font-size:13px;color:#1a2340">
            ${f.email ? `📧 Email: <strong>${f.email}</strong><br>` : ''}
            ${f.contactAlt ? `💬 LINE/WhatsApp: <strong>${f.contactAlt}</strong><br>` : ''}
            📞 โทร: <strong>${f.phone}</strong>
          </p>
        </div>
      </div>
    </div>`;

  const attachments = [];
  if (req.files?.petPhoto1?.[0]) {
    const file = req.files.petPhoto1[0];
    attachments.push({ filename: file.originalname, content: file.buffer, contentType: file.mimetype });
  }
  if (req.files?.petPhoto2?.[0]) {
    const file = req.files.petPhoto2[0];
    attachments.push({ filename: file.originalname, content: file.buffer, contentType: file.mimetype });
  }

  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: GMAIL_USER, pass: GMAIL_PASS }
    });
    await transporter.sendMail({
      from: `"Phuket Home" <${GMAIL_USER}>`,
      to: 'sikharin.wandee@gmail.com',
      replyTo: f.email || undefined,
      subject: `[Viewing] ${f.fullName || 'ไม่ระบุชื่อ'} — ${f.viewingDate || 'ไม่ระบุวัน'} — Supalai Bella Thalang`,
      html,
      attachments
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('Mail error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  const filePath = `assets/${req.file.filename}`;
  res.json({ filePath });
});

app.use((err, req, res, next) => {
  if (err) {
    return res.status(400).json({ error: err.message || 'Upload failed' });
  }
  next();
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
