# GENSITI — Dokumentasi Arsitektur

Ringkasan teknis untuk onboarding cepat: skema database, daftar fungsi/RPC Supabase, dan
alur hak akses. Ditulis dari kondisi database & kode per **16 Juli 2026**. Untuk konteks
project/produk dan konvensi coding, lihat [CLAUDE.md](CLAUDE.md); untuk riwayat pekerjaan
& arah pengembangan, lihat [HANDOFF.md](HANDOFF.md).

---

## 1. Gambaran Umum

```
User → Vercel (Next.js App Router)  →  Supabase Postgres (RLS + RPC SECURITY DEFINER)
                                     →  Supabase Auth
                                     →  Resend (email)
                                     →  Sentry (error monitoring, tier gratis)
```

- Tidak ada backend custom terpisah — semua logika data lewat Supabase (Postgres + RLS +
  RPC). API routes Next.js (`app/api/*`) memakai **service role key** (bypass RLS) tapi
  **wajib** memverifikasi identitas & scope pemanggil secara manual di kode — lihat
  §4.
- Supabase project ID: `ccyqgcfjmzgkmkczuydv` (region `ap-southeast-1`, Postgres 17).
- Sumber kebenaran hak akses ada **dua lapis yang harus selalu konsisten**:
  1. **Database** (RLS policy + fungsi `is_*()` SECURITY DEFINER + RPC laporan) — enforcement
     sesungguhnya, tidak bisa dilewati dari client manapun.
  2. **Aplikasi** ([lib/roles.ts](lib/roles.ts) + pengecekan di `app/api/*`) — gate UI/UX
     (sembunyikan tombol yang toh akan ditolak) dan validasi kedua di API routes yang pakai
     service role.

## 2. Struktur Jenjang Organisasi

```
Daerah
 └─ Desa (10)
     └─ Kelompok (50)
          └─ Generus (anggota, ~83 aktif)

PPG — jalur paralel, di ATAS Daerah, murni pengawas read-only + approval
      (tidak terikat desa_id/kelompok_id tertentu)

Super Admin — akun tunggal, pengelola sistem (bukan pengurus organisasi)
```

Setiap **user pengurus** (bukan Generus biasa) punya `role.tingkatan` ∈
`{kelompok, desa, daerah, ppg, super_admin}` dan nama role bebas teks (Ketua, Wakil Ketua,
Sekretaris, Bendahara, Kemandirian, Keputrian, dst). Hierarki `tingkatan` (dari bawah ke
atas): `kelompok < desa < daerah < ppg, super_admin` — dipakai HANYA untuk menentukan siapa
boleh membuat role di tingkatan apa (`getAllowedTargetTingkatan` di
[lib/roles.ts:242](lib/roles.ts:242)), bukan untuk gate fitur lain (masing-masing fitur
punya gate sendiri, lihat §4).

## 3. Skema Database (schema `public`, 19 tabel, RLS aktif di semua)

### Struktur organisasi
| Tabel | Isi | Relasi kunci |
|---|---|---|
| `roles` | Master role (nama_role + tingkatan) | `users.role_id` |
| `desa` | 10 Desa | induk `kelompok`, banyak tabel scope |
| `kelompok` | 50 Kelompok | `desa_id` → `desa` |
| `users` | Akun login (84 baris) — profil, role, scope, session token single-login | `role_id`, `desa_id`, `kelompok_id`, terhubung `auth.users` |
| `generus` | Biodata anggota (83 baris) — bisa merangkap `users` lewat `user_id`, `kartu_rfid_uid` (unique, lihat §11) | `desa_id`, `kelompok_id`, status arsip (menikah/meninggal/pindah_sambung) |

> **Invarian RLS tulis `users` & `generus` (sejak 20 Juli 2026).** Kedua tabel ini
> **tidak** pernah ditulis langsung dari client — semua create/update lewat API route
> service-role (`/api/users`, `/api/generus`) yang bypass RLS + verifikasi manual. Karena
> itu policy tulis langsung keduanya sengaja dibatasi **super_admin saja**
> (`users_all_superadmin`, `generus_all_superadmin`); baca tetap hierarkis via policy SELECT
> terpisah (`users_select`, `anggota_select`). Ini menutup celah eskalasi lewat anon key
> (penting untuk client native nanti — lihat NATIVE_READINESS_AUDIT.md §G.1).

