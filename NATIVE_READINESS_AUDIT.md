# GENSITI — Audit Kesiapan Arsitektur untuk Native (Flutter / Tauri / Electron)

Dokumen ini menilai kesiapan arsitektur GENSITI **saat ini** (per 20 Juli 2026) sebelum
mulai pengembangan aplikasi native:

- **Mobile**: Android & iOS via Flutter (rebuild UI, reuse backend/logic)
- **Desktop**: Windows & Mac via Tauri/Electron (idealnya reuse kode web langsung)

Sifatnya **assessment & rekomendasi** — belum ada kode yang diubah. Untuk konteks
produk/arsitektur, lihat [CLAUDE.md](CLAUDE.md), [ARCHITECTURE.md](ARCHITECTURE.md),
[HANDOFF.md](HANDOFF.md).

> **Catatan cakupan audit.** Temuan di bawah berbasis pembacaan **kode** (`app/api/*`,
> `lib/*`, `components/*`, config) secara langsung. Yang **belum** diverifikasi dari sesi
> ini adalah isi sebenarnya dari **RLS policy & body RPC di database Supabase**
> (project `ccyqgcfjmzgkmkczuydv`) — beberapa temuan di kategori A.3 dan G.1 karena itu
> ditandai **"perlu verifikasi langsung DB"** (lewat Supabase MCP `list_tables` verbose /
> query `pg_policies`, atau dashboard). Itu adalah langkah pertama yang direkomendasikan,
> bukan asumsi yang sudah dipastikan.

> **⟳ Pembaruan 20 Juli 2026 — verifikasi DB & perbaikan Batch A sudah dijalankan.**
> RLS 22 tabel & fungsi SECURITY DEFINER sudah diinspeksi langsung (`pg_policies`,
> `pg_proc`, security advisor). Hasil: fondasi lebih kuat dari dugaan awal — `users`
> sudah write-locked ke super_admin (self-escalation terblokir), `password_reset_otp`
> deny-all benar, dan fungsi laporan/`global_search`/`ajukan_izin_presensi` semuanya
> punya guard `auth.uid()`/tingkatan internal (tidak bocor walau anon-executable). Migrasi
> `harden_rls_generus_write_and_cleanup` sudah diterapkan (lihat "Log Perubahan" di akhir
> dokumen). Bagian A.3, F/G di bawah sudah diperbarui dengan status aktual.

---

## 1. Ringkasan Eksekutif

**Kesiapan keseluruhan: ± 60%.** Fondasi datanya kuat dan sebagian besar sudah
platform-agnostic — Supabase (Postgres + Auth + Realtime) memang dirancang untuk diakses
dari client manapun, dan otentikasinya berbasis JWT (bukan cookie/header khusus browser).
Artinya "otak" aplikasi (data + auth) secara konsep sudah bisa dipakai ulang dari Flutter
maupun desktop. Tapi ada **beberapa gap struktural** yang lebih murah diperbaiki
**sebelum** ada 3–4 client baru yang bergantung pada backend yang sama, karena setelah itu
setiap perubahan harus dikoordinasikan lintas platform.

**3 gap terbesar (harus dibereskan lebih dulu):**

1. **Logika otorisasi terduplikasi di lapisan aplikasi, bukan di database.** Aturan siapa
   boleh melakukan apa (`canManageMembers`, `canActOnScope`, hierarki `TINGKATAN_HIERARKI`,
   normalisasi `login_username`) di-copy manual di **3 tempat** sekarang: `lib/roles.ts`
   (gate UI), `app/api/users/route.ts`, dan `app/api/generus/route.ts` (enforcement server).
   Flutter akan jadi **salinan ke-4 (Dart)**. Setiap salinan yang tidak sinkron = celah
   keamanan. Sumber kebenaran sesungguhnya harus turun ke DB (RPC `SECURITY DEFINER` + RLS)
   supaya satu definisi dipakai semua platform.

2. **Single-session enforcement memblokir multi-device by design.** Model sesi tunggal
   saat ini (satu `active_session_token` per user) akan membuat web dan mobile saling
   menendang keluar kalau login bersamaan. Untuk native ini harus didesain ulang jadi model
   multi-device.

3. **Anon key akan ter-embed di APK/IPA/binary desktop** (bisa diekstrak siapa saja). Ini
   normal untuk Supabase **asalkan RLS rapat**. Karena operasi sensitif sekarang "aman"
   hanya karena lewat service-role di server web, perlu dipastikan RLS di DB **juga**
   menolak akses langsung anon/authenticated ke operasi yang sama.

