

## Struktur file

- `index.html`: kerangka utama, metadata, urutan CSS/JavaScript, dan penanda include HTML.
- `src/templates/layout/`: header, footer, navigasi mobile.
- `src/templates/customer/`: halaman pengunjung, keranjang, checkout, dan tiket.
- `src/templates/admin/`: form login dan modal pengelolaan admin.
- `public/css/site.css`: styling tambahan dan animasi.
- `public/js/state.js`: data demo dan state aplikasi.
- `public/js/utils.js`: format rupiah dan toast.
- `public/js/navigation.js`: navigasi dan pergantian tampilan setelah login.
- `public/js/schedule.js`, `store.js`, `cart.js`, `checkout.js`, `tickets.js`, `facilities.js`: perilaku masing-masing fitur.
- `public/js/admin/`: autentikasi di browser, dashboard, jadwal, booking manual, reschedule, pembatalan, lapangan, jam, produk, dan verifikasi pembayaran.
- `public/js/customer-account.js`: akun peserta, verifikasi email, lupa password, dan riwayat.
- `public/js/tournaments.js` dan `public/js/admin/tournaments.js`: pendaftaran turnamen untuk peserta dan pengelolaan turnamen/peserta untuk admin.
- `public/js/init.js`: inisialisasi halaman.
- `server/admin-auth.mjs`: pemeriksaan login dan sesi di server.
- `server/customer-auth.mjs`: autentikasi peserta, email verifikasi/reset, dan API pemesanan.
- `server/tournaments.mjs`: API turnamen dan skema SQLite, dilindungi sesi admin untuk pengelolaan.
- `server/data/tournaments.sqlite`: basis data SQLite yang dibuat otomatis saat server pertama kali berjalan; folder ini diabaikan Git.
- `server/admin-panel.html`: dashboard yang hanya dikirim setelah login; jangan dipindahkan ke folder publik atau di-include ke halaman pengunjung.
- `tooling/html-partials.mjs`: menyatukan template HTML saat development dan build. Perubahan template memuat ulang halaman di development.

Edit file sesuai fitur di atas. HTML menggunakan event handler seperti `onclick`, sehingga JavaScript masih berupa script klasik dengan fungsi bersama dan `AppState`; urutan tag `defer` di `index.html` harus dipertahankan. Tidak ada fetch template tambahan di browser.

`src/App.tsx`, `src/main.tsx`, dan `src/index.css` merupakan scaffold React lama yang belum digunakan oleh halaman ini. Halaman aktif tetap memakai HTML dan JavaScript di struktur di atas.

Gunakan Node.js 22.13 atau yang lebih baru untuk dukungan `node:sqlite`. Jalankan `npm.cmd run build` kemudian `npm.cmd run test:auth` untuk memeriksa hasil build, API akun/turnamen, dan proteksi admin. Perintah menjalankan web tetap `npm.cmd run dev`.

## Menyiapkan akun admin

1. Jalankan `npm.cmd install`.
2. Jalankan `npm.cmd run admin:setup`, lalu isi username dan password (minimal 12 karakter). Input password disembunyikan.
3. Jalankan atau restart `npm.cmd run dev`, lalu buka http://localhost:3000.
4. Klik logo **BadmintonHub di header 5 kali dalam 2,5 detik** untuk membuka login.
5. Gunakan **Keluar Admin** untuk mengakhiri sesi.

Kredensial tersimpan di `.env.local` yang diabaikan Git. Untuk mengganti password, ulangi setup dan restart server. Sesi memakai cookie HttpOnly, berlaku 8 jam, dan hilang ketika server restart. Lima percobaan gagal dibatasi selama 15 menit per alamat IP.

Panel admin diberikan oleh server hanya setelah login. Data turnamen dan pendaftar disimpan persisten di `server/data/tournaments.sqlite`; API untuk membuat, mengubah, menghapus, dan memeriksa pendaftar memerlukan sesi admin. Pendaftar menerima kode untuk memeriksa status pendaftaran dan pembayaran. Unggah poster dan bukti pembayaran menerima JPG, PNG, atau WebP hingga 5 MB. Cadangkan file SQLite bersama prosedur backup server yang berlaku.

## Akun peserta dan email

Peserta dapat mendaftar/login melalui tombol **Masuk / Daftar**. Verifikasi email wajib dilakukan sebelum login; akun yang login dapat mendaftar turnamen dan melihat riwayat turnamen serta pemesanan. Pemesanan lapangan tetap dapat dilakukan sebagai tamu, tetapi hanya pesanan yang dibuat saat login yang otomatis terhubung ke riwayat akun; tamu menggunakan e-tiket/kode pesanan.

Untuk mengaktifkan email verifikasi dan reset password, siapkan Gmail khusus operasional, aktifkan Verifikasi 2 Langkah, lalu buat App Password. Atur rahasia berikut di `.env.local` (jangan commit atau kirim melalui chat):

```dotenv
SMTP_USER=akun-admin@gmail.com
SMTP_PASS=app-password-gmail
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_FROM=Badminton Hub <akun-admin@gmail.com>
APP_PUBLIC_URL=https://alamat-situs-anda
```

`APP_PUBLIC_URL` harus URL HTTPS publik yang benar saat produksi. Jangan mengaktifkan fitur akun di hosting publik tanpa konfigurasi SMTP dan HTTPS. Permintaan lupa password selalu dikirim ke email akun yang terverifikasi; respons publik tidak mengungkap apakah alamat terdaftar. Tautan reset berlaku 15 menit, satu kali pakai, dan menggugurkan sesi akun yang lama. Akun, sesi, pendaftaran, dan pesanan tersimpan di SQLite yang sama pada `server/data/tournaments.sqlite`. Pesanan tamu/akun kini dicatat di server; data demo yang hanya pernah berada di memori browser sebelum perubahan ini tidak dapat dipulihkan sebagai riwayat.

Login membutuhkan server Node yang menjalankan plugin autentikasi; mengunggah folder `dist` saja ke hosting statis tidak cukup. Untuk mencoba hasil build secara lokal: `npm.cmd run build`, lalu `npm.cmd run preview`. Pada hosting HTTPS melalui reverse proxy, set `ADMIN_COOKIE_SECURE=true` dan `APP_COOKIE_SECURE=true`. Jangan menaruh `.env.local` atau folder `server` pada direktori publik.

Setelah SMTP aktif, admin yang mengubah status pendaftaran menjadi **Diterima** atau **Ditolak** memicu email kepada peserta berisi nama turnamen, jadwal, lokasi, kategori, kode pendaftaran, dan status pembayaran. Saat admin mengonfirmasi pesanan lapangan menjadi **LUNAS/Disetujui**, atau menolak/membatalkannya, pelanggan menerima email berisi kode pesanan, slot jadwal, rincian, total, status, dan catatan admin. Email hanya dikirim saat status benar-benar berubah; kegagalan email tidak membatalkan perubahan status yang sudah tersimpan dan akan ditampilkan di dashboard admin.

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`