### Konten operasional
| Tabel | Isi |
|---|---|
| `kegiatan` | Kegiatan/acara — scope tingkatan, target peserta, kode presensi rotasi 5 menit, `presensi_metode_qr`/`presensi_metode_rfid` (metode presensi aktif, lihat §10-§11), alur approval PPG (`status_approval`) untuk kegiatan tingkat Daerah |
| `absensi` | Rekap kehadiran per kegiatan per generus (`hadir/tidak_hadir/izin/sakit`) + jejak koreksi manual |
| `pengajuan_izin_presensi` | Pengajuan izin generus, perlu approval pengurus sebelum masuk `absensi.status=izin` |
| `pengumuman` | Pengumuman — scope tingkatan, alur approval PPG utk tingkat Daerah |
| `dokumen` | Dokumen — scope tingkatan, publik/privat |
| `catatan_pembinaan` | Catatan pembinaan PPG ke Desa/Kelompok |

### Keuangan
| Tabel | Isi |
|---|---|
| `keuangan` | Transaksi pemasukan/pengeluaran per scope tingkatan |
| `pengajuan_reimbursement` | Pengajuan reimbursement pengurus non-Bendahara, perlu approval Bendahara sebelum jadi transaksi resmi di `keuangan` |

### Notifikasi & komunikasi
| Tabel | Isi |
|---|---|
| `notifikasi` | Notifikasi in-app |
| `push_subscriptions` | Endpoint push notification browser (web push) |
| `email_log` | Log pengiriman email via Resend (pengumuman/kegiatan/reminder/approval/reset password/maintenance) |
| `email_preferensi` | Opt-in/out notifikasi email per user (default semua true) |

### Sistem & audit
| Tabel | Isi |
|---|---|
| `audit_log` | Log aksi sensitif (140 baris) |
| `feature_toggles` | Toggle menu aktif/nonaktif per jenjang role (35 baris), dikelola Super Admin |
| `system_config` | Mode perawatan (maintenance mode), termasuk penjadwalan otomatis |
| `reset_password_requests` | *(Retired)* Antrian permintaan reset password manual -- diganti alur OTP self-service (`password_reset_otp`), tabel dibiarkan ada utk histori, tidak dipakai kode lagi |
| `password_reset_otp` | Kode OTP reset password self-service (hash, expiry, attempt count) -- RLS deny-all, hanya diakses service role |

## 4. Fungsi & RPC Database (schema `public`, ~65 fungsi)

Semua RPC bertanda **SECURITY DEFINER** menjalankan pengecekan role di dalam fungsinya
sendiri (bukan cuma mengandalkan RLS caller) — ini yang dimaksud "sumber kebenaran
sesungguhnya" di komentar `lib/roles.ts`.

**Helper konteks user** (dipakai di dalam RLS policy & RPC lain):
`get_user_role`, `get_user_nama_role`, `get_user_tingkatan`, `get_user_desa_id`,
`get_user_kelompok_id`, `is_pengurus`, `is_pengurus_konten`, `is_pengurus_presensi`,
`is_bendahara`

**Laporan Bulanan** (3 varian per jenjang: `_daerah` / `_desa` / `_kelompok`):
`get_laporan_kehadiran_bulanan_*`, `get_laporan_kelas_ngaji_*`,
`get_rata_rata_kehadiran_6bulan_*`, `get_rekap_generus_bulanan_*`,
`get_tren_kehadiran_tahunan_*`, plus `get_pertumbuhan_generus`,
`get_jumlah_generus_aktif`, `get_ringkasan_keuangan` (dashboard)

