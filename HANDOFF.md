# GENSITI -- Handoff ke Claude Code

Dokumen ini merangkum status proyek per **16 Juli 2026** untuk melanjutkan kerja di Claude Code
(sebelumnya dikerjakan lewat Cowork). Baca file ini dulu sebelum mulai kerja apa pun.

---

## 1. Tentang Proyek

**GENSITI** (Smart Organization Management System) -- aplikasi manajemen organisasi untuk PPG
(Persatuan Pemuda... / organisasi induk keagamaan dengan struktur jenjang berlapis: Daerah >
Desa > Kelompok, plus jalur khusus PPG). Fungsi utamanya: data keanggotaan (Generus/anggota
muda & Pembina/PPG), absensi kegiatan, laporan bulanan, keuangan, dokumen, dan monitoring
sistem.

- **Repo**: `github.com/Moreno19Ryan/gensiti-app` (branch `main`)
- **Live**: `gensiti-app.vercel.app` -- auto-deploy dari push ke `main` lewat Vercel
- **Stack**: Next.js (App Router) + TypeScript + Supabase (Postgres, Auth, RLS, Realtime,
  Edge Functions) + Tailwind
- **Supabase project_id**: `ccyqgcfjmzgkmkczuydv`
- **Ukuran kode**: ~12.000 baris di `app/`, ~2.000 di `lib/`, ~2.200 di `components/`
- **Skala pengguna**: ~82 akun aktif (per audit terakhir)

### Struktur folder inti
```
app/(dashboard)/     -- semua halaman menu (absensi, generus, keuangan, monitoring, dst.)
app/api/              -- API routes server-side (pakai service role key utk bypass RLS,
                          dengan verifikasi manual identitas pemanggil di tiap route)
app/login, app/lupa-password  -- alur autentikasi (di luar dashboard layout)
lib/                  -- helper inti: roles.ts (hierarki akses), auth.ts, feature-toggles.ts,
                          user-context.tsx (session), export.ts (PDF/Excel), audit.ts
components/           -- komponen reusable (Modal, PasswordInput, LaporanBulananModal, dst.)
```

### Aturan penting yang HARUS diikuti (dari instruksi proyek Reno)
> Kerjakan semua dengan teliti dan hati-hati. Selalu cek ulang hasil pekerjaan setelah
> melakukan update. Setelah selesai, semua isi proyek dicek ulang lagi dan pastikan aplikasi
> web berjalan dengan baik dan optimal.

Praktik yang sudah berjalan dan sebaiknya diteruskan:
- Setiap fix/fitur diverifikasi dengan `tsc --noEmit` + `eslint` sebelum commit (bukan cuma
  baca kode).
- Kalau memungkinkan, uji langsung di browser (live site) setelah deploy, bukan cuma percaya
  logika di kepala -- beberapa bug (race condition, dsb.) hanya kelihatan saat direproduksi
  nyata.
- Komentar kode di proyek ini SENGAJA panjang dan naratif (menjelaskan histori keputusan/bug),
  bukan cuma deskriptif. Pertahankan gaya ini saat menambah kode baru di file yang sudah
  punya gaya komentar begini.
- Migrasi database dilakukan lewat Supabase MCP (`apply_migration`), bukan file migrasi lokal
  (folder `supabase/migrations` tidak dipakai di proyek ini).

### Isu lingkungan yang perlu diketahui (BUKAN bug aplikasi)
- Repo Git di komputer Windows Reno pakai `core.autocrlf=true` bawaan Git -- ini bisa bikin
  `git status` menampilkan file "modified" padahal isinya identik (cuma beda LF/CRLF). Kalau
  ketemu ini, cek dulu pakai `git diff --stat` atau `git hash-object` vs `git ls-tree HEAD`
  sebelum menyimpulkan ada perubahan nyata.
- Push ke GitHub dari sandbox terpisah (kalau dipakai) tidak selalu punya kredensial git --
  push sebaiknya lewat mesin asli Reno.

---

## 2. Yang Baru Saja Dikerjakan

### Sesi 26 Juli 2026 — Tone/voice, A6 (eskalasi approval), B3 (Mode Gelap rollout penuh), fix PPG di Data Generus

