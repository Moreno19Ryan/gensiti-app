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
