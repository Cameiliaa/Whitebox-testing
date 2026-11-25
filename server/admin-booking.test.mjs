import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createAdminBookingApi } from './customer-auth.mjs';

function createDatabaseDouble(activeBookings = []) {
  const insertCalls = [];
  const selectCalls = [];

  // Stub: controls occupied slots so each conflict path is deterministic.
  const database = {
    prepare(sql) {
      if (sql.includes('SELECT court_slots_json FROM court_bookings')) {
        return {
          all() {
            selectCalls.push(sql);
            return activeBookings;
          }
        };
      }

      if (sql.includes('INSERT INTO court_bookings')) {
        return {
          run(...values) {
            // Spy: captures INSERT calls to verify writes and rejected paths.
            insertCalls.push({ sql, values });
            return { changes: 1 };
          }
        };
      }

      throw new Error(`Unexpected SQL in booking test: ${sql}`);
    }
  };

  return { database, insertCalls, selectCalls };
}

function validPayload(overrides = {}) {
  return {
    name: 'Pelanggan',
    phone: '0812345678',
    email: 'tes@example.id',
    details: 'Booking lapangan',
    courtSlots: [{
      dateKey: '2026-11-18',
      courtId: 'court-1',
      courtName: 'Court 1',
      time: '09:00 - 10:00',
      price: 50000
    }],
    addons: [{ name: 'Raket', qty: 2, price: 10000 }],
    total: 70000,
    status: 'LUNAS',
    adminNote: '',
    paymentMethod: 'Tunai',
    ...overrides
  };
}

async function postBooking(payload, activeBookings = []) {
  const dbDouble = createDatabaseDouble(activeBookings);
  const app = express();
  app.use(createAdminBookingApi({
    database: dbDouble.database,
    isAdmin: () => true,
    deliverEmail: async () => {}
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));

  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return { status: response.status, body: await response.json(), dbDouble };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('creates a manual booking and returns 201', async () => {
  // Arrange
  const payload = validPayload();

  // Act
  const result = await postBooking(payload);

  // Assert
  assert.equal(result.status, 201);
  assert.equal(result.body.success, true);
  assert.match(result.body.id, /^BHUB-MANUAL-[A-F0-9]{16}$/);
  assert.equal(Number.isNaN(Date.parse(result.body.createdAt)), false);
  assert.equal(result.dbDouble.selectCalls.length, 1);
  assert.equal(result.dbDouble.insertCalls.length, 1);
  assert.deepEqual(result.dbDouble.insertCalls[0].values, [
    result.body.id,
    'Pelanggan',
    '0812345678',
    'tes@example.id',
    'Booking lapangan',
    JSON.stringify(payload.courtSlots),
    JSON.stringify(payload.addons),
    70000,
    'manual_cashier_entry.jpg',
    'LUNAS',
    '',
    'Tunai',
    result.body.createdAt
  ]);
});

test('returns 400 for invalid booking data', async () => {
  // Arrange
  const payload = validPayload({ name: null });

  // Act
  const result = await postBooking(payload);

  // Assert
  assert.equal(result.status, 400);
  assert.equal(result.body.error, 'Data pemesanan manual tidak valid.');
  assert.equal(result.dbDouble.selectCalls.length, 0);
  assert.equal(result.dbDouble.insertCalls.length, 0);
});

test('returns 400 when total does not match the booking subtotal', async () => {
  // Arrange
  const payload = validPayload({ total: 70001 });

  // Act
  const result = await postBooking(payload);

  // Assert
  assert.equal(result.status, 400);
  assert.equal(result.body.error, 'Total pemesanan manual tidak sesuai.');
  assert.equal(result.dbDouble.selectCalls.length, 0);
  assert.equal(result.dbDouble.insertCalls.length, 0);
});

test('returns 400 when requested court slots are duplicated', async () => {
  // Arrange
  const slot = validPayload().courtSlots[0];
  const payload = validPayload({
    courtSlots: [slot, { ...slot }],
    total: 120000
  });

  // Act
  const result = await postBooking(payload);

  // Assert
  assert.equal(result.status, 400);
  assert.equal(result.body.error, 'Slot yang sama tidak dapat dimasukkan dua kali.');
  assert.equal(result.dbDouble.selectCalls.length, 0);
  assert.equal(result.dbDouble.insertCalls.length, 0);
});

test('returns 409 when a requested slot is already occupied', async () => {
  // Arrange
  const payload = validPayload();
  const activeBookings = [{
    court_slots_json: JSON.stringify(payload.courtSlots)
  }];

  // Act
  const result = await postBooking(payload, activeBookings);

  // Assert
  assert.equal(result.status, 409);
  assert.equal(result.body.error, 'Salah satu slot sudah dipesan.');
  assert.equal(result.dbDouble.selectCalls.length, 1);
  assert.equal(result.dbDouble.insertCalls.length, 0);
});

const negativeCases = [
  ['one-character name', { name: 'A' }],
  ['invalid phone', { phone: '08123abc' }],
  ['product quantity zero', { addons: [{ name: 'Raket', qty: 0, price: 10000 }] }],
  ['product quantity 1000', { addons: [{ name: 'Raket', qty: 1000, price: 10000 }] }],
  ['negative total', { total: -1 }],
  ['disallowed status', { status: 'UNKNOWN' }],
  ['empty court slots', { courtSlots: [] }]
];

for (const [label, overrides] of negativeCases) {
  test(`rejects ${label} without inserting`, async () => {
    // Arrange
    const payload = validPayload(overrides);

    // Act
    const result = await postBooking(payload);

    // Assert
    assert.equal(result.status, 400);
    assert.equal(result.body.error, 'Data pemesanan manual tidak valid.');
    assert.equal(result.dbDouble.insertCalls.length, 0);
  });
}