**Yang sudah bagus:** CI gate sudah ada (typecheck+lint+test), palet warna terpusat di
`globals.css`, Realtime cuma dipakai untuk presence (portable), otentikasi berbasis JWT,
dan API route sebenarnya **sudah reachable via HTTP dari client manapun** (jadi bukan
"terjebak" total — hanya terkopel ke deployment Vercel + logikanya terduplikasi).

---

## 2. Temuan per Kategori

Skala **Risiko**: Rendah / Sedang / Tinggi (dampak kalau tidak dibereskan sebelum native).
Skala **Effort**: Kecil (jam–hari) / Menengah (beberapa hari) / Besar (minggu+).

---

### A. Portabilitas Backend & Business Logic

#### A.1 — API route yang pakai service role key
**Risiko: Sedang · Effort: Besar**

8 dari 9 route memakai `SUPABASE_SERVICE_ROLE_KEY` (bypass RLS + verifikasi manual):

| Route | Fungsi | Kandidat pindah ke |
|---|---|---|
| `app/api/users` (POST/PATCH) | CRUD akun + hierarki role | RPC `SECURITY DEFINER` |
| `app/api/generus` (GET/PATCH) | CRUD biodata + anti-IDOR scope | RPC `SECURITY DEFINER` |
| `app/api/resolve-login` (POST) | nama → email (pra-login) | Edge Function / RPC anon-safe |
| `app/api/session/claim` (POST) | klaim sesi tunggal | RPC (setelah redesign, lihat B.2) |
| `app/api/backup` (POST) | ekspor 10 tabel (Super Admin) | RPC `SECURITY DEFINER` atau tetap |
| `app/api/maintenance/activate-scheduled` (POST) | eksekusi jadwal maintenance | RPC / pg_cron |
| `app/api/password-reset/request` (POST) | kirim OTP email | Edge Function |
| `app/api/password-reset/confirm` (POST) | verifikasi OTP + set password | Edge Function |
| `app/api/health` (GET) | health check (tanpa Supabase) | — (biarkan) |

**Nuansa penting:** route ini **bukan "terjebak"** dalam arti tak bisa dipanggil dari luar
— semuanya endpoint HTTP biasa, Flutter/desktop **bisa** `POST` ke
`https://gensiti-app.vercel.app/api/users` dengan Bearer token. Masalah sesungguhnya ada 2:
(a) **terkopel ke deployment web Vercel** — kalau web di-maintenance/rollback, backend
mobile ikut mati; dan (b) **logika otorisasinya diduplikasi** (lihat A.2). Memindahkan
enforcement ke **RPC `SECURITY DEFINER`** (untuk operasi authenticated) dan **Edge Function
Supabase** (untuk yang pra-login seperti resolve-login & password-reset) menghilangkan kedua
masalah: backend jadi hidup independen dari web, dan aturannya cuma ditulis sekali di DB.

> Rekomendasi bertahap: mulai dari yang paling "murni fungsi" (resolve-login,
> password-reset → Edge Function) karena paling gampang dilepas, lalu users/generus
> (paling berdampak, paling banyak logika) sebagai fase berikutnya.

#### A.2 — Business logic yang "terjebak" di client
**Risiko: Tinggi · Effort: Menengah**

- **Duplikasi aturan otorisasi (paling kritikal).** `canManageMembers`, `canActOnScope`,
  `getAllowedTargetTingkatan`, `TINGKATAN_HIERARKI` ada di `lib/roles.ts` **dan** di-copy
  verbatim di `app/api/users/route.ts` + `app/api/generus/route.ts` (dikonfirmasi oleh
  komentar di kode: *"Duplikat kecil… sengaja tidak diekstrak"*). Untuk web, keputusan itu
  masuk akal. Untuk multi-platform, ini bom waktu: Flutter tak bisa `import` file TS, jadi
  akan jadi salinan ke-4 dalam Dart. **Solusi:** jadikan DB sumber kebenaran (fungsi `is_*()`
  + RPC yang sudah `SECURITY DEFINER` — sebagian sudah ada per ARCHITECTURE.md §4), client
  mana pun (web/Flutter) cukup memanggilnya untuk gate UI, tidak menuliskan ulang aturannya.
- **Normalisasi `login_username`** (`trim + collapse spasi + uppercase`) diduplikasi di **4
  tempat**: `app/login/page.tsx`, `resolve-login`, `users/route.ts`, `generus/route.ts`.
  Idealnya jadi satu fungsi DB dipakai resolve-login RPC.
- **Generate PDF/Excel** (`lib/export.ts`, pakai `jspdf`/`exceljs`) murni client-side/browser.
  Flutter **tidak bisa** reuse ini — perlu implementasi ulang (mis. package `pdf`/`excel`
  Dart) atau dipindah jadi Edge Function yang mengembalikan file. Bukan blocker native, tapi
  perlu dianggarkan.
