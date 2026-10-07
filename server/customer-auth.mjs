import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import express from 'express';
import { createEmailSender, escapeEmailHtml } from './email.mjs';
import { getTournamentDatabase } from './tournaments.mjs';

const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;
const VERIFY_TTL = 30 * 60 * 1000;
const RESET_TTL = 15 * 60 * 1000;

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

function passwordHash(password) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [salt, digest] = stored.split(':');
  return timingSafeEqual(scryptSync(password, salt, 64), Buffer.from(digest, 'hex'));
}

function publicUser(row) {
  return {
    id: row.id,
    fullName: row.full_name,
    whatsapp: row.whatsapp,
    email: row.email,
    emailVerified: !!row.email_verified_at
  };
}

function sendError(res, status, error) {
  return res.status(status).json({ error });
}

export function createCustomerApi({ root = process.cwd(), databasePath, env = process.env, now = Date.now, sendMail } = {}) {
  const router = express.Router();
  const db = getTournamentDatabase(root, databasePath);
  const attempts = new Map();
  const deliver = createEmailSender({ env, sendMail });

  function publicBaseUrl() {
    const url = new URL(env.APP_PUBLIC_URL || 'http://localhost:3000');
    const isLocalhost = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    const octets = url.hostname.split('.').map(Number);
    const isPrivateIpv4 = octets.length === 4 && octets.every(octet => Number.isInteger(octet) && octet >= 0 && octet <= 255) &&
      (octets[0] === 10 || octets[0] === 192 && octets[1] === 168 ||
        octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31);
    if (!['http:', 'https:'].includes(url.protocol) ||
      (url.protocol !== 'https:' && (env.NODE_ENV === 'production' || !isLocalhost && !isPrivateIpv4))) {
      throw new Error('APP_PUBLIC_URL harus memakai HTTPS, kecuali localhost atau IP privat untuk pengujian lokal.');
    }
    return url.href;
  }

  router.use(express.json({ limit: '8mb' }));
  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method !== 'GET' && (req.headers['sec-fetch-site'] === 'cross-site' ||
      (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host))) {
      return sendError(res, 403, 'Permintaan tidak diizinkan.');
    }
    next();
  });

  function getUser(req) {
    const token = /(?:^|;\s*)bh_customer=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie ?? '')?.[1];
    if (!token) return null;
    const session = db.prepare(`SELECT u.* FROM customer_sessions s JOIN customer_users u ON u.id=s.user_id
      WHERE s.token_hash=? AND s.expires_at>? AND u.email_verified_at IS NOT NULL`).get(hash(token), now());
    return session ?? null;
  }

  function requireUser(req, res, next) {
    const user = getUser(req);
    if (!user) return sendError(res, 401, 'Silakan login ke akun peserta terlebih dahulu.');
    req.customer = user;
    next();
  }

  function checkThrottle(key) {
    for (const [attemptKey, attempt] of attempts) {
      if (attempt.until <= now()) attempts.delete(attemptKey);
    }
    const current = attempts.get(key);
    if (!current || current.until <= now()) {
      attempts.set(key, { count: 1, until: now() + 15 * 60 * 1000 });
      return false;
    }
    current.count++;
    return current.count > 5;
  }
  const requestKey = req => req.ip ?? req.socket.remoteAddress ?? 'unknown';

  router.get('/session', (req, res) => {
    const user = getUser(req);
    return res.json({ authenticated: !!user, user: user ? publicUser(user) : null });
  });

  router.post('/register', async (req, res) => {
    const { fullName, whatsapp, email, password } = req.body ?? {};
    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    if (typeof fullName !== 'string' || fullName.trim().length < 2 || fullName.trim().length > 120 ||
      typeof whatsapp !== 'string' || !/^[+]?[0-9 ()-]{8,20}$/.test(whatsapp.trim()) ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) || normalizedEmail.length > 254 ||
      typeof password !== 'string' || password.length < 12 || password.length > 256) {
      return sendError(res, 400, 'Isi nama, WhatsApp, email yang valid, dan password minimal 12 karakter.');
    }
    if (checkThrottle(`register:${requestKey(req)}`)) return sendError(res, 429, 'Terlalu banyak percobaan. Coba lagi dalam 15 menit.');
    const registrationMessage = 'Jika email dapat digunakan, instruksi verifikasi akan dikirim.';
    if (db.prepare('SELECT id FROM customer_users WHERE email=?').get(normalizedEmail)) {
      return res.status(202).json({ success: true, message: registrationMessage });
    }
    const token = randomBytes(32).toString('hex');
    const createdAt = new Date(now()).toISOString();
    let result;
    try {
      result = db.prepare(`INSERT INTO customer_users (
        full_name, whatsapp, email, password_hash, verify_token_hash, verify_expires_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
        fullName.trim(), whatsapp.trim(), normalizedEmail, passwordHash(password),
        hash(token), now() + VERIFY_TTL, createdAt, createdAt
      );
      const link = new URL('/', publicBaseUrl());
      link.searchParams.set('verifyEmail', token);
      await deliver({
        to: normalizedEmail,
        subject: 'Verifikasi akun Badminton Hub',
        text: `Verifikasi email Anda melalui tautan berikut (berlaku 30 menit): ${link.href}`,
        html: `<p>Verifikasi email Anda untuk mengaktifkan akun Badminton Hub.</p><p><a href="${link.href}">Verifikasi email</a></p><p>Tautan berlaku 30 menit.</p>`
      });
      return res.status(202).json({ success: true, message: registrationMessage });
    } catch (error) {
      if (result?.lastInsertRowid) db.prepare('DELETE FROM customer_users WHERE id=? AND email_verified_at IS NULL').run(result.lastInsertRowid);
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(202).json({ success: true, message: registrationMessage });
      console.error('Gagal mengirim verifikasi akun peserta:', error.message);
      return sendError(res, 503, 'Akun belum dapat dibuat karena email verifikasi tidak terkirim. Periksa konfigurasi email server.');
    }
  });

  router.post('/verify-email', (req, res) => {
    const token = req.body?.token;
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return sendError(res, 400, 'Tautan verifikasi tidak valid atau sudah kedaluwarsa.');
    const result = db.prepare(`UPDATE customer_users SET email_verified_at=?, verify_token_hash=NULL,
      verify_expires_at=NULL, updated_at=? WHERE verify_token_hash=? AND verify_expires_at>? AND email_verified_at IS NULL`)
      .run(new Date(now()).toISOString(), new Date(now()).toISOString(), hash(token), now());
    if (!result.changes) return sendError(res, 400, 'Tautan verifikasi tidak valid atau sudah kedaluwarsa.');
    return res.json({ success: true, message: 'Email berhasil diverifikasi. Silakan login.' });
  });

  router.post('/login', (req, res) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = req.body?.password;
    if (checkThrottle(`login:${requestKey(req)}`)) return sendError(res, 429, 'Terlalu banyak percobaan. Coba lagi dalam 15 menit.');
    if (!email || typeof password !== 'string' || password.length > 256) return sendError(res, 400, 'Isi email dan password dengan benar.');
    const user = db.prepare('SELECT * FROM customer_users WHERE email=?').get(email);
    if (!user || !verifyPassword(password, user.password_hash)) return sendError(res, 401, 'Email atau password salah.');
    if (!user.email_verified_at) return sendError(res, 403, 'Verifikasi email Anda terlebih dahulu sebelum login.');
    const oldToken = /(?:^|;\s*)bh_customer=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie ?? '')?.[1];
    if (oldToken) db.prepare('DELETE FROM customer_sessions WHERE token_hash=?').run(hash(oldToken));
    const token = randomBytes(32).toString('hex');
    db.prepare('INSERT INTO customer_sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
      .run(hash(token), user.id, now() + SESSION_TTL, new Date(now()).toISOString());
    res.setHeader('Set-Cookie', `bh_customer=${token}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${SESSION_TTL / 1000}${req.socket.encrypted || env.APP_COOKIE_SECURE === 'true' ? '; Secure' : ''}`);
    attempts.delete(`login:${requestKey(req)}`);
    return res.json({ authenticated: true, user: publicUser(user) });
  });

  router.post('/logout', (req, res) => {
    const token = /(?:^|;\s*)bh_customer=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie ?? '')?.[1];
    if (token) db.prepare('DELETE FROM customer_sessions WHERE token_hash=?').run(hash(token));
    res.setHeader('Set-Cookie', 'bh_customer=; HttpOnly; SameSite=Strict; Path=/api; Max-Age=0');
    return res.json({ authenticated: false });
  });

  router.post('/password/forgot', async (req, res) => {
    const generic = { success: true, message: 'Jika email terdaftar, tautan reset akan dikirim.' };
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (checkThrottle(`forgot:${requestKey(req)}`)) return res.status(200).json(generic);
    const user = db.prepare('SELECT id, email FROM customer_users WHERE email=? AND email_verified_at IS NOT NULL').get(email);
    if (user) {
      const token = randomBytes(32).toString('hex');
      db.prepare('UPDATE customer_users SET reset_token_hash=?, reset_expires_at=?, updated_at=? WHERE id=?')
        .run(hash(token), now() + RESET_TTL, new Date(now()).toISOString(), user.id);
      try {
        const link = new URL('/', publicBaseUrl());
        link.searchParams.set('resetPassword', token);
        await deliver({
          to: user.email,
          subject: 'Reset password Badminton Hub',
          text: `Gunakan tautan berikut untuk mengatur ulang password (berlaku 15 menit): ${link.href}`,
          html: `<p>Permintaan reset password akun Badminton Hub diterima.</p><p><a href="${link.href}">Atur ulang password</a></p><p>Tautan berlaku 15 menit. Abaikan email ini jika Anda tidak meminta reset.</p>`
        });
      } catch (error) {
        console.error('Gagal mengirim email reset password peserta:', error.message);
        db.prepare('UPDATE customer_users SET reset_token_hash=NULL, reset_expires_at=NULL WHERE id=?').run(user.id);
      }
    }
    return res.status(200).json(generic);
  });

  router.post('/password/reset', (req, res) => {
    const token = req.body?.token;
    const password = req.body?.password;
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token) ||
      typeof password !== 'string' || password.length < 12 || password.length > 256) {
      return sendError(res, 400, 'Tautan reset tidak valid atau password baru kurang dari 12 karakter.');
    }
    const user = db.prepare('SELECT id FROM customer_users WHERE reset_token_hash=? AND reset_expires_at>?')
      .get(hash(token), now());
    if (!user) return sendError(res, 400, 'Tautan reset tidak valid atau sudah kedaluwarsa.');
    const stamp = new Date(now()).toISOString();
    db.prepare(`UPDATE customer_users SET password_hash=?, reset_token_hash=NULL, reset_expires_at=NULL,
      updated_at=? WHERE id=?`).run(passwordHash(password), stamp, user.id);
    db.prepare('DELETE FROM customer_sessions WHERE user_id=?').run(user.id);
    return res.json({ success: true, message: 'Password berhasil diubah. Silakan login kembali.' });
  });

  router.get('/history', requireUser, (req, res) => {
    const registrations = db.prepare(`SELECT r.code, r.category, r.payment_status AS paymentStatus,
        r.registration_status AS registrationStatus, r.created_at AS createdAt,
        t.name AS tournamentName, t.event_date AS eventDate
      FROM tournament_registrations r JOIN tournaments t ON t.id=r.tournament_id
      WHERE r.user_id=? ORDER BY r.created_at DESC`).all(req.customer.id);
    const bookings = db.prepare(`SELECT id, name, phone, email, details,
        court_slots_json AS courtSlotsJson, addons_json AS addonsJson, total,
        status, admin_note AS adminNote, created_at AS createdAt
      FROM court_bookings WHERE user_id=? ORDER BY created_at DESC`).all(req.customer.id)
      .map(row => ({
        ...row,
        courtSlots: JSON.parse(row.courtSlotsJson),
        addons: JSON.parse(row.addonsJson),
        courtSlotsJson: undefined,
        addonsJson: undefined
      }));
    return res.json({ registrations, bookings });
  });

  router.post('/bookings', (req, res) => {
    const { name, phone, email, details, courtSlots, addons, total, proofFileName } = req.body ?? {};
    const user = getUser(req);
    if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 120 ||
      typeof phone !== 'string' || !/^[+]?[0-9 ()-]{8,20}$/.test(phone.trim()) ||
      typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
      typeof details !== 'string' || details.length > 3000 ||
      !Array.isArray(courtSlots) || !Array.isArray(addons) ||
      !Number.isSafeInteger(total) || total < 0 || total > 1000000000 ||
      typeof proofFileName !== 'string' || proofFileName.length > 255) {
      return sendError(res, 400, 'Data pemesanan tidak valid.');
    }
    if (courtSlots.length > 24 || addons.length > 50 ||
      courtSlots.some(slot => !slot || typeof slot.courtId !== 'string' || typeof slot.courtName !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(slot.dateKey) || !/^\d{2}:\d{2} - \d{2}:\d{2}$/.test(slot.time) ||
        !Number.isSafeInteger(slot.price) || slot.price < 0 || slot.price > 100000000) ||
      addons.some(addon => !addon || typeof addon.name !== 'string' || !Number.isSafeInteger(addon.qty) ||
        addon.name.length > 120 || addon.qty < 1 || addon.qty > 999 ||
        !Number.isSafeInteger(addon.price) || addon.price < 0 || addon.price > 100000000)) {
      return sendError(res, 400, 'Rincian pesanan tidak valid.');
    }
    const subtotal = courtSlots.reduce((sum, slot) => sum + slot.price, 0) +
      addons.reduce((sum, addon) => sum + addon.qty * addon.price, 0);
    const expectedTotal = subtotal - (courtSlots.length >= 2 ? Math.round(subtotal * 0.1) : 0);
    if (total !== expectedTotal) return sendError(res, 400, 'Total pesanan tidak sesuai dengan rincian harga.');
    const requestedSlots = new Set();
    for (const slot of courtSlots) {
      const key = `${slot.dateKey}:${slot.courtId}:${slot.time}`;
      if (requestedSlots.has(key)) return sendError(res, 400, 'Slot yang sama tidak dapat dipesan dua kali.');
      requestedSlots.add(key);
    }
    const activeBookings = db.prepare(`SELECT court_slots_json FROM court_bookings
      WHERE status NOT IN ('DITOLAK', 'Ditolak', 'DIBATALKAN')`).all();
    for (const booking of activeBookings) {
      const occupied = JSON.parse(booking.court_slots_json);
      if (occupied.some(slot => requestedSlots.has(`${slot.dateKey}:${slot.courtId}:${slot.time}`))) {
        return sendError(res, 409, 'Salah satu slot baru saja dipesan. Muat ulang jadwal dan pilih slot lain.');
      }
    }
    const id = `BHUB-${new Date(now()).getFullYear()}-${randomBytes(4).toString('hex').toUpperCase()}`;
    const createdAt = new Date(now()).toISOString();
    try {
      db.prepare(`INSERT INTO court_bookings (
        id, user_id, name, phone, email, details, court_slots_json, addons_json, total,
        proof_file_name, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Menunggu Verifikasi', ?)`).run(
        id, user?.id ?? null, name.trim(), phone.trim(), email.trim().toLowerCase(), details,
        JSON.stringify(courtSlots), JSON.stringify(addons), total, proofFileName, createdAt
      );
      return res.status(201).json({
        success: true,
        booking: { id, userId: user?.id ?? null, name: name.trim(), phone: phone.trim(), email: email.trim().toLowerCase(),
          details, courtSlots, addons, total, proofUploaded: !!proofFileName, proofFileName,
          status: 'Menunggu Verifikasi', adminNote: '', createdAt }
      });
    } catch (error) {
      console.error('Gagal menyimpan pesanan lapangan:', error.message);
      return sendError(res, 500, 'Pesanan tidak dapat disimpan. Silakan coba lagi.');
    }
  });

  router.use((error, req, res, next) => {
    console.error('Gagal memproses API akun peserta:', error.message);
    return sendError(res, error.status === 413 ? 413 : 400, error.status === 413 ? 'Permintaan terlalu besar.' : 'Permintaan tidak valid.');
  });

  const app = express();
  app.use(router);
  app.getUser = getUser;
  return app;
}

