(() => {
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
  let user = null;
  let afterLogin = null;
  const modalId = 'customer-account-modal';

  function addModal() {
    if (document.getElementById(modalId)) return;
    document.body.insertAdjacentHTML('beforeend', `<div id="${modalId}" class="fixed inset-0 z-[90] hidden items-center justify-center bg-slate-950/70 p-3 sm:p-6" role="dialog" aria-modal="true" aria-labelledby="customer-account-title">
      <div class="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-2xl">
        <div class="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white/95 px-5 py-4 backdrop-blur"><h2 id="customer-account-title" class="text-lg font-extrabold text-slate-900">Akun Peserta</h2><button type="button" data-customer-close class="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Tutup">✕</button></div>
        <div id="customer-account-content" class="p-5 sm:p-7"></div>
      </div>
    </div>`);
    const modal = document.getElementById(modalId);
    modal.addEventListener('click', event => {
      if (event.target === modal || event.target.closest('[data-customer-close]')) close();
      const mode = event.target.closest('[data-customer-mode]')?.dataset.customerMode;
      if (mode) {
        event.preventDefault();
        renderForm(mode);
      }
      const action = event.target.closest('[data-customer-action]')?.dataset.customerAction;
      if (action === 'logout') logout();
      if (action === 'refresh-history') loadHistory();
    });
    modal.addEventListener('submit', submitForm);
  }

  function show() {
    const modal = document.getElementById(modalId);
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    document.body.style.overflow = 'hidden';
  }

  function close() {
    const modal = document.getElementById(modalId);
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    document.body.style.overflow = '';
  }

  async function request(path, options = {}) {
    const response = await fetch(`/api/account${path}`, {
      credentials: 'same-origin',
      ...options,
      headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers }
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Permintaan akun gagal. Coba lagi.');
    return result;
  }

  function renderForm(mode = 'login', message = '', resetToken = '') {
    addModal();
    const content = document.getElementById('customer-account-content');
    const common = '<p id="customer-account-error" class="mb-4 hidden rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-700" role="alert"></p>';
    let body;
    if (mode === 'register') {
      body = `<p class="mb-5 text-sm text-slate-600">Daftar akun untuk mengelola pendaftaran turnamen dan melihat riwayat.</p>
        <form class="space-y-4" data-customer-form="register">
          <label class="block text-xs font-bold text-slate-700">Nama lengkap<input name="fullName" required minlength="2" maxlength="120" autocomplete="name" class="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"></label>
          <label class="block text-xs font-bold text-slate-700">Nomor WhatsApp<input name="whatsapp" required maxlength="20" pattern="[+]?[0-9 ()\\-]{8,20}" autocomplete="tel" class="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"></label>
          <label class="block text-xs font-bold text-slate-700">Email<input name="email" type="email" required maxlength="254" autocomplete="email" class="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"></label>
          <label class="block text-xs font-bold text-slate-700">Password (minimal 12 karakter)<input name="password" type="password" required minlength="12" maxlength="256" autocomplete="new-password" class="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"></label>
          ${common}<button class="w-full rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white hover:bg-emerald-700">Buat Akun</button>
        </form><p class="mt-4 text-center text-sm text-slate-600">Sudah punya akun? <button data-customer-mode="login" class="font-bold text-emerald-700">Login</button></p>`;
    } else if (mode === 'forgot') {
      body = `<p class="mb-5 text-sm text-slate-600">Masukkan email akun. Jika terdaftar, tautan reset akan dikirim ke email tersebut.</p>
        <form class="space-y-4" data-customer-form="forgot"><label class="block text-xs font-bold text-slate-700">Email<input name="email" type="email" required maxlength="254" autocomplete="email" class="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"></label>
          ${common}<button class="w-full rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white">Kirim Tautan Reset</button>
        </form><button data-customer-mode="login" class="mt-4 text-sm font-bold text-emerald-700">Kembali ke login</button>`;
    } else if (mode === 'reset') {
      body = `<p class="mb-5 text-sm text-slate-600">Buat password baru minimal 12 karakter. Tautan reset hanya dapat digunakan sekali.</p>
        <form class="space-y-4" data-customer-form="reset"><input name="token" type="hidden" value="${escapeHtml(resetToken)}">
          <label class="block text-xs font-bold text-slate-700">Password baru<input name="password" type="password" required minlength="12" maxlength="256" autocomplete="new-password" class="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"></label>
          ${common}<button class="w-full rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white">Simpan Password Baru</button>
        </form>`;
    } else {
      body = `<p class="mb-5 text-sm text-slate-600">Login untuk mendaftar turnamen dan melihat riwayat akun.</p>
        <form class="space-y-4" data-customer-form="login"><label class="block text-xs font-bold text-slate-700">Email<input name="email" type="email" required maxlength="254" autocomplete="email" class="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"></label>
          <label class="block text-xs font-bold text-slate-700">Password<input name="password" type="password" required maxlength="256" autocomplete="current-password" class="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"></label>
          ${common}<button class="w-full rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white">Login</button>
        </form><div class="mt-4 flex justify-between gap-3 text-sm"><button data-customer-mode="forgot" class="font-semibold text-emerald-700">Lupa password?</button><button data-customer-mode="register" class="font-bold text-emerald-700">Daftar akun</button></div>`;
    }
    content.innerHTML = `${message ? `<p class="mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">${escapeHtml(message)}</p>` : ''}${body}`;
    content.querySelector('input:not([type="hidden"])')?.focus();
    lucide.createIcons();
  }

  function renderHistory(registrations, bookings) {
    const tournamentRows = registrations.length ? registrations.map(item => `<article class="rounded-xl border border-slate-200 p-3"><div class="flex flex-wrap items-start justify-between gap-2"><h4 class="font-bold text-slate-900">${escapeHtml(item.tournamentName)}</h4><span class="rounded-full bg-amber-50 px-2 py-1 text-[10px] font-bold text-amber-800">${escapeHtml(item.registrationStatus)}</span></div><p class="mt-1 text-xs text-slate-600">${escapeHtml(item.category)} · ${escapeHtml(item.eventDate)} · Pembayaran: ${escapeHtml(item.paymentStatus)}</p><p class="mt-2 text-[11px] text-slate-500">Kode: <span class="select-all font-mono font-bold">${escapeHtml(item.code)}</span></p></article>`).join('') : '<p class="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">Belum ada pendaftaran turnamen.</p>';
    const bookingRows = bookings.length ? bookings.map(item => `<article class="rounded-xl border border-slate-200 p-3"><div class="flex flex-wrap items-start justify-between gap-2"><h4 class="font-bold text-slate-900">Pesanan ${escapeHtml(item.id)}</h4><span class="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-800">${escapeHtml(item.status)}</span></div><p class="mt-1 text-xs text-slate-600">${escapeHtml(item.details)}</p><p class="mt-1 text-xs font-bold text-slate-800">${escapeHtml(formatRp(item.total))}</p><p class="mt-1 text-[11px] text-slate-500">${escapeHtml(item.createdAt)}</p></article>`).join('') : '<p class="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">Belum ada riwayat pemesanan lapangan dari akun ini.</p>';
    document.getElementById('customer-account-content').innerHTML = `<div class="flex flex-wrap items-center justify-between gap-3"><div><p class="text-sm font-bold text-slate-900">${escapeHtml(user.fullName)}</p><p class="text-xs text-slate-500">${escapeHtml(user.email)}</p></div><div class="flex gap-2"><button data-customer-action="refresh-history" class="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold">Perbarui</button><button data-customer-action="logout" class="rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white">Keluar</button></div></div>
      <div class="mt-6 grid gap-6"><section><h3 class="mb-3 text-sm font-extrabold text-slate-900">Pendaftaran Turnamen</h3><div class="space-y-2">${tournamentRows}</div></section><section><h3 class="mb-3 text-sm font-extrabold text-slate-900">Riwayat Pemesanan</h3><div class="space-y-2">${bookingRows}</div></section></div>`;
    lucide.createIcons();
  }

  async function loadHistory() {
    try {
      const result = await request('/history');
      renderHistory(result.registrations, result.bookings);
      return result;
    } catch (error) {
      showToast(error.message, 'error');
      return null;
    }
  }

  async function submitForm(event) {
    const form = event.target.closest('[data-customer-form]');
    if (!form) return;
    event.preventDefault();
    const mode = form.dataset.customerForm;
    const button = form.querySelector('button[type="submit"], button:not([data-customer-mode])');
    const errorBox = form.querySelector('[role="alert"]');
    const data = new FormData(form);
    if (button) button.disabled = true;
    errorBox?.classList.add('hidden');
    try {
      if (mode === 'register') {
        const result = await request('/register', { method: 'POST', body: JSON.stringify(Object.fromEntries(data)) });
        renderForm('login', result.message);
      } else if (mode === 'login') {
        const result = await request('/login', { method: 'POST', body: JSON.stringify(Object.fromEntries(data)) });
        user = result.user;
        document.getElementById('customer-account-nav-label').textContent = 'Akun Saya';
        const history = await loadHistory();
        if (!history) return;
        window.dispatchEvent(new CustomEvent('customer:authenticated', { detail: { user } }));
        window.dispatchEvent(new CustomEvent('customer:history-updated'));
      } else if (mode === 'forgot') {
        const result = await request('/password/forgot', { method: 'POST', body: JSON.stringify({ email: data.get('email') }) });
        renderForm('login', result.message);
      } else if (mode === 'reset') {
        const result = await request('/password/reset', { method: 'POST', body: JSON.stringify(Object.fromEntries(data)) });
        history.replaceState(null, '', location.pathname + location.hash);
        renderForm('login', result.message);
      }
    } catch (error) {
      if (errorBox) {
        errorBox.textContent = error.message;
        errorBox.classList.remove('hidden');
      } else showToast(error.message, 'error');
    } finally {
      if (button?.isConnected) button.disabled = false;
    }
  }

  async function logout() {
    try {
      await request('/logout', { method: 'POST' });
      user = null;
      document.getElementById('customer-account-nav-label').textContent = 'Masuk / Daftar';
      renderForm('login', 'Anda sudah keluar dari akun.');
      window.dispatchEvent(new CustomEvent('customer:signed-out'));
    } catch (error) { showToast(error.message, 'error'); }
  }

  async function openCustomerAccount() {
    addModal();
    show();
    if (user) await loadHistory();
    else renderForm('login');
  }

  window.openCustomerAccount = openCustomerAccount;
  window.customerAccount = {
    get user() { return user; },
    onAuthenticated(callback) { afterLogin = callback; }
  };

  async function initialize() {
    addModal();
    document.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
    try {
      const result = await request('/session');
      user = result.user;
      if (user) document.getElementById('customer-account-nav-label').textContent = 'Akun Saya';
    } catch (error) {
      console.error('Gagal memeriksa sesi peserta:', error.message);
    }
    const params = new URLSearchParams(location.search);
    const verifyToken = params.get('verifyEmail');
    const resetToken = params.get('resetPassword');
    if (verifyToken) {
      history.replaceState(null, '', location.pathname + location.hash);
      try {
        const result = await request('/verify-email', { method: 'POST', body: JSON.stringify({ token: verifyToken }) });
        await openCustomerAccount();
        renderForm('login', result.message);
      } catch (error) {
        await openCustomerAccount();
        renderForm('login', error.message);
      }
    } else if (resetToken) {
      history.replaceState(null, '', location.pathname + location.hash);
      renderForm('reset', '', resetToken);
      show();
    }
    document.addEventListener('customer:authenticated', () => {
      if (afterLogin) {
        const callback = afterLogin;
        afterLogin = null;
        close();
        callback();
      }
    });
  }

  window.addEventListener('DOMContentLoaded', initialize);
  window.addEventListener('customer:history-updated', () => {
    if (user && !document.getElementById(modalId)?.classList.contains('hidden')) loadHistory();
  });
})();
