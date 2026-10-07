(() => {
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
  const tournamentApi = '/api/admin/tournaments';
  let tournaments = [];
  let registrations = [];

  async function request(path, options = {}) {
    const response = await fetch(`/api/admin${path}`, {
      credentials: 'same-origin',
      ...options,
      headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers }
    });
    if (!response.headers.get('content-type')?.includes('application/json')) {
      throw new Error('Server turnamen tidak merespons dengan benar. Pastikan membuka port aplikasi yang terbaru, lalu muat ulang halaman.');
    }
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Server tidak dapat dihubungi. Coba lagi.');
    return result;
  }

  function dateLabel(value) {
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
  }

  function addEditorModal() {
    if (document.getElementById('admin-tournament-editor')) return;
    document.body.insertAdjacentHTML('beforeend', `<div id="admin-tournament-editor" class="fixed inset-0 z-[80] hidden items-center justify-center bg-slate-950/70 p-3 sm:p-6" role="dialog" aria-modal="true" aria-labelledby="admin-tournament-editor-title">
      <div class="w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-2xl bg-white shadow-2xl">
        <div class="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white/95 px-5 py-4 backdrop-blur"><h2 id="admin-tournament-editor-title" class="text-lg font-extrabold text-slate-900">Tambah Turnamen</h2><button type="button" data-close-admin-modal class="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Tutup">✕</button></div>
        <form id="admin-tournament-form" class="space-y-5 p-5 sm:p-7"></form>
      </div>
    </div>
    <div id="admin-participant-detail" class="fixed inset-0 z-[80] hidden items-center justify-center bg-slate-950/70 p-3 sm:p-6" role="dialog" aria-modal="true" aria-labelledby="admin-participant-title">
      <div class="w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-2xl bg-white shadow-2xl"><div class="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white/95 px-5 py-4"><h2 id="admin-participant-title" class="text-lg font-extrabold text-slate-900">Detail Pendaftar</h2><button type="button" data-close-admin-modal class="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Tutup">✕</button></div><div id="admin-participant-content" class="p-5 sm:p-7"></div></div>
    </div>`);
    document.querySelectorAll('#admin-tournament-editor, #admin-participant-detail').forEach(modal => {
      modal.addEventListener('click', event => {
        if (event.target === modal || event.target.closest('[data-close-admin-modal]')) closeAdminModal(modal);
      });
    });
  }

  function showAdminModal(modal) {
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    document.body.style.overflow = 'hidden';
  }

  function closeAdminModal(modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    if (![...document.querySelectorAll('#admin-tournament-editor, #admin-participant-detail')]
      .some(item => !item.classList.contains('hidden'))) document.body.style.overflow = '';
  }

  function tournamentForm(tournament = null) {
    const value = (key, fallback = '') => escapeHtml(tournament?.[key] ?? fallback);
    const categories = tournament?.categories?.map(item => `${item.name}|${item.teamSize}`).join('\n') ?? 'Tunggal Putra|1\nGanda Campuran|2';
    const fields = tournament?.extraFields?.map(item => `${item.label}|${item.required ? 'wajib' : 'opsional'}`).join('\n') ?? '';
    const existingPoster = tournament?.hasPoster
      ? `<img src="/api/admin/tournaments/${encodeURIComponent(tournament.id)}/poster" alt="Poster saat ini" class="mb-2 max-h-48 rounded-lg object-contain">` : '';
    return `<input type="hidden" name="tournamentId" value="${value('id')}">
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label class="sm:col-span-2"><span class="mb-1 block text-xs font-bold text-slate-700">Nama turnamen *</span><input name="name" required maxlength="120" value="${value('name')}" class="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:border-emerald-500"></label>
        <label class="sm:col-span-2"><span class="mb-1 block text-xs font-bold text-slate-700">Deskripsi *</span><textarea name="description" required maxlength="10000" rows="3" class="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:border-emerald-500">${value('description')}</textarea></label>
        <label><span class="mb-1 block text-xs font-bold text-slate-700">Tanggal pelaksanaan *</span><input name="eventDate" type="date" required value="${value('eventDate')}" class="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"></label>
        <label><span class="mb-1 block text-xs font-bold text-slate-700">Lokasi *</span><input name="location" required maxlength="300" value="${value('location')}" class="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"></label>
        <label><span class="mb-1 block text-xs font-bold text-slate-700">Waktu mulai *</span><input name="startTime" type="time" required value="${value('startTime', '08:00')}" class="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"></label>
        <label><span class="mb-1 block text-xs font-bold text-slate-700">Waktu selesai *</span><input name="endTime" type="time" required value="${value('endTime', '17:00')}" class="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"></label>
        <label><span class="mb-1 block text-xs font-bold text-slate-700">Biaya pendaftaran (Rp) *</span><input name="fee" type="number" min="0" max="1000000000" step="1000" required value="${value('fee', '0')}" class="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"></label>
        <label><span class="mb-1 block text-xs font-bold text-slate-700">Minimal pembayaran (Rp)</span><input name="minPayment" type="number" min="0" max="1000000000" step="1000" value="${value('minPayment', '0')}" class="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"></label>
        <label class="sm:col-span-2"><span class="mb-1 block text-xs font-bold text-slate-700">Batas akhir pendaftaran *</span><input name="registrationDeadline" type="datetime-local" required value="${value('registrationDeadline')}" class="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"></label>
        <div class="sm:col-span-2 grid grid-cols-1 gap-3 rounded-xl border border-slate-200 p-4 sm:grid-cols-2">
          <label class="sm:col-span-2"><span class="mb-1 block text-xs font-bold text-slate-700">Informasi diskon</span><input name="discountLabel" maxlength="120" placeholder="Contoh: Early bird" value="${value('discountLabel')}" class="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"></label>
          <label><span class="mb-1 block text-xs font-bold text-slate-700">Jenis diskon</span><select name="discountType" class="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"><option value="amount" ${tournament?.discountType !== 'percent' ? 'selected' : ''}>Potongan rupiah</option><option value="percent" ${tournament?.discountType === 'percent' ? 'selected' : ''}>Persentase</option></select></label>
          <label><span class="mb-1 block text-xs font-bold text-slate-700">Nilai diskon</span><input name="discountValue" type="number" min="0" step="1" value="${value('discountValue', '0')}" class="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"></label>
          <label><span class="mb-1 block text-xs font-bold text-slate-700">Diskon mulai</span><input name="discountStart" type="date" value="${value('discountStart')}" class="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"></label>
          <label><span class="mb-1 block text-xs font-bold text-slate-700">Diskon berakhir</span><input name="discountEnd" type="date" value="${value('discountEnd')}" class="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"></label>
        </div>
        <label class="sm:col-span-2"><span class="mb-1 block text-xs font-bold text-slate-700">Kategori & jumlah anggota per baris *</span><textarea name="categories" required rows="3" placeholder="Tunggal Putra|1&#10;Ganda Campuran|2" class="w-full rounded-xl border border-slate-300 px-3 py-2.5 font-mono text-xs">${escapeHtml(categories)}</textarea><span class="mt-1 block text-[10px] text-slate-500">Format: Nama kategori|jumlah peserta (1–8). Baris terpisah untuk tiap kategori.</span></label>
        <label class="sm:col-span-2"><span class="mb-1 block text-xs font-bold text-slate-700">Field tambahan per baris</span><textarea name="extraFields" rows="2" placeholder="Klub|wajib&#10;Catatan|opsional" class="w-full rounded-xl border border-slate-300 px-3 py-2.5 font-mono text-xs">${escapeHtml(fields)}</textarea><span class="mt-1 block text-[10px] text-slate-500">Format: Label|wajib atau opsional.</span></label>
        <label class="sm:col-span-2"><span class="mb-1 block text-xs font-bold text-slate-700">Syarat & ketentuan (satu per baris)</span><textarea name="terms" rows="3" class="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm">${escapeHtml(tournament?.terms?.join('\n') ?? '')}</textarea></label>
        <label class="sm:col-span-2"><span class="mb-1 block text-xs font-bold text-slate-700">Informasi tambahan admin</span><textarea name="extraInfo" maxlength="3000" rows="2" class="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm">${value('extraInfo')}</textarea></label>
        <label class="sm:col-span-2"><span class="mb-1 block text-xs font-bold text-slate-700">Poster ${tournament?.hasPoster ? '(unggah untuk mengganti)' : '*'}</span>${existingPoster}<input name="poster" type="file" accept="image/jpeg,image/png,image/webp" ${tournament?.hasPoster ? '' : 'required'} class="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-xs file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2"><span class="mt-1 block text-[10px] text-slate-500">Format JPG, PNG, atau WebP; ukuran file maksimal 5 MB. Disarankan gambar vertikal rasio 3:4 (contoh 1200 × 1600 px) agar tampil optimal. Tidak ada batas dimensi wajib.</span></label>
        <label class="flex items-center gap-2 text-xs font-semibold text-slate-700"><input name="requiresPaymentProof" type="checkbox" ${tournament?.requiresPaymentProof ? 'checked' : ''} class="h-4 w-4 accent-emerald-600">Wajib unggah bukti pembayaran</label>
        <label class="flex items-center gap-2 text-xs font-semibold text-slate-700"><input name="registrationOpen" type="checkbox" ${tournament?.registrationOpen !== false ? 'checked' : ''} class="h-4 w-4 accent-emerald-600">Pendaftaran sedang dibuka</label>
        <label class="flex items-center gap-2 text-xs font-semibold text-slate-700 sm:col-span-2"><input name="isActive" type="checkbox" ${tournament?.isActive !== false ? 'checked' : ''} class="h-4 w-4 accent-emerald-600">Tampilkan turnamen di halaman publik</label>
      </div>
      <p id="admin-tournament-form-error" class="hidden rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-700" role="alert"></p>
      <div class="flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:justify-end"><button type="button" data-close-admin-modal class="rounded-xl border border-slate-300 px-4 py-2.5 text-xs font-bold text-slate-700">Batal</button><button type="submit" class="rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-bold text-white hover:bg-emerald-700">Simpan Turnamen</button></div>`;
  }

  function openTournamentEditor(id = '') {
    addEditorModal();
    const tournament = tournaments.find(item => item.id === id);
    document.getElementById('admin-tournament-editor-title').textContent = tournament ? 'Edit Turnamen' : 'Tambah Turnamen';
    document.getElementById('admin-tournament-form').innerHTML = tournamentForm(tournament);
    showAdminModal(document.getElementById('admin-tournament-editor'));
  }
  window.openTournamentEditor = openTournamentEditor;

  function lines(value) {
    return value.split('\n').map(line => line.trim()).filter(Boolean);
  }

  function readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Gagal membaca poster.'));
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(file);
    });
  }

  async function submitTournament(form) {
    const submit = form.querySelector('[type="submit"]');
    const errorBox = document.getElementById('admin-tournament-form-error');
    const data = new FormData(form);
    const file = form.elements.poster.files[0];
    submit.disabled = true;
    errorBox.classList.add('hidden');
    try {
      if (file && file.size > 5 * 1024 * 1024) throw new Error('Ukuran poster maksimal 5 MB.');
      const categories = lines(data.get('categories')).map(line => {
        const [name, teamSize = '1'] = line.split('|');
        return { name: name.trim(), teamSize: Number(teamSize.trim()) };
      });
      const extraFields = lines(data.get('extraFields')).map(line => {
        const [label, required = 'opsional'] = line.split('|');
        return { label: label.trim(), required: required.trim().toLowerCase() === 'wajib' };
      });
      const payload = {
        name: data.get('name').trim(),
        description: data.get('description').trim(),
        eventDate: data.get('eventDate'),
        startTime: data.get('startTime'),
        endTime: data.get('endTime'),
        location: data.get('location').trim(),
        fee: Number(data.get('fee')),
        minPayment: Number(data.get('minPayment') || 0),
        discountLabel: data.get('discountLabel').trim(),
        discountType: data.get('discountType'),
        discountValue: Number(data.get('discountValue') || 0),
        discountStart: data.get('discountStart'),
        discountEnd: data.get('discountEnd'),
        registrationDeadline: data.get('registrationDeadline'),
        terms: lines(data.get('terms')),
        extraInfo: data.get('extraInfo').trim(),
        categories,
        extraFields,
        requiresPaymentProof: data.has('requiresPaymentProof'),
        registrationOpen: data.has('registrationOpen'),
        isActive: data.has('isActive')
      };
      if (file) payload.poster = await readFile(file);
      const id = data.get('tournamentId');
      const saved = await request(id ? `/tournaments/${encodeURIComponent(id)}` : '/tournaments', {
        method: id ? 'PUT' : 'POST',
        body: JSON.stringify(payload)
      });
      if (!saved.tournament?.id) throw new Error('Server belum mengonfirmasi penyimpanan turnamen.');
      const updated = await renderAdminTournaments();
      if (!updated?.some(item => item.id === saved.tournament.id)) {
        throw new Error('Turnamen terkirim, tetapi belum terbaca kembali dari database. Muat ulang halaman admin dan periksa daftar turnamen.');
      }
      closeAdminModal(document.getElementById('admin-tournament-editor'));
      showToast('Turnamen berhasil disimpan.', 'success');
    } catch (error) {
      errorBox.textContent = error.message;
      errorBox.classList.remove('hidden');
    } finally {
      submit.disabled = false;
    }
  }

  async function renderAdminTournaments() {
    const container = document.getElementById('admin-tournaments-list');
    if (!container) return;
    container.innerHTML = '<div class="col-span-full rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">Memuat turnamen…</div>';
    try {
      const result = await request('/tournaments');
      if (!Array.isArray(result.tournaments)) throw new Error('Server tidak mengirim daftar turnamen yang valid.');
      tournaments = result.tournaments;
      const badge = document.getElementById('admin-tab-tournaments-badge');
      if (badge) badge.textContent = String(tournaments.length);
      if (!tournaments.length) {
        container.innerHTML = '<div class="col-span-full rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center"><p class="font-bold text-slate-700">Belum ada turnamen</p><p class="mt-1 text-xs text-slate-500">Tambahkan turnamen agar pengunjung dapat melihat informasi dan mendaftar.</p></div>';
        updateTournamentFilterOptions();
        return tournaments;
      }
      container.innerHTML = tournaments.map(tournament => `<article class="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs sm:flex">
        <div class="h-44 bg-slate-900 sm:h-auto sm:w-44 sm:shrink-0">${tournament.hasPoster ? `<img src="/api/admin/tournaments/${encodeURIComponent(tournament.id)}/poster" alt="Poster ${escapeHtml(tournament.name)}" class="h-full w-full object-cover">` : '<div class="flex h-full items-center justify-center text-emerald-400"><i data-lucide="trophy" class="h-12 w-12"></i></div>'}</div>
        <div class="min-w-0 flex-1 p-4 sm:p-5">
          <div class="flex flex-wrap items-start justify-between gap-2"><h4 class="font-extrabold text-slate-900">${escapeHtml(tournament.name)}</h4><span class="rounded-full px-2.5 py-1 text-[10px] font-bold ${tournament.registrationOpen && tournament.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}">${tournament.isActive ? (tournament.registrationOpen ? 'Pendaftaran dibuka' : 'Pendaftaran ditutup') : 'Tidak ditampilkan'}</span></div>
          <p class="mt-2 text-xs text-slate-500">${escapeHtml(dateLabel(tournament.eventDate))} · ${escapeHtml(tournament.startTime)}–${escapeHtml(tournament.endTime)} · ${escapeHtml(tournament.location)}</p>
          <p class="mt-2 text-xs font-semibold text-slate-700">${tournament.fee ? escapeHtml(formatRp(tournament.fee)) : 'Gratis'}${tournament.minPayment ? ` · Minimal ${escapeHtml(formatRp(tournament.minPayment))}` : ''}</p>
          <p class="mt-1 text-[11px] text-slate-500">${tournament.categories.map(category => escapeHtml(`${category.name} (${category.teamSize})`)).join(' · ')}</p>
          <p class="mt-1 text-[11px] text-slate-500">${tournament.requiresPaymentProof ? 'Bukti pembayaran wajib' : 'Tanpa upload bukti wajib'} · Batas ${escapeHtml(dateLabel(tournament.registrationDeadline.slice(0, 10)))}</p>
          <div class="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
            <button type="button" data-edit-tournament="${escapeHtml(tournament.id)}" class="rounded-lg border border-slate-300 px-3 py-2 text-[11px] font-bold text-slate-700 hover:bg-slate-50">Edit</button>
            <button type="button" data-toggle-tournament="${escapeHtml(tournament.id)}" class="rounded-lg border border-slate-300 px-3 py-2 text-[11px] font-bold text-slate-700 hover:bg-slate-50">${tournament.registrationOpen ? 'Tutup pendaftaran' : 'Buka pendaftaran'}</button>
            <button type="button" data-delete-tournament="${escapeHtml(tournament.id)}" class="rounded-lg border border-red-200 px-3 py-2 text-[11px] font-bold text-red-700 hover:bg-red-50">Hapus</button>
          </div>
        </div>
      </article>`).join('');
      updateTournamentFilterOptions();
      lucide.createIcons();
      return tournaments;
    } catch (error) {
      container.innerHTML = `<p class="col-span-full rounded-xl bg-red-50 p-5 text-sm text-red-700">${escapeHtml(error.message)}</p>`;
      return null;
    }
  }
  window.renderAdminTournaments = renderAdminTournaments;

  function updateTournamentFilterOptions() {
    const tournamentSelect = document.getElementById('admin-participant-tournament-filter');
    const categorySelect = document.getElementById('admin-participant-category-filter');
    if (!tournamentSelect || !categorySelect) return;
    const oldTournament = tournamentSelect.value;
    const oldCategory = categorySelect.value;
    tournamentSelect.innerHTML = '<option value="">Semua turnamen</option>' + tournaments.map(item =>
      `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join('');
    const categories = [...new Set(tournaments.flatMap(item => item.categories.map(category => category.name)))];
    categorySelect.innerHTML = '<option value="">Semua kategori</option>' + categories.map(name =>
      `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
    tournamentSelect.value = oldTournament;
    categorySelect.value = oldCategory;
  }

  function participantStatusSelect(registration, field) {
    const choices = field === 'paymentStatus'
      ? ['Menunggu Pembayaran', 'Menunggu Verifikasi', 'Lunas', 'Ditolak', 'Tidak Diperlukan']
      : ['Menunggu Konfirmasi', 'Diterima', 'Ditolak'];
    return `<select data-status-field="${field}" data-registration-id="${registration.id}" class="max-w-44 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-[10px] font-semibold text-slate-700">${choices.map(status => `<option ${registration[field] === status ? 'selected' : ''} value="${escapeHtml(status)}">${escapeHtml(status)}</option>`).join('')}</select>`;
  }

  function renderParticipantRows() {
    const body = document.getElementById('admin-participants-tbody');
    if (!body) return;
    const search = document.getElementById('admin-participant-search').value.trim().toLowerCase();
    const tournamentId = document.getElementById('admin-participant-tournament-filter').value;
    const category = document.getElementById('admin-participant-category-filter').value;
    const status = document.getElementById('admin-participant-status-filter').value;
    const filtered = registrations.filter(item => {
      const matchesSearch = !search || [item.fullName, item.whatsapp, item.email, item.code].some(value => value.toLowerCase().includes(search));
      const matchesStatus = !status || item.paymentStatus === status || item.registrationStatus === status;
      return matchesSearch && (!tournamentId || item.tournamentId === tournamentId) &&
        (!category || item.category === category) && matchesStatus;
    });
    document.getElementById('admin-participant-count').textContent = `${filtered.length} peserta`;
    const badge = document.getElementById('admin-tab-participants-badge');
    if (badge) badge.textContent = String(registrations.length);
    if (!filtered.length) {
      body.innerHTML = '<tr><td colspan="7" class="px-4 py-12 text-center text-slate-500">Tidak ada peserta yang cocok dengan filter.</td></tr>';
      return;
    }
    body.innerHTML = filtered.map(item => `<tr>
      <td class="px-4 py-3"><p class="font-bold text-slate-900">${escapeHtml(item.fullName)}</p><p class="mt-1 text-[10px] text-slate-500">${escapeHtml(item.code)}</p></td>
      <td class="px-4 py-3 text-slate-600">${escapeHtml(item.whatsapp)}<br><span class="text-[10px]">${escapeHtml(item.email)}</span></td>
      <td class="px-4 py-3"><p class="font-semibold text-slate-800">${escapeHtml(item.tournamentName)}</p><p class="mt-1 text-[10px] text-slate-500">${escapeHtml(item.category)}</p></td>
      <td class="px-4 py-3 text-slate-600">${escapeHtml(new Date(item.createdAt).toLocaleString('id-ID'))}</td>
      <td class="px-4 py-3">${participantStatusSelect(item, 'paymentStatus')}${item.hasProof ? '<p class="mt-1 text-[10px] font-semibold text-emerald-700">Bukti tersedia</p>' : ''}</td>
      <td class="px-4 py-3">${participantStatusSelect(item, 'registrationStatus')}</td>
      <td class="px-4 py-3"><button type="button" data-view-participant="${item.id}" class="rounded-lg bg-slate-100 px-3 py-2 text-[10px] font-bold text-slate-700 hover:bg-slate-200">Detail</button></td>
    </tr>`).join('');
  }

  async function renderAdminParticipants() {
    const body = document.getElementById('admin-participants-tbody');
    if (!body) return;
    body.innerHTML = '<tr><td colspan="7" class="px-4 py-12 text-center text-slate-500">Memuat data peserta…</td></tr>';
    try {
      if (!tournaments.length) {
        const tournamentResult = await request('/tournaments');
        tournaments = tournamentResult.tournaments;
      }
      updateTournamentFilterOptions();
      const result = await request('/tournament-registrations');
      registrations = result.registrations;
      renderParticipantRows();
    } catch (error) {
      body.innerHTML = `<tr><td colspan="7" class="px-4 py-8 text-center text-red-700">${escapeHtml(error.message)}</td></tr>`;
    }
  }
  window.renderAdminParticipants = renderAdminParticipants;

  async function showParticipant(id) {
    addEditorModal();
    try {
      const result = await request(`/tournament-registrations/${id}`);
      const item = result.registration;
      const extra = Object.entries(item.extraData).map(([label, value]) => `<p><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</p>`).join('');
      document.getElementById('admin-participant-content').innerHTML = `
        <div class="grid grid-cols-1 gap-3 rounded-xl bg-slate-50 p-4 text-sm sm:grid-cols-2">
          <p><strong>Nama:</strong> ${escapeHtml(item.fullName)}</p><p><strong>Kode:</strong> ${escapeHtml(item.code)}</p>
          <p><strong>WhatsApp:</strong> ${escapeHtml(item.whatsapp)}</p><p><strong>Email:</strong> ${escapeHtml(item.email)}</p>
          <p><strong>Turnamen:</strong> ${escapeHtml(item.tournamentName)}</p><p><strong>Kategori:</strong> ${escapeHtml(item.category)}</p>
          <p><strong>Terdaftar:</strong> ${escapeHtml(new Date(item.createdAt).toLocaleString('id-ID'))}</p>
          <p><strong>Jumlah dibayar:</strong> ${escapeHtml(formatRp(item.amountPaid))} / ${escapeHtml(formatRp(item.payableAmount))}</p>
        </div>
        ${item.teammates.length ? `<div class="mt-4"><h3 class="font-bold text-slate-900">Rekan satu tim</h3><ul class="mt-2 list-disc pl-5 text-sm text-slate-600">${item.teammates.map(name => `<li>${escapeHtml(name)}</li>`).join('')}</ul></div>` : ''}
        ${extra ? `<div class="mt-4 space-y-1 text-sm text-slate-600">${extra}</div>` : ''}
        ${item.hasProof ? `<div class="mt-5"><h3 class="font-bold text-slate-900">Bukti pembayaran</h3><a href="/api/admin/tournament-registrations/${item.id}/proof" target="_blank" rel="noopener noreferrer"><img src="/api/admin/tournament-registrations/${item.id}/proof" alt="Bukti pembayaran ${escapeHtml(item.fullName)}" class="mt-2 max-h-96 max-w-full rounded-xl border border-slate-200 object-contain"></a></div>` : '<p class="mt-5 rounded-lg bg-slate-50 p-3 text-xs text-slate-500">Peserta belum mengunggah bukti pembayaran.</p>'}`;
      document.getElementById('admin-participant-title').textContent = `Detail · ${item.fullName}`;
      showAdminModal(document.getElementById('admin-participant-detail'));
    } catch (error) { showToast(error.message, 'error'); }
  }

  document.addEventListener('submit', event => {
    if (event.target.id === 'admin-tournament-form') {
      event.preventDefault();
      submitTournament(event.target);
    }
  });

  document.addEventListener('click', async event => {
    const edit = event.target.closest('[data-edit-tournament]');
    if (edit) return openTournamentEditor(edit.dataset.editTournament);
    const remove = event.target.closest('[data-delete-tournament]');
    if (remove) {
      if (!window.confirm('Hapus turnamen ini? Turnamen yang memiliki pendaftar tidak dapat dihapus.')) return;
      try {
        await request(`/tournaments/${encodeURIComponent(remove.dataset.deleteTournament)}`, { method: 'DELETE' });
        showToast('Turnamen berhasil dihapus.', 'success');
        await renderAdminTournaments();
      } catch (error) { showToast(error.message, 'error'); }
      return;
    }
    const toggle = event.target.closest('[data-toggle-tournament]');
    if (toggle) {
      const tournament = tournaments.find(item => item.id === toggle.dataset.toggleTournament);
      if (!tournament) return;
      try {
        const payload = {
          ...tournament,
          registrationOpen: !tournament.registrationOpen,
        };
        delete payload.id;
        await request(`/tournaments/${encodeURIComponent(tournament.id)}`, {
          method: 'PUT', body: JSON.stringify(payload)
        });
        showToast('Status pendaftaran diperbarui.', 'success');
        await renderAdminTournaments();
      } catch (error) { showToast(error.message, 'error'); }
      return;
    }
    const detail = event.target.closest('[data-view-participant]');
    if (detail) showParticipant(detail.dataset.viewParticipant);
  });

  document.addEventListener('change', async event => {
    if (event.target.matches('[data-status-field]')) {
      const registration = registrations.find(item => item.id === Number(event.target.dataset.registrationId));
      if (!registration) return;
      const field = event.target.dataset.statusField;
      const body = {
        paymentStatus: field === 'paymentStatus' ? event.target.value : registration.paymentStatus,
        registrationStatus: field === 'registrationStatus' ? event.target.value : registration.registrationStatus
      };
      try {
        const result = await request(`/tournament-registrations/${registration.id}/status`, {
          method: 'PATCH', body: JSON.stringify(body)
        });
        showToast(result.emailSent === false && result.notificationError
          ? result.notificationError
          : result.emailSent
            ? 'Status peserta diperbarui dan email pemberitahuan berhasil dikirim.'
            : 'Status peserta berhasil diperbarui.', result.emailSent === false && result.notificationError ? 'error' : 'success');
        await renderAdminParticipants();
      } catch (error) {
        showToast(error.message, 'error');
        await renderAdminParticipants();
      }
    }
  });

  ['admin-participant-search', 'admin-participant-tournament-filter', 'admin-participant-category-filter', 'admin-participant-status-filter'].forEach(id => {
    document.addEventListener('input', event => { if (event.target.id === id) renderParticipantRows(); });
    document.addEventListener('change', event => { if (event.target.id === id) renderParticipantRows(); });
  });
})();
