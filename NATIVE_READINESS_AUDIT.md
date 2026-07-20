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
**Risiko: Sedang · Effort: Kecil (verifikasi) — perlu verifikasi langsung DB**

Dari kode, otentikasi & RLS berbasis **`auth.uid()` / JWT** (helper `get_user_role`,
`get_user_tingkatan`, `is_pengurus`, dst per ARCHITECTURE.md §4) — **tidak** ada
ketergantungan pada header khusus browser, cookie, atau `Origin`. Secara desain ini
**platform-agnostic** (JWT dari Flutter/desktop diperlakukan sama). Tidak ditemukan RLS
policy yang membaca header request di kode aplikasi.

**Namun** ini perlu dikonfirmasi langsung di DB sebelum native: query `pg_policies` untuk
memastikan tak ada policy yang (a) mengandalkan `current_setting('request.header...')`
tertentu, atau (b) meng-hardcode asumsi lain. Semua 19 tabel & ~65 RPC pada dasarnya perlu
diakses dari mobile/desktop juga (hampir semua fitur), jadi verifikasi ini menyeluruh, bukan
per-tabel pilih-pilih.

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
**Risiko: Tinggi · Effort: Menengah — sebagian perlu verifikasi langsung DB**

Begitu native rilis, `NEXT_PUBLIC_SUPABASE_ANON_KEY` **pasti** bisa diekstrak dari APK/IPA/binary
desktop. Ini **normal & aman untuk Supabase ASALKAN RLS rapat** — anon key hanya "tiket masuk",
RLS yang menentukan boleh apa. **Yang harus dipastikan:** operasi yang sekarang "aman" **hanya
karena** lewat service-role di server web (yang bypass RLS) harus **juga** ditolak di level RLS
untuk siapa pun yang datang dengan anon key + JWT sendiri. Contoh operasi yang wajib diperiksa:

- **`users`**: pastikan RLS **menolak** self-update `role_id` / `is_active` / `desa_id` /
  `kelompok_id` (kolom eskalasi hak akses). Saat ini proteksinya ada di **logika TS route** —
  kalau RLS tabel `users` mengizinkan UPDATE self yang longgar, client jahat bisa **bypass route
  dan langsung `UPDATE`** via anon key. **(Perlu verifikasi `pg_policies`.)**
- **Pembuatan akun / ubah role / hierarki jenjang**: harus mustahil dilakukan tanpa lewat RPC
  ber-otorisasi (menguatkan alasan A.1 — pindahkan ke RPC `SECURITY DEFINER`).
- **`password_reset_otp`**: ARCHITECTURE.md menyebut RLS deny-all (hanya service role) — **baik**,
  tinggal konfirmasi.
- **`system_config`**, **`backup` (10 tabel)**: pastikan tidak ada jalur baca/tulis langsung dari
  anon/authenticated di luar RPC/route berwenang.

> Ini **temuan prioritas tertinggi**: seluruh model keamanan multi-platform bertumpu pada RLS
> yang rapat, dan sebagian saat ini "ditutupi" oleh logika di server web yang tidak berlaku
> untuk client yang memanggil Supabase langsung.

#### G.2 — Rate limiting resolve-login (& password-reset)
**Risiko: Sedang → Tinggi (naik untuk native) · Effort: Kecil–Menengah**

`resolve-login` belum punya rate limiting eksplisit (mengandalkan rate limit bawaan Supabase
Auth di `signInWithPassword`). Dengan lebih banyak jenis client yang bisa memanggilnya, risiko
**enumerasi nama / brute force** naik. **`password-reset/request`** juga rawan
**abuse/email-bombing** (kirim OTP berulang). Rekomendasi: tambahkan rate limit (per IP + per
nama/target, mis. lockout sementara setelah N gagal) — sekalian saat memindahkannya ke Edge
Function (B.3), karena Edge Function lebih cocok untuk logika ini daripada API route Vercel.

---

## 3. Urutan Prioritas Perbaikan (Sebelum Mulai Flutter/Tauri)

Alasan urutan ini: **fondasi keamanan & kontacktbackend dulu** (karena semua client
bergantung padanya dan paling mahal diubah belakangan), baru **hal yang memungkinkan fitur
native jalan**, terakhir **paralel/kosmetik**.

| # | Perbaikan | Kategori | Risiko | Effort | Kenapa urutan ini |
|---|---|---|---|---|---|
| **1** | **Audit & rapatkan RLS di DB** (verifikasi `pg_policies`: `users`, `system_config`, `password_reset_otp`, dll menolak akses langsung anon/authenticated ke operasi sensitif) | G.1, A.3 | Tinggi | Menengah | Seluruh model keamanan multi-platform bertumpu di sini. Anon key akan tersebar — RLS harus jadi benteng sesungguhnya, bukan logika server web. **Kerjakan paling awal & langsung di DB.** |
| **2** | **Pindahkan otorisasi ke RPC `SECURITY DEFINER` + Edge Function** (users/generus → RPC; resolve-login/password-reset → Edge Function), hilangkan duplikasi aturan | A.1, A.2, B.3 | Tinggi | Besar | Menjadikan DB sumber kebenaran tunggal → Flutter tinggal panggil, tak menulis ulang aturan. Sekaligus melepas backend dari deployment Vercel & mengisolasi service-role key. |
| **3** | **Contract test untuk authorization + RPC kritis** (server enforcement, resolve-login, laporan) + perluas CI ke test level-backend | F.1, F.2 | Tinggi | Menengah | Mengunci perilaku backend **sebelum** 3–4 client bergantung. Paling efektif dikerjakan tepat setelah #2 (menguji RPC baru). |
| **4** | **Redesain single-session → model multi-device** (`user_sessions`) | B.2 | Tinggi | Menengah–Besar | Menyentuh model data + UX; harus final sebelum client mobile dibangun di atas asumsi sesi tunggal. |
| **5** | **Generalisasi arsitektur push** (skema `push_subscriptions` simpan platform+token; `notify_push` fan-out Web Push + FCM) | C.2 | Sedang | Menengah–Besar | Web tetap jalan; ubah skema sekarang agar tak perlu migrasi data saat FCM ditambah. |
| **6** | **OAuth deep-link scheme + generalisasi redirect config** | D.2 | Sedang | Menengah | Prasyarat "Masuk dengan Google" di mobile; tak memblokir login nama+password. |
| **7** | **Ekstrak design token lengkap** (palet + warna status/chart) ke satu sumber | E.2 | Sedang | Menengah | Paralelisabel, risiko rendah; mempercepat paritas visual Flutter. Bisa jalan kapan saja. |
| **8** | **Rate limiting resolve-login + password-reset** | G.2 | Sedang | Kecil | Hardening; enak digabung dengan #2 saat keduanya pindah ke Edge Function. |

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
- Tidak ada kode aplikasi yang diubah untuk audit ini (sesuai instruksi: assessment dulu).
