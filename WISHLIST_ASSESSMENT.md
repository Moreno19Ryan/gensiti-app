# WISHLIST_ASSESSMENT.md — Cek Kelayakan Teknis

Assessment murni (kompleksitas, dependency, red flag) untuk tiap item di
`WISHLIST_PENGEMBANGAN_GENSITI.md`. **Tidak ada kode yang diubah untuk
dokumen ini** — semua temuan diverifikasi langsung dari isi repo (path file
disertakan supaya bisa dicek ulang), bukan tebakan.

Urutan analisis mengikuti permintaan: A4 → A2 → sisanya sesuai urutan
dokumen asli.

Skala kompleksitas: **Kecil** (jam–1 hari) · **Menengah** (beberapa hari) ·
**Besar** (butuh keputusan desain + effort multi-hari, atau berisiko ke data
production).

---

## A4 — Redesain Single-Session → Multi-Device

**Status: sudah ada analisis teknis lengkap sebelumnya — item ini BUKAN ide
baru.** `NATIVE_READINESS_AUDIT.md` §B.2 sudah membahas ini secara rinci
(diberi label **Risiko: Tinggi · Effort: Menengah–Besar**, ranking
prioritas **#4** dari 8 item), dengan rekomendasi eksplisit:

- **Opsi A (disarankan di sana):** ganti kolom tunggal `users.active_session_token`
  jadi tabel `user_sessions` (1 baris per device: token, user_agent/platform,
  last_seen), izinkan N device, UI "perangkat aktif" + logout per-device.
- **Opsi B:** batasi per-platform (mis. maks 1 web + 1 mobile).

**Kompleksitas: Besar.** Ini bukan cuma migrasi skema — menyentuh:
- `app/api/session/claim/route.ts` (klaim sesi saat login)
- `lib/user-context.tsx` (`checkSessionMasihValid`, polling 30 detik)
- `app/(dashboard)/monitoring/page.tsx` tab **Sesi Aktif** (lihat A5 — perlu
  dirombak dari "1 baris per user" jadi "N baris per user")
- Keputusan produk yang belum diambil: berapa device maksimal? Perlu UI
  "logout device lain" saat limit tercapai?

**Dependency:** A5 (Tampilan Sesi Aktif) bergantung penuh ke keputusan di
sini — kalau A4 dikerjakan, A5 otomatis perlu dirombak mengikuti model baru
(bukan pekerjaan terpisah, keduanya harus dikerjakan sebagai satu paket).

**Red flag:** ini **perubahan model data + alur otorisasi inti**, langsung
memicu Pasal 2 di CLAUDE.md ("Untuk keputusan besar/ambigu, tanya dulu").
Jangan dieksekusi tanpa keputusan eksplisit soal Opsi A vs B, dan tanpa
Supabase database branch untuk uji migrasi (bukan langsung ke
`ccyqgcfjmzgkmkczuydv`).

---

## A2 — Dashboard Kesehatan Sistem Terpusat

**Status: SEBAGIAN BESAR SUDAH ADA.** `app/(dashboard)/monitoring/page.tsx`
tab **"💡 Kesehatan Sistem"** (`KesehatanTab`, baris ±143–258) sudah
menampilkan real-time: jumlah pengguna aktif/nonaktif per tingkatan, jumlah
sesi tersimpan, error rate email + jumlah gagal/pending — persis "satu
pandangan gabungan" yang diminta wishlist. Tab ini sudah terbuka untuk
Super Admin **dan** Team IT (bukan cuma SA).

**Yang benar-benar masih gap:**
1. **Sentry belum masuk ke dashboard ini.** Kodenya sendiri **sudah 100%
   siap** — `instrumentation-client.ts`, `instrumentation.ts`,
   `sentry.server.config.ts`, `sentry.edge.config.ts` semua sudah wired
   dengan benar, `enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN`. **Tidak
   ada kode yang perlu ditulis untuk "mengaktifkan" Sentry** — itu murni
   soal mengisi `NEXT_PUBLIC_SENTRY_DSN`/`SENTRY_DSN` di Vercel env vars
   (persis seperti klaim wishlist). Aku tidak cek nilai env var Vercel
   secara langsung di sesi ini (di luar scope tool yang kupakai untuk
   assessment read-only ini) — tapi kalau mau menambahkan **jumlah
   error terbaru dari Sentry** ke `KesehatanTab`, itu butuh Sentry API call
   baru (MCP Sentry tersedia: `search_issues`/`search_events`), bukan
   sekadar mengisi DSN.
2. **Rate-limit hits (`auth_rate_limit`) belum ditampilkan sama sekali** di
   mana pun di UI — datanya sudah ada di DB (lihat A7), tinggal query count.

**Kompleksitas untuk menutup 2 gap di atas: Kecil–Menengah.** Menambah 1-2
card baru ke `KesehatanTab` yang sudah ada (pola sudah établished, tinggal
tambah query + card) — bukan membangun dashboard baru dari nol seperti
tersirat di wishlist.

---

## A1 — Rencana Pemulihan Darurat Akun Super Admin

**Verifikasi:** trigger `enforce_single_super_admin` memang ada dan aktif
(dikonfirmasi di `ARCHITECTURE.md` §4 — "Super Admin akun tunggal
mutlak"), jadi premis masalahnya valid.

**Kompleksitas: Kecil, TAPI ini murni pekerjaan dokumentasi/prosedur, bukan
kode.** Solusi yang diajukan wishlist sendiri ("akses langsung lewat
Supabase Dashboard oleh pemilik project") sudah cukup — Reno sebagai
project owner selalu bisa masuk Supabase Dashboard dan `UPDATE` langsung
row `users` (atau relaksasi sementara trigger-nya) tanpa perlu fitur baru
di aplikasi. Yang perlu dibuat cuma **runbook tertulis** (langkah persis,
disimpan di luar app — mis. password manager/dokumen terpisah, BUKAN di
repo publik kalau berisi kredensial).

**Red flag:** kalau ke depannya ingin fitur recovery **di dalam aplikasi**
(bukan cuma prosedur manual), itu otomatis butuh cara memverifikasi
"pemilik organisasi yang sah" di luar sistem auth normal — desainnya sendiri
riskan (bisa jadi backdoor kalau tidak hati-hati). Sarankan: cukup
runbook manual dulu, jangan buru-buru bikin mekanisme in-app.

---

## A3 — Jadwal Backup Otomatis + Reminder

**Verifikasi state sekarang:** `app/(dashboard)/backup-data/page.tsx` +
`app/api/backup/route.ts` — backup 100% manual (klik tombol, download
JSON ke device). Tidak ada `vercel.json` di repo (dicek — tidak ada),
jadi **tidak ada Vercel Cron terpasang** sama sekali sekarang.

**Temuan penting:** pola "aksi terjadwal" **sudah ada preseden** di
codebase ini, lewat 2 jalur berbeda:
1. **Client-polling** (`app/(dashboard)/monitoring/page.tsx` `MaintenanceTab`,
   `app/api/maintenance/activate-scheduled/route.ts`) — client polling tiap
   15 detik, endpoint idempotent dipanggil siapa saja yang online.
   **Kelemahan untuk kasus backup:** butuh ada user yang online saat waktu
   terjadwal tiba — tidak cocok untuk "reminder walau tidak ada yang buka
   app."
2. **Reminder berbasis DB function** — `send_reminder_h1_kegiatan` &
   `send_reminder_laporan_belum_diisi` (disebut di `ARCHITECTURE.md` §4)
   sudah ada sebagai fungsi database. CLAUDE.md mencatat **Google Apps
   Script (GAS)** sebagai bagian stack ("Script tambahan") — dugaan
   beralasan (belum terverifikasi langsung karena skrip GAS di luar repo
   ini): GAS kemungkinan jadi scheduler eksternal yang memanggil
   fungsi-fungsi reminder ini secara periodik, mengingat tidak ada
   pg_cron/Vercel Cron yang kutemukan di repo.

**Kompleksitas:**
- **Reminder "sudah X hari sejak backup terakhir" (in-app/email):** Menengah
  — butuh kolom baru (`last_backup_at`, kemungkinan di `system_config` yang
  sudah ada), lalu reminder-nya mengikuti pola scheduler yang sudah dipakai
  (GAS atau tambah endpoint baru dipanggil GAS).
- **Backup terjadwal otomatis tersimpan ke storage (bukan cuma download
  manual):** Besar — beda kelas masalah. `keuangan` sengaja dikecualikan
  dari backup (lihat komentar di `backup-data/page.tsx` baris 3–18,
  keputusan desain: Super Admin tidak boleh akses data keuangan). Backup
  otomatis ke Supabase Storage berarti file itu tersimpan permanen di
  suatu tempat — perlu keputusan baru soal **siapa yang boleh akses file
  storage itu** (kalau Super Admin yang trigger tapi filenya berisi data
  yang dia sendiri sengaja dibatasi aksesnya utk lihat langsung di app,
  itu kontradiktif — perlu dipikirkan ulang, bukan auto-include semua
  tabel yang sama seperti backup manual).

**Red flag:** opsi "backup otomatis ke storage" perlu didiskusikan dulu
soal scope aksesnya sebelum dieksekusi — bertentangan berpotensi dengan
prinsip pemisahan wewenang yang sudah sengaja dibangun di fitur backup
manual.

---

## A5 — Tampilan Sesi Aktif

**Status: SUDAH ADA, cukup lengkap — bukan gap.** Tab **"🔐 Sesi Aktif"**
di `app/(dashboard)/monitoring/page.tsx` (`SesiTab`, baris ±611–756) sudah:
- Menampilkan daftar user dengan sesi tersimpan (nama, role, waktu login
  terakhir)
- Tombol "Paksa Logout" per user (dengan modal konfirmasi, ada penanda
  khusus kalau target adalah sesi diri sendiri)
- Sudah tercatat ke audit log setiap kali dipakai
- Dibatasi Super Admin saja (sesuai prinsip least privilege)

**Satu-satunya gap nyata:** ini masih model **1 sesi per user** (kolom
tunggal `active_session_token`), jadi "sesi aktif" di sini berarti "device
TERAKHIR yang login", bukan daftar semua device yang sedang login
bersamaan. Ini **gap yang sama persis dengan A4** — begitu A4 dikerjakan
(model `user_sessions`), tab ini otomatis perlu diperbarui untuk
menampilkan N baris per user (device apa saja, bukan cuma 1).

**Rekomendasi: gabungkan A5 ke A4 sebagai satu paket kerja**, jangan
dikerjakan terpisah — mengerjakan A5 sendirian sekarang cuma akan
menghasilkan kode yang perlu ditulis ulang begitu A4 jalan.

---

## A6 — Eskalasi Otomatis untuk Approval yang Nyangkut

**Verifikasi state sekarang:** visibilitas pasif **sudah ada** —
`app/(dashboard)/dashboard/page.tsx` (baris ±19–38, ±590–623) sudah
menghitung dan menampilkan sebagai "Perlu Perhatian":
- PPG: `kegiatanMenunggu` + `pengumumanMenunggu` (approval Daerah yang
  masih pending)
- Ketua/Sekretaris (konten manager): jumlah kegiatan/pengumuman yang masih
  menunggu approval PPG
- Bendahara: `reimbursementPending` (jumlah reimbursement menunggu)

Field `status_approval: 'menunggu_ppg' | 'disetujui' | 'ditolak'`
(`lib/types.ts` baris 3) dan `PengajuanReimbursement.status: 'menunggu' |
'disetujui' | 'ditolak'` (baris 144) sudah cukup untuk query "berapa lama
sudah menunggu" — tinggal bandingkan `diajukan_at`/`created_at` ke `now()`.

**Yang benar-benar gap (sesuai definisi wishlist "eskalasi otomatis"):**
dashboard sekarang **pasif** (cuma tampil kalau approver buka Dashboard
sendiri) — **tidak ada** reminder proaktif (push/email) ke approver
maupun notifikasi ke Super Admin kalau sudah lewat X hari.

**Kompleksitas: Menengah.** Datanya sudah lengkap, tinggal:
1. Fungsi DB baru (pola sama seperti `send_reminder_h1_kegiatan` yang
   sudah ada) — cek pengajuan dgn `status = pending` DAN `created_at`/
   `diajukan_at` lebih tua dari threshold, kirim `notify_email`/`notify_push`
2. Wiring ke scheduler yang sudah dipakai (kemungkinan GAS, sama seperti
   A3)

Tidak ada red flag berarti — ini perluasan wajar dari pola yang sudah
established, bukan fitur baru dari nol.

---

## A7 — Alert untuk Rate-Limit Hits Berulang

**Verifikasi state sekarang:** tabel `auth_rate_limit` + RPC
`check_auth_rate_limit(p_key, p_max, p_window_seconds)` sudah live di
production (`NATIVE_READINESS_AUDIT.md` §5, migrasi `add_auth_rate_limit`,
20 Juli 2026) — sliding window atomic, `SECURITY DEFINER`, EXECUTE
**hanya service_role**. Dipakai di `resolve-login` (120 req/10 menit per
IP) dan `password-reset/request` (20 req/15 menit per IP), keduanya
**fail-open** (limiter error tidak pernah mengunci user sah).

**Datanya sudah tercatat, tapi TIDAK ADA yang membacanya balik** — tidak
ada UI atau alert apa pun yang query tabel `auth_rate_limit` sampai
sekarang. Ini beda dari A2/A5/A6 — di sini betul-betul gap kosong, bukan
"sudah ada tapi kurang lengkap."

**Kompleksitas: Kecil–Menengah.**
- Threshold sederhana ("1 IP kena limit >N kali dalam periode T") bisa
  dihitung dari `auth_rate_limit` langsung (tabel ini pada dasarnya **sudah**
  log semua percobaan, cuma belum ada yang membaca agregatnya).
- Card baru di `KesehatanTab` (Monitoring & Log) untuk quick win read-only
  — Kecil.
- Notifikasi aktif (push/email ke Super Admin) kalau threshold tercapai —
  Menengah, butuh keputusan threshold yang wajar (supaya tidak jadi alert
  fatigue untuk skala organisasi kecil ini).

---

## B1 — Gamifikasi Ringan untuk Generus

**Verifikasi:** dicek eksplisit — **tidak ada** kolom/tabel terkait poin,
badge, streak, atau leaderboard di manapun di codebase. Ini murni ide baru
dari nol, bukan perluasan sesuatu yang sudah ada.

**Kompleksitas: Besar.** Butuh tabel baru (poin per generus, riwayat
badge), logika perhitungan (kapan poin bertambah — tiap presensi? per
kegiatan selesai?), UI baru (halaman leaderboard, komponen badge), DAN
seperti sudah diakui di wishlist sendiri — **dimensi sosial/budaya**
organisasi yang perlu didiskusikan dengan pengurus lain dulu, bukan
keputusan teknis semata.

**Red flag (mengulang catatan wishlist sendiri, dan aku setuju):**
leaderboard antar-kelompok berisiko jadi kompetisi tidak sehat untuk
organisasi keagamaan/sosial — bukan pertimbangan teknis, tapi perlu
dipikirkan sebelum ini masuk roadmap resmi.

---

## B2 — Personalisasi Dashboard per Role

**Status: SUDAH SEBAGIAN BESAR ADA — wishlist agak understate ini.**
`app/(dashboard)/dashboard/page.tsx` sudah personalisasi konten
berdasarkan role login: PPG lihat antrean approval Daerahnya, Bendahara
lihat `reimbursementPending` + saldo bulan ini, konten manager (Ketua/
Wakil/Sekretaris) lihat status approval kegiatan/pengumumannya sendiri,
Team IT lihat health metrics. Bukan dashboard generik satu-untuk-semua.

**Yang mungkin masih dimaksud wishlist (kalau lebih dari yang sudah ada):**
"ringkasan kelompoknya langsung" untuk Ketua Kelompok — perlu klarifikasi
konkret apa yang dianggap kurang, karena dari kode yang ada, personalisasi
per-role based **sudah jalan**. Kalau yang dimaksud adalah widget
ringkasan tambahan (grafik tren kehadiran kelompok, dll — bukan cuma
angka), itu Kecil–Menengah (nambah card ke halaman yang sudah
personalized, bukan membangun ulang).

**Rekomendasi:** minta contoh konkret "dashboard idealnya kelihatan
seperti apa" sebelum dianggap sebagai item roadmap — supaya effort-nya
bisa dinilai akurat, bukan dari premis yang sudah separuh keliru.

---

## B3 — Mode Gelap (Dark Mode)

**Status: SUDAH DIBANGUN & BERFUNGSI, TAPI ROLLOUT BARU ~21%.** Ini temuan
paling signifikan dari assessment ini — wishlist menyebut dark mode
seolah belum ada sama sekali, padahal:

- Infrastrukturnya **lengkap**: `app/globals.css` punya
  `@custom-variant dark (&:where(.dark, .dark *))` + override CSS untuk
  warna dasar (bg, border, text, input, table, shadow)
- Toggle-nya **sudah ada & berfungsi**: `app/(dashboard)/profil/page.tsx`
  ("Mode Gelap" switch, baris ±400) — simpan preferensi ke
  `localStorage` (`gensiti_dark_mode`), toggle class `dark` di
  `document.documentElement`
- **Tapi baru dipakai di 10 dari 47 file `.tsx`** (dicek langsung via
  grep): 6 halaman di bawah `/profil/*`, `app/(dashboard)/layout.tsx`
  (shell), dan 3 komponen bersama (`LoadingSpinner`, `ProfilHeader`,
  `GlobalSearch`). **Modul inti seperti Keuangan, Presensi, Kegiatan,
  Generus, Organisasi, Audit Log, Monitoring, Dashboard sendiri BELUM**
  punya kelas `dark:` sama sekali — kalau user aktifkan Mode Gelap dari
  Profil lalu buka halaman-halaman itu, tampilannya kemungkinan pecah
  (background putih polos, teks tidak kebaca kalau ada elemen gelap lain).

**Kompleksitas untuk menuntaskan sisanya: Menengah**, tapi **mekanis**
(bukan butuh keputusan desain baru — pola `dark:` yang dipakai sudah
konsisten, tinggal diterapkan berulang ke ±37 file tersisa). Bisa
dicicil per-modul tanpa risiko ke fungsi lain (murni styling).

---

## B4 — Aksesibilitas (Ukuran Teks & Kontras)

**Verifikasi:** tidak ditemukan mekanisme serupa yang sudah ada.

**Kompleksitas: Menengah.** Kabar baik: **pola pengirimannya bisa
mencontek persis mekanisme Mode Gelap (B3)** yang sudah terbukti jalan —
toggle di halaman Profil, simpan preferensi ke `localStorage`, terapkan
lewat class di `documentElement` (mis. `text-scale-lg`,
`high-contrast`) + custom property CSS di `globals.css`. Bukan pola baru
yang perlu didesain dari nol.

Yang bikin ini Menengah (bukan Kecil) bukan soal toggle-nya, tapi soal
cakupan: sama seperti B3, begitu ditambahkan perlu diterapkan konsisten
ke seluruh halaman, bukan cuma mekanismenya doang.

---

## B5 — Export Data Personal untuk Anggota

**Status: separuh jalan.** `app/(dashboard)/profil/riwayat-absensi/page.tsx`
**sudah** menampilkan riwayat kehadiran pribadi Generus (self-service,
sudah scoped ke `user_id` sendiri via join ke `generus`) — tapi **cuma
tampilan list, tidak ada tombol export/download**.

**Kompleksitas: Kecil.** `lib/export.ts` sudah jadi helper reusable
(dipakai di Keuangan, Presensi, Generus, Kegiatan — lihat komentar baris
1–5 file tsb: "Helper reusable untuk export laporan ke PDF & Excel") dgn
API yang rapi (`ExportColumn`, `ExportOptions`, auto-badge-coloring per
status). Menambah tombol export di halaman yang **sudah mengambil
datanya** (`riwayatPresensi` sudah ada di state) tinggal panggil helper
yang sudah ada — bukan membangun sistem export baru.

---

## Ringkasan

| Item | Status Ditemukan | Kompleksitas Sisa |
|---|---|---|
| A1 | Belum ada — murni prosedur, bukan kode | Kecil (dokumentasi) |
| A2 | Sebagian besar SUDAH ADA (`KesehatanTab`) | Kecil–Menengah (2 card baru) |
| A3 | Belum ada — tapi pola scheduler sudah ada preseden | Menengah (reminder) / Besar (backup ke storage, perlu keputusan akses) |
| A4 | Belum dikerjakan, tapi SUDAH ada analisis desain lengkap di NATIVE_READINESS_AUDIT.md | Besar |
| A5 | SUDAH ADA & fungsional, gap-nya identik dgn A4 | Gabung ke A4 |
| A6 | Visibilitas pasif SUDAH ADA, tinggal tambah proaktif | Menengah |
| A7 | Data sudah dicatat, belum ada yg membaca | Kecil–Menengah |
| B1 | Belum ada sama sekali | Besar + perlu diskusi non-teknis |
| B2 | Sebagian besar SUDAH ADA, wishlist agak understate | Perlu klarifikasi scope dulu |
| B3 | SUDAH DIBANGUN, rollout baru 21% (10/47 file) | Menengah, mekanis |
| B4 | Belum ada, tapi bisa contek pola B3 | Menengah |
| B5 | Separuh jalan (view ada, export belum) | Kecil |

**Catatan paling penting dari assessment ini:** setidaknya **6 dari 12
item** (A2, A5, A6, B2, B3, B5) ternyata **sudah punya fondasi nyata di
codebase** — beberapa (A5, B3) malah sudah fungsional, hanya belum
lengkap cakupannya. Sebelum eksekusi dimulai, ada baiknya urutan prioritas
di `WISHLIST_PENGEMBANGAN_GENSITI.md` (§"Ringkasan Prioritas") ditinjau
ulang dengan info ini — beberapa item yang ditandai "Tinggi/Sedang" di
sana ternyata quick win (A2, A7, B5), sementara A4 (yang di dokumen asal
tidak diberi urutan eksplisit selain "Kritis") kemungkinan butuh effort
paling besar dan paling banyak keputusan produk yang belum diambil.