- **Kabar baik:** perhitungan laporan bulanan (H/I/S/A, agregasi) sudah di **RPC** (ARCHITECTURE.md
  §4), bukan di React — ini justru contoh yang benar dan langsung reusable dari Flutter.

#### A.3 — RLS yang diam-diam mengasumsikan pemanggil dari web
**Risiko: Sedang → ✅ TERVERIFIKASI (20 Juli 2026) — tidak ada asumsi web**

Dari kode, otentikasi & RLS berbasis **`auth.uid()` / JWT** (helper `get_user_role`,
`get_user_tingkatan`, `is_pengurus`, dst per ARCHITECTURE.md §4) — **tidak** ada
ketergantungan pada header khusus browser, cookie, atau `Origin`. Secara desain ini
**platform-agnostic** (JWT dari Flutter/desktop diperlakukan sama).

**Terkonfirmasi via `pg_policies`:** seluruh 22 tabel RLS-nya berbasis `auth.uid()` +
fungsi helper `get_user_*()`/`is_*()`. **Tidak ada** policy yang membaca
`current_setting('request.header...')`, `Origin`, atau asumsi khusus browser lain. Semua
tabel & RPC bisa diakses identik dari mobile/desktop. **Aman untuk multi-platform.**

---

### B. Autentikasi & Session

#### B.1 — Ketergantungan Supabase Auth pada API browser-only
**Risiko: Sedang · Effort: Menengah**

- Alur inti (`signInWithPassword`, `getSession`, `onAuthStateChange`, `authFetch` yang inject
  `Bearer`) **konseptnya portable** — `supabase_flutter` & Supabase JS di desktop punya API
  setara.
- **Titik browser-only:** `lib/supabase.ts` memakai **custom storage adapter `dualStorage`**
  berbasis `localStorage`/`sessionStorage`/`window` untuk fitur "Ingat saya di perangkat ini".
  Ini **tidak jalan di Flutter** (harus pakai secure storage `supabase_flutter`). Untuk
  desktop berbasis web (Tauri/Electron) `localStorage` tetap ada, jadi **bisa reuse langsung**.
  Konsep "remember me → persistent vs session storage" perlu ditulis ulang di Flutter, tapi
  logikanya sederhana.
- `lib/user-context.tsx`, `lib/push.ts` memakai `window`/`navigator`/`localStorage` → lapisan
  React ini memang akan di-rebuild untuk Flutter; yang penting **helper data/auth-nya** (di
  `lib/auth.ts`) sudah bersih.

#### B.2 — Single-session enforcement vs multi-device
**Risiko: Tinggi · Effort: Menengah–Besar**

Cara kerja sekarang (`app/api/session/claim` + `lib/user-context.tsx`): setiap login lewat
form menghasilkan `active_session_token` acak yang disimpan di kolom `users` **dan** di
`localStorage`. Kalau device lain login, token DB tertimpa; device lama mendeteksi
ketidakcocokan (saat reload atau polling 30 detik) lalu **logout sendiri**. Efeknya:
**hanya boleh ada 1 sesi aktif per akun**.

**Implikasi native (penting):** kalau user login di web **dan** mobile bersamaan, keduanya
akan saling menendang keluar terus-menerus. Untuk aplikasi multi-platform ini hampir pasti
**bukan** yang diinginkan. Perlu keputusan produk + desain ulang:

- **Opsi A (disarankan):** ganti kolom tunggal jadi **tabel `user_sessions`** (satu baris per
  device: token, `user_agent`/platform, `last_seen`), izinkan N device, sediakan UI "perangkat
  aktif" + "logout device tertentu". Ini pola standar app modern.
- **Opsi B:** batasi per-platform (mis. maksimal 1 web + 1 mobile).

Karena ini menyentuh model data + UX, jauh lebih murah didesain **sebelum** ada client mobile
yang mengasumsikan perilaku sesi tunggal.

#### B.3 — resolve-login sebagai RPC/Edge Function murni
**Risiko: Sedang · Effort: Kecil**

`resolve-login` sudah berupa fungsi murni (`username → email`, anti-enumerasi, escape ILIKE).
Memindahkannya ke **Edge Function** (atau RPC anon-safe) membuatnya bisa dipanggil identik
dari web/Flutter/desktop tanpa bergantung ke `/api/*` Vercel. Kompleksitas rendah, dan sekalian
menempatkan normalisasi `login_username` di satu tempat (lihat A.2).

---

### C. Konsistensi Data & Realtime

#### C.1 — Supabase Realtime
**Risiko: Rendah · Effort: Kecil**

