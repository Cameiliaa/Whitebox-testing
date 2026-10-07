import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import express from 'express';
import { createEmailSender, escapeEmailHtml } from './email.mjs';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const databases = new Map();

export function getTournamentDatabase(root = process.cwd(), databasePath) {
  const file = databasePath ?? resolve(root, 'server/data/tournaments.sqlite');
  if (databases.has(file)) return databases.get(file);
  mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS tournaments (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      event_date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      location TEXT NOT NULL,
      fee INTEGER NOT NULL DEFAULT 0,
      min_payment INTEGER NOT NULL DEFAULT 0,
      discount_label TEXT NOT NULL DEFAULT '',
      discount_type TEXT NOT NULL DEFAULT 'amount',
      discount_value INTEGER NOT NULL DEFAULT 0,
      discount_start TEXT NOT NULL DEFAULT '',
      discount_end TEXT NOT NULL DEFAULT '',
      registration_deadline TEXT NOT NULL,
      terms_json TEXT NOT NULL DEFAULT '[]',
      extra_info TEXT NOT NULL DEFAULT '',
      categories_json TEXT NOT NULL DEFAULT '[]',
      extra_fields_json TEXT NOT NULL DEFAULT '[]',
      requires_payment_proof INTEGER NOT NULL DEFAULT 0,
      registration_open INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1,
      poster BLOB,
      poster_type TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tournament_registrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
      full_name TEXT NOT NULL,
      whatsapp TEXT NOT NULL,
      email TEXT NOT NULL,
      category TEXT NOT NULL,
      teammates_json TEXT NOT NULL DEFAULT '[]',
      extra_data_json TEXT NOT NULL DEFAULT '{}',
      proof BLOB,
      proof_type TEXT,
      payment_status TEXT NOT NULL DEFAULT 'Menunggu Pembayaran',
      registration_status TEXT NOT NULL DEFAULT 'Menunggu Konfirmasi',
      payable_amount INTEGER NOT NULL DEFAULT 0,
      amount_paid INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS tournament_registrations_event
      ON tournament_registrations(tournament_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS customer_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      whatsapp TEXT NOT NULL,
      email TEXT NOT NULL COLLATE NOCASE UNIQUE,
      password_hash TEXT NOT NULL,
      email_verified_at TEXT,
      verify_token_hash TEXT,
      verify_expires_at INTEGER,
      reset_token_hash TEXT,
      reset_expires_at INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS customer_sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES customer_users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS customer_sessions_expiry ON customer_sessions(expires_at);
    CREATE TABLE IF NOT EXISTS court_bookings (
      id TEXT PRIMARY KEY,
      user_id INTEGER REFERENCES customer_users(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      email TEXT NOT NULL,
      details TEXT NOT NULL,
      court_slots_json TEXT NOT NULL DEFAULT '[]',
      addons_json TEXT NOT NULL DEFAULT '[]',
      total INTEGER NOT NULL,
      proof_file_name TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Menunggu Verifikasi',
      admin_note TEXT NOT NULL DEFAULT '',
      payment_method TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS court_bookings_user ON court_bookings(user_id, created_at DESC);
  `);
  if (!db.prepare('PRAGMA table_info(tournament_registrations)').all().some(column => column.name === 'user_id')) {
    db.exec('ALTER TABLE tournament_registrations ADD COLUMN user_id INTEGER REFERENCES customer_users(id) ON DELETE SET NULL');
  }
  if (!db.prepare('PRAGMA table_info(court_bookings)').all().some(column => column.name === 'payment_method')) {
    db.exec("ALTER TABLE court_bookings ADD COLUMN payment_method TEXT NOT NULL DEFAULT ''");
  }
  if (!db.prepare('PRAGMA table_info(tournament_registrations)').all().some(column => column.name === 'amount_paid')) {
    db.exec('ALTER TABLE tournament_registrations ADD COLUMN amount_paid INTEGER NOT NULL DEFAULT 0');
  }
  databases.set(file, db);
  return db;
}

export function closeTournamentDatabase(databasePath) {
  const file = databasePath ?? resolve(process.cwd(), 'server/data/tournaments.sqlite');
  const db = databases.get(file);
  if (db) {
    db.close();
    databases.delete(file);
  }
}

function parseJson(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function tournamentFromRow(row, includePoster = false) {
  const tournament = {
    id: row.id,
    name: row.name,
    description: row.description,
    eventDate: row.event_date,
    startTime: row.start_time,
    endTime: row.end_time,
    location: row.location,
    fee: row.fee,
    minPayment: row.min_payment,
    discountLabel: row.discount_label,
    discountType: row.discount_type,
    discountValue: row.discount_value,
    discountStart: row.discount_start,
    discountEnd: row.discount_end,
    registrationDeadline: row.registration_deadline,
    terms: parseJson(row.terms_json, []),
    extraInfo: row.extra_info,
    categories: parseJson(row.categories_json, []),
    extraFields: parseJson(row.extra_fields_json, []),
    requiresPaymentProof: !!row.requires_payment_proof,
    registrationOpen: !!row.registration_open,
    isActive: !!row.is_active,
    hasPoster: !!row.poster,
    posterUrl: row.poster ? `/api/tournaments/${encodeURIComponent(row.id)}/poster` : '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (includePoster && row.poster) {
    tournament.poster = `data:${row.poster_type};base64,${Buffer.from(row.poster).toString('base64')}`;
  }
  return tournament;
}

function publicTournament(row) {
  const tournament = tournamentFromRow(row);
  tournament.registrationOpen = tournament.registrationOpen &&
    new Date(`${tournament.registrationDeadline}:00+07:00`).getTime() >= Date.now();
  return tournament;
}

function rowById(db, id) {
  return db.prepare('SELECT * FROM tournaments WHERE id = ?').get(id);
}

function sendError(res, status, error) {
  return res.status(status).json({ error });
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function parseImage(value, required = false) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new Error('Poster turnamen wajib diunggah.');
    return null;
  }
  if (typeof value !== 'string') throw new Error('Format gambar tidak valid.');
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || !IMAGE_TYPES.has(match[1])) throw new Error('Gunakan poster JPG, PNG, atau WebP.');
  const data = Buffer.from(match[2], 'base64');
  if (data.length === 0 || data.length > MAX_IMAGE_BYTES || data.toString('base64') !== match[2]) {
    throw new Error('Gambar tidak valid atau ukurannya melebihi 5 MB.');
  }
  return { data, type: match[1] };
}

function parseTournament(input, existing = null) {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const description = typeof input.description === 'string' ? input.description.trim() : '';
  const location = typeof input.location === 'string' ? input.location.trim() : '';
  const eventDate = typeof input.eventDate === 'string' ? input.eventDate : '';
  const startTime = typeof input.startTime === 'string' ? input.startTime : '';
  const endTime = typeof input.endTime === 'string' ? input.endTime : '';
  const deadline = typeof input.registrationDeadline === 'string' ? input.registrationDeadline : '';
  const fee = Number(input.fee);
  const minPayment = Number(input.minPayment ?? 0);
  const discountValue = Number(input.discountValue ?? 0);
  const discountType = input.discountType === 'percent' ? 'percent' : 'amount';
  const categories = input.categories;
  const extraFields = input.extraFields ?? [];
  const terms = input.terms ?? [];
  if (!name || name.length > 120) throw new Error('Nama turnamen wajib diisi (maksimal 120 karakter).');
  if (!description || description.length > 10000) throw new Error('Deskripsi wajib diisi (maksimal 10.000 karakter).');
  if (!location || location.length > 300) throw new Error('Lokasi wajib diisi (maksimal 300 karakter).');
  if (!validDate(eventDate) ||
      !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(startTime) ||
      !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(endTime)) {
    throw new Error('Tanggal dan waktu turnamen tidak valid.');
  }
  if (startTime >= endTime) throw new Error('Waktu selesai harus setelah waktu mulai.');
  const [deadlineDate, deadlineTime] = deadline.split('T');
  if (!validDate(deadlineDate) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(deadlineTime ?? '')) {
    throw new Error('Batas pendaftaran tidak valid.');
  }
  if (!Number.isSafeInteger(fee) || fee < 0 || fee > 1000000000 ||
      !Number.isSafeInteger(minPayment) || minPayment < 0 || minPayment > fee) {
    throw new Error('Biaya dan minimal pembayaran tidak valid.');
  }
  if (!Number.isSafeInteger(discountValue) || discountValue < 0 ||
      (discountType === 'percent' && discountValue > 100) ||
      (discountType === 'amount' && discountValue > fee)) {
    throw new Error('Nilai diskon tidak valid.');
  }
  const discountStart = typeof input.discountStart === 'string' ? input.discountStart : '';
  const discountEnd = typeof input.discountEnd === 'string' ? input.discountEnd : '';
  if ((discountStart && !validDate(discountStart)) ||
      (discountEnd && !validDate(discountEnd)) ||
      (discountStart && discountEnd && discountStart > discountEnd)) {
    throw new Error('Periode diskon tidak valid.');
  }
  if (!Array.isArray(categories) || categories.length < 1 || categories.length > 30 ||
      categories.some(category => !category || typeof category.name !== 'string' ||
        !category.name.trim() || category.name.length > 80 ||
        !Number.isInteger(category.teamSize) || category.teamSize < 1 || category.teamSize > 8)) {
    throw new Error('Tambahkan minimal satu kategori dengan jumlah peserta 1–8 orang.');
  }
  if (new Set(categories.map(category => category.name.trim().toLowerCase())).size !== categories.length) {
    throw new Error('Nama kategori tidak boleh duplikat.');
  }
  if (!Array.isArray(terms) || terms.length > 50 ||
      terms.some(term => typeof term !== 'string' || !term.trim() || term.length > 500)) {
    throw new Error('Syarat dan ketentuan tidak valid.');
  }
  if (!Array.isArray(extraFields) || extraFields.length > 20 ||
      extraFields.some(field => !field || typeof field.label !== 'string' ||
        !field.label.trim() || field.label.length > 80)) {
    throw new Error('Field tambahan tidak valid.');
  }
  if (new Set(extraFields.map(field => field.label.trim().toLowerCase())).size !== extraFields.length) {
    throw new Error('Nama field tambahan tidak boleh duplikat.');
  }
  const poster = parseImage(input.poster, !existing);
  const bool = (value, fallback) => value === undefined ? fallback : value === true;
  return {
    id: existing?.id ?? `tournament-${randomBytes(12).toString('hex')}`,
    name, description, eventDate, startTime, endTime, location, fee, minPayment,
    discountLabel: typeof input.discountLabel === 'string' ? input.discountLabel.trim().slice(0, 120) : '',
    discountType,
    discountValue,
    discountStart,
    discountEnd,
    registrationDeadline: deadline,
    terms: terms.map(term => term.trim()),
    extraInfo: typeof input.extraInfo === 'string' ? input.extraInfo.trim().slice(0, 3000) : '',
    categories: categories.map(category => ({ name: category.name.trim(), teamSize: category.teamSize })),
    extraFields: extraFields.map(field => ({ label: field.label.trim(), required: field.required === true })),
    requiresPaymentProof: bool(input.requiresPaymentProof, false),
    registrationOpen: bool(input.registrationOpen, true),
    isActive: bool(input.isActive, true),
    poster: poster ?? (existing?.poster ? parseImage(existing.poster) : null),
  };
}

function saveTournament(db, tournament, existing, now = new Date().toISOString()) {
  const values = [
    tournament.name, tournament.description, tournament.eventDate, tournament.startTime,
    tournament.endTime, tournament.location, tournament.fee, tournament.minPayment,
    tournament.discountLabel, tournament.discountType, tournament.discountValue,
    tournament.discountStart, tournament.discountEnd, tournament.registrationDeadline,
    JSON.stringify(tournament.terms), tournament.extraInfo, JSON.stringify(tournament.categories),
    JSON.stringify(tournament.extraFields), Number(tournament.requiresPaymentProof),
    Number(tournament.registrationOpen), Number(tournament.isActive), tournament.poster?.data ?? null,
    tournament.poster?.type ?? null, now, tournament.id,
  ];
  if (existing) {
    db.prepare(`UPDATE tournaments SET
      name=?, description=?, event_date=?, start_time=?, end_time=?, location=?, fee=?, min_payment=?,
      discount_label=?, discount_type=?, discount_value=?, discount_start=?, discount_end=?,
      registration_deadline=?, terms_json=?, extra_info=?, categories_json=?, extra_fields_json=?,
      requires_payment_proof=?, registration_open=?, is_active=?,
      poster=COALESCE(?, poster), poster_type=COALESCE(?, poster_type), updated_at=?
      WHERE id=?`).run(...values);
  } else {
    db.prepare(`INSERT INTO tournaments (
      name, description, event_date, start_time, end_time, location, fee, min_payment,
      discount_label, discount_type, discount_value, discount_start, discount_end,
      registration_deadline, terms_json, extra_info, categories_json, extra_fields_json,
      requires_payment_proof, registration_open, is_active, poster, poster_type, created_at, updated_at, id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(...values.slice(0, 23), now, now, tournament.id);
  }
  return rowById(db, tournament.id);
}

function currentDiscount(tournament, now = new Date()) {
  if (!tournament.discountValue || !tournament.discountLabel) return 0;
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(now);
  if (tournament.discountStart && date < tournament.discountStart) return 0;
  if (tournament.discountEnd && date > tournament.discountEnd) return 0;
  const discount = tournament.discountType === 'percent'
    ? Math.floor(tournament.fee * tournament.discountValue / 100)
    : tournament.discountValue;
  return Math.min(discount, Math.max(0, tournament.fee - tournament.minPayment));
}

function parseRegistration(input, tournament) {
  const name = typeof input.fullName === 'string' ? input.fullName.trim() : '';
  const whatsapp = typeof input.whatsapp === 'string' ? input.whatsapp.trim() : '';
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  const categoryName = typeof input.category === 'string' ? input.category : '';
  const category = tournament.categories.find(item => item.name === categoryName);
  const teammates = input.teammates;
  const extraData = input.extraData ?? {};
  if (!name || name.length > 120) throw new Error('Nama lengkap wajib diisi (maksimal 120 karakter).');
  if (!/^\+?[0-9\s()-]{8,20}$/.test(whatsapp)) throw new Error('Nomor WhatsApp tidak valid.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Error('Alamat email tidak valid.');
  if (!category) throw new Error('Pilih kategori pertandingan yang tersedia.');
  if (!Array.isArray(teammates) || teammates.length !== category.teamSize - 1 ||
      teammates.some(person => typeof person !== 'string' || !person.trim() || person.length > 120)) {
    throw new Error(`Kategori ${category.name} memerlukan ${category.teamSize} peserta termasuk pendaftar.`);
  }
  if (!extraData || typeof extraData !== 'object' || Array.isArray(extraData)) {
    throw new Error('Data tambahan tidak valid.');
  }
  if (Object.keys(extraData).some(key => !tournament.extraFields.some(field => field.label === key))) {
    throw new Error('Data tambahan tidak sesuai dengan formulir turnamen.');
  }
  for (const field of tournament.extraFields) {
    const value = extraData[field.label];
    if (field.required && (typeof value !== 'string' || !value.trim())) {
      throw new Error(`Field ${field.label} wajib diisi.`);
    }
    if (value !== undefined && (typeof value !== 'string' || value.length > 500)) {
      throw new Error(`Field ${field.label} tidak valid.`);
    }
  }
  const discount = currentDiscount(tournament);
  const payableAmount = Math.max(0, tournament.fee - discount);
  const proof = parseImage(input.paymentProof, tournament.requiresPaymentProof && payableAmount > 0);
  const amountPaid = proof ? Number(input.paymentAmount ?? payableAmount) : 0;
  if (proof && (!Number.isSafeInteger(amountPaid) || amountPaid < tournament.minPayment || amountPaid > payableAmount)) {
    throw new Error(`Jumlah pembayaran harus antara ${tournament.minPayment} dan ${payableAmount}.`);
  }
  return {
    name, whatsapp, email, category: category.name,
    teammates: teammates.map(person => person.trim()),
    extraData,
    proof,
    payableAmount,
    amountPaid,
  };
}

function registrationFromRow(row) {
  return {
    id: row.id,
    code: row.code,
    tournamentId: row.tournament_id,
    tournamentName: row.tournament_name,
    fullName: row.full_name,
    whatsapp: row.whatsapp,
    email: row.email,
    category: row.category,
    teammates: parseJson(row.teammates_json, []),
    extraData: parseJson(row.extra_data_json, {}),
    hasProof: !!row.proof,
    proofUrl: row.proof ? `/api/admin/tournament-registrations/${row.id}/proof` : '',
    paymentStatus: row.payment_status,
    registrationStatus: row.registration_status,
    payableAmount: row.payable_amount,
    amountPaid: row.amount_paid,
    createdAt: row.created_at,
  };
}

function adminOnly(isAdmin, handler) {
  return (req, res, next) => {
    if (!isAdmin(req)) return sendError(res, 401, 'Silakan login sebagai admin.');
    try { return handler(req, res, next); } catch (error) {
      console.error('Gagal memproses permintaan turnamen:', error);
      return sendError(res, 500, 'Terjadi kesalahan server. Silakan coba lagi.');
    }
  };
}

export function createPublicTournamentApi({ root = process.cwd(), databasePath, getUser = () => null } = {}) {
  const router = express();
  router.disable('x-powered-by');
  const db = getTournamentDatabase(root, databasePath);
  router.use(express.json({ limit: '8mb' }));

  router.get('/', (req, res) => {
    const events = db.prepare('SELECT * FROM tournaments WHERE is_active=1 ORDER BY event_date, start_time')
      .all().map(publicTournament);
    return res.json({ tournaments: events });
  });

  router.get('/registrations/:code', (req, res) => {
    const row = db.prepare(`SELECT r.code, r.category, r.payment_status, r.registration_status,
        r.created_at, t.name AS tournament_name
      FROM tournament_registrations r JOIN tournaments t ON t.id=r.tournament_id
      WHERE r.code=?`).get(req.params.code.toUpperCase());
    if (!row) return sendError(res, 404, 'Pendaftaran tidak ditemukan. Periksa kode pendaftaran Anda.');
    return res.json({
      code: row.code,
      tournamentName: row.tournament_name,
      category: row.category,
      paymentStatus: row.payment_status,
      registrationStatus: row.registration_status,
      createdAt: row.created_at,
    });
  });

  router.get('/:id/poster', (req, res) => {
    const row = db.prepare('SELECT poster, poster_type FROM tournaments WHERE id=? AND is_active=1').get(req.params.id);
    if (!row?.poster) return sendError(res, 404, 'Poster tidak ditemukan.');
    res.setHeader('Content-Type', row.poster_type);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.send(Buffer.from(row.poster));
  });

  router.get('/:id', (req, res) => {
    const row = db.prepare('SELECT * FROM tournaments WHERE id=? AND is_active=1').get(req.params.id);
    if (!row) return sendError(res, 404, 'Turnamen tidak ditemukan.');
    return res.json({ tournament: publicTournament(row) });
  });

  router.post('/:id/registrations', (req, res) => {
    const user = getUser(req);
    if (!user) return sendError(res, 401, 'Login akun peserta diperlukan untuk mendaftar turnamen.');
    const row = rowById(db, req.params.id);
    if (!row || !row.is_active) return sendError(res, 404, 'Turnamen tidak ditemukan.');
    const tournament = tournamentFromRow(row);
    if (!tournament.registrationOpen) return sendError(res, 409, 'Pendaftaran turnamen sedang ditutup.');
    if (new Date(`${tournament.registrationDeadline}:00+07:00`).getTime() < Date.now()) {
      return sendError(res, 409, 'Batas pendaftaran turnamen telah berakhir.');
    }
    try {
      const registrant = parseRegistration(req.body ?? {}, tournament);
      const code = randomBytes(12).toString('hex').toUpperCase();
      const createdAt = new Date().toISOString();
      db.prepare(`INSERT INTO tournament_registrations (
        code, tournament_id, user_id, full_name, whatsapp, email, category, teammates_json, extra_data_json,
        proof, proof_type, payment_status, registration_status, payable_amount, amount_paid, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        code, tournament.id, user.id, registrant.name, registrant.whatsapp, registrant.email,
        registrant.category, JSON.stringify(registrant.teammates), JSON.stringify(registrant.extraData),
        registrant.proof?.data ?? null, registrant.proof?.type ?? null,
        registrant.proof ? 'Menunggu Verifikasi' : registrant.payableAmount ? 'Menunggu Pembayaran' : 'Tidak Diperlukan',
        'Menunggu Konfirmasi', registrant.payableAmount, registrant.amountPaid, createdAt,
      );
      return res.status(201).json({
        success: true, code, registrationStatus: 'Menunggu Konfirmasi',
        paymentStatus: registrant.proof ? 'Menunggu Verifikasi' : registrant.payableAmount ? 'Menunggu Pembayaran' : 'Tidak Diperlukan',
      });
    } catch (error) {
      return sendError(res, 400, error.message);
    }
  });

  router.use((error, req, res, next) => {
    console.error('Gagal memproses permintaan turnamen:', error);
    return sendError(res, 400, 'Permintaan tidak valid atau terlalu besar.');
  });

  return router;
}

export function createAdminTournamentApi({ root = process.cwd(), databasePath, isAdmin, deliverEmail = createEmailSender() } = {}) {
  const router = express.Router();
  const db = getTournamentDatabase(root, databasePath);

  router.get('/tournaments', adminOnly(isAdmin, (req, res) => {
    const events = db.prepare('SELECT * FROM tournaments ORDER BY created_at DESC').all()
      .map(row => tournamentFromRow(row));
    return res.json({ tournaments: events });
  }));

  router.get('/tournaments/:id/poster', adminOnly(isAdmin, (req, res) => {
    const row = db.prepare('SELECT poster, poster_type FROM tournaments WHERE id=?').get(req.params.id);
    if (!row?.poster) return sendError(res, 404, 'Poster tidak ditemukan.');
    res.setHeader('Content-Type', row.poster_type);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.send(Buffer.from(row.poster));
  }));

  router.post('/tournaments', adminOnly(isAdmin, (req, res) => {
    try {
      const tournament = parseTournament(req.body ?? {});
      const row = saveTournament(db, tournament);
      return res.status(201).json({ tournament: tournamentFromRow(row) });
    } catch (error) {
      return sendError(res, 400, error.message);
    }
  }));

  router.put('/tournaments/:id', adminOnly(isAdmin, (req, res) => {
    const existing = rowById(db, req.params.id);
    if (!existing) return sendError(res, 404, 'Turnamen tidak ditemukan.');
    try {
      const tournament = parseTournament(req.body ?? {}, tournamentFromRow(existing, true));
      const row = saveTournament(db, tournament, existing);
      return res.json({ tournament: tournamentFromRow(row) });
    } catch (error) {
      return sendError(res, 400, error.message);
    }
  }));

  router.delete('/tournaments/:id', adminOnly(isAdmin, (req, res) => {
    const count = db.prepare('SELECT COUNT(*) AS total FROM tournament_registrations WHERE tournament_id=?')
      .get(req.params.id).total;
    if (count) return sendError(res, 409, 'Turnamen sudah memiliki pendaftar. Nonaktifkan turnamen agar data peserta tetap tersimpan.');
    const result = db.prepare('DELETE FROM tournaments WHERE id=?').run(req.params.id);
    if (!result.changes) return sendError(res, 404, 'Turnamen tidak ditemukan.');
    return res.json({ success: true });
  }));

  router.get('/tournament-registrations', adminOnly(isAdmin, (req, res) => {
    const rows = db.prepare(`SELECT r.*, t.name AS tournament_name
      FROM tournament_registrations r JOIN tournaments t ON t.id=r.tournament_id
      ORDER BY r.created_at DESC`).all().map(registrationFromRow);
    return res.json({ registrations: rows });
  }));

  router.get('/tournament-registrations/:id', adminOnly(isAdmin, (req, res) => {
    const row = db.prepare(`SELECT r.*, t.name AS tournament_name
      FROM tournament_registrations r JOIN tournaments t ON t.id=r.tournament_id
      WHERE r.id=?`).get(req.params.id);
    if (!row) return sendError(res, 404, 'Data pendaftar tidak ditemukan.');
    return res.json({ registration: registrationFromRow(row) });
  }));

  router.get('/tournament-registrations/:id/proof', adminOnly(isAdmin, (req, res) => {
    const row = db.prepare('SELECT proof, proof_type FROM tournament_registrations WHERE id=?')
      .get(req.params.id);
    if (!row?.proof) return sendError(res, 404, 'Bukti pembayaran tidak ditemukan.');
    res.setHeader('Content-Type', row.proof_type);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.send(Buffer.from(row.proof));
  }));

  router.patch('/tournament-registrations/:id/status', adminOnly(isAdmin, async (req, res) => {
    const { paymentStatus, registrationStatus } = req.body ?? {};
    const paymentStatuses = ['Menunggu Pembayaran', 'Menunggu Verifikasi', 'Lunas', 'Ditolak', 'Tidak Diperlukan'];
    const registrationStatuses = ['Menunggu Konfirmasi', 'Diterima', 'Ditolak'];
    if (!paymentStatuses.includes(paymentStatus) || !registrationStatuses.includes(registrationStatus)) {
      return sendError(res, 400, 'Status pembayaran atau pendaftaran tidak valid.');
    }
    const current = db.prepare(`SELECT r.*, t.name AS tournament_name, t.event_date, t.start_time, t.end_time,
        t.location, t.fee, t.min_payment, t.extra_info
      FROM tournament_registrations r JOIN tournaments t ON t.id=r.tournament_id WHERE r.id=?`)
      .get(req.params.id);
    if (!current) return sendError(res, 404, 'Data pendaftar tidak ditemukan.');
    db.prepare(`UPDATE tournament_registrations SET payment_status=?, registration_status=? WHERE id=?`)
      .run(paymentStatus, registrationStatus, req.params.id);
    const acceptedStatuses = new Set(['Diterima']);
    const rejectedStatuses = new Set(['Ditolak']);
    const needsNotice = registrationStatus !== current.registration_status &&
      (acceptedStatuses.has(registrationStatus) || rejectedStatuses.has(registrationStatus));
    if (!needsNotice) return res.json({ success: true, emailSent: false });

    const accepted = registrationStatus === 'Diterima';
    const date = new Intl.DateTimeFormat('id-ID', { dateStyle: 'long', timeZone: 'Asia/Jakarta' })
      .format(new Date(`${current.event_date}T00:00:00+07:00`));
    const schedule = `${date}, pukul ${current.start_time}–${current.end_time} WIB`;
    const details = accepted
      ? `Jadwal: ${schedule}\nLokasi: ${current.location}\nKategori: ${current.category}\nKode pendaftaran: ${current.code}\nStatus pembayaran: ${paymentStatus}\nBiaya pendaftaran: Rp${Number(current.payable_amount || current.fee).toLocaleString('id-ID')}${current.extra_info ? `\nInformasi tambahan: ${current.extra_info}` : ''}`
      : `Turnamen: ${current.tournament_name}\nKategori: ${current.category}\nKode pendaftaran: ${current.code}\nJadwal: ${schedule}`;
    const subject = accepted
      ? `Pendaftaran turnamen diterima: ${current.tournament_name}`
      : `Pembaruan pendaftaran turnamen: ${current.tournament_name}`;
    const text = `Halo ${current.full_name},\n\n${accepted
      ? 'Selamat, pendaftaran turnamen Anda telah diterima.'
      : 'Mohon maaf, pendaftaran turnamen Anda belum dapat diterima.'}\n\n${details}\n\nSimpan email ini sebagai informasi pendaftaran.`;
    const htmlDetails = details.split('\n')
      .map(line => `<p style="margin:6px 0">${escapeEmailHtml(line)}</p>`).join('');
    const html = `<div style="font-family:Arial,sans-serif;color:#0f172a;line-height:1.5"><h2>${accepted ? 'Pendaftaran diterima' : 'Pembaruan pendaftaran'}</h2><p>Halo ${escapeEmailHtml(current.full_name)},</p><p>${accepted
      ? 'Selamat, pendaftaran turnamen Anda telah diterima.'
      : 'Mohon maaf, pendaftaran turnamen Anda belum dapat diterima.'}</p><h3>${escapeEmailHtml(current.tournament_name)}</h3>${htmlDetails}<p>Simpan email ini sebagai informasi pendaftaran.</p></div>`;
    try {
      await deliverEmail({ to: current.email, subject, text, html });
      return res.json({ success: true, emailSent: true });
    } catch (error) {
      console.error('Status pendaftaran turnamen tersimpan, tetapi email peserta gagal dikirim:', error.message);
      return res.json({ success: true, emailSent: false, notificationError: 'Status tersimpan, tetapi email pemberitahuan gagal dikirim.' });
    }
  }));

  router.use((error, req, res, next) => {
    console.error('Gagal memproses permintaan admin turnamen:', error);
    return sendError(res, 400, 'Permintaan tidak valid atau terlalu besar.');
  });

  return router;
}