**Presensi**: `generate_kode_presensi` (buka/rotasi kode 6-digit), `submit_presensi`
(self check-in generus), `ajukan_izin_presensi`, `proses_izin_presensi`,
`auto_alpha_generus_kegiatan_selesai` (trigger auto-alpha saat kegiatan selesai),
`submit_presensi_rfid`/`daftarkan_kartu_rfid`/`cabut_kartu_rfid` (kiosk RFID, struktur
siap belum aktif — lihat §11). `submit_presensi` & `submit_presensi_rfid` menerima
parameter opsional **`p_waktu_scan`** (ditambahkan 22 Juli 2026 — diverifikasi ulang
langsung ke `pg_proc` production, bukan cuma dari pesan commit git, karena repo ini
tidak punya folder migrasi) — dipakai oleh antrean offline
([lib/offline-queue.ts](lib/offline-queue.ts), §10/§11) supaya `waktu_absen` yang
tercatat adalah waktu generus benar-benar tap/scan, bukan waktu antrean akhirnya
berhasil disinkronkan setelah sinyal pulih. Nilainya di-*clamp*: dipakai apa adanya
kalau masih masuk akal (-24 jam s/d +5 menit dari waktu server), di luar rentang itu
fallback ke `now()`. Signature lama (tanpa parameter ini) sudah dihapus dari database,
tidak ada overload ganda yang ambigu.

> **Bug fix 24 Juli 2026 — GRANT SELECT hilang di `pengajuan_izin_presensi`.**
> Tabel ini punya RLS policy yang benar (`pengajuan_izin_select_sendiri`,
> `pengajuan_izin_select_pengurus`), tapi tidak pernah dapat **table-level GRANT SELECT**
> untuk role `authenticated` — Postgres cek GRANT dulu sebelum RLS dievaluasi, jadi
> query manapun ke tabel ini (`components/PengajuanIzinPanel.tsx` sisi Generus,
> `app/(dashboard)/absensi/page.tsx` sisi Pengurus) selalu gagal
> `permission denied for table pengajuan_izin_presensi` sebelum RLS sempat jalan. Akibatnya
> fitur "Pengajuan Izin Presensi" rusak total di kedua sisi sejak awal dibuat (tabel kosong,
> 0 baris — tidak ada satupun pengajuan yang pernah berhasil tersimpan lewat alur normal,
> meski `ajukan_izin_presensi` RPC-nya sendiri berfungsi karena `SECURITY DEFINER` bypass
> GRANT tabel).
>
> **Fix**: `GRANT SELECT ON public.pengajuan_izin_presensi TO authenticated;` — sengaja
> **hanya SELECT**, bukan INSERT/UPDATE/DELETE. INSERT & UPDATE tetap wajib lewat RPC
> (`ajukan_izin_presensi`/`proses_izin_presensi`) karena keduanya punya efek samping
> penting (insert baris `absensi` + kirim notifikasi) yang harus tetap atomik — memberi
> GRANT langsung akan membuka jalur bypass validasi & efek samping itu.
>
> Diverifikasi lewat simulasi RLS penuh (`SET LOCAL ROLE authenticated` + `request.jwt.claims`
> memakai user sungguhan) untuk sisi Generus maupun Pengurus — keduanya sukses tanpa error
> setelah fix. Root cause murni GRANT database (tidak ter-track git, tidak ada folder migrasi
> di repo ini) — **tidak berkaitan dengan perubahan kode manapun**, ditemukan lewat testing
> manual PR #12 tapi bug-nya sendiri sudah ada sejak tabel ini dibuat.

**Approval workflow** (PPG untuk kegiatan/pengumuman Daerah, Bendahara untuk
reimbursement): `approve_kegiatan`, `reject_kegiatan`, `approve_pengumuman`,
`reject_pengumuman`, `proses_reimbursement`, plus trigger
`set_status_approval_kegiatan`/`set_status_approval_pengumuman`

**Auto-numbering** (nomor generus/kegiatan/dokumen/pengumuman/transaksi/kode
desa-kelompok, format konsisten per scope): `fn_generate_nomor_generus`,
`fn_generate_kode_kegiatan_v2`, `fn_generate_nomor_dokumen_v2`,
`fn_generate_nomor_pengumuman_v2`, `fn_generate_nomor_transaksi_v2`,
`fn_generate_kode_desa`, `fn_generate_kode_kelompok`, `fn_scope_code`, + trigger
wrapper masing-masing (`trigger_fn_*`)

