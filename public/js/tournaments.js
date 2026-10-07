(() => {
  if (!document.getElementById) return;
  const cards = document.getElementById('tournament-cards');
  const detailModal = document.getElementById('tournament-detail-modal');
  const registrationModal = document.getElementById('tournament-registration-modal');
  const statusModal = document.getElementById('tournament-status-modal');
  let tournaments = [];
  let activeTournament = null;
  let pendingTournamentId = null;

  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);

  async function request(path, options = {}) {
    const response = await fetch(`/api/tournaments${path}`, {
      credentials: 'same-origin',
      ...options,
      headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers }
    });
    if (!response.headers.get('content-type')?.includes('application/json')) {
      throw new Error('Server turnamen tidak merespons dengan benar. Muat ulang halaman atau buka port aplikasi yang terbaru.');
    }
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Server tidak dapat dihubungi. Coba lagi.');
    return result;
  }

  function showModal(modal) {
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    document.body.style.overflow = 'hidden';
  }

  function closeTournamentModal(id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    if (![detailModal, registrationModal, statusModal].some(item => !item.classList.contains('hidden'))) {
      document.body.style.overflow = '';
    }
  }
  window.closeTournamentModal = closeTournamentModal;

  function formatDate(value, options = { dateStyle: 'long' }) {
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('id-ID', options).format(date);
  }

  function discountAmount(tournament, respectPeriod = true) {
    if (!tournament.discountValue || !tournament.discountLabel) return 0;
    if (respectPeriod) {
      const today = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit'
      }).format(new Date());
      if ((tournament.discountStart && today < tournament.discountStart) ||
          (tournament.discountEnd && today > tournament.discountEnd)) return 0;
    }
    return Math.min(tournament.discountType === 'percent'
      ? Math.floor(tournament.fee * tournament.discountValue / 100)
      : tournament.discountValue, Math.max(0, tournament.fee - tournament.minPayment));
  }

  function discountFor(tournament) {
    const amount = discountAmount(tournament);
    if (amount) return `${tournament.discountLabel} · hemat ${formatRp(amount)}`;
    const configuredAmount = discountAmount(tournament, false);
    if (!configuredAmount) return '';
    return tournament.discountType === 'percent'
      ? `${tournament.discountLabel} · diskon ${tournament.discountValue}%`
      : `${tournament.discountLabel} · potongan ${formatRp(configuredAmount)}`;
  }

  function renderCards() {
    if (!cards) return;
    if (!tournaments.length) {
      cards.innerHTML = '<div class="col-span-full rounded-2xl border border-slate-200 bg-white p-9 text-center"><i data-lucide="trophy" class="mx-auto mb-3 h-8 w-8 text-slate-300"></i><p class="font-bold text-slate-700">Belum ada turnamen</p><p class="mt-1 text-sm text-slate-500">Informasi turnamen akan tampil di sini saat tersedia.</p></div>';
      lucide.createIcons();
      return;
    }
    cards.innerHTML = tournaments.map(tournament => {
      const discount = discountFor(tournament);
      const deadline = formatDate(tournament.registrationDeadline.slice(0, 10), { day: 'numeric', month: 'short', year: 'numeric' });
      const categoryNames = tournament.categories.map(category => category.name).join(', ');
      return `<article class="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg">
        <button type="button" onclick="openTournamentDetails('${escapeHtml(tournament.id)}')" class="group relative block h-52 w-full overflow-hidden bg-slate-900 text-left">
          ${tournament.hasPoster ? `<img src="${escapeHtml(tournament.posterUrl)}" alt="Poster ${escapeHtml(tournament.name)}" class="h-full w-full object-cover transition duration-500 group-hover:scale-105">` : '<div class="flex h-full items-center justify-center text-emerald-400"><i data-lucide="trophy" class="h-14 w-14"></i></div>'}
          <span class="absolute left-3 top-3 rounded-full bg-emerald-500 px-3 py-1 text-[10px] font-extrabold uppercase tracking-wide text-slate-950">${tournament.registrationOpen ? 'Pendaftaran Dibuka' : 'Pendaftaran Ditutup'}</span>
        </button>
        <div class="space-y-4 p-5">
          <div><h3 class="text-lg font-extrabold leading-snug text-slate-900">${escapeHtml(tournament.name)}</h3>
            <p class="mt-2 line-clamp-2 text-xs leading-relaxed text-slate-500">${escapeHtml(tournament.description)}</p></div>
          <div class="grid grid-cols-2 gap-x-3 gap-y-3 text-xs">
            <div class="flex gap-2 text-slate-600"><i data-lucide="calendar-days" class="h-4 w-4 shrink-0 text-emerald-600"></i><span>${escapeHtml(formatDate(tournament.eventDate, { day: 'numeric', month: 'short', year: 'numeric' }))}</span></div>
            <div class="flex gap-2 text-slate-600"><i data-lucide="clock-3" class="h-4 w-4 shrink-0 text-emerald-600"></i><span>${escapeHtml(tournament.startTime)}–${escapeHtml(tournament.endTime)}</span></div>
            <div class="col-span-2 flex gap-2 text-slate-600"><i data-lucide="map-pin" class="h-4 w-4 shrink-0 text-emerald-600"></i><span>${escapeHtml(tournament.location)}</span></div>
            <div class="flex gap-2 text-slate-600"><i data-lucide="wallet" class="h-4 w-4 shrink-0 text-emerald-600"></i><span>${tournament.fee ? escapeHtml(formatRp(tournament.fee)) : 'Gratis'}</span></div>
            <div class="flex gap-2 text-slate-600"><i data-lucide="hourglass" class="h-4 w-4 shrink-0 text-emerald-600"></i><span>Daftar s.d. ${escapeHtml(deadline)}</span></div>
          </div>
          ${discount ? `<p class="rounded-lg bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800"><i data-lucide="tag" class="mr-1 inline h-3.5 w-3.5"></i>${escapeHtml(discount)}</p>` : ''}
          ${tournament.terms.length ? `<p class="line-clamp-2 text-[11px] leading-relaxed text-slate-500"><span class="font-bold text-slate-700">Syarat:</span> ${escapeHtml(tournament.terms.join(' · '))}</p>` : ''}
          <p class="text-[11px] text-slate-500">${escapeHtml(categoryNames)}</p>
          <div class="flex gap-2 border-t border-slate-100 pt-4">
            <button type="button" onclick="openTournamentDetails('${escapeHtml(tournament.id)}')" class="flex-1 rounded-xl border border-slate-300 px-3 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50">Lihat Detail</button>
            <button type="button" onclick="registerForTournament('${escapeHtml(tournament.id)}')" ${tournament.registrationOpen ? '' : 'disabled'} class="flex-1 rounded-xl bg-emerald-600 px-3 py-2.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300">Daftar Sekarang</button>
          </div>
        </div>
      </article>`;
    }).join('');
    lucide.createIcons();
  }

  function renderTournamentDetail(tournament) {
    const discount = discountFor(tournament);
    const discountPeriod = tournament.discountLabel
      ? `${tournament.discountStart || 'tanpa tanggal mulai'} – ${tournament.discountEnd || 'tanpa tanggal akhir'}`
      : '';
    const terms = tournament.terms.length
      ? `<ul class="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600">${tournament.terms.map(term => `<li>${escapeHtml(term)}</li>`).join('')}</ul>`
      : '<p class="mt-2 text-sm text-slate-500">Belum ada syarat khusus.</p>';
    document.getElementById('tournament-detail-content').innerHTML = `
      ${tournament.hasPoster ? `<img src="${escapeHtml(tournament.posterUrl)}" alt="Poster ${escapeHtml(tournament.name)}" class="mb-5 max-h-80 w-full rounded-xl bg-slate-100 object-contain">` : ''}
      <div class="space-y-5">
        <div><h3 class="text-xl font-extrabold text-slate-900">${escapeHtml(tournament.name)}</h3><p class="mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-600">${escapeHtml(tournament.description)}</p></div>
        <div class="grid grid-cols-1 gap-3 rounded-xl bg-slate-50 p-4 sm:grid-cols-2 text-sm">
          <p><span class="font-bold text-slate-800">Tanggal & waktu:</span> ${escapeHtml(formatDate(tournament.eventDate))}, ${escapeHtml(tournament.startTime)}–${escapeHtml(tournament.endTime)}</p>
          <p><span class="font-bold text-slate-800">Lokasi:</span> ${escapeHtml(tournament.location)}</p>
          <p><span class="font-bold text-slate-800">Biaya pendaftaran:</span> ${tournament.fee ? escapeHtml(formatRp(tournament.fee)) : 'Gratis'}</p>
          <p><span class="font-bold text-slate-800">Minimal pembayaran:</span> ${tournament.minPayment ? escapeHtml(formatRp(tournament.minPayment)) : 'Tidak ada'}</p>
          <p><span class="font-bold text-slate-800">Batas pendaftaran:</span> ${escapeHtml(formatDate(tournament.registrationDeadline.slice(0, 10)))} pukul ${escapeHtml(tournament.registrationDeadline.slice(11, 16))}</p>
          <p><span class="font-bold text-slate-800">Kategori:</span> ${tournament.categories.map(category => escapeHtml(`${category.name} (${category.teamSize} peserta)`)).join(', ')}</p>
        </div>
        ${discountPeriod ? `<div class="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><p class="font-bold">${escapeHtml(tournament.discountLabel)}${discount ? ` · hemat ${escapeHtml(formatRp(discountAmount(tournament)))}` : tournament.discountType === 'percent' ? ` · diskon ${tournament.discountValue}%` : ` · potongan ${escapeHtml(formatRp(discountAmount(tournament, false)))}`}</p><p class="mt-1 text-xs">Periode: ${escapeHtml(discountPeriod)}</p></div>` : ''}
        <div><h4 class="font-bold text-slate-900">Syarat & ketentuan</h4>${terms}</div>
        ${tournament.extraInfo ? `<div><h4 class="font-bold text-slate-900">Informasi tambahan</h4><p class="mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-600">${escapeHtml(tournament.extraInfo)}</p></div>` : ''}
        <button type="button" onclick="registerForTournament('${escapeHtml(tournament.id)}')" ${tournament.registrationOpen ? '' : 'disabled'} class="w-full rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300">${tournament.registrationOpen ? 'Daftar Sekarang' : 'Pendaftaran Ditutup'}</button>
      </div>`;
    document.getElementById('tournament-detail-title').textContent = tournament.name;
    lucide.createIcons();
  }

  async function openTournamentDetails(id) {
    try {
      const result = await request(`/${encodeURIComponent(id)}`);
      renderTournamentDetail(result.tournament);
      showModal(detailModal);
    } catch (error) { showToast(error.message, 'error'); }
  }
  window.openTournamentDetails = openTournamentDetails;

  function renderRegistrationFields(tournament, selectedCategory) {
    const form = document.getElementById('tournament-registration-form');
    const category = tournament.categories.find(item => item.name === selectedCategory) ?? tournament.categories[0];
    const customer = window.customerAccount?.user;
    const payableAmount = Math.max(0, tournament.fee - discountAmount(tournament));
    const teammateFields = Array.from({ length: Math.max(0, category.teamSize - 1) }, (_, index) =>
      `<label class="block"><span class="mb-1 block text-xs font-bold text-slate-700">Nama peserta ${index + 2} <span class="text-red-500">*</span></span><input name="teammate" required maxlength="120" class="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-emerald-500"></label>`
    ).join('');
    const extraFields = tournament.extraFields.map(field => `<label class="block"><span class="mb-1 block text-xs font-bold text-slate-700">${escapeHtml(field.label)}${field.required ? ' <span class="text-red-500">*</span>' : ''}</span><input name="extra:${escapeHtml(field.label)}" ${field.required ? 'required' : ''} maxlength="500" class="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-emerald-500"></label>`).join('');
    form.innerHTML = `
      <input type="hidden" name="tournamentId" value="${escapeHtml(tournament.id)}">
      <div class="rounded-xl bg-emerald-50 p-3"><p class="font-bold text-emerald-950">${escapeHtml(tournament.name)}</p><p class="mt-1 text-xs text-emerald-800">${escapeHtml(formatDate(tournament.eventDate))} · ${escapeHtml(tournament.startTime)}–${escapeHtml(tournament.endTime)} · ${tournament.fee ? escapeHtml(formatRp(tournament.fee)) : 'Gratis'}</p></div>
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label class="block sm:col-span-2"><span class="mb-1 block text-xs font-bold text-slate-700">Nama lengkap <span class="text-red-500">*</span></span><input name="fullName" required maxlength="120" autocomplete="name" value="${escapeHtml(customer?.fullName)}" class="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-emerald-500"></label>
        <label class="block"><span class="mb-1 block text-xs font-bold text-slate-700">Nomor WhatsApp <span class="text-red-500">*</span></span><input name="whatsapp" required maxlength="20" autocomplete="tel" inputmode="tel" pattern="[+]?[0-9 ()\\-]{8,20}" value="${escapeHtml(customer?.whatsapp)}" class="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-emerald-500"></label>
        <label class="block"><span class="mb-1 block text-xs font-bold text-slate-700">Email <span class="text-red-500">*</span></span><input name="email" type="email" required maxlength="254" autocomplete="email" value="${escapeHtml(customer?.email)}" class="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-emerald-500"></label>
        <label class="block sm:col-span-2"><span class="mb-1 block text-xs font-bold text-slate-700">Kategori pertandingan <span class="text-red-500">*</span></span><select name="category" required class="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm">${tournament.categories.map(item => `<option value="${escapeHtml(item.name)}" ${item.name === category.name ? 'selected' : ''}>${escapeHtml(item.name)} · ${item.teamSize} peserta</option>`).join('')}</select></label>
      </div>
      <div id="tournament-teammates" class="grid grid-cols-1 gap-4 sm:grid-cols-2">${teammateFields}</div>
      ${extraFields ? `<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">${extraFields}</div>` : ''}
      ${tournament.requiresPaymentProof && payableAmount ? `<label class="block"><span class="mb-1 block text-xs font-bold text-slate-700">Jumlah yang dibayarkan (Rp) <span class="text-red-500">*</span></span><input name="paymentAmount" type="number" required min="${tournament.minPayment}" max="${payableAmount}" value="${payableAmount}" step="1000" class="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-emerald-500"></label><label class="block"><span class="mb-1 block text-xs font-bold text-slate-700">Bukti pembayaran (JPG, PNG, WebP; maks. 5 MB) <span class="text-red-500">*</span></span><input id="tournament-payment-proof" name="paymentProof" type="file" accept="image/jpeg,image/png,image/webp" required class="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-xs file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2"></label>` : ''}
      <p class="text-xs leading-relaxed text-slate-500">${tournament.requiresPaymentProof && payableAmount ? `Minimal pembayaran ${escapeHtml(formatRp(tournament.minPayment))}. Bukti akan diverifikasi admin.` : 'Pendaftaran akan ditinjau oleh admin setelah dikirim.'}</p>
      <p id="tournament-registration-error" class="hidden rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-700" role="alert"></p>
      <button type="submit" class="w-full rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white hover:bg-emerald-700 disabled:cursor-wait disabled:opacity-60">Kirim Pendaftaran</button>`;
    form.elements.category.addEventListener('change', () => renderRegistrationFields(tournament, form.elements.category.value));
  }

  function fileAsDataUri(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Gagal membaca file gambar.'));
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(file);
    });
  }

  async function registerForTournament(id) {
    const tournament = tournaments.find(item => item.id === id) ?? (await request(`/${encodeURIComponent(id)}`)).tournament;
    if (!tournament.registrationOpen) {
      showToast('Pendaftaran turnamen ini sedang ditutup.', 'error');
      return;
    }
    if (!window.customerAccount?.user) {
      pendingTournamentId = id;
      window.customerAccount?.onAuthenticated(() => {
        const pendingId = pendingTournamentId;
        pendingTournamentId = null;
        if (pendingId) registerForTournament(pendingId);
      });
      closeTournamentModal('tournament-detail-modal');
      window.openCustomerAccount?.();
      showToast('Login atau daftar akun peserta terlebih dahulu untuk mendaftar turnamen.', 'info');
      return;
    }
    activeTournament = tournament;
    closeTournamentModal('tournament-detail-modal');
    renderRegistrationFields(tournament);
    showModal(registrationModal);
    document.getElementById('tournament-registration-form').elements.fullName.focus();
  }
  window.registerForTournament = id => registerForTournament(id).catch(error => showToast(error.message, 'error'));

  document.getElementById('tournament-registration-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector('[type="submit"]');
    const errorBox = document.getElementById('tournament-registration-error');
    const data = new FormData(form);
    submit.disabled = true;
    errorBox.classList.add('hidden');
    try {
      const paymentFile = form.elements.paymentProof?.files?.[0];
      if (paymentFile && paymentFile.size > 5 * 1024 * 1024) throw new Error('Ukuran bukti pembayaran maksimal 5 MB.');
      const extraData = {};
      form.querySelectorAll('[name^="extra:"]').forEach(field => {
        extraData[field.name.slice('extra:'.length)] = field.value.trim();
      });
      const payload = {
        fullName: data.get('fullName'),
        whatsapp: data.get('whatsapp'),
        email: data.get('email'),
        category: data.get('category'),
        teammates: [...form.querySelectorAll('[name="teammate"]')].map(field => field.value.trim()),
        extraData
      };
      if (data.has('paymentAmount')) payload.paymentAmount = Number(data.get('paymentAmount'));
      if (paymentFile) payload.paymentProof = await fileAsDataUri(paymentFile);
      const result = await request(`/${encodeURIComponent(activeTournament.id)}/registrations`, {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      closeTournamentModal('tournament-registration-modal');
      showToast('Pendaftaran berhasil dikirim.', 'success');
      openRegistrationStatus(result.code);
    } catch (error) {
      errorBox.textContent = error.message;
      errorBox.classList.remove('hidden');
    } finally {
      submit.disabled = false;
    }
  });

  async function loadRegistrationStatus(code) {
    const resultBox = document.getElementById('tournament-status-result');
    resultBox.innerHTML = '<p class="text-sm text-slate-500">Memeriksa status…</p>';
    try {
      const status = await request(`/registrations/${encodeURIComponent(code.trim().toUpperCase())}`);
      resultBox.innerHTML = `<div class="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm"><p class="font-bold text-emerald-950">${escapeHtml(status.tournamentName)}</p><p class="mt-2 text-slate-700">Kategori: ${escapeHtml(status.category)}</p><p class="mt-1 text-slate-700">Status pendaftaran: <strong>${escapeHtml(status.registrationStatus)}</strong></p><p class="mt-1 text-slate-700">Status pembayaran: <strong>${escapeHtml(status.paymentStatus)}</strong></p><p class="mt-3 border-t border-emerald-200 pt-3 text-xs text-slate-600">Kode pendaftaran: <span class="select-all font-mono font-bold">${escapeHtml(status.code)}</span></p></div>`;
    } catch (error) {
      resultBox.innerHTML = `<p class="rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">${escapeHtml(error.message)}</p>`;
    }
  }

  function openRegistrationStatus(code = '') {
    const form = document.getElementById('tournament-status-form');
    form.elements.code.value = code;
    document.getElementById('tournament-status-result').innerHTML = '';
    showModal(statusModal);
    if (code) loadRegistrationStatus(code);
    else form.elements.code.focus();
  }
  window.openRegistrationStatus = openRegistrationStatus;
  document.getElementById('tournament-status-form').addEventListener('submit', event => {
    event.preventDefault();
    loadRegistrationStatus(event.currentTarget.elements.code.value);
  });

  document.querySelectorAll('[id$="-modal"]').forEach(modal => {
    modal.addEventListener('click', event => {
      if (event.target === modal) closeTournamentModal(modal.id);
    });
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      [detailModal, registrationModal, statusModal].forEach(modal => {
        if (!modal.classList.contains('hidden')) closeTournamentModal(modal.id);
      });
    }
  });

  async function loadTournaments() {
    try {
      const result = await request('');
      if (!Array.isArray(result.tournaments)) throw new Error('Server tidak mengirim daftar turnamen yang valid.');
      tournaments = result.tournaments;
      renderCards();
    } catch (error) {
      cards.innerHTML = `<div class="col-span-full rounded-2xl border border-red-200 bg-red-50 p-6 text-center text-sm text-red-700">${escapeHtml(error.message)}</div>`;
    }
  }

  window.addEventListener('DOMContentLoaded', loadTournaments);
  window.addEventListener('focus', loadTournaments);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') loadTournaments();
  });
  window.setInterval(() => {
    if (document.visibilityState === 'visible') loadTournaments();
  }, 30000);
  window.addEventListener('storage', event => {
    if (event.key === 'badminton-hub:tournaments-updated') loadTournaments();
  });
})();