Realtime **hanya** dipakai untuk **presence** ("online-users" channel di `user-context.tsx`,
menghitung jumlah online scoped). **Tidak ada** subscription `postgres_changes`. Presence via
`supabase.channel(...).track(...)` **portable** ke Flutter (`supabase_flutter` mendukung
Realtime/Presence) dan desktop. Payload track (`user_id`, `nama`, `desa_id`, `kelompok_id`)
tak menyentuh API browser-only. Aman untuk multi-platform apa adanya. (Catatan kecil: kalau
nanti mau data live antar-device — mis. absensi masuk real-time — `postgres_changes` juga
portable, tinggal ditambah.)

#### C.2 — Push notification (gap terbesar di kategori ini)
**Risiko: Sedang · Effort: Menengah–Besar**

Sekarang **100% Web Push (VAPID)**: `lib/push.ts` subscribe lewat `PushManager`, simpan
`endpoint`/`p256dh`/`auth` ke tabel `push_subscriptions`; trigger DB `notify_push` /
`notify_push_scope` memanggil Edge Function `send-push` (web push). Ini **tidak menjangkau**
notifikasi native Android/iOS.

**Gap yang perlu diisi:**
- **Android/iOS** butuh **FCM** (Android + iOS) / APNs. Perlu: (a) kolom/tabel baru untuk
  menyimpan **FCM token** per device (format beda dari web-push endpoint), (b) integrasi FCM
  di Flutter.
- **Idealnya `notify_push` diperluas jadi fan-out**: satu trigger backend → kirim ke Web Push
  **+** FCM **+** notifikasi native desktop sekaligus, berdasarkan tipe subscription yang
  tersimpan per device. Desainnya: generalisasi `push_subscriptions` jadi menyimpan
  `platform` + `token/endpoint`, lalu `send-push` bercabang per platform.
- **Desktop (Tauri/Electron)** bisa reuse Web Push atau OS-notification API — gap paling kecil.

Bisa distaging (web dulu tetap jalan), tapi **skema tabelnya sebaiknya digeneralisasi sekarang**
supaya tak perlu migrasi data belakangan.

---

### D. Environment & Konfigurasi

#### D.1 — Konfigurasi Next.js-specific vs portable
**Risiko: Rendah · Effort: Kecil**

| Env var | Sifat | Dipakai di native? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | **Portable** | Ya — identik di Flutter/Tauri/Electron |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **Portable** | Ya — tapi lihat G.1 (ter-embed di binary) |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Portable (web push) | Desktop-web ya; mobile pakai FCM |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server-only** | **TIDAK BOLEH** masuk binary client |
| `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` | Portable konsep | Ya — via SDK Sentry Flutter/desktop terpisah |
| `SENTRY_ORG/PROJECT/AUTH_TOKEN` | Build-time web | Tidak |

`next.config.ts` (`withSentryConfig`) dan file `instrumentation*.ts` murni Next.js — tidak
relevan untuk Flutter (yang pakai `sentry_flutter`). Hanya 2–3 nilai Supabase yang benar-benar
dibawa lintas platform. Yang **paling penting**: `SUPABASE_SERVICE_ROLE_KEY` **hanya** hidup di
server web dan **tidak boleh** pernah ikut ke client manapun (ini menguatkan A.1/G.1 — begitu
logika service-role pindah ke RPC/Edge Function, key ini makin terisolasi di DB).

#### D.2 — Hardcoded assumption soal domain/URL (OAuth)
**Risiko: Sedang · Effort: Menengah**

OAuth Google memakai `redirectTo: window.location.origin + '/login?google=1'`
(`app/login/page.tsx:132`) dan `+ '/profil?linked=google'` (`app/(dashboard)/profil/page.tsx:165`).
Ini **redirect berbasis domain web**. Untuk mobile, OAuth butuh **deep-link scheme** (mis.
`gensiti://login-callback`) yang harus (a) didaftarkan di **Supabase Auth → Redirect URLs
allowlist**, dan (b) dikonfigurasi di Android (intent filter) / iOS (URL scheme). Saat ini
kemungkinan besar hanya origin web yang di-whitelist. Perlu generalisasi konfigurasi redirect
per-platform sebelum "Masuk dengan Google" jalan di native. (Login nama+password tidak
terdampak.)

---

### E. Desain & Komponen

#### E.1 — Komponen presentational vs logic-blended
**Risiko: Rendah · Effort: Menengah**