**Notifikasi**: `notify_email`, `notify_inapp_scope`, `notify_push`, `notify_push_scope`,
`build_email_html`, `send_reminder_h1_kegiatan` (H-1 kegiatan),
`send_reminder_laporan_belum_diisi`, plus trigger `trg_notify_email_*` &
`trg_notify_bendahara_reimbursement`

**Lainnya**: `global_search` (pencarian lintas modul), `enforce_single_super_admin`
(trigger — Super Admin akun tunggal mutlak), `rls_auto_enable` (event trigger — RLS wajib
aktif di tabel baru)

## 5. API Routes (Next.js, service role key — bypass RLS + verifikasi manual)

| Route | Fungsi |
|---|---|
| `app/api/users` | CRUD pengguna, enforce `getAllowedTargetTingkatan` server-side |
| `app/api/generus` | CRUD biodata Generus, cek scope tujuan saat pindah sambung (anti-IDOR) |
| `app/api/resolve-login` | Terjemahkan nama panggilan/lengkap → email asli untuk login |
| `app/api/session/claim` | Klaim token sesi aktif (single-session enforcement) |
| `app/api/password-reset/request`, `.../confirm` | Reset password self-service via OTP email (tanpa approval admin) |
| `app/api/backup` | Backup data |
| `app/api/maintenance`, `.../activate-scheduled` | Mode perawatan sistem |

Setiap route ini **wajib** memvalidasi identitas & scope pemanggil secara manual di kode
(karena bypass RLS) — lihat komentar & riwayat fix di masing-masing file untuk detail
celah yang pernah ditemukan (IDOR, eskalasi scope, enumerasi akun).

## 6. Peta Hak Akses ([lib/roles.ts](lib/roles.ts))

Gate UI — HARUS selalu konsisten dengan RLS/RPC di §4 (ini hanya mencegah tombol yang toh
akan ditolak server tampil ke role yang salah):

| Fungsi gate | Siapa yang lolos |
|---|---|
| `canManageMembers` | Ketua/Wakil Ketua/Sekretaris (semua jenjang) + Super Admin |
| `canViewGenerusData` | Semua pengurus + PPG + Super Admin (bukan cuma yang bisa edit) |
| `canManageKontenOrganisasi` | Ketua/Wakil Ketua/Sekretaris — **Super Admin dikecualikan** |
| `canManagePresensi` | Ketua/Wakil Ketua/Sekretaris — **Super Admin & PPG dikecualikan** |
| `isBendahara` / `canAjukanReimbursement` | Bendahara kelola langsung; pengurus lain ajukan via reimbursement |
| `canLihatLaporanDaerah` | Super Admin, PPG, Ketua/Sekretaris Daerah |
| `canLihatLaporanBulanan` | Super Admin, PPG, Ketua/Sekretaris di jenjang manapun |
| `getAllowedTargetTingkatan` | Menentukan tingkatan role yang boleh dibuat user ini (lihat §2) |

Pola berulang yang perlu diingat saat menambah fitur baru: **Super Admin murni pengelola
sistem**, bukan pengurus organisasi — sengaja dikecualikan dari operasional harian
(konten, presensi) tapi diberi akses penuh di modul terkait akun/data pengguna. **PPG**
murni pengawas read-only + approval Daerah, tidak pernah bisa membuat/mengelola apapun.

Test otomatis untuk semua fungsi ini ada di [lib/roles.test.ts](lib/roles.test.ts) (36 test).

## 7. Menu Aplikasi (`app/(dashboard)/*`)

`dashboard`, `absensi`/`presensi`, `anggota`, `generus`/`data-generus`/`data-pembina`,
`kegiatan`, `keuangan`, `pengumuman`, `dokumen`, `catatan-pembinaan`, `notifikasi`,
`organisasi`, `ppg`, `users`, `profil`, `audit-log`, `email-log`,
`backup-data`, `monitoring`, `admin-sistem`,
`pengaturan-fitur` (toggle fitur per menu × jenjang). Reset password kini `app/lupa-password`
(publik, self-service OTP) -- tidak lagi menu Super Admin.

