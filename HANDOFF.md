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

## 2. Yang Baru Saja Dikerjakan (sesi 16 Juli 2026)

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
- Tidak ada automated test (unit/integration) sejauh ini -- semua verifikasi manual (tsc,
  eslint, uji browser langsung). Untuk skala kode 12rb+ baris dan fitur sekompleks laporan
  bulanan (RPC agregasi berlapis), test otomatis untuk fungsi kritis (perhitungan H/I/S/A,
  hierarki akses, resolve-login) akan mengurangi risiko regresi seiring proyek membesar.
  Pertimbangkan setidaknya test untuk `lib/roles.ts` dan RPC-RPC laporan (lewat pgTAP atau
  test di level aplikasi).
- CI/CD saat ini murni Vercel auto-deploy tanpa gate (tidak ada CI yang menjalankan
  tsc/eslint sebelum deploy) -- kalau commit langsung ke `main` tanpa cek lokal, ada risiko
  deploy kode yang error. Pertimbangkan GitHub Action ringan (tsc + eslint) sebagai
  pre-deploy check.
- Dokumentasi arsitektur (skema database, daftar RPC, diagram alur peran/akses) belum ada
  dalam bentuk terpisah -- pengetahuannya saat ini tersebar di komentar kode (yang memang
  bagus & detail, tapi tidak ada satu tempat ringkas untuk onboarding cepat kalau ada
  kontributor baru).

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