| Komponen | Sifat | Catatan porting Flutter |
|---|---|---|
| `Modal.tsx`, `PasswordInput.tsx`, `LoadingSpinner.tsx`, `ProfilHeader.tsx` | **Presentational** | Pemetaan konsep ke widget gampang |
| `GlobalSearch.tsx` | Logic-blended (fetch + debounce + state) | Pisahkan data-layer dulu |
| `PresensiPanel.tsx` | Logic-blended (QR gen/scan, rotasi kode, RPC) | Butuh reimplement (kamera/QR native) |
| `LaporanBulananModal.tsx` | Logic-blended (fetch RPC + chart + export) | Data-layer reusable, render + export tidak |
| `ExportPreviewModal.tsx`, `PengajuanIzinPanel.tsx` | Logic-blended | Pisahkan logika sebelum porting |

Tidak ada blocker; pola umumnya "data & aturan sudah rapi di `lib/`+RPC, tinggal render yang
di-rebuild". Yang perlu perhatian khusus: **PresensiPanel** (QR scan pakai `qr-scanner`
browser — Flutter perlu package kamera/QR native) dan **export** (lihat A.2).

#### E.2 — Sentralisasi design token
**Risiko: Sedang · Effort: Menengah**

- **Sudah bagus:** skala warna biru aksen (`--color-blue-50..950`, base `#0381FE`) terpusat di
  `@theme` `app/globals.css` — satu sumber, gampang direplikasi ke Flutter `ThemeData`.
  Keputusan warnanya juga terdokumentasi di `DESIGN_BRIEF_GENSITI.md`.
- **Perlu dirapikan:** ada **± 72 nilai hex inline** tersebar di `app/**` + `components/**`
  (warna badge status H/I/S/A, warna chart, dll) — belum jadi token. Spacing & border-radius
  mengandalkan default Tailwind (bukan token kustom). Untuk paritas visual di Flutter, sebaiknya
  **ekstrak palet lengkap (termasuk warna status & chart) ke satu file token** (mis. JSON/TS
  yang bisa di-generate jadi Dart) supaya web dan Flutter menarik dari sumber yang sama. Bisa
  dikerjakan paralel, risiko rendah.

---

### F. Testing & Kualitas untuk Ekspansi Besar

#### F.1 — Cakupan test sebagai "kontrak" backend
**Risiko: Tinggi · Effort: Menengah**

- `lib/roles.test.ts` (38 test) bagus, **tapi** menguji **salinan client** (`lib/roles.ts`
  — gate UI). **Enforcement sesungguhnya** (di `app/api/users|generus/route.ts` dan RLS/RPC
  di DB) **belum ada test sama sekali**. Justru lapisan inilah yang akan dihantam langsung oleh
  Flutter/desktop, jadi **ini yang paling butuh contract test** sebelum jadi pondasi
  multi-platform.
- Fungsi kritis lain tanpa test: **`resolve-login`** (anti-enumerasi, escape ILIKE — regresi di
  sini = celah keamanan), **RPC laporan bulanan** (agregasi berlapis — regresi = angka salah).
- Rekomendasi: begitu authorization dipindah ke RPC (A.1/A.2), tulis test level-DB (pgTAP) atau
  integration test yang memanggil RPC dengan berbagai role — ini sekaligus jadi kontrak yang
  mengunci perilaku untuk **semua** client.

#### F.2 — CI/CD gate jadi lebih mendesak?
**Risiko: Sedang · Effort: Kecil (sudah ada, tinggal diperluas)**

Catatan lama di HANDOFF.md ("belum ada CI gate") **sudah usang** — `.github/workflows/ci.yml`
menjalankan `typecheck + lint + test` di tiap push/PR ke `main`. Tapi CI itu menguji **web app
saja**. Begitu backend dipakai bersama web+mobile+desktop, kerusakan backend berdampak ke
**semua** sekaligus — jadi **ya, lebih mendesak** untuk menambahkan **test level-backend**
(RPC/RLS via pgTAP atau integration) ke pipeline, bukan cuma typecheck/lint/test frontend.
Effort kecil untuk memperluas workflow yang sudah ada; nilainya besar.

---

### G. Keamanan untuk Permukaan Serangan yang Lebih Luas

#### G.1 — Anon key ter-embed di binary + operasi sensitif
**Risiko: awalnya Tinggi → sebagian besar TERVERIFIKASI AMAN + gap yang ada sudah ditutup (20 Juli 2026)**

Begitu native rilis, `NEXT_PUBLIC_SUPABASE_ANON_KEY` **pasti** bisa diekstrak dari APK/IPA/binary
desktop. Ini **normal & aman untuk Supabase ASALKAN RLS rapat** — anon key hanya "tiket masuk",
RLS yang menentukan boleh apa. Hasil verifikasi langsung `pg_policies`/`pg_proc`:

- **`users`** ✅ **sudah aman.** Hanya ada policy SELECT (self + hierarki) dan `users_all_superadmin`
  (ALL, super_admin). **Tidak ada** policy UPDATE/INSERT untuk non-super-admin → self-update
  `role_id`/`is_active`/scope via anon key **sudah terblokir RLS** (default-deny). Manajemen
  anggota hanya lewat route service-role. Kekhawatiran awal **tidak terbukti**.
- **`generus`** ⚠️→✅ **gap ditemukan & ditutup.** Policy lama `anggota_all_superadmin_daerah`
  (FOR ALL) mengizinkan tulis untuk **semua** akun tingkatan `daerah` tanpa cek `nama_role`,
  padahal `generus` tak pernah ditulis langsung client (semua via service-role). Diperbaiki
  jadi tulis = super_admin saja (migrasi `harden_rls_generus_write_and_cleanup`), baca
  daerah/ppg/desa/kelompok tetap utuh via `anggota_select`.
- **`reset_password_requests`** ⚠️→✅ policy INSERT `WITH CHECK (true)` (anon insert tanpa batas,
  tabel retired) **sudah dicabut** di migrasi yang sama.
- **`password_reset_otp`** ✅ deny-all (0 policy, hanya service role) — **dikonfirmasi benar**.
- **`system_config`** ✅ SELECT authenticated, UPDATE super_admin — rapat.
- **Fungsi laporan / `global_search` / `ajukan_izin_presensi` / `proses_*`** ✅ walau
  anon-executable, **semuanya punya guard internal** (`auth.uid()` / tingkatan) yang menolak
  anon & role tak berwenang. Tidak bocor. Revoke anon-execute (defense-in-depth, Batch B)
  **belum** dijalankan (opsional).

> **Status:** gap RLS nyata sudah ditutup. Model keamanan untuk anon key kini rapat di level
> DB (bukan sekadar logika server web). Sisa: Batch B (revoke anon-execute, opsional) &
> aktifkan leaked-password protection di Auth settings.

#### G.2 — Rate limiting resolve-login (& password-reset)
**Risiko: Sedang → ✅ DIKERJAKAN (20 Juli 2026) · Effort: Kecil**

`resolve-login` sebelumnya tanpa rate limit eksplisit (dan merupakan oracle enumerasi:
200+email utk nama valid vs 404 utk tidak ada). `password-reset/request` sudah punya throttle
**per-user** (3 OTP/15 menit) tapi belum **per-IP** (rawan spraying ke banyak akun).

**Sudah ditambahkan** rate limiter per-IP berbasis DB (reusable oleh client native):
- Migrasi `add_auth_rate_limit`: tabel `auth_rate_limit` (deny-all RLS) + RPC
  `check_auth_rate_limit(key, max, window_seconds)` — atomic prune→count→insert, **service_role
  only** (tak bisa dipanggil/di-bypass anon).
- `resolve-login`: **120 req / 10 menit per IP** (sangat longgar — seluruh org bisa login
  berbarengan dari satu wifi; tetap memotong brute-force). Diblokir → 429 dgn pesan generik
  identik "nama/password salah" (tidak bocorkan validitas nama).
- `password-reset/request`: **20 req / 15 menit per IP**, di atas throttle per-user yang sudah
  ada. Diblokir → diam-diam jatuh ke response generik (anti-enumeration).
- Keduanya **fail-open**: error limiter tidak pernah mengunci pengguna sah.

**Catatan:** oracle enumerasi `resolve-login` (mengembalikan email) dimitigasi rate limit,
belum dihilangkan total — fix tuntasnya adalah tidak pernah mengembalikan email (butuh ubah
alur login client). Layak dipertimbangkan saat #2/#B.3 (pindah ke Edge Function).

---

## 3. Urutan Prioritas Perbaikan (Sebelum Mulai Flutter/Tauri)

Alasan urutan ini: **fondasi keamanan & kontacktbackend dulu** (karena semua client
bergantung padanya dan paling mahal diubah belakangan), baru **hal yang memungkinkan fitur
native jalan**, terakhir **paralel/kosmetik**.