export function createAdminBookingApi({ root = process.cwd(), databasePath, isAdmin = () => false, deliverEmail = createEmailSender() } = {}) {
  const router = express.Router();
  const db = getTournamentDatabase(root, databasePath);
  const adminOnly = handler => (req, res, next) => {
    if (!isAdmin(req)) return sendError(res, 401, 'Silakan login admin terlebih dahulu.');
    return handler(req, res, next);
  };

  router.use(express.json({ limit: '1mb' }));
  router.get('/bookings', adminOnly((req, res) => {
    const bookings = db.prepare(`SELECT id, user_id AS userId, name, phone, email, details,
      court_slots_json AS courtSlotsJson, addons_json AS addonsJson, total, proof_file_name AS proofFileName,
      status, admin_note AS adminNote, payment_method AS paymentMethod, created_at AS createdAt
      FROM court_bookings ORDER BY created_at DESC`).all().map(row => ({
      ...row,
      courtSlots: JSON.parse(row.courtSlotsJson),
      addons: JSON.parse(row.addonsJson),
      timestamp: new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' })
        .format(new Date(row.createdAt)) + ' WIB',
      proofUploaded: !!row.proofFileName,
      courtSlotsJson: undefined,
      addonsJson: undefined
    }));
    return res.json({ bookings });
  }));

  router.post('/bookings', adminOnly((req, res) => {
    const { name, phone, email, details, courtSlots, addons, total, status, adminNote = '', paymentMethod = '' } = req.body ?? {};
    const allowed = new Set(['Menunggu Verifikasi', 'LUNAS', 'Disetujui', 'DITOLAK', 'DIBATALKAN']);
    if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 120 ||
      typeof phone !== 'string' || !/^[+]?[0-9 ()-]{8,20}$/.test(phone.trim()) ||
      typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
      typeof details !== 'string' || details.length > 3000 ||
      !Array.isArray(courtSlots) || !Array.isArray(addons) ||
      !Number.isSafeInteger(total) || total < 0 || total > 1000000000 ||
      !allowed.has(status) || typeof adminNote !== 'string' || adminNote.length > 2000 ||
      typeof paymentMethod !== 'string' || paymentMethod.length > 120 ||
      courtSlots.length < 1 || courtSlots.length > 24 || addons.length > 50 ||
      courtSlots.some(slot => !slot || typeof slot.courtId !== 'string' || typeof slot.courtName !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(slot.dateKey) || !/^\d{2}:\d{2} - \d{2}:\d{2}$/.test(slot.time) ||
        !Number.isSafeInteger(slot.price) || slot.price < 0 || slot.price > 100000000) ||
      addons.some(addon => !addon || typeof addon.name !== 'string' || addon.name.length > 120 ||
        !Number.isSafeInteger(addon.qty) || addon.qty < 1 || addon.qty > 999 ||
        !Number.isSafeInteger(addon.price) || addon.price < 0 || addon.price > 100000000)) {
      return sendError(res, 400, 'Data pemesanan manual tidak valid.');
    }
    const subtotal = courtSlots.reduce((sum, slot) => sum + slot.price, 0) +
      addons.reduce((sum, addon) => sum + addon.qty * addon.price, 0);
    const expectedTotal = subtotal;
    if (total !== expectedTotal) return sendError(res, 400, 'Total pemesanan manual tidak sesuai.');
    const requestedSlots = new Set(courtSlots.map(slot => `${slot.dateKey}:${slot.courtId}:${slot.time}`));
    if (requestedSlots.size !== courtSlots.length) return sendError(res, 400, 'Slot yang sama tidak dapat dimasukkan dua kali.');
    const occupied = db.prepare(`SELECT court_slots_json FROM court_bookings
      WHERE status NOT IN ('DITOLAK', 'Ditolak', 'DIBATALKAN')`).all()
      .some(row => JSON.parse(row.court_slots_json).some(slot =>
        requestedSlots.has(`${slot.dateKey}:${slot.courtId}:${slot.time}`)));
    if (occupied) return sendError(res, 409, 'Salah satu slot sudah dipesan.');
    const id = `BHUB-MANUAL-${randomBytes(8).toString('hex').toUpperCase()}`;
    const createdAt = new Date().toISOString();
    db.prepare(`INSERT INTO court_bookings (
      id, name, phone, email, details, court_slots_json, addons_json, total, proof_file_name,
      status, admin_note, payment_method, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, name.trim(), phone.trim(), email.trim().toLowerCase(), details,
      JSON.stringify(courtSlots), JSON.stringify(addons), total, 'manual_cashier_entry.jpg',
      status, adminNote.trim(), paymentMethod.trim(), createdAt
    );
    return res.status(201).json({ success: true, id, createdAt });
  }));

  router.patch('/bookings/:id/status', adminOnly(async (req, res) => {
    const { status, adminNote, courtSlots, details } = req.body ?? {};
    const allowed = new Set(['Menunggu Verifikasi', 'LUNAS', 'Disetujui', 'DITOLAK', 'DIBATALKAN']);
    const current = db.prepare('SELECT * FROM court_bookings WHERE id=?').get(req.params.id);
    if (!current) return sendError(res, 404, 'Pesanan tidak ditemukan.');
    const nextStatus = status ?? current.status;
    const nextNote = adminNote ?? current.admin_note;
    const nextSlots = courtSlots ?? JSON.parse(current.court_slots_json);
    const nextDetails = details ?? current.details;
    if (!allowed.has(nextStatus) || typeof nextNote !== 'string' || nextNote.length > 2000 ||
      typeof nextDetails !== 'string' || nextDetails.length > 3000 || !Array.isArray(nextSlots) ||
      nextSlots.length > 24 ||
      nextSlots.some(slot => !slot || typeof slot.courtId !== 'string' || typeof slot.courtName !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(slot.dateKey) || !/^\d{2}:\d{2} - \d{2}:\d{2}$/.test(slot.time) ||
        !Number.isSafeInteger(slot.price) || slot.price < 0 || slot.price > 100000000)) {
      return sendError(res, 400, 'Status atau catatan admin tidak valid.');
    }
    const requestedSlots = new Set(nextSlots.map(slot => `${slot.dateKey}:${slot.courtId}:${slot.time}`));
    if (requestedSlots.size !== nextSlots.length) return sendError(res, 400, 'Slot yang sama tidak dapat dimasukkan dua kali.');
    if (!['DITOLAK', 'Ditolak', 'DIBATALKAN'].includes(nextStatus)) {
      const conflict = db.prepare(`SELECT id, court_slots_json FROM court_bookings
        WHERE id<>? AND status NOT IN ('DITOLAK', 'Ditolak', 'DIBATALKAN')`).all(req.params.id)
        .some(row => JSON.parse(row.court_slots_json).some(slot =>
          requestedSlots.has(`${slot.dateKey}:${slot.courtId}:${slot.time}`)));
      if (conflict) return sendError(res, 409, 'Slot tujuan sudah dipesan.');
    }
    db.prepare('UPDATE court_bookings SET status=?, admin_note=?, court_slots_json=?, details=? WHERE id=?')
      .run(nextStatus, nextNote.trim(), JSON.stringify(nextSlots), nextDetails, req.params.id);
    const wasConfirmed = ['LUNAS', 'Disetujui'].includes(current.status);
    const isConfirmed = ['LUNAS', 'Disetujui'].includes(nextStatus);
    const wasRejected = ['DITOLAK', 'Ditolak'].includes(current.status);
    const isRejected = ['DITOLAK', 'Ditolak'].includes(nextStatus);
    const wasCancelled = current.status === 'DIBATALKAN';
    const isCancelled = nextStatus === 'DIBATALKAN';
    if (wasConfirmed && isConfirmed || wasRejected && isRejected || wasCancelled && isCancelled ||
      !isConfirmed && !isRejected && !isCancelled) {
      return res.json({ success: true, emailSent: false });
    }

    const confirmed = isConfirmed;
    const schedule = nextSlots.map(slot => {
      const date = new Intl.DateTimeFormat('id-ID', { dateStyle: 'long', timeZone: 'Asia/Jakarta' })
        .format(new Date(`${slot.dateKey}T00:00:00+07:00`));
      return `${slot.courtName}: ${date}, pukul ${slot.time} WIB`;
    }).join('\n');
    const subject = confirmed
      ? `Pesanan lapangan dikonfirmasi: ${current.id}`
      : `Pembaruan pesanan lapangan: ${current.id}`;
    const statusMessage = confirmed
      ? 'Pesanan lapangan Anda telah dikonfirmasi.'
      : isCancelled ? 'Pesanan lapangan Anda telah dibatalkan.' : 'Mohon maaf, pesanan lapangan Anda ditolak.';
    const text = `Halo ${current.name},\n\n${statusMessage}\n\nKode pesanan: ${current.id}\nJadwal:\n${schedule}\n\nRincian: ${nextDetails}\nTotal: Rp${Number(current.total).toLocaleString('id-ID')}\nStatus: ${nextStatus}${nextNote.trim() ? `\nCatatan: ${nextNote.trim()}` : ''}\n\nSimpan email ini sebagai bukti informasi pesanan.`;
    const html = `<div style="font-family:Arial,sans-serif;color:#0f172a;line-height:1.5"><h2>${escapeEmailHtml(statusMessage)}</h2><p>Halo ${escapeEmailHtml(current.name)},</p><p><strong>Kode pesanan:</strong> ${escapeEmailHtml(current.id)}</p><h3>Jadwal</h3>${schedule.split('\n').map(line => `<p style="margin:6px 0">${escapeEmailHtml(line)}</p>`).join('')}<p><strong>Rincian:</strong> ${escapeEmailHtml(nextDetails)}</p><p><strong>Total:</strong> Rp${Number(current.total).toLocaleString('id-ID')}</p><p><strong>Status:</strong> ${escapeEmailHtml(nextStatus)}</p>${nextNote.trim() ? `<p><strong>Catatan:</strong> ${escapeEmailHtml(nextNote.trim())}</p>` : ''}<p>Simpan email ini sebagai bukti informasi pesanan.</p></div>`;
    try {
      await deliverEmail({ to: current.email, subject, text, html });
      return res.json({ success: true, emailSent: true });
    } catch (error) {
      console.error('Status pesanan tersimpan, tetapi email pelanggan gagal dikirim:', error.message);
      return res.json({ success: true, emailSent: false, notificationError: 'Status tersimpan, tetapi email pemberitahuan gagal dikirim.' });
    }
  }));
  return router;
}
