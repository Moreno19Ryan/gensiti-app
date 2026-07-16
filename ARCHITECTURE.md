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
| `generus` | Biodata anggota (83 baris) — bisa merangkap `users` lewat `user_id` | `desa_id`, `kelompok_id`, status arsip (menikah/meninggal/pindah_sambung) |

### Konten operasional
| Tabel | Isi |
|---|---|
| `kegiatan` | Kegiatan/acara — scope tingkatan, target peserta, kode presensi rotasi 5 menit, alur approval PPG (`status_approval`) untuk kegiatan tingkat Daerah |
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
| `reset_password_requests` | Antrian permintaan reset password manual |

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
`auto_alpha_generus_kegiatan_selesai` (trigger auto-alpha saat kegiatan selesai)

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
| `app/api/reset-password-requests` | Antrian permintaan reset password |
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
`reset-password-requests`, `backup-data`, `monitoring`, `admin-sistem`,
`pengaturan-fitur` (toggle fitur per menu × jenjang).

## 8. Yang Belum Terdokumentasi / Perlu Update Berkala

- Dokumen ini snapshot per tanggal di atas — RPC & tabel baru harus ditambahkan ke §3/§4
  saat migrasi baru diterapkan lewat Supabase MCP (`apply_migration`).
- Detail lengkap tiap RLS policy (bukan cuma fungsi helper-nya) tidak direplikasi di sini
  — cek langsung lewat Supabase dashboard/MCP (`list_tables` verbose atau query
  `pg_policies`) kalau butuh detail policy spesifik.