| # | Perbaikan | Kategori | Risiko | Effort | Kenapa urutan ini |
|---|---|---|---|---|---|
| **1** | ~~**Audit & rapatkan RLS di DB**~~ ✅ **SELESAI (Batch A, 20 Juli 2026)** — verifikasi 22 tabel + fungsi; gap `generus`/`reset_password_requests` ditutup, `search_path` `increment_otp_attempt` dikunci. Sisa opsional: Batch B (revoke anon-execute) + leaked-password protection. | G.1, A.3 | ~~Tinggi~~ | Menengah | Seluruh model keamanan multi-platform bertumpu di sini. Anon key akan tersebar — RLS harus jadi benteng sesungguhnya, bukan logika server web. **Sudah dikerjakan paling awal & langsung di DB.** |
| **2** | ~~**Pindahkan otorisasi ke RPC `SECURITY DEFINER`**~~ ✅ **SELESAI (21-22 Juli 2026)** — `users`/`generus` (GET+PATCH) kini RPC (`get_generus_biodata`, `update_generus_biodata`, `update_user_profile`), route lama jadi wrapper tipis. Password tetap GoTrue (kendala teknis, lihat PLAN_MIGRASI_OTORISASI_RPC.md §2). Edge Function (resolve-login/password-reset) untuk B.3 belum -- baru relevan saat proyek Flutter benar-benar mulai. | A.1, A.2, B.3 | ~~Tinggi~~ | Besar | Menjadikan DB sumber kebenaran tunggal → Flutter tinggal panggil, tak menulis ulang aturan. **Detail lengkap & log verifikasi di PLAN_MIGRASI_OTORISASI_RPC.md.** |
| **3** | ⏳ **Contract test untuk authorization + RPC kritis** — **sebagian selesai**: `lib/authz-rpc.contract.test.ts` (31 test, CI) mengunci 5 fungsi otorisasi murni dari Fase 1. RPC yang bergantung `auth.uid()` (`can_manage_members`, `get_generus_biodata`, dst) & RPC laporan/resolve-login **belum** -- butuh fixture akun test (di luar super_admin, akun tunggal mutlak) sebelum bisa diotomasi penuh. | F.1, F.2 | Tinggi | Menengah | Mengunci perilaku backend **sebelum** 3–4 client bergantung. |
| **4** | **Redesain single-session → model multi-device** (`user_sessions`) | B.2 | Tinggi | Menengah–Besar | Menyentuh model data + UX; harus final sebelum client mobile dibangun di atas asumsi sesi tunggal. |
| **5** | **Generalisasi arsitektur push** (skema `push_subscriptions` simpan platform+token; `notify_push` fan-out Web Push + FCM) | C.2 | Sedang | Menengah–Besar | Web tetap jalan; ubah skema sekarang agar tak perlu migrasi data saat FCM ditambah. |
| **6** | **OAuth deep-link scheme + generalisasi redirect config** | D.2 | Sedang | Menengah | Prasyarat "Masuk dengan Google" di mobile; tak memblokir login nama+password. |
| **7** | **Ekstrak design token lengkap** (palet + warna status/chart) ke satu sumber | E.2 | Sedang | Menengah | Paralelisabel, risiko rendah; mempercepat paritas visual Flutter. Bisa jalan kapan saja. |
| **8** | ~~**Rate limiting resolve-login + password-reset**~~ ✅ **SELESAI (20 Juli 2026)** — limiter per-IP berbasis DB (RPC `check_auth_rate_limit`), fail-open. | G.2 | Sedang | Kecil | Hardening; dikerjakan lebih awal sbg quick win. Logika limiter sudah di DB → ikut terpakai saat pindah ke Edge Function (#B.3). |

**Ringkas:** #1–#3 adalah **pondasi backend/keamanan** yang tidak boleh ditawar sebelum native.
#4–#6 **membuka jalan** fitur native (sesi, push, OAuth). #7–#8 bisa **paralel/menyusul**.
Item #7 (design token) aman dikerjakan kapan pun karena tidak menyentuh backend.

---

## 4. Catatan Penutup

- Temuan berbasis **kode**; langkah **#1 (verifikasi RLS langsung di DB)** wajib dilakukan lebih
  dulu karena beberapa asumsi keamanan di sini belum dikonfirmasi terhadap `pg_policies` /
  body RPC yang sebenarnya. Lakukan lewat Supabase MCP (`list_tables`, `get_advisors`, query
  `pg_policies`) atau dashboard.
- Dokumen ini snapshot per tanggal di atas — perbarui kalau arsitektur berubah (mis. setelah
  #2 dikerjakan, tabel §A dan diagram alur di ARCHITECTURE.md perlu ikut disesuaikan).
- Audit awal (assessment) tidak menyentuh kode; perbaikan #1 (Batch A) hanya mengubah **RLS di
  database** (migrasi terlacak), bukan kode aplikasi.

---

## 5. Log Perubahan (perbaikan yang sudah dijalankan)

### 22 Juli 2026 — Prioritas #3 (sebagian): contract test fungsi otorisasi murni

`lib/authz-rpc.contract.test.ts` (baru) -- 31 test Vitest yang memanggil 5 fungsi otorisasi
murni di DB (`member_management_allowed`, `scope_action_allowed`, `tingkatan_hierarchy_allowed`,
`tingkatan_assignment_allowed`, `normalize_login_username`) lewat **anon key** (bukan secret --
sama seperti dipakai client browser). Mirror persis 30 skenario yang diverifikasi manual via SQL
saat migrasi Fase 1 diterapkan (21 Juli) -- kini permanen & otomatis di CI, bukan sekali jalan.
`ci.yml` diberi env `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` (nilai publik,
plain di workflow, bukan GitHub secret) khusus step Test. Tanpa env ini (mis. lokal tanpa
`.env.local`) test di-skip diam-diam (`describe.skipIf`), tidak pernah gagal.

**Catatan verifikasi:** sandbox pengerjaan sesi ini diblokir proxy jaringan mengakses
`*.supabase.co` langsung (beda dari tool MCP Supabase yang lewat jalur lain) -- run lokal
gagal karena itu, BUKAN karena RPC salah (dikonfirmasi ulang lewat MCP `execute_sql` bahwa
`normalize_login_username(...)` tetap mengembalikan nilai benar). Verifikasi sesungguhnya
menunggu run CI asli (GitHub Actions, akses internet normal) setelah PR dibuka.

**Belum selesai** (di luar cakupan sesi ini): RPC yang bergantung `auth.uid()`
(`can_manage_members`, `get_generus_biodata`, `update_generus_biodata`, `update_user_profile`)
serta RPC laporan/`resolve-login` butuh sesi login sungguhan utk diuji end-to-end. Tak bisa
pakai fixture akun `super_admin` terisolasi (trigger `enforce_single_super_admin` menolak baris
kedua) -- kalau dilanjutkan, perlu akun test non-super-admin (Ketua/Generus) khusus + kredensial
tersimpan sbg GitHub secret, keputusan yang butuh persetujuan eksplisit lebih dulu.

### 20 Juli 2026 — Prioritas #1 Batch A (RLS hardening)

Verifikasi RLS langsung di DB (`pg_policies`, `pg_proc`, security advisor) + migrasi
**`harden_rls_generus_write_and_cleanup`** (diterapkan ke project `ccyqgcfjmzgkmkczuydv`):

1. **`generus`** — `DROP POLICY anggota_all_superadmin_daerah` (FOR ALL, semua tingkatan
   `daerah`) → `CREATE POLICY generus_all_superadmin` (FOR ALL, super_admin saja), samakan
   dengan pola tabel `users`. Baca daerah/ppg/desa/kelompok tetap via `anggota_select`.
   Verified aman: `generus` tak pernah ditulis langsung client (semua via route service-role),
   dan tak ada fungsi DB yang menulis `generus`.
2. **`reset_password_requests`** — `DROP POLICY reset_request_insert` (INSERT `WITH CHECK true`,
   tabel retired). Policy `reset_request_superadmin` dibiarkan.
3. **`increment_otp_attempt`** — `SET search_path = public, pg_temp` (tutup search_path mutable).

Security advisor Supabase pasca-migrasi: `rls_policy_always_true` & `function_search_path_mutable`
**hilang**. Sisa temuan (`rls_enabled_no_policy` pada `password_reset_otp` = deny-all sengaja;
anon/authenticated function-execute = self-guarded; leaked-password protection = config Auth)
bukan lubang aktif.

**Belum dikerjakan (opsional / lanjutan):** Batch B (revoke anon `EXECUTE` — defense-in-depth),
aktifkan leaked-password protection di Supabase Auth settings, dan prioritas #2 dst.

### 20 Juli 2026 — Prioritas #8 (rate limiting per-IP)

Migrasi **`add_auth_rate_limit`** + wiring 2 route:

1. Tabel `auth_rate_limit` (RLS deny-all) + RPC `check_auth_rate_limit(p_key, p_max,
   p_window_seconds)` — sliding window atomic (prune→count→insert), `SECURITY DEFINER`,
   `search_path` terkunci, EXECUTE **hanya service_role** (di-revoke dari public/anon/authenticated).
   Diuji langsung: `max=3` → `true,true,true,false,false`.
2. `app/api/resolve-login/route.ts` — cek per-IP (120/10 mnt) sebelum query; blokir → 429
   pesan generik. Fail-open.
3. `app/api/password-reset/request/route.ts` — cek per-IP (20/15 mnt) di atas throttle
   per-user yang sudah ada; blokir → response generik (silent). Fail-open.

Verifikasi: `typecheck` + `eslint` (0 error) + `vitest` (38) + `build` sukses. Limiter di-DB
sengaja generic (`p_key` bebas) supaya reusable saat endpoint dipindah ke Edge Function (#B.3)
& dipakai client native.