Empat PR berurutan (#15-#18), semua sudah di-merge ke `main`. Ringkasan per PR:

**PR #15 -- Tone/voice: pesan motivasi, sapaan waktu & nama panggilan di Dashboard**
- Fase A (fondasi data): tabel baru `pesan_motivasi` (40 baris seed, teks
  penyemangat/pantun) + kolom `users.tampilkan_pesan_motivasi` (default
  `true`) + RPC `set_tampilkan_pesan_motivasi` (`SECURITY DEFINER`, hanya
  menyentuh `auth.uid()` sendiri -- tulis langsung ke `users` tetap terkunci
  Super Admin lewat RLS, jadi toggle preferensi butuh RPC khusus).
- Fase B (Dashboard UI): `SapaanWaktuCard` (kartu terpisah, emoji & gradasi
  warna beda tiap periode waktu -- pagi/siang/sore/malam/larut malam, frasa
  persis dari `PANDUAN_TONE_VOICE_GENSITI.md`) + `PesanMotivasiCard` (random
  1x per sesi browser via `sessionStorage`, respek toggle, disembunyikan
  utk Super Admin). Toggle baru "Pesan Motivasi di Dashboard" di
  `profil/notifikasi/page.tsx`.
- Fase C (microcopy audit menyeluruh): pesan loading/empty-state/error
  diperhalus di ~15 halaman (Dashboard, Kegiatan, Absensi, Dokumen, Generus,
  Catatan Pembinaan, Pengumuman, Monitoring, GlobalSearch, login, dst.) --
  polanya konsisten dgn suara GENSITI di panduan, bukan perubahan fungsional.
- Diperluas ke **email otomatis & subjek notifikasi** (3 lapisan, atas
  permintaan eksplisit "biar generus tertarik untuk membacanya"): subjek
  emoji-aware untuk pengumuman/kegiatan/approval/reminder H-1/reminder
  laporan, badan email `build_email_html` cabang `reminder` diperhalus,
  footer email (satu sumber, dipakai semua tipe email) diperlunak. Migrasi
  `tone_voice_email_notifikasi` (`CREATE OR REPLACE` 6 fungsi, tidak ada
  perubahan skema).
- Bug ditemukan & diperbaiki selama testing: kartu pesan motivasi sempat
  "hilang" -- ternyata bukan bug, user sendiri tidak sengaja mematikan
  toggle-nya saat uji coba (dikonfirmasi lewat `get_logs` + query langsung
  ke baris user, bukan asumsi).

**PR #18 -- A6: Eskalasi approval reimbursement yang nyangkut**
- Assessment awal & desain lengkap ada di
  [WISHLIST_ASSESSMENT.md §A6](WISHLIST_ASSESSMENT.md). Desain final BUKAN
  auto-approve (opsi awal yang diusulkan, ditolak eksplisit krn risiko
  governance keuangan -- lihat diskusi) -- tetap perlu aksi manual manusia.
- Backend (migrasi terpisah, diverifikasi lewat `BEGIN...ROLLBACK`
  multi-skenario dgn identitas user nyata sebelum deploy): `proses_reimbursement`
  diperluas menerima 2 tier caller (Bendahara ATAU Ketua di jenjang sama
  kalau sudah >3 hari nyangkut), + 2 RPC reminder baru
  (`send_reminder_approval_kegiatan_pengumuman`/`send_reminder_approval_reimbursement`)
  + 2 cron harian 08:00 WIB. **Bug ditemukan & diperbaiki sendiri** (bukan
  laporan user) selama verifikasi: reminder reimbursement awalnya salah pakai
  pola broadcast ala notifikasi kegiatan (`tingkatan='daerah'` lihat semua) --
  seharusnya otorisasi sungguhan (scope caller harus PERSIS sama dgn
  pengajuan), diperbaiki migrasi susulan `fix_scope_reminder_approval_reimbursement`.
- Frontend (`app/(dashboard)/keuangan/page.tsx`): badge "⚡ Sudah >3 hari
  menunggu Bendahara -- Anda bisa ambil alih" + tombol Setujui/Tolak utk
  Ketua yang eligible, `bisaKetuaAmbilAlih()` di client mirror persis gate
  RPC (client cuma menentukan tampilan, bukan sumber otorisasi).
- Detail lengkap di [ARCHITECTURE.md §4](ARCHITECTURE.md#4-fungsi--rpc-database-schema-public-65-fungsi).

**PR #16 -- B3: Mode Gelap, sinkronisasi toggle & rollout penuh**
- **Bug sinkronisasi ditemukan & diperbaiki** (laporan user: ikon mode gelap
  di header tidak sinkron dgn toggle di menu Profil): dua `useState` terpisah
  yang masing-masing baca `localStorage` sekali saat mount, tidak saling
  memberi tahu. Diperbaiki dgn hook bersama `lib/dark-mode.ts` berbasis
  `useSyncExternalStore` (React 18+) sebagai satu-satunya sumber kebenaran --
  toggle di satu tempat langsung ter-refleksi di semua komponen yang pakai
  hook ini, tanpa reload.
- **Rollout ke seluruh aplikasi** (assessment awal di
  [WISHLIST_ASSESSMENT.md §B3](WISHLIST_ASSESSMENT.md) memperkirakan ~37
  file tersisa dari klaim 47 total -- ternyata jauh lebih sedikit yang
  BENAR-BENAR butuh sentuhan: `app/globals.css` sudah override warna dasar
  Tailwind (`bg-white`, `border-slate-*`, `text-slate-*`, input, table,
  shadow) secara global lewat `.dark` class, jadi mayoritas styling otomatis
  ikut gelap TANPA perlu kelas `dark:` eksplisit. Yang genuinely perlu
  disentuh murni **aksen warna non-slate** -- badge status, box info/warning
  berwarna, link, hover state). Metodologi: grep pola
  `(bg|border|text|hover:)-{warna}-{angka}` per file, exclude yang sudah
  ada `dark:`, patch dgn konvensi warna konsisten (`bg-{c}-100` →
  `dark:bg-{c}-900/30`, dst.), verifikasi `tsc`/`eslint`/test tiap file.
  Tombol solid berwarna + teks putih, spinner, dan `focus:ring` SENGAJA
  dibiarkan apa adanya (kontras sudah cukup di kedua mode).
- **30 file disentuh** (29 commit): seluruh halaman `app/(dashboard)/*`,
  semua sub-halaman Profil, komponen bersama (`PresensiPanel`,
  `PengajuanIzinPanel`, `LaporanBulananModal`, `RfidKioskInput`,
  `GlobalSearch`), plus halaman publik (`login`, `lupa-password`).
- **Konflik merge ditemukan & diperbaiki**: branch sempat dibuat dari commit
  `main` yang lebih lama (sebelum PR #15 merge), sehingga wording microcopy
  Fase C (PR #15) bentrok dgn kelas `dark:` yang ditambahkan di baris yang
  sama pada 6 file (`dokumen`, `generus`, `kegiatan`, `keuangan`,
  `pengumuman`, `profil/notifikasi`). Diselesaikan dgn merge `main` terbaru
  + resolusi manual per-file (selalu pertahankan wording terbaru + tambahkan
  `dark:`), termasuk fitur baru "Pesan Motivasi di Dashboard" toggle
  (dari PR #15) yang belum ada dark-mode-treated sebelumnya -- ikut
  dirapikan sekalian saat resolusi konflik.

**PR #17 -- Fix: kecualikan PPG dari daftar Data Generus**
- Bug ditemukan lewat laporan user (akun "RIZAL FIRDAUS" muncul di menu
  Data Generus, padahal PPG). Dikonfirmasi lewat query langsung ke DB
  production: role-nya memang "PPG Bekasi Timur" (`tingkatan='ppg'`, aktif) --
  bukan salah data, murni filter `loadData()` di
  `app/(dashboard)/generus/page.tsx` yang cuma exclude `super_admin`, belum
  exclude `ppg` (peninggalan dari sebelum menu "Data Pembina" jadi halaman
  mandiri dgn kontrol akun+biodata lengkap sendiri). Fix 1 baris: tambah
  `&& m.roles?.tingkatan !== 'ppg'`, filter tetap di client (bukan query
  PostgREST) sesuai catatan lama di file yg sama soal filter negasi pada
  relasi nested/embedded.

Semua 4 PR diverifikasi `tsc --noEmit` + `eslint` + `npm run test` (49
lulus) sebelum tiap commit/merge. `npm run build` gagal di sandbox
pengembangan (tidak ada `.env.local`, bukan disebabkan perubahan kode) --
diverifikasi lewat preview deployment Vercel per PR sebagai gantinya.

**Belum dikerjakan (di luar cakupan sesi ini):** B4 (Aksesibilitas -- ukuran
teks & kontras, mirror pola B3), dan verifikasi visual manual langsung di
browser oleh Reno (Claude Code tidak bisa klik-klik UI nyata -- lihat
`CLAUDE.md` prinsip #5).

### Sesi 24 Juli 2026 (lanjutan 2) — A1, A3 (Opsi B), A2/A7 dari `WISHLIST_ASSESSMENT.md`

Urutan disepakati lewat sesi strategi Claude.ai: item ringan/berisiko-tinggi-
kalau-ditunda dulu (A1), baru item yang butuh keputusan tools (A3), baru item
"nice to have" (A2 sisa). Detail lengkap tiap item + status di
[WISHLIST_ASSESSMENT.md §Status Implementasi](WISHLIST_ASSESSMENT.md).

- **A1 -- Runbook recovery Super Admin** (`RUNBOOK_RECOVERY_SUPER_ADMIN.md`,
  commit `260aad3`). 4 skenario (lupa password, akun nonaktif, role_id
  berubah, baris user hilang), semua lewat Supabase Dashboard manual --
  SENGAJA tidak ada fitur recovery di dalam aplikasi (red flag: kalau auth
  normal bermasalah, jalur recovery yang sama tidak menolong). Trigger
  `enforce_single_super_admin` diverifikasi ulang lewat `pg_get_functiondef`
  sebelum ditulis -- cuma memblokir akun LAIN jadi Super Admin kedua, tidak
  menghalangi memulihkan baris yang sudah ada.
- **A3 -- Reminder backup mingguan** (migrasi `add_backup_reminder_schedule`,
  commit `a195537`). Opsi B dari 3 opsi yang diajukan (A: upgrade Supabase
  Pro, B: reminder-only via pg_cron, C: backup otomatis ke Storage) -- pola
  identik 2 reminder existing (`send_reminder_h1_kegiatan` dkk). Kolom baru
  `system_config.last_backup_at` (diisi `/api/backup` tiap backup manual
  selesai) + RPC `send_reminder_backup_belum_dilakukan` (in-app+push+email
  ke Super Admin kalau >30 hari) + cron mingguan Senin 08:00 WIB. Tambah 1
  cabang baru `reminder_umum` di `build_email_html` (cabang lain tidak
  diubah) -- cabang `reminder` lama ternyata hard-coded utk kegiatan, tidak
  reusable. Opsi C (backup otomatis) DITUNDA -- butuh keputusan scope akses
  storage terpisah (lihat red flag di `WISHLIST_ASSESSMENT.md` A3).
- **A2 sisa + A7 -- Card rate-limit & link Sentry** (migrasi
  `add_rate_limit_summary_rpc`, commit `254e168`). RPC baru
  `get_rate_limit_summary` (gate super_admin/Team IT) karena tabel
  `auth_rate_limit` deny-all utk `authenticated` -- beda dari card lain di
  `KesehatanTab` yang query langsung krn RLS sudah mengizinkan. Live error
  count Sentry DITUNDA (butuh `SENTRY_AUTH_TOKEN`/`SENTRY_ORG`/
  `SENTRY_PROJECT` diisi Vercel dulu, belum ada saat ini) -- diganti link-out
  ke Sentry Issues (`https://generus-bekasi-timur.sentry.io`) sbg langkah
  pertama tanpa secret baru.
- Semua 3 item di atas diverifikasi lewat `BEGIN...ROLLBACK`/simulasi RLS
  penuh (identitas Super Admin + Generus, cek fail-closed) sebelum commit,
  plus `tsc`/`eslint`/`npm run test` (49 lulus) utk perubahan kode.
- Ketiga commit di atas sudah di-merge ke `main` lewat PR #14 (26 Juli 2026).

### Sesi 24 Juli 2026 — Insiden: 2 commit lolos ke main tanpa PR/review, branch protection diaktifkan

- Ditemukan Reno (bukan lewat proses audit terjadwal) bahwa 2 commit sempat masuk ke
  `main` LANGSUNG (push tanpa PR, tanpa review) sebelum sesi ini:
  - `eeccd81` (2026-07-22 10:35 UTC) -- "fix: ganti checkbox metode presensi (QR/RFID)
    jadi toggle switch"
  - `4611126` (2026-07-22 10:53 UTC) -- "fix: cegah kegiatan tersimpan tanpa metode
    presensi aktif (QR & RFID mati)" (isinya sudah didokumentasikan di atas, bagian
    "Sesi 22 Juli 2026 (lanjutan 2)")
- Keduanya commit non-merge (1 parent), diverifikasi TIDAK punya PR terkait (dicek
  terhadap seluruh 13 PR yang pernah ada di repo ini) dan tidak punya footer
  `Claude-Session` (beda dari commit sesi ini/sesi lain yang biasa mencantumkan link
  session) -- artinya tidak bisa diidentifikasi sesi/entitas Claude Code mana yang
  melakukan push ini.
- Sebagai pembanding: commit `7e558bf` (PR #11, "Prioritas #3 contract test otorisasi")
  yang sempat dicurigai serupa ternyata SAH -- benar-benar lewat PR, di-merge manual
  oleh Reno, hanya dari sesi Claude Code lain (bukan sesi yang sedang berjalan sekarang).
- **Root cause**: branch protection untuk `main` belum aktif saat itu -- tidak ada
  gerbang teknis yang mencegah push langsung dari sesi mana pun, termasuk sesi yang
  tidak diawasi Reno secara real-time.
- **Respons**: branch protection diaktifkan untuk `main` -- wajib lewat Pull Request,
  minimal 1 approval dari reviewer ber-akses write sebelum merge (dikonfirmasi lewat
  `list_repository_collaborators`: `Moreno19Ryan` [admin/pemilik] dan
  `generusbekasitimur-arch` [write]; approval PR berikutnya, #12 & #13, memang datang
  dari `generusbekasitimur-arch`). Sejak itu tidak ada lagi commit yang masuk `main`
  tanpa lewat proses PR.
- Dampak isi 2 commit itu sendiri: tidak berbahaya secara fungsional (satu perbaikan
  bug validasi form, satu perubahan UI checkbox->toggle) -- risiko yang jadi perhatian
  di sini murni soal PROSES (bypass review), bukan soal kerusakan dari isi perubahannya.
- **Belum terkonfirmasi**: apakah setting "Require status checks to pass before
  merging" juga aktif di branch protection `main` -- tidak ada tool yang bisa mengecek
  ini langsung dari sesi Claude Code, perlu dicek manual oleh Reno lewat GitHub
  Settings > Branches.

### Sesi 22 Juli 2026 (lanjutan) — Prioritas #3 (sebagian): contract test otorisasi

- **`lib/authz-rpc.contract.test.ts`** (baru): 31 test Vitest mengunci 5 fungsi otorisasi
  murni (Fase 1) lewat anon key -- mirror 30 skenario yang sebelumnya cuma diverifikasi
  manual via SQL. Masuk `ci.yml` (env publik, bukan secret). Lokal tanpa env, test skip
  diam-diam. Detail + batasan (RPC ber-`auth.uid()` & super_admin belum bisa diotomasi
  penuh) di [NATIVE_READINESS_AUDIT.md §5](NATIVE_READINESS_AUDIT.md).

### Sesi 22 Juli 2026 (lanjutan 2) — Fix: kegiatan bisa tersimpan tanpa metode presensi aktif

- **Bug ditemukan Reno**: form Tambah/Edit Kegiatan tidak mencegah kedua toggle metode
  presensi (QR/RFID) dimatikan bersamaan — kegiatan tetap bisa tersimpan & berjalan, cuma
  mengandalkan kode manual (Pengurus membacakan kode 6-digit satu per satu, tanpa cara
  lebih cepat sama sekali), hampir pasti bukan yang dimaksud saat kelupaan menyalakan
  salah satu toggle.
- **Diperbaiki di dua lapis** (konsisten dgn prinsip proyek ini -- proteksi harus di
  database, bukan cuma UI):
  1. Validasi form (`handleSave` di `app/(dashboard)/kegiatan/page.tsx`) menolak simpan
     dgn pesan jelas kalau `presensi_metode_qr` dan `presensi_metode_rfid` sama-sama mati.
  2. Migrasi Supabase `require_at_least_one_presensi_metode`: constraint
     `kegiatan_minimal_satu_metode_presensi` (`CHECK (presensi_metode_qr OR
     presensi_metode_rfid)`) di tabel `kegiatan` -- backstop kalau ada jalur tulis lain di
     luar form ini. Pesan error Postgres mentah dipetakan ke pesan ramah di
     `handleSave` kalau backstop ini yang kena. Diverifikasi lewat `BEGIN...ROLLBACK`
     langsung di DB (insert dgn keduanya `false` ditolak, dgn salah satu `true` diterima).
- Data existing aman (1 baris kegiatan di DB, sudah `presensi_metode_qr=true` dari
  default kolom) -- constraint tidak butuh backfill. Detail di
  [ARCHITECTURE.md §11](ARCHITECTURE.md#11-presensi-via-kartu-rfid-struktur-siap-belum-aktif).
- Diverifikasi: `tsc --noEmit`, `eslint` (0 error), `npm run test` (38/38), `npm run build`
  sukses.

### Sesi 22 Juli 2026 — Fase 3 endpoint 3 (TERAKHIR, hibrida): `PATCH /api/users` lewat RPC

- **Endpoint terakhir Fase 3**, beda karakter dari 2 sebelumnya: **HYBRID**. Field non-password
  (nama/no_hp/role/scope/is_active/avatar/archive/restore) dialihkan ke RPC `update_user_profile`;
  `password` TETAP di route via GoTrue Admin API (tak bisa 100% RPC). RPC dipanggil LEBIH DULU
  (bahkan payload kosong) supaya jadi gerbang otorisasi ganda: field akun DAN ganti password --
  password tak pernah tersentuh kalau caller tak berwenang atas target. `getCaller`/
  `canManageMembers`/`canActOnScope` TIDAK dihapus dari file (masih dipakai `POST` bikin-akun).
- **Perbaikan sebelum wiring**: pesan error hierarki role di RPC sebelumnya generik, diperbaiki
  (migrasi `fix_update_user_profile_role_hierarchy_message`) agar identik dgn route lama
  (sebut jenjang tujuan + daftar jenjang yang boleh ditetapkan) -- wrapper meneruskan pesan RPC
  apa adanya, jadi harus benar-benar sama dulu.
- Diverifikasi ulang (self, Super Admin protected, PPG guard, pesan hierarki role, 2 skenario
  baru gerbang password) + `typecheck`/`lint`/`test`/`build` sukses. **Belum:** spot-check live
  (termasuk ganti password nyata) SEBELUM merge. Detail di
  [PLAN_MIGRASI_OTORISASI_RPC.md §0](PLAN_MIGRASI_OTORISASI_RPC.md) Fase 3 poin 3.

### Sesi 21 Juli 2026 (lanjutan 6) — Fase 3 endpoint 2: `PATCH /api/generus` lewat RPC

- **Handler PATCH `/api/generus` dialihkan ke RPC `update_generus_biodata`** (wrapper tipis,
  `userClient` + JWT pemanggil). Bangun `p_payload` jsonb hanya dari field yang dikirim client
  (mirror `!== undefined`), teruskan `user_id`/`generus_id` sbg param. Error 4xx otorisasi:
  pesan spesifik dari RPC diteruskan apa adanya (string di-RAISE identik dgn route lama). Bentuk
  balik `{ success, newLoginUsername? }` identik → frontend tak berubah.
- **Karena GET (endpoint 1) sudah RPC juga, seluruh helper duplikat TS di file itu DIHAPUS**
  (`getCaller`/`canManageMembers`/`canActOnScope`/`generateUniqueLoginUsername`/`adminClient`/
  `Caller`) — file generus route kini bersih: 2 wrapper RPC + helper token. Ini "hapus
  duplikasi" tujuan Fase 3. Bonus: otorisasi+tulis kini ATOMIK (satu transaksi RPC).
- `typecheck`/`lint`/`test`/`build` sukses. RPC-nya sendiri sudah diverifikasi 7 skenario saat
  dibuat (PR #6). **Belum:** round-trip TULIS live — HARUS spot-check di preview PR (login →
  edit & SIMPAN biodata) SEBELUM merge, karena ini jalur tulis ke data ~82 user. Detail di
  [PLAN_MIGRASI_OTORISASI_RPC.md §0](PLAN_MIGRASI_OTORISASI_RPC.md) Fase 3 poin 2.

### Sesi 21 Juli 2026 (lanjutan 5) — Fase 3 pilot: `GET /api/generus` lewat RPC

- **Fase 3 DIMULAI** (pertama kalinya jalur produksi dialihkan, bukan cuma aditif). Pilot:
  handler `GET` di `app/api/generus/route.ts` sekarang **wrapper tipis** yang memanggil RPC
  `get_generus_biodata` lewat `userClient(token)` (anon key + JWT pemanggil, bukan
  service-role) -- otorisasi ditegakkan di DB via `auth.uid()`. Kontrak HTTP tak berubah
  (client tetap `authFetch('/api/generus?userId=...')`), error RPC dipetakan ke status yang
  sama (28000→401, 42501→403), bentuk balik `{ data: <row|null> }` identik.
- Sekaligus merapikan `get_generus_biodata` (migrasi `gate_get_generus_biodata_on_caller_active`)
  agar menggate `caller_account_active()` utk akses biodata SENDIRI juga (sebelumnya terlewat).
- Diverifikasi: `typecheck`/`lint`/`test`/`build` sukses; RPC diverifikasi ulang di DB (4
  skenario, termasuk self-nonaktif→Unauthorized). **Belum:** spot-check round-trip live --
  HARUS dicek manual di URL preview PR (login → buka Data Generus/Profil>Data Diri) SEBELUM
  merge ke `main`, karena merge = langsung live ke ~82 user. Detail di
  [PLAN_MIGRASI_OTORISASI_RPC.md §0](PLAN_MIGRASI_OTORISASI_RPC.md) Fase 3.

### Sesi 21 Juli 2026 (lanjutan 4) — Fase 2 langkah 3 (TERAKHIR): RPC `update_user_profile`

- **RPC penutup Fase 2** diterapkan (migrasi `add_update_user_profile_rpc`), mirror persis
  `PATCH /api/users` bagian non-password (password tetap di GoTrue, di luar RPC). Guard yang
  dipindahkan: proteksi Super Admin, guard PPG, guard scope lama+baru, larangan role_id jadi
  super_admin kedua, hierarki jenjang, semantik arsip/pulihkan. Detail lengkap di
  [PLAN_MIGRASI_OTORISASI_RPC.md §0](PLAN_MIGRASI_OTORISASI_RPC.md) langkah 3.
- Diverifikasi lewat 10 skenario tulis nyata dalam `BEGIN...ROLLBACK` (data user sungguhan,
  tanpa mengubah production secara permanen) -- semua sesuai ekspektasi, dikonfirmasi tanpa
  residu. `get_advisors` bersih. Route lama tetap jalan.
- **Fase 2 (RPC data-only, prioritas #2 audit native) SELESAI TOTAL** -- ketiga RPC
  (`get_generus_biodata`, `update_generus_biodata`, `update_user_profile`) sudah hidup
  berdampingan dgn route lama, siap jadi fondasi Fase 3 (pindahkan pemanggil web) kapan pun
  disetujui.

### Sesi 21 Juli 2026 (lanjutan 3) — Fase 2 langkah 2: RPC `update_generus_biodata`

- **RPC tulis biodata Generus** diterapkan (migrasi `add_update_generus_biodata_rpc`),
  mirror persis `PATCH /api/generus` (guard admin field, guard PPG, guard tempat sambung
  lama+baru, sinkron `login_username`). Detail lengkap di
  [PLAN_MIGRASI_OTORISASI_RPC.md §0](PLAN_MIGRASI_OTORISASI_RPC.md) langkah 2.
- Diverifikasi lewat 7 skenario tulis nyata di dalam `BEGIN...ROLLBACK` (data user
  sungguhan, tanpa mengubah production secara permanen) -- semua sesuai ekspektasi,
  dikonfirmasi tidak ada residu. `get_advisors` bersih. Route lama tetap jalan.

### Sesi 21 Juli 2026 (lanjutan 2) — Fase 2 langkah 1: RPC `get_generus_biodata`

- **RPC pertama Fase 2** ([PLAN_MIGRASI_OTORISASI_RPC.md](PLAN_MIGRASI_OTORISASI_RPC.md) §0)
  diterapkan: `get_generus_biodata(p_user_id)`, mirror persis `GET /api/generus` (termasuk
  fix IDOR scope). Route lama tetap jalan, RPC belum dipanggil kode manapun.
- **Gap ditemukan & diperbaiki**: 4 wrapper self-check dari Fase 1 (`can_manage_members`
  dkk) ternyata tidak mengecek `is_active` caller -- beda dari `getCaller()` TS yang selalu
  fail-closed kalau akun caller nonaktif. Ditambahkan `caller_account_active()` sebagai
  gate tambahan (migrasi `gate_authorization_helpers_on_caller_active`).
- Diverifikasi lewat simulasi `auth.uid()` (`set local request.jwt.claims`) dgn user
  sungguhan (read-only): super_admin lintas scope berhasil, akses biodata sendiri berhasil,
  Generus biasa akses biodata Generus lain ditolak. `get_advisors` bersih.

### Sesi 21 Juli 2026 (lanjutan) — Fase 0+1 migrasi otorisasi RPC (audit native #2)

- **Perbaikan kecil**: audit log `logAudit()` di modal edit Data Generus sekarang ikut
  mencatat `is_active` (sebelumnya cuma tombol cepat toggle yang eksplisit log
  ACTIVATE/DEACTIVATE; edit lewat modal tidak tercermin di detail log).
- **Fase 0+1 dari [PLAN_MIGRASI_OTORISASI_RPC.md](PLAN_MIGRASI_OTORISASI_RPC.md) dieksekusi**
  (prioritas #2 audit native) -- 9 fungsi helper SQL aditif (`can_manage_members`,
  `can_act_on_scope`, `allowed_target_tingkatan`, `can_assign_tingkatan`,
  `normalize_login_username`, + versi "pure" masing-masing) yang mirror persis logika
  otorisasi di `app/api/users/route.ts`/`app/api/generus/route.ts`. Belum dipanggil kode
  manapun -- nol perubahan perilaku. Diverifikasi lewat 30 test case paritas (cocok dgn
  `lib/roles.test.ts`) + `get_advisors` (ditemukan & diperbaiki: search_path belum terkunci
  di 5 fungsi, grant PUBLIC implisit di 4 wrapper -- kedua isu diperbaiki migrasi susulan).
  DB branching Supabase tidak tersedia (butuh plan Pro) -- migrasi diterapkan langsung ke
  production karena aditif murni & reversibel, sesuai persetujuan eksplisit per langkah.
  Detail lengkap di PLAN_MIGRASI_OTORISASI_RPC.md §0.

### Sesi 21 Juli 2026 — Sentry terverifikasi jalan di production

- **Sentry error monitoring** (dipasang sesi 19 Juli) **sudah diverifikasi jalan penuh di
  production**, bukan cuma terpasang di kode. Langkah verifikasi: project Sentry dibuat
  (org `generus-bekasi-timur`, project `javascript-nextjs`, platform Next.js), DSN diisi ke
  Vercel env vars (`NEXT_PUBLIC_SENTRY_DSN` + `SENTRY_DSN`), redeploy, lalu error test
  dilempar langsung dari browser production (`gensiti-app.vercel.app`) dan dikonfirmasi
  muncul di Sentry Issues (`JAVASCRIPT-NEXTJS-1`, route `/login`) dalam hitungan detik.
  `SENTRY_ORG`/`SENTRY_PROJECT`/`SENTRY_AUTH_TOKEN` (source map upload) masih belum diisi --
  opsional, build tetap sukses tanpa itu (cuma warning "will not upload source maps").
  Tidak ada perubahan kode aplikasi di sesi ini.

### Sesi 20 Juli 2026 (lanjutan) — RLS hardening (audit native #1, Batch A)

- **Audit kesiapan native** ([NATIVE_READINESS_AUDIT.md](NATIVE_READINESS_AUDIT.md)) — assessment
  arsitektur sebelum pengembangan Flutter/Tauri. Kesiapan ±60%; 3 gap struktural terbesar +
  urutan prioritas perbaikan.
- **Prioritas #1 (Batch A) sudah dijalankan** — verifikasi RLS langsung di DB (`pg_policies`,
  `pg_proc`, security advisor) lalu migrasi `harden_rls_generus_write_and_cleanup`:
  1. `generus` — policy tulis disamakan dgn `users` (super_admin saja; sebelumnya semua
     tingkatan `daerah` bisa tulis langsung tanpa cek nama_role). Baca tak berubah.
  2. `reset_password_requests` (retired) — cabut policy INSERT `WITH CHECK (true)` yg terbuka.
  3. `increment_otp_attempt` — kunci `search_path`.
  Verified tak memutus flow app (generus tak pernah ditulis langsung client). Security advisor
  pasca-migrasi: 2 temuan hilang. Detail + sisa item (Batch B opsional, leaked-password
  protection) di NATIVE_READINESS_AUDIT.md §5 Log Perubahan.
- **Temuan penting audit:** fondasi RLS ternyata sudah kuat — `users` write-locked ke
  super_admin (self-escalation terblokir), semua fungsi SECURITY DEFINER anon-executable
  punya guard `auth.uid()`/tingkatan internal (tidak bocor).
- **Prioritas #8 (rate limiting) juga dijalankan** — migrasi `add_auth_rate_limit` (tabel
  `auth_rate_limit` deny-all + RPC `check_auth_rate_limit`, service_role only) + limiter
  per-IP di `resolve-login` (120/10 mnt) & `password-reset/request` (20/15 mnt, di atas
  throttle per-user yg sudah ada). Fail-open. Detail di NATIVE_READINESS_AUDIT.md §5.

### Sesi 22 Juli 2026

- **Struktur presensi via Kartu RFID** (mode kiosk, reader dipegang Pengurus) -- disiapkan
  penuh atas permintaan Reno, tapi **sengaja belum diaktifkan di UI produksi** karena QR
  masih dianggap cukup untuk saat ini dan fiturnya belum pernah diuji pakai reader USB
  fisik sungguhan. Dikunci lewat `RFID_PRESENSI_READY = false` di `lib/rfid.ts` -- ganti
  ke `true` + deploy setelah pengujian fisik berhasil, tidak perlu perubahan kode lain.
  - Migrasi Supabase (`add_rfid_presensi`, diterapkan lewat MCP `apply_migration`):
    kolom `generus.kartu_rfid_uid` (unique) dan `kegiatan.presensi_metode_qr`/
    `presensi_metode_rfid` (boolean, default `true`/`false`), plus 3 RPC baru
    (`daftarkan_kartu_rfid`, `cabut_kartu_rfid`, `submit_presensi_rfid`) -- detail lengkap
    di [ARCHITECTURE.md §11](ARCHITECTURE.md#11-presensi-via-kartu-rfid-struktur-siap-belum-aktif).
  - Kode baru: `lib/rfid.ts` (flag kesiapan), `components/RfidKioskInput.tsx` (input
    kiosk auto-focus utk reader keyboard-wedge). Terintegrasi ke `PresensiPanel.tsx`
    (kiosk RFID sisi Pengurus), `app/(dashboard)/kegiatan/page.tsx` (toggle metode
    presensi QR/RFID per kegiatan -- kode manual tetap selalu tersedia di luar toggle
    ini), dan `app/(dashboard)/generus/page.tsx` (tombol "Kartu RFID" di modal Detail
    Generus utk daftar/cabut kartu). Semua elemen UI RFID di-gate lewat
    `RFID_PRESENSI_READY` -- kalau `false`, tombol/checkbox-nya tidak dirender sama
    sekali (bukan cuma disabled), supaya tidak ada dead-end UI di produksi.
  - Diverifikasi: `tsc --noEmit`, `eslint` (0 error, warning sama seperti baseline),
    `npm run test` (38/38), `npm run build` sukses. `get_advisors` Supabase menunjukkan
    RPC baru memicu advisory generik yang sama seperti `generate_kode_presensi`/
    `submit_presensi` yang sudah ada (SECURITY DEFINER + authenticated executable) --
    bukan temuan baru, pola yang sudah diterima proyek ini.
  - **Belum dilakukan** (di luar cakupan sesi ini): uji end-to-end pakai reader RFID USB
    fisik. Sebelum `RFID_PRESENSI_READY` diganti `true`, sebaiknya dicoba dulu di satu
    kegiatan kecil (mirip kegiatan "tes" yang dipakai audit QR sebelumnya).

### Sesi 20 Juli 2026

- **Audit fitur absensi via QR Code** (diminta sebagai permintaan fitur baru, ternyata sudah
  ada) -- ditemukan fitur ini sudah diimplementasikan penuh & live sejak commit `1c2a222`
  (`feat: QR check-in presensi + audit trail koreksi kehadiran`):
  `components/PresensiPanel.tsx` men-generate QR dari `kode_presensi_aktif` (RPC
  `generate_kode_presensi`) untuk Pengurus di kartu kegiatan, dan menyediakan scan kamera
  (`qr-scanner`) untuk Generus dengan **fallback kode manual 6-digit tetap ada** (bukan
  dihapus). Yang ternyata belum sinkron cuma dokumentasi: `CLAUDE.md` §"Rencana Pengembangan"
  masih menandainya `[ ]` belum dikerjakan, dan `ARCHITECTURE.md` belum punya bagian yang
  menjelaskan alur QR ini secara eksplisit (RPC-nya sudah terdaftar di §4, tapi lapisan
  client -- payload QR, rotasi 5 menit, fallback manual -- belum). Diperbaiki: checklist
  `CLAUDE.md` diceklis, ditambahkan [ARCHITECTURE.md §10](ARCHITECTURE.md#10-presensi-via-qr-code-client-side).
  Tidak ada perubahan kode aplikasi -- `tsc --noEmit`, `eslint`, dan `npm run test` (38 test)
  tetap sukses tanpa error/regresi, dan `npm run build` diverifikasi sukses (pakai
  placeholder `NEXT_PUBLIC_SUPABASE_*` di sandbox tanpa akses `.env.local` asli).

### Sesi 19 Juli 2026

- **Pasang Sentry error monitoring** (`@sentry/nextjs`, tier gratis) --
  `instrumentation-client.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`,
  `instrumentation.ts` (`onRequestError`), `app/global-error.tsx`, dan
  `next.config.ts` dibungkus `withSentryConfig`. DSN & konfigurasi lain lewat
  environment variable (`NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_DSN`, `SENTRY_ORG`,
  `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN`), tidak di-hardcode -- lihat
  `.env.example` (file baru, mendokumentasikan semua env var yang dipakai app
  ini). Detail lihat [ARCHITECTURE.md §9](ARCHITECTURE.md#9-error-monitoring-sentry).
  `npm run build` + `tsc --noEmit` + `eslint` sukses tanpa error setelah
  perubahan ini.

### Sesi 16 Juli 2026

1. **Fix bug kritis PasswordInput** (`components/PasswordInput.tsx`) -- input password lama
   memakai `<input type="text">` dengan value hasil masking manual, dan salah menafsirkan
   `e.target.value` (yang sudah berisi bullet campuran) sebagai password asli. Password yang
   diketik panjang bisa tersimpan salah tanpa user sadar. **Sudah diperbaiki total**: sekarang
   pakai `<input type="password">` NATIVE, value selalu asli dari browser, tidak pernah
   direkonstruksi. Preview karakter terakhir cuma badge visual di luar `<input>`, sama sekali
   tidak menyentuh value. Dipakai di 4 tempat: login, profil (3x), generus (1x). Sudah
   diverifikasi live end-to-end.
2. **Fix race condition menu Monitoring & Log** (`app/(dashboard)/monitoring/page.tsx`) --
   halaman redirect ke `/dashboard` sebelum pengecekan `feature_toggles` selesai (state
   `featureChecking` belum `false`), sehingga role yang sebenarnya berhak (mis. Ketua
   Daerah) kadang gagal masuk tergantung kecepatan koneksi. Diperbaiki dengan menunda
   keputusan redirect sampai `featureChecking` selesai.
3. **Audit RLS & endpoint API menyeluruh** (task #74) -- ditemukan & diperbaiki celah
   keamanan nyata lewat migrasi Supabase (detail spesifik ada di riwayat migrasi Supabase,
   bukan di kode lokal).
4. **Reset password akun RENO** (morenoryandika@gmail.com) lewat Supabase Dashboard setelah
   dikonfirmasi password lama corrupt akibat bug #1 di atas (password lama sempat diganti
   lewat form yang masih bug).

Commit terakhir: `6165084` (fix Monitoring), sudah live di production.

---

## 3. Riwayat Pencapaian (kronologis, ringkas)

Total **76 task selesai**. Kelompok besar pekerjaan yang sudah dituntaskan:

- **Absensi & Presensi**: filter target peserta (alamat sambung > kelas ngaji > dapukan),
  auto-alpha untuk yang belum ditandai, rename "Presensi" -> "Absensi" (UI+URL).
- **Laporan Bulanan** (evolusi v1 -> v4): mulai dari agregasi RPC dasar per Daerah/Desa/
  Kelompok, sampai hero metric, perbandingan bulan lalu, rata-rata bergerak 6 bulan + deteksi
  anomali, drill-down per gender, dan daftar rekap individu per Generus. Termasuk export
  PDF/Excel dengan grafik, logo PPG+GENSITI, dan lembar absen kosong cetak.
  fitur ini kompleks & jadi salah satu kekuatan utama aplikasi (RPC-heavy, banyak agregasi).
- **Hak akses & hierarki**: sistem role bertingkat (kelompok < desa < daerah < ppg/super_admin
  paralel) di `lib/roles.ts`, ditegakkan di form tambah/edit pengguna dan API `/api/users`.
  Sistem toggle fitur per menu x jenjang (`feature_toggles`, fail-open by design, Super Admin
  selalu tidak terdampak).
- **Data quality**: backfill & sinkronisasi otomatis `login_username`, import massal 80 data
  Generus (Kartika Wanasari) dengan dry-run dulu, scan data quality seluruh tabel.
  fitur "Pulihkan akun diarsipkan" (menikah/meninggal/pindah) untuk Generus & PPG.
- **Export PDF/Excel**: redesain visual (kartu ringkasan, badge status berwarna), riwayat
  kehadiran bulan berjalan, grafik built-in Excel (sempat ditambah lalu dihapus lagi -- pie
  chart Excel dianggap tidak perlu setelah dicoba).
  fitur "Rekap Absensi Kegiatan" v2/v3 dengan polish berlapis.
- **Kualitas kode**: pembersihan menyeluruh error eslint `react-hooks/set-state-in-effect` di
  seluruh `app/` (0 error app-wide), termasuk perbaikan purity bug di `PresensiPanel`.
- **Keamanan**: audit RLS & endpoint API menyeluruh (task #74), fix login gagal saat pakai
  nama lengkap vs nama panggilan, fix rate limit 429 di edge function `send-email`.
- **UX**: global search lintas modul, sistem reminder terjadwal, toggle show/hide password.
- **Login system**: 2 bug besar ditemukan & diperbaiki (nama lengkap tidak bisa login;
  PasswordInput corrupt value) -- keduanya sudah diverifikasi live.

---

## 4. Target & Arah Pengembangan ke Depan

Belum ada roadmap tertulis eksplisit dari Reno selain permintaan ad-hoc per sesi, jadi bagian
ini disusun dari pola kerja & gap yang terlihat selama audit. **Perlu dikonfirmasi ulang
prioritasnya bersama Reno**, tapi ini kandidat area lanjutan yang masuk akal:

### A. Kesehatan & keamanan sistem (berkelanjutan)
- [x] Endpoint health check publik `/api/health` (`GET`, tanpa autentikasi) -- balas `200`
  + `{status: "ok", timestamp}`, sengaja tidak menyentuh Supabase sama sekali (tetap
  menjawab walau database bermasalah) dan tidak membocorkan data internal apapun. Siap
  dipantau UptimeRobot -- registrasi monitor-nya sendiri ke uptimerobot.com tetap manual
  oleh Reno.
- Audit RLS/API sudah dilakukan sekali (#74) -- sebaiknya jadi rutinitas berkala, terutama
  setiap kali ada fitur baru yang menyentuh tabel sensitif (users, keuangan, reset_password).
- Belum ada rate limiting eksplisit di `/api/resolve-login` -- saat ini mengandalkan rate
  limit bawaan Supabase Auth di level `signInWithPassword`. Layak dicek apakah itu cukup
  untuk skala 82+ pengguna, atau perlu lapisan tambahan (mis. lockout sementara per IP/nama
  setelah beberapa kali gagal).
- Pertimbangkan menambahkan `.gitattributes` (`* text=auto eol=lf`) untuk menghindari isu
  autocrlf berulang di masa depan.

### B. Fitur yang kemungkinan besar masih dibutuhkan
- **Notifikasi**: menu `notifikasi` sudah ada, tapi belum diaudit mendalam sejauh mana
  cakupannya (push notification web sudah ada `lib/push.ts` + `ServiceWorkerRegister.tsx` --
  perlu dicek status pemakaian nyata).
- **Backup data**: menu `backup-data` sudah ada -- perlu dipastikan alurnya (manual/terjadwal)
  dan diuji end-to-end kalau belum pernah dicoba pemulihan datanya.
- **Laporan bulanan untuk jenjang PPG**: sejauh ini RPC laporan bulanan dibangun untuk
  Daerah/Desa/Kelompok -- perlu dicek apakah PPG (jalur paralel) butuh laporan serupa atau
  memang di luar cakupan.
- **Dashboard real-time**: ada indikasi awal (`get_jumlah_generus_aktif`,
  `get_ringkasan_keuangan`, dsb. sebagai RPC) -- kemungkinan ada ruang untuk memperkaya
  dashboard utama dengan lebih banyak insight otomatis, mengikuti pola "ringkasan otomatis"
  yang sudah terbukti bagus di Laporan Bulanan v2.

### C. Kualitas & keberlanjutan jangka panjang
- [x] Automated test dasar sudah ada: `lib/roles.test.ts` (36 test, hak akses/hierarki) +
  2 test lain (38 total lewat `npm run test` / vitest). **Masih gap**: RPC laporan bulanan
  (agregasi berlapis) dan `resolve-login` belum ada test otomatis (pgTAP atau test level
  aplikasi) -- kalau mau nambah cakupan, ini kandidat berikutnya.
- [x] CI/CD gate sudah ada: `.github/workflows/ci.yml` menjalankan `typecheck` + `lint` +
  `test` di tiap push/PR ke `main` (bukan lagi murni Vercel auto-deploy tanpa gate).
- [x] Dokumentasi arsitektur sudah ada di [ARCHITECTURE.md](ARCHITECTURE.md) -- skema
  database, daftar RPC, peta hak akses, alur QR presensi, dan setup Sentry semua
  terdokumentasi di satu tempat untuk onboarding cepat.

### D. Segera dikonfirmasi dengan Reno di awal sesi Claude Code
1. Prioritas: lanjut fitur baru, atau dulukan hardening (test, CI, dokumentasi)?
2. Apakah ada keluhan/laporan bug lain dari pengguna yang belum sempat disampaikan ke Cowork?
3. Target rilis atau musim aktivitas organisasi tertentu yang perlu dikejar (mis. sebelum
   kegiatan besar tertentu, ada fitur yang harus siap)?

---

## 5. Cara Mulai di Claude Code

```powershell
cd "C:\Users\Moreno\Claude\Projects\GENSITI - Smart Organization Management System\gensiti-app"
claude
```

Karena `CLAUDE.md` di root proyek meng-import `AGENTS.md`, instruksi proyek otomatis kebaca.
Sarankan langkah pertama di Claude Code: minta ia baca file ini (`HANDOFF.md`) dan
`lib/roles.ts` + `lib/types.ts` dulu untuk membangun peta mental struktur akses & data
sebelum mengerjakan apa pun.
