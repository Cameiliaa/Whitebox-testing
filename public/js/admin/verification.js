// Open Admin Verification Modal with QRIS & Customer Data
async function persistAdminBookingStatus(booking, status, adminNote, changes = {}) {
  const response = await fetch(`/api/admin/bookings/${encodeURIComponent(booking.id)}/status`, {
    method: 'PATCH',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status, adminNote, ...changes })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Status pesanan tidak dapat disimpan.');
  return result;
}

function openAdminVerifyModal(index) {
  AppState.activeVerifyIndex = index;
  const b = AppState.adminBookings[index];
  if (!b) return;

  document.getElementById('admin-verify-booking-id').innerText = b.id;
  document.getElementById('verify-cust-name').innerText = b.name;
  document.getElementById('verify-cust-phone').innerText = b.phone;
  document.getElementById('verify-cust-phone-link').href = 'https://wa.me/' + b.phone.replace(/[^0-9]/g, '');
  document.getElementById('verify-cust-email').innerText = b.email;
  document.getElementById('verify-timestamp').innerText = b.timestamp || '28 Sep 2026, 14:20 WIB';
  document.getElementById('verify-order-total').innerText = formatRp(b.total);

  // Receipt details
  document.getElementById('verify-receipt-amount').innerText = formatRp(b.total);
  document.getElementById('verify-receipt-ref').innerText = b.receiptData?.refId || ('QRIS-BCA-' + Math.floor(1000000 + Math.random() * 9000000));
  document.getElementById('verify-proof-filename').innerText = b.proofFileName || 'struk_pembayaran_qris.jpg';

  // Items list in modal
  const orderItemsContainer = document.getElementById('verify-order-items');
  orderItemsContainer.innerHTML = '';
  if (b.courtSlots && b.courtSlots.length > 0) {
    b.courtSlots.forEach(s => {
      orderItemsContainer.innerHTML += `
        <div class="flex justify-between text-[11px]">
          <span class="text-slate-800">🏸 ${s.courtName} (${s.time})</span>
          <span class="font-mono font-bold text-slate-900">${formatRp(s.price)}</span>
        </div>
      `;
    });
  }
  if (b.addons && b.addons.length > 0) {
    b.addons.forEach(a => {
      orderItemsContainer.innerHTML += `
        <div class="flex justify-between text-[11px]">
          <span class="text-slate-800">📦 ${a.name} (${a.qty}x)</span>
          <span class="font-mono font-bold text-slate-900">${formatRp(a.price * a.qty)}</span>
        </div>
      `;
    });
  }
  if ((!b.courtSlots || b.courtSlots.length === 0) && (!b.addons || b.addons.length === 0)) {
    orderItemsContainer.innerHTML = `<div class="text-[11px] text-slate-700">${b.details}</div>`;
  }

  // Status indicator in modal
  const statusBadge = document.getElementById('verify-current-status-badge');
  if (b.status === 'LUNAS' || b.status === 'Disetujui') {
    statusBadge.className = 'px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-900';
    statusBadge.innerText = 'STATUS: LUNAS (TERVERIFIKASI)';
  } else if (b.status === 'DITOLAK' || b.status === 'Ditolak') {
    statusBadge.className = 'px-2 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-900';
    statusBadge.innerText = 'STATUS: DITOLAK';
  } else {
    statusBadge.className = 'px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-900';
    statusBadge.innerText = 'STATUS: MENUNGGU VERIFIKASI';
  }

  // Note input prefill
  const noteInput = document.getElementById('verify-admin-note-input');
  if (b.adminNote) {
    noteInput.value = b.adminNote;
  } else {
    noteInput.value = 'Pembayaran Lunas, silakan tunjukkan tiket PDF saat tiba di arena.';
  }

  document.getElementById('admin-verify-modal').classList.remove('hidden');
  lucide.createIcons();
}

function closeAdminVerifyModal() {
  document.getElementById('admin-verify-modal').classList.add('hidden');
}

// APPROVAL FLOW: Updates status to LUNAS and locks court slots in the schedule
async function executeAdminApproval() {
  if (AppState.activeVerifyIndex === null) return;
  const b = AppState.adminBookings[AppState.activeVerifyIndex];
  if (!b) return;

  const note = document.getElementById('verify-admin-note-input').value.trim() || 'Pembayaran Lunas, silakan tunjukkan tiket PDF saat tiba di arena.';
  let notification;
  try {
    notification = await persistAdminBookingStatus(b, 'LUNAS', note);
  } catch (error) {
    showToast(error.message, 'error');
    return;
  }
  b.status = 'LUNAS';
  b.adminNote = note;

  // Lock court slots to RED in schedule
  if (b.courtSlots && b.courtSlots.length > 0) {
    b.courtSlots.forEach(slot => {
      if (!AppState.bookedSlots[slot.dateKey]) {
        AppState.bookedSlots[slot.dateKey] = {};
      }
      if (!AppState.bookedSlots[slot.dateKey][slot.courtId]) {
        AppState.bookedSlots[slot.dateKey][slot.courtId] = [];
      }
      if (!AppState.bookedSlots[slot.dateKey][slot.courtId].includes(slot.time)) {
        AppState.bookedSlots[slot.dateKey][slot.courtId].push(slot.time);
      }
    });
  }

  showToast(notification.emailSent === false && notification.notificationError
    ? notification.notificationError
    : notification.emailSent
      ? `Email konfirmasi pesanan berhasil dikirim ke ${b.email}.`
      : 'Pesanan berhasil dikonfirmasi.', notification.emailSent === false && notification.notificationError ? 'error' : 'success');

  closeAdminVerifyModal();
  renderAdminDashboard();
  renderScheduleGrid();
}

// REJECTION FLOW: Updates status to DITOLAK, frees court slots to GREEN, sends email rejection simulation
async function executeAdminRejection() {
  if (AppState.activeVerifyIndex === null) return;
  const b = AppState.adminBookings[AppState.activeVerifyIndex];
  if (!b) return;

  let note = document.getElementById('verify-admin-note-input').value.trim();
  if (!note || note.includes('Pembayaran Lunas')) {
    note = prompt('Masukkan alasan penolakan untuk pelanggan:', 'Bukti bayar tidak valid / nominal tidak sesuai.');
    if (!note) {
      showToast('Penolakan dibatalkan (alasan penolakan wajib diisi).', 'error');
      return;
    }
  }

  let notification;
  try {
    notification = await persistAdminBookingStatus(b, 'DITOLAK', note);
  } catch (error) {
    showToast(error.message, 'error');
    return;
  }
  b.status = 'DITOLAK';
  b.adminNote = note;

  // Free court slots to GREEN (remove from bookedSlots)
  if (b.courtSlots && b.courtSlots.length > 0) {
    b.courtSlots.forEach(slot => {
      if (AppState.bookedSlots[slot.dateKey] && AppState.bookedSlots[slot.dateKey][slot.courtId]) {
        AppState.bookedSlots[slot.dateKey][slot.courtId] = AppState.bookedSlots[slot.dateKey][slot.courtId].filter(t => t !== slot.time);
      }
    });
  }

  showToast(notification.emailSent === false && notification.notificationError
    ? notification.notificationError
    : notification.emailSent
      ? `Email pemberitahuan penolakan berhasil dikirim ke ${b.email}.`
      : 'Pesanan berhasil ditolak.', notification.emailSent === false && notification.notificationError ? 'error' : 'info');

  closeAdminVerifyModal();
  renderAdminDashboard();
  renderScheduleGrid();
}