## 8. Restore Data (Darurat)

`Backup Data` ([app/(dashboard)/backup-data/page.tsx](app/(dashboard)/backup-data/page.tsx))
murni **ekspor satu arah** — mengunduh JSON gabungan 10 tabel ke browser Super Admin.
**Tidak ada tombol/endpoint restore/import** — ini keputusan sengaja (dikonfirmasi audit
peran 2026-07-16), bukan fitur yang belum sempat dibuat: restore jarang dipakai tapi
risikonya tinggi (salah urutan insert atau bentrok data bisa merusak seluruh database),
jadi sengaja dibiarkan manual supaya ada jeda berpikir manusia, bukan self-service.

Kalau restore benar-benar dibutuhkan (mis. data korup/terhapus tidak sengaja):

1. Buka file backup JSON terakhir (struktur: `{ _meta: {...}, data: { <tabel>: [...] } }`).
2. Aktifkan **Mode Perawatan Sistem** dulu lewat Monitoring & Log (blokir akses pengguna
   lain selama restore berlangsung — lihat §7 `system_config`).
3. Insert lewat **Supabase SQL Editor** (atau MCP `execute_sql`/`apply_migration`),
   **URUT SESUAI `BACKUP_TABLES`** di `app/api/backup/route.ts` (`desa` → `kelompok` →
   `roles` → `users` → `generus` → `kegiatan` → `absensi` → `pengumuman` → `dokumen` →
   `notifikasi`) — urutan ini sengaja mengikuti dependency foreign key, membalik urutan
   akan gagal karena FK constraint. Contoh pola per tabel (sesuaikan nama tabel &
   tangani konflik ID sesuai kebutuhan — mis. `ON CONFLICT (id) DO NOTHING` kalau restore
   parsial di atas data yang sudah ada):
   ```sql
   insert into public.desa
   select * from jsonb_populate_recordset(null::public.desa, '<isi data.desa dari JSON>'::jsonb)
   on conflict (id) do nothing;
   ```
4. Setelah semua tabel selesai, jalankan `get_advisors` (Supabase MCP) untuk cek RLS/FK
   tidak ada yang rusak, lalu nonaktifkan Mode Perawatan.
5. Tabel yang SENGAJA tidak ada di backup (`keuangan`, `catatan_pembinaan`,
   `email_preferensi` — lihat `EXCLUDED_TABLES` di kode) tidak bisa direstore dari file
   ini sama sekali — di luar wewenang Super Admin secara desain.

## 9. Error Monitoring (Sentry)

Sentry (`@sentry/nextjs`, tier gratis) dipasang untuk menangkap error tak
tertangani di client, server, dan edge runtime.

- Konfigurasi: `instrumentation-client.ts` (client), `sentry.server.config.ts`
  (server), `sentry.edge.config.ts` (edge), didaftarkan lewat `instrumentation.ts`
  (`register()` + `onRequestError`). `app/global-error.tsx` menangkap error yang
  lolos sampai root layout.
- `next.config.ts` dibungkus `withSentryConfig` untuk upload source maps saat
  build (opsional, hanya jalan kalau `SENTRY_AUTH_TOKEN` tersedia).
- DSN dan konfigurasi lain **selalu** lewat environment variable, tidak pernah
  di-hardcode: `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_DSN` (wajib diisi agar Sentry
  aktif; kalau kosong, SDK otomatis nonaktif lewat flag `enabled`), plus
  `SENTRY_ORG` / `SENTRY_PROJECT` / `SENTRY_AUTH_TOKEN` (opsional, untuk upload
  source map di CI/Vercel). Lihat `.env.example`.
- **Status: terverifikasi jalan di production** (21 Juli 2026) — project Sentry
  `javascript-nextjs` (org `generus-bekasi-timur`), DSN terisi di Vercel, error
  test dari browser production berhasil tertangkap di Sentry Issues.

