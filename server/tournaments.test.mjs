import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scryptSync } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import express from 'express';
import { createAdminAuth } from './admin-auth.mjs';
import { createCustomerApi } from './customer-auth.mjs';
import { closeTournamentDatabase, createPublicTournamentApi } from './tournaments.mjs';

test('tournament API persists registrations and protects administration', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'badminton-tournament-'));
  const databasePath = join(folder, 'tournaments.sqlite');
  const salt = 'b'.repeat(32);
  const app = express();
  const sentMail = [];
  const customerApi = createCustomerApi({
    root: process.cwd(),
    databasePath,
    env: { APP_PUBLIC_URL: 'http://192.168.50.27:3000' },
    sendMail: async message => sentMail.push(message)
  });
  app.use('/api/admin', createAdminAuth({
    root: process.cwd(),
    databasePath,
    sendMail: async message => sentMail.push(message),
    credentials: {
      ADMIN_USERNAME: 'test-admin',
      ADMIN_PASSWORD_HASH: `${salt}:${scryptSync('test-password-123', salt, 64).toString('hex')}`
    }
  }));
  app.use('/api/account', customerApi);
  app.use('/api/tournaments', createPublicTournamentApi({ databasePath, getUser: customerApi.getUser }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  let customerCookie = '';

  try {
    const unauthenticated = await fetch(`${base}/api/admin/tournaments`, { method: 'POST' });
    assert.equal(unauthenticated.status, 401);

    const login = await fetch(`${base}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'test-admin', password: 'test-password-123' })
    });
    assert.equal(login.status, 200);
    cookie = login.headers.get('set-cookie').split(';')[0];

    const accountResponse = await fetch(`${base}/api/account/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: 'Ayu Pratama',
        whatsapp: '+6281234567890',
        email: 'ayu@example.id',
        password: 'peserta-password-123'
      })
    });
    assert.equal(accountResponse.status, 202);
    const repeatedRegistration = await fetch(`${base}/api/account/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: 'Ayu Pratama',
        whatsapp: '+6281234567890',
        email: 'ayu@example.id',
        password: 'peserta-password-123'
      })
    });
    assert.equal(repeatedRegistration.status, 202);
    assert.equal((await repeatedRegistration.json()).message, (await accountResponse.clone().json()).message);
    assert.equal(sentMail.length, 1);
    const unverifiedLogin = await fetch(`${base}/api/account/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'ayu@example.id', password: 'peserta-password-123' })
    });
    assert.equal(unverifiedLogin.status, 403);
    const verificationToken = sentMail.at(-1).text.match(/verifyEmail=([a-f0-9]{64})/)[1];
    const verification = await fetch(`${base}/api/account/verify-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: verificationToken })
    });
    assert.equal(verification.status, 200);
    const accountLogin = await fetch(`${base}/api/account/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'ayu@example.id', password: 'peserta-password-123' })
    });
    assert.equal(accountLogin.status, 200);
    customerCookie = accountLogin.headers.get('set-cookie').split(';')[0];

    const poster = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jYbkAAAAASUVORK5CYII=';
    const tournamentInput = {
      name: 'Kejuaraan Badminton 2029',
      description: 'Turnamen terbuka tingkat komunitas.',
      eventDate: '2029-06-20',
      startTime: '08:00',
      endTime: '17:00',
      location: 'Arena Badminton Hub',
      fee: 100000,
      minPayment: 25000,
      discountLabel: 'Early bird',
      discountType: 'percent',
      discountValue: 10,
      discountStart: '2026-01-01',
      discountEnd: '2030-01-01',
      registrationDeadline: '2029-06-10T23:59',
      terms: ['Bawa kartu identitas.', 'Peserta hadir 30 menit lebih awal.'],
      extraInfo: 'Panitia menyediakan shuttlecock.',
      categories: [{ name: 'Ganda Campuran', teamSize: 2 }],
      extraFields: [{ label: 'Nama klub', required: true }],
      requiresPaymentProof: true,
      registrationOpen: true,
      isActive: true,
      poster
    };
    const createdResponse = await fetch(`${base}/api/admin/tournaments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify(tournamentInput)
    });
    assert.equal(createdResponse.status, 201);
    const { tournament } = await createdResponse.json();
    assert.equal(tournament.name, tournamentInput.name);
    assert.equal(tournament.minPayment, 25000);
    assert.equal(tournament.hasPoster, true);
    const publicPosterResponse = await fetch(`${base}${tournament.posterUrl}`);
    assert.equal(publicPosterResponse.status, 200);
    assert.equal(publicPosterResponse.headers.get('content-type'), 'image/png');
    assert.deepEqual(
      Buffer.from(await publicPosterResponse.arrayBuffer()),
      Buffer.from(poster.split(',')[1], 'base64')
    );
    const adminPosterResponse = await fetch(`${base}/api/admin/tournaments/${tournament.id}/poster`, {
      headers: { cookie }
    });
    assert.equal(adminPosterResponse.status, 200);
    assert.equal(adminPosterResponse.headers.get('content-type'), 'image/png');
    assert.deepEqual(
      Buffer.from(await adminPosterResponse.arrayBuffer()),
      Buffer.from(poster.split(',')[1], 'base64')
    );

    const publicList = await fetch(`${base}/api/tournaments`).then(response => response.json());
    assert.equal(publicList.tournaments.length, 1);
    assert.equal('poster' in publicList.tournaments[0], false);

    const editedResponse = await fetch(`${base}/api/admin/tournaments/${tournament.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ ...tournamentInput, name: 'Kejuaraan Badminton Diperbarui', poster: undefined })
    });
    assert.equal(editedResponse.status, 200);
    const { tournament: editedTournament } = await editedResponse.json();
    assert.equal(editedTournament.name, 'Kejuaraan Badminton Diperbarui');
    assert.equal(editedTournament.hasPoster, true);
    const updatedPublicList = await fetch(`${base}/api/tournaments`).then(response => response.json());
    assert.equal(updatedPublicList.tournaments[0].name, 'Kejuaraan Badminton Diperbarui');

    const guestRegistration = await fetch(`${base}/api/tournaments/${tournament.id}/registrations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fullName: 'Atlet', whatsapp: '081234567890', email: 'atlet@example.id' })
    });
    assert.equal(guestRegistration.status, 401);

    const registrationResponse = await fetch(`${base}/api/tournaments/${tournament.id}/registrations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: customerCookie },
      body: JSON.stringify({
        fullName: 'Ayu Pratama',
        whatsapp: '+6281234567890',
        email: 'ayu@example.id',
        category: 'Ganda Campuran',
        teammates: ['Bima Putra'],
        extraData: { 'Nama klub': 'PB Hub' },
        paymentAmount: 25000,
        paymentProof: poster
      })
    });
    assert.equal(registrationResponse.status, 201);
    const registered = await registrationResponse.json();
    assert.equal(registered.paymentStatus, 'Menunggu Verifikasi');
    assert.equal(registered.registrationStatus, 'Menunggu Konfirmasi');

    const bookingResponse = await fetch(`${base}/api/account/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: customerCookie },
      body: JSON.stringify({
        name: 'Ayu Pratama',
        phone: '+6281234567890',
        email: 'ayu@example.id',
        details: 'Court 1 · 08:00–09:00',
        courtSlots: [{ courtId: 'court-1', courtName: 'Court 1', dateKey: '2029-06-20', time: '08:00 - 09:00', price: 50000 }],
        addons: [],
        total: 50000,
        proofFileName: 'transfer.jpg'
      })
    });
    assert.equal(bookingResponse.status, 201);
    const savedBooking = (await bookingResponse.json()).booking;
    assert.match(savedBooking.id, /^BHUB-\d{4}-[A-F0-9]{8}$/);

    const historyResponse = await fetch(`${base}/api/account/history`, { headers: { cookie: customerCookie } });
    assert.equal(historyResponse.status, 200);
    const history = await historyResponse.json();
    assert.equal(history.registrations.length, 1);
    assert.equal(history.registrations[0].code, registered.code);
    assert.equal(history.bookings.length, 1);
    assert.equal(history.bookings[0].id, savedBooking.id);
    assert.equal((await fetch(`${base}/api/account/history`)).status, 401);

    const guestBookingInput = {
      name: 'Pelanggan Tamu',
      phone: '081234567890',
      email: 'tamu@example.id',
      details: 'Court 2 · 09:00–10:00',
      courtSlots: [{ courtId: 'court-2', courtName: 'Court 2', dateKey: '2029-06-20', time: '09:00 - 10:00', price: 50000 }],
      addons: [],
      total: 50000,
      proofFileName: 'transfer.jpg'
    };
    const guestBooking = await fetch(`${base}/api/account/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(guestBookingInput)
    });
    assert.equal(guestBooking.status, 201);
    assert.equal((await guestBooking.json()).booking.userId, null);
    const duplicateSlot = await fetch(`${base}/api/account/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(guestBookingInput)
    });
    assert.equal(duplicateSlot.status, 409);

    const adminBookings = await fetch(`${base}/api/admin/bookings`, { headers: { cookie } });
    assert.equal(adminBookings.status, 200);
    assert.equal((await adminBookings.json()).bookings.length, 2);
    const confirmedBooking = await fetch(`${base}/api/admin/bookings/${encodeURIComponent(savedBooking.id)}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ status: 'LUNAS', adminNote: 'Pembayaran diterima.' })
    });
    assert.equal(confirmedBooking.status, 200);
    assert.equal((await confirmedBooking.json()).emailSent, true);
    assert.equal(sentMail.at(-1).to, 'ayu@example.id');
    assert.match(sentMail.at(-1).subject, /Pesanan lapangan dikonfirmasi/);
    assert.match(sentMail.at(-1).text, /Court 1: 20 Juni 2029/);
    assert.match(sentMail.at(-1).text, /Pembayaran diterima/);
    const duplicateConfirmation = await fetch(`${base}/api/admin/bookings/${encodeURIComponent(savedBooking.id)}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ status: 'Disetujui', adminNote: 'Pembayaran diterima.' })
    });
    assert.equal((await duplicateConfirmation.json()).emailSent, false);

    const forgot = await fetch(`${base}/api/account/password/forgot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'ayu@example.id' })
    });
    assert.equal(forgot.status, 200);
    assert.match((await forgot.json()).message, /Jika email terdaftar/);
    const resetToken = sentMail.at(-1).text.match(/resetPassword=([a-f0-9]{64})/)[1];
    const reset = await fetch(`${base}/api/account/password/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: resetToken, password: 'peserta-password-456' })
    });
    assert.equal(reset.status, 200);
    const reusedReset = await fetch(`${base}/api/account/password/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: resetToken, password: 'peserta-password-789' })
    });
    assert.equal(reusedReset.status, 400);
    assert.equal((await fetch(`${base}/api/account/history`, { headers: { cookie: customerCookie } })).status, 401);
    const relogin = await fetch(`${base}/api/account/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'ayu@example.id', password: 'peserta-password-456' })
    });
    assert.equal(relogin.status, 200);
    customerCookie = relogin.headers.get('set-cookie').split(';')[0];
    const postResetHistory = await fetch(`${base}/api/account/history`, { headers: { cookie: customerCookie } });
    assert.equal(postResetHistory.status, 200);
    assert.equal((await postResetHistory.json()).registrations.length, 1);

    const publicStatus = await fetch(`${base}/api/tournaments/registrations/${registered.code}`).then(response => response.json());
    assert.equal(publicStatus.category, 'Ganda Campuran');
    assert.equal(publicStatus.paymentStatus, 'Menunggu Verifikasi');
    assert.equal('email' in publicStatus, false);

    const adminList = await fetch(`${base}/api/admin/tournament-registrations`, { headers: { cookie } })
      .then(response => response.json());
    assert.equal(adminList.registrations.length, 1);
    const participant = adminList.registrations[0];
    assert.equal(participant.fullName, 'Ayu Pratama');
    assert.deepEqual(participant.teammates, ['Bima Putra']);
    assert.equal(participant.amountPaid, 25000);
    assert.equal((await fetch(`${base}${participant.proofUrl}`, { headers: { cookie } })).status, 200);

    const changedStatus = await fetch(`${base}/api/admin/tournament-registrations/${participant.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ paymentStatus: 'Lunas', registrationStatus: 'Diterima' })
    });
    assert.equal(changedStatus.status, 200);
    assert.equal((await changedStatus.json()).emailSent, true);
    assert.equal(sentMail.at(-1).to, 'ayu@example.id');
    assert.match(sentMail.at(-1).subject, /Pendaftaran turnamen diterima/);
    assert.match(sentMail.at(-1).text, /20 Juni 2029, pukul 08:00–17:00 WIB/);
    assert.match(sentMail.at(-1).text, /Arena Badminton Hub/);
    const duplicateTournamentConfirmation = await fetch(`${base}/api/admin/tournament-registrations/${participant.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ paymentStatus: 'Lunas', registrationStatus: 'Diterima' })
    });
    assert.equal((await duplicateTournamentConfirmation.json()).emailSent, false);
    const updatedStatus = await fetch(`${base}/api/tournaments/registrations/${registered.code}`).then(response => response.json());
    assert.equal(updatedStatus.paymentStatus, 'Lunas');
    assert.equal(updatedStatus.registrationStatus, 'Diterima');

    const deleteWithRegistrant = await fetch(`${base}/api/admin/tournaments/${tournament.id}`, {
      method: 'DELETE', headers: { cookie }
    });
    assert.equal(deleteWithRegistrant.status, 409);

    const persisted = new DatabaseSync(databasePath);
    assert.equal(persisted.prepare('SELECT COUNT(*) AS total FROM tournament_registrations').get().total, 1);
    assert.equal(persisted.prepare('SELECT COUNT(*) AS total FROM customer_users WHERE email_verified_at IS NOT NULL').get().total, 1);
    assert.equal(persisted.prepare('SELECT COUNT(*) AS total FROM court_bookings').get().total, 2);
    persisted.close();
  } finally {
    await new Promise(resolve => server.close(resolve));
    closeTournamentDatabase(databasePath);
    rmSync(folder, { recursive: true, force: true });
  }
});