## 10. Presensi via QR Code (Client-Side)

Lapisan client di atas RPC presensi (§4 `generate_kode_presensi` / `submit_presensi`) —
diimplementasikan di [components/PresensiPanel.tsx](components/PresensiPanel.tsx), dipasang
per-kartu kegiatan di [app/(dashboard)/kegiatan/page.tsx](<app/(dashboard)/kegiatan/page.tsx>).

- **Pengurus** (`canManagePresensi`, §6): tekan "Mulai Absensi" → memanggil
  `generate_kode_presensi` → kode 6-digit yang didapat di-encode jadi QR PNG di sisi client
  (`qrcode`, `QRCode.toDataURL`) dan ditampilkan besar di kartu kegiatan. Kode & QR **rotasi
  otomatis tiap 5 menit** selagi sesi terbuka (`KODE_MASA_BERLAKU_MS`), memanggil ulang RPC
  yang sama. Kode presensi tetap satu-satunya sumber kebenaran untuk validasi — QR murni
  representasi visualnya, bukan jalur otorisasi terpisah.
- **Generus & pengurus lain**: default-nya tombol "📷 Scan QR Absensi" (kamera device via
  `qr-scanner`) untuk self check-in. **Input kode manual 6-digit tetap tersedia** sebagai
  jalur alternatif (bukan dihapus) lewat link "Kamera tidak bisa? Masukkan kode manual" —
  keduanya berakhir memanggil RPC `submit_presensi` yang sama persis, jadi validasi &
  anti-duplikasi konsisten terlepas dari cara input.
- **Payload QR**: JSON `{v: 1, kegiatanId, kode}` (bukan sekadar kode polos) supaya hasil
  scan bisa divalidasi dulu di client (kegiatan cocok, format benar) sebelum memanggil
  `submit_presensi` — pesan error lebih jelas & cepat kalau salah scan QR kegiatan lain,
  meski otorisasi sesungguhnya tetap di RPC (server), tidak bisa dilewati dari sini.
- Super Admin & PPG tidak melihat panel self check-in sama sekali (bukan peserta kegiatan
  — lihat §6), hanya keterangan netral.

## 11. Presensi via Kartu RFID (Struktur Siap, Belum Aktif)

Lapisan kiosk di atas presensi yang sama (§4, §10) — reader RFID dipegang **Pengurus**
(beda dari QR/manual yang self-service), Generus tap kartu bergiliran ke device yang sama.
Skema, RPC, dan komponennya sudah lengkap, tapi **belum ditampilkan di UI produksi**:
dikunci lewat `RFID_PRESENSI_READY = false` di [lib/rfid.ts](lib/rfid.ts) sampai diuji
dengan reader USB fisik sungguhan. Ganti ke `true` + deploy setelah pengujian berhasil —
tidak perlu perubahan kode lain.

- **Skema baru**: `generus.kartu_rfid_uid` (text, unique, nullable — satu kartu = satu
  Generus) dan `kegiatan.presensi_metode_qr` / `kegiatan.presensi_metode_rfid` (boolean,
  default `true`/`false`) — Pengurus memilih metode mana yang aktif per kegiatan lewat
  form di `app/(dashboard)/kegiatan/page.tsx`. **Input kode manual selalu tersedia di luar
  kedua flag ini**, tidak pernah ikut di-toggle. Constraint `kegiatan_minimal_satu_metode_
  presensi` (`CHECK (presensi_metode_qr OR presensi_metode_rfid)`) mencegah kedua flag
  mati bersamaan di level database — bukan cuma validasi form — supaya tidak ada kegiatan
  tersimpan tanpa metode presensi cepat apapun (kode manual tanpa QR/RFID berarti Pengurus
  harus membacakan kode satu per satu ke tiap Generus, hampir pasti bukan yang dimaksud).
- **`daftarkan_kartu_rfid(p_generus_id, p_kartu_uid)`** / **`cabut_kartu_rfid(p_generus_id)`**:
  bind/lepas UID kartu ke seorang Generus. Otorisasi sama seperti `canManageMembers`
  (§6): Ketua/Wakil Ketua/Sekretaris jenjang manapun + Super Admin, dengan scope Desa/
  Kelompok ditegakkan di RPC (bukan cuma UI). Dipanggil dari tombol "Kartu RFID" di modal
  Detail Generus (`app/(dashboard)/generus/page.tsx`).
- **`submit_presensi_rfid(p_kegiatan_id, p_kode, p_kartu_uid, p_waktu_scan)`**: variasi
  `submit_presensi` dengan beda kunci — identitas peserta dicari lewat `kartu_rfid_uid`,
  **bukan** `auth.uid()`, karena yang login di reader adalah Pengurus, bukan pemilik kartu.
  Konsekuensinya, otorisasi PEMANGGIL disamakan dengan `generate_kode_presensi` (Ketua/
  Wapon/Sekretaris + scope kegiatan) supaya cuma device yang dioperasikan Pengurus resmi
  yang bisa men-tap-kan kartu orang lain. Validasi bisnis lain (kegiatan `ongoing`, scope
  alamat sambung, `target_peserta`, anti-duplikasi, PPG dikecualikan) identik dengan
  `submit_presensi` — **KECUALI cek kode presensi**, yang sengaja DILONGGARKAN khusus di
  sini (diubah 22 Juli 2026, isi fungsi diverifikasi ulang langsung ke production): RFID
  hanya mensyaratkan `kode_presensi_aktif IS NOT NULL` + `p_kode` tidak kosong — **tidak
  lagi** mengharuskan `p_kode` sama dengan kode yang aktif SAAT INI ataupun belum
  kedaluwarsa (beda dari `submit_presensi`/QR-manual di §10 yang tetap wajib keduanya,
  TIDAK ikut dilonggarkan). Alasan: RFID sudah digerbang login + role + scope Pengurus di
  atas, jadi kode presensi di jalur ini murni penanda "sesi presensi sedang dibuka" (tidak
  pernah ditampilkan ke publik untuk di-screenshot, beda dari QR yang butuh rotasi 5 menit
  sebagai proteksi anti-penyalahgunaan) — pelonggaran ini supaya kartu yang di-tap saat
  sinyal offline tetap tercatat walau kode presensinya sempat rotasi beberapa kali sebelum
  antrean ([lib/offline-queue.ts](lib/offline-queue.ts)) berhasil disinkronkan. `p_waktu_scan`
  sama seperti dijelaskan di §4 — waktu tap asli dari device, di-*clamp* -24 jam s/d +5
  menit dari waktu server. `absensi.keterangan` diisi `'RFID check-in'` (beda dari
  `'Self check-in'`) untuk keperluan rekap/audit.
- **`components/RfidKioskInput.tsx`**: dirender di `PresensiPanel.tsx` sisi Pengurus saat
  `RFID_PRESENSI_READY && kegiatan.presensi_metode_rfid`. Input tersembunyi auto-focus
  menerima ketikan reader USB mode "keyboard wedge" (UID + Enter), auto-clear & re-focus
  setelah tiap submit supaya kartu berikutnya bisa langsung di-tap tanpa klik apa pun.
- **Keamanan UID kartu**: UID bukan rahasia (bisa dibaca reader murah mana pun) — level
  keamanan sesungguhnya ada di kombinasi *kode presensi aktif* (rotasi 5 menit, sama
  seperti QR) + *device dipegang Pengurus yang login*, bukan di kerahasiaan UID itu
  sendiri. Cukup untuk skala organisasi ini, bukan tingkat keamanan bank-grade.

## 12. Yang Belum Terdokumentasi / Perlu Update Berkala

- Dokumen ini snapshot per tanggal di atas — RPC & tabel baru harus ditambahkan ke §3/§4
  saat migrasi baru diterapkan lewat Supabase MCP (`apply_migration`).
- Detail lengkap tiap RLS policy (bukan cuma fungsi helper-nya) tidak direplikasi di sini
  — cek langsung lewat Supabase dashboard/MCP (`list_tables` verbose atau query
  `pg_policies`) kalau butuh detail policy spesifik.
