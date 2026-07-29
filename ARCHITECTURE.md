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

## 3. Skema Database (schema `public`, 20 tabel, RLS aktif di semua)

### Struktur organisasi
| Tabel | Isi | Relasi kunci |
|---|---|---|
| `roles` | Master role (nama_role + tingkatan) | `users.role_id` |
| `desa` | 10 Desa | induk `kelompok`, banyak tabel scope |
| `kelompok` | 50 Kelompok | `desa_id` → `desa` |
| `users` | Akun login (84 baris) — profil, role, scope | `role_id`, `desa_id`, `kelompok_id`, terhubung `auth.users` |
| `generus` | Biodata anggota (83 baris) — bisa merangkap `users` lewat `user_id`, `kartu_rfid_uid` (unique, lihat §11) | `desa_id`, `kelompok_id`, status arsip (menikah/meninggal/pindah_sambung) |

### Autentikasi & sesi
| Tabel | Isi |
|---|---|
| `user_sessions` | **(A4, 27 Juli 2026)** 1 baris per device login, maks 2 baris/user (device ke-3 menendang yang tertua) -- menggantikan kolom tunggal `users.active_session_token`/`active_session_created_at` (keduanya di-DROP). RLS: baca/hapus hanya baris sendiri ATAU Super Admin (data per-sesi -- user-agent, waktu login -- dianggap lebih sensitif drpd data pengguna umum, jadi TIDAK ikut kebuka utk Daerah/PPG seperti `users_select`). Insert HANYA lewat RPC `claim_session`, tidak ada policy/grant INSERT client. |

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
| `pesan_motivasi` | Kumpulan teks pesan/pantun penyemangat (40 baris seed) -- ditampilkan random 1x per sesi browser di Dashboard, bisa dimatikan per user lewat `users.tampilkan_pesan_motivasi` (Profil > Notifikasi) |

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
`sinkron_status_kegiatan_jika_selesai` (dipanggil client saat kegiatan sudah lewat
`tanggal_selesai` — lihat §10 untuk kenapa ini masih perlu ada meski status dihitung live),
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

> **Eskalasi approval yang nyangkut (A6, 26 Juli 2026).** `proses_reimbursement`
> sekarang mengizinkan **dua** tier caller, bukan cuma Bendahara: `is_bendahara()`
> ATAU (`get_user_nama_role() ilike '%ketua%'` DAN `pengajuan.created_at < now() -
> interval '3 days'`) -- scope tingkatan caller tetap harus persis sama dengan
> pengajuan (bukan pola broadcast "daerah lihat semua" seperti notifikasi
> kegiatan/pengumuman, ini otorisasi sungguhan). Kalau Bendahara belum
> memproses reimbursement dalam >3 hari, Ketua di jenjang yang sama sekarang
> bisa ambil alih Setujui/Tolak langsung dari `app/(dashboard)/keuangan/page.tsx`
> (badge "⚡ Sudah >3 hari menunggu Bendahara"). Kegiatan/pengumuman Daerah
> TETAP eskalasi ke Super Admin (tidak berubah, PPG tetap approver utama).
> Desain ini **bukan** auto-approve (opsi awal yang diusulkan, ditolak karena
> risiko governance keuangan) -- approval tetap perlu aksi manual manusia,
> sistem cuma membuka jalur pengambilalihan + reminder berkala. Lihat
> `WISHLIST_ASSESSMENT.md` §A6 untuk assessment awal.

**Auto-numbering** (nomor generus/kegiatan/dokumen/pengumuman/transaksi/kode
desa-kelompok, format konsisten per scope): `fn_generate_nomor_generus`,
`fn_generate_kode_kegiatan_v2`, `fn_generate_nomor_dokumen_v2`,
`fn_generate_nomor_pengumuman_v2`, `fn_generate_nomor_transaksi_v2`,
`fn_generate_kode_desa`, `fn_generate_kode_kelompok`, `fn_scope_code`, + trigger
wrapper masing-masing (`trigger_fn_*`)

**Notifikasi**: `notify_email`, `notify_inapp_scope`, `notify_push`, `notify_push_scope`,
`build_email_html`, `send_reminder_h1_kegiatan` (H-1 kegiatan),
`send_reminder_laporan_belum_diisi`,
`send_reminder_approval_kegiatan_pengumuman`/`send_reminder_approval_reimbursement`
(A6, cron harian 08:00 WIB -- reminder proaktif ke approver yang belum
memproses, bukan cuma menunggu approver buka Dashboard sendiri),
`set_tampilkan_pesan_motivasi` (toggle preferensi pesan motivasi per user,
`SECURITY DEFINER` yang hanya menyentuh `auth.uid()` sendiri, tidak menerima
parameter target user), plus trigger `trg_notify_email_*` &
`trg_notify_bendahara_reimbursement`. **Tone/voice (26 Juli 2026):** subjek &
isi email otomatis (pengumuman/kegiatan/approval/reminder) serta notifikasi
in-app diperhalus mengikuti `PANDUAN_TONE_VOICE_GENSITI.md` -- lihat commit
migrasi `tone_voice_email_notifikasi`.

**Autentikasi & sesi (A4, 27 Juli 2026):** `claim_session(p_user_agent)` -- `SECURITY DEFINER`,
dipanggil client sekali tepat setelah `signInWithPassword` berhasil; insert baris baru ke
`user_sessions` lalu tendang sesi TERTUA kalau sudah >2 (lihat §3). Menggantikan
`app/api/session/claim` (service-role) sesuai rekomendasi NATIVE_READINESS_AUDIT.md §B.2.
`created_at` tabel `user_sessions` pakai `clock_timestamp()`, BUKAN `now()` -- `now()` tetap
sama sepanjang 1 transaksi Postgres, jadi kalau dipakai di sini urutan eviksi antar-login yang
berdekatan bisa jadi tidak deterministik (ketemu langsung saat verifikasi `BEGIN...ROLLBACK`
sebelum migrasi diterapkan). `count_sesi_aktif()` -- agregat jumlah sesi aktif se-sistem,
sengaja terbuka utk semua `authenticated` (bukan cuma Super Admin/Team IT) krn cuma 1 angka
total tanpa detail per-device, dipakai kartu "Sesi Aktif" di Monitoring & Log > Kesehatan
Sistem.

**Lainnya**: `global_search` (pencarian lintas modul), `enforce_single_super_admin`
(trigger — Super Admin akun tunggal mutlak), `rls_auto_enable` (event trigger — RLS wajib
aktif di tabel baru)

## 5. API Routes (Next.js, service role key — bypass RLS + verifikasi manual)

| Route | Fungsi |
|---|---|
| `app/api/users` | CRUD pengguna, enforce `getAllowedTargetTingkatan` server-side |
| `app/api/generus` | CRUD biodata Generus, cek scope tujuan saat pindah sambung (anti-IDOR) |
| `app/api/resolve-login` | Terjemahkan nama panggilan/lengkap → email asli untuk login |
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

**Sidebar desktop -- "liquid glass" (Tahap 1, 2026-07-28):** sidebar di `app/(dashboard)/layout.tsx`
sekarang glassmorphism di breakpoint `lg:` (semua kelas turunan pakai prefix `lg:`, MOBILE TIDAK
DISENTUH -- masih drawer solid `bg-blue-900` persis seperti sebelumnya). Perubahan: kartu
mengambang (`lg:ml-2 lg:top-2 lg:mb-2 lg:rounded-3xl`, bukan lagi edge-to-edge), semi-transparan +
`backdrop-blur-xl backdrop-saturate-150` + `ring-inset` border highlight. Dua blob gradient biru
`-z-10` (`isolate` di wrapper terluar) ditambah di background halaman -- tanpa ini blur nyaris
tidak kelihatan bedanya dari warna solid, krn sidebar nempel di tepi (tidak overlay konten yang
di-scroll seperti tab Berita). Ikon collapsed dapat tooltip hover: SATU instance `hoverTip` state
dibagi bareng (bukan span per-item), posisi dihitung via `getBoundingClientRect()`, di-render DI
LUAR `<nav>` -- percobaan awal pakai span absolute per-item ternyata ikut terpotong oleh `<nav>`
sendiri (browser memaksa `overflow-x` ikut jadi `auto` begitu `overflow-y-auto` diset, walau
`<aside>`-nya sudah `lg:overflow-visible` -- aturan CSS Overflow Module, dibuktikan lewat
computed-style check saat testing).

**Bottom nav mobile -- "liquid glass" (Tahap 2, 2026-07-29):** drawer hamburger mobile lama
DIHAPUS TOTAL (tombolnya di topbar & elemen `<aside>` mobile-nya) -- digantikan bottom nav fixed
(`fixed left-2 right-2`, `bottom: max(0.5rem, env(safe-area-inset-bottom))` utk safe-area PWA)
dengan treatment glass SAMA PERSIS kelasnya dgn sidebar desktop. Beda dari sidebar: bottom nav
genuinely overlay konten yang di-scroll (bukan nempel di tepi kosong), jadi TIDAK perlu blob
ambient-glow buatan seperti sidebar. Label SELALU tampil (bukan disembunyikan di balik hover,
beda sengaja dari sidebar krn mobile tidak punya mouse).

4 menu utama per kelompok peran (bukan diambil otomatis dari urutan `navItems` -- urutan itu
disusun utk alasan lain mis. cluster PPG, dikonfirmasi manual lewat mockup sebelum implementasi):
```
Generus        : Dashboard, Kegiatan, Absensi (self-view), Pengumuman
PPG             : Dashboard, Dashboard PPG, Catatan Pembinaan, Kegiatan
Daerah/Desa/Kelompok (bukan Generus) : Dashboard, Absensi (kelola), Data Generus, Keuangan
Super Admin     : Dashboard, Data Generus, Keuangan, Monitoring & Log
```
Notifikasi sengaja tidak diberi slot di peran manapun -- sudah ada lonceng permanen di topbar.
Sisanya (termasuk avatar/nama/role/tombol Keluar yang dulu ada di header drawer) masuk sheet
"Lainnya" yang slide-up dari bawah, grid 4 kolom.

Dua flag baru opsional di `NavItem` (additive, tidak ubah struktur lama): `showOnlyForGenerus`
(kebalikan `hideForGenerus`) dan `hideFromSidebar` (item bottom-nav-mobile-only, TIDAK pernah
muncul di sidebar desktop -- Tahap 2 scope-nya mobile saja). Dipakai utk 1 entry baru:
`/profil/riwayat-absensi` dinaikkan jadi shortcut bottom nav Generus (halaman self-view riwayat
presensi sudah ada sejak lama, cuma belum pernah jadi menu top-level) -- **BUKAN** perubahan
akses, dicek eksplisit ke Reno dulu sebelum dikerjakan krn sempat ambigu dgn `/absensi` (menu
kelola milik pengurus, tetap `hideForGenerus`, tidak disentuh). Filter role/feature-toggle
lama (`isNavItemVisible`, dipakai bareng sidebar & bottom nav) tidak diubah logikanya.

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

### Status & jendela presensi dihitung LIVE, bukan lagi field manual (28 Juli 2026)

Sampai migrasi `kegiatan_jendela_presensi_otomatis`, Pengurus harus MANUAL mengedit
`kegiatan.status` ke `'ongoing'` dulu (dropdown di form) sebelum panel presensi bahkan
muncul — gampang lupa, dan tidak ada cara "buka lebih awal" untuk Generus yang sudah di
lokasi sebelum jam resmi. Sekarang:

- Status tampilan (`Akan Datang`/`Berlangsung`/`Selesai`) dihitung LIVE dari
  `tanggal_mulai`/`tanggal_selesai` lewat `computeKegiatanStatus()` di
  [lib/kegiatan-status.ts](lib/kegiatan-status.ts) — dropdown status manual di form Kegiatan
  **sudah dihapus**. Kolom `kegiatan.status` di database TETAP ada, tapi sekarang murni
  housekeeping (lihat poin berikutnya), tidak pernah lagi jadi sumber kebenaran gating UI.
- Jendela presensi (`isPresensiWindowOpen()`, fungsi sama) bisa terbuka LEBIH AWAL dari
  `tanggal_mulai` sesuai `kegiatan.presensi_buka_lebih_awal_menit` (pilihan 0/15/30/60 menit
  di form) — Generus yang sudah di lokasi bisa langsung absen tanpa menunggu jam pasti.
  `PresensiPanel.tsx` memakai fungsi ini utk gate render (ganti dari cek
  `kegiatan.status === 'ongoing'` lama).
- **`submit_presensi`/`submit_presensi_rfid` (server, sumber kebenaran sesungguhnya)**
  sekarang mengecek jendela waktu yang SAMA PERSIS (`tanggal_mulai -
  presensi_buka_lebih_awal_menit` s/d `tanggal_selesai`), BUKAN lagi `status = 'ongoing'`.
  `generate_kode_presensi` SENGAJA TIDAK ikut dibatasi jendela waktu (Pengurus tetap bisa
  generate kode kapan saja kalau perlu) — batasan sesungguhnya ada di `submit_presensi`,
  bukan di pembuatan kodenya.
- **Auto-alpha tetap jalan seperti sebelumnya** — trigger database
  `trg_auto_alpha_generus_kegiatan_selesai` (fungsi `auto_alpha_generus_kegiatan_selesai`,
  TIDAK diubah sama sekali di migrasi ini) masih terpicu begitu `kegiatan.status` transisi ke
  `'selesai'`. Yang berubah cuma SIAPA yang memicu transisi itu: dulu Pengurus manual lewat
  dropdown, sekarang RPC baru **`sinkron_status_kegiatan_jika_selesai(p_kegiatan_id)`** —
  dipanggil client (fire-and-forget) dari `loadData()`/`loadKegiatan()` di halaman Kegiatan &
  Absensi setiap kali daftar kegiatan dimuat, kalau kegiatan itu computed-status-nya sudah
  `'selesai'` tapi kolom `status` database belum. Idempotent (`WHERE status <> 'selesai'`).
  **Konsekuensi yang disadari & diterima**: kalau tidak ada satupun yang membuka halaman
  Kegiatan/Absensi tepat saat sebuah kegiatan selesai, auto-alpha baru benar-benar tersimpan
  ke database saat SESEORANG berikutnya membuka salah satu halaman itu — bukan persis di
  detik kegiatan selesai. Trade-off yang disengaja (bukan cron/background job) supaya tidak
  perlu infrastruktur produksi baru.
- **`kegiatan.lokasi_maps_url`** (text, opsional) — link Google Maps lokasi, ditampilkan
  sebagai link "Buka Maps" di kartu kegiatan (`app/(dashboard)/kegiatan/page.tsx`) untuk
  membantu Generus yang belum tahu lokasi acara.
- **Badge "Tepat Waktu"/"Terlambat"** di rekap absensi (`app/(dashboard)/absensi/page.tsx`)
  — `isTepatWaktu()` (fungsi sama di `lib/kegiatan-status.ts`) membandingkan `waktu_absen`
  vs `tanggal_mulai`, murni tampilan (tidak ada kolom baru).
- **Koreksi manual kehadiran wajib alasan + catatan** — dropdown "Tandai" di halaman Absensi
  tidak langsung menyimpan lagi, membuka modal pemilihan alasan (Lupa Absen/Kendala
  Teknis/Lainnya) + catatan wajib dulu, tersimpan ke `absensi.keterangan` menggantikan teks
  generik lama `"Koreksi manual pengurus"`.

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

## 12. Berita Organisasi (Mirror RSS/Feed Publik Multi-Sumber)

Menu "Berita Organisasi" (`app/(dashboard)/berita/page.tsx`) menampilkan ringkasan berita dari
feed publik beberapa organisasi afiliasi — **DPD LDII Kota Bekasi**
(`https://ldiibekasikota.or.id/feed/`), **LDII** nasional (`https://www.ldii.or.id/feed/`),
**PERSINAS ASAD** (`https://official.asad.or.id/feed/`), dan **SENKOM Mitra Polri**
(`https://www.senkom.or.id/feeds/posts/default?alt=rss`) — diperbarui otomatis, dipilih lewat
tab di dalam halaman. Awalnya menu ini khusus LDII (`berita_ldii`/`fetch-berita-ldii`) — sudah
digeneralisasi (28 Juli 2026) jadi satu tabel + satu Edge Function multi-sumber supaya
menambah sumber baru nanti cukup 1 baris config, bukan duplikasi ~150 baris kode.

**Prioritas tampilan LDII Kota Bekasi**: karena GENSITI untuk Generus Bekasi Timur (bagian dari
Kota Bekasi), tab ini ditaruh **paling kiri & jadi tab default** saat halaman dibuka (`activeSumber`
awal `'ldii-bekasi'`, bukan LDII nasional), plus ikon 📍 di label tab-nya — supaya berita paling
relevan lokal (kegiatan PAC/PC spesifik wilayah Bekasi) langsung terlihat tanpa perlu klik.
Keputusan ini (dari 2 opsi tata letak yang diajukan: tab biasa yang dijadikan default, vs section
"Sorotan Lokal" terpisah di atas tab) dikonfirmasi eksplisit Reno — pilih opsi tab biasa supaya
tidak menambah kompleksitas komponen baru.

- **Alur**: pg_cron job (jadwal `0 */4 * * *`, tiap 4 jam) → fungsi tipis
  `public.fetch_berita_organisasi_cron()` (pola identik `notify_push`/`send_reminder_*`) →
  `net.http_post` (timeout 30 detik — default 5 detik pg_net terlalu pendek untuk fetch
  keluar ke situs pihak ketiga) → Edge Function `fetch-berita-organisasi` (Deno,
  `fast-xml-parser`) → loop atas array `SOURCES` hardcoded di dalam function (`{sumber,
  feedUrl, truncateRingkasan?}`), fetch tiap feed, parse, upsert ke tabel `berita_organisasi`
  by `guid` (kolom `sumber` membedakan asalnya).
- **Prinsip hak cipta (WAJIB dijaga kalau menyentuh kode ini)** — caranya beda per platform
  sumber, jangan asumsikan satu pola cocok semua:
  - **WordPress (LDII Kota Bekasi, LDII nasional, ASAD)**: `<description>` SUDAH otomatis
    dipotong jadi cuplikan pendek oleh Yoast SEO/WordPress sendiri — aman dipakai langsung.
    `<content:encoded>` (isi artikel LENGKAP, kalau ada) hanya disentuh untuk SATU hal — regex
    keluarkan URL `<img src="...">` PERTAMA sebagai thumbnail (`gambar_url`, nullable), setara
    ekstraksi `og:image` link preview medsos (hotlink, BUKAN salinan teks). **Teks
    `content:encoded` itu sendiri tidak pernah disimpan/diekspos.** ASAD malah tidak punya
    `content:encoded` sama sekali di feed-nya — `gambar_url` otomatis selalu `null` untuk
    sumber ini, tidak ada mekanisme thumbnail apapun. LDII Kota Bekasi pola persis sama dengan
    LDII nasional (termasuk wording boilerplate Yoast "appeared first on"), tidak butuh
    penanganan khusus.
  - **Blogger (SENKOM)**: BEDA STRUKTURAL — `<description>` di Blogger BUKAN cuplikan, isinya
    ARTIKEL LENGKAP (Blogger tidak punya mekanisme auto-excerpt terpisah seperti Yoast).
    Ditemukan saat riset (panjang description 4.000–11.000+ karakter per item). Kalau
    diperlakukan sama seperti LDII/ASAD (pakai field apa adanya), itu JUSTRU melanggar prinsip
    "cuma cuplikan" — karena di sini description = isi lengkap. Solusinya: potong SENDIRI di
    sisi kita ke `truncateRingkasan` karakter pertama (`potongRingkasan()`, default 280,
    dipotong di batas kata terdekat + elipsis) — TIDAK PERNAH simpan lebih dari itu.
    Thumbnail-nya pakai `<media:thumbnail url="...">` yang memang disediakan Blogger sebagai
    field terpisah (hotlink resmi, bukan regex dari body).
  - Field yang pernah dibaca (semua sumber): title/link/pubDate/description(ringkasan)/
    category/guid. Ringkasan dibersihkan dari HTML entity mentah (`decodeHtmlEntities`,
    dijalankan 2x — Blogger kadang double-escape entity di XML, mis. `&amp;nbsp;`
    merepresentasikan `&nbsp;` asli) & boilerplate Yoast SEO (`bersihkanRingkasan` — regex
    men-tolerir dua variasi kalimat "appeared first on"/"first appeared on" DAN marker `[…]`
    yang OPSIONAL di depannya, karena tidak semua situs/artikel menyertakannya). Kalau
    menambah sumber/field baru, evaluasi dulu platform-nya (WordPress? Blogger? lainnya) —
    JANGAN asumsikan field description selalu aman dipakai apa adanya.
  - Parser `XMLParser` dipanggil dengan `processEntities: false` — feed SENKOM (banyak entity
    ter-embed di HTML description) melebihi batas pengaman "entity expansion" bawaan
    `fast-xml-parser` (default 1000). Konsekuensinya: urutan wajib **decode entity dulu, baru
    strip HTML tag** (`stripHtml(decodeHtmlEntities(...))`, BUKAN sebaliknya) — kalau
    terbalik, tag `<p>` dsb masih dalam bentuk ter-escape (`&lt;p&gt;`) saat `stripHtml`
    dijalankan, jadi tidak ke-strip sama sekali (bug nyata yang sempat kejadian saat build ini).
  - Halaman frontend TIDAK PERNAH merender isi lengkap — seluruh kartu adalah link
    `target="_blank"` ke artikel asli di situs sumber masing-masing.
- **Tabel `berita_organisasi`**: kolom
  `sumber text check (sumber in ('ldii','asad','senkom','ldii-bekasi'))`.
  RLS SELECT untuk `authenticated` semua jenjang. Sengaja TANPA policy INSERT/UPDATE/DELETE —
  hanya service role (dari Edge Function) yang menulis. **Catatan penting (masih berlaku,
  diterapkan sejak awal di migrasi tabel ini)**: tabel baru TIDAK otomatis mewarisi default
  privileges project seperti tabel lama (mis. `push_subscriptions`) — RLS policy saja tidak
  cukup tanpa `GRANT SELECT/INSERT/UPDATE` eksplisit ke `authenticated`/`service_role`, dua
  lapisan permission yang terpisah. Kalau membuat tabel baru lain, cek grants-nya juga
  (`information_schema.role_table_grants`), jangan asumsikan otomatis sama seperti tabel lama.
  Tabel `berita_ldii` (versi lama, khusus LDII) masih ada sementara sampai tabel baru
  terverifikasi jalan lancar di production, baru akan di-drop di migrasi terpisah.
- Menu ini pakai `menuKey: 'berita-organisasi'` (rename dari `berita-ldii`, fail-open by
  design, lihat §6/`lib/feature-toggles.ts`) — tidak ada baris `feature_toggles` yang memakai
  key lama (dicek dulu sebelum rename), jadi aman diganti langsung tanpa migrasi data. Menu ini
  juga baru ditambahkan ke `MENU_GROUPS` di `app/(dashboard)/pengaturan-fitur/page.tsx` —
  ternyata sejak awal dibuat (era masih "Berita LDII"), menu ini luput dari halaman toggle
  Super Admin itu, jadi baru sekarang Super Admin punya UI untuk mematikannya per jenjang.
- **Keaktifan sumber (per riset 28 Juli 2026)**: LDII nasional update per jam (paling aktif),
  LDII Kota Bekasi & ASAD update harian-mingguan, SENKOM jauh lebih jarang & tidak teratur
  (jeda bisa 3-4 minggu) — bukan mati seperti kasus lama forsgi.com (mati sejak 2022), tapi
  cadence-nya nyata berbeda. Kategori ASAD saat ini selalu sama ("PERSINAS ASAD") di 10 artikel
  terbaru — filter kategori kurang berguna untuk sumber itu dibanding LDII/LDII Kota
  Bekasi/SENKOM yang variatif.
- **Nav tab bergaya "liquid glass"/glassmorphism** (redesain 28 Juli 2026, murni visual, tidak
  menyentuh logic fetch/parse) — track tab pakai `backdrop-blur-xl` + `bg-white/50 dark:bg-
  slate-800/45` (semi-transparan, bukan solid) + border tipis dgn highlight + `rounded-full`,
  chip tab aktif mengambang di atasnya (`shadow-md` + `ring-1`). **Struktur (track + chip
  mengambang) REUSE pola segmented-control Akun/Biodata yang sudah ada di
  `generus/page.tsx`** — cuma treatment-nya diganti kaca, bukan pola baru. Transisi cross-fade
  sederhana (`transition-colors duration-300`), BUKAN indikator yang "meluncur" presisi antar
  posisi tab (opsi yang lebih kompleks, ditunda sebagai peningkatan terpisah kalau diperlukan).
  Sengaja TIDAK sticky/fixed — biar tidak menghitung ulang blur tiap frame scroll (resiko lag
  di device low-end kalau sticky).
  - Ikon tiap tab = favicon RESMI situs sumber, hotlink apa adanya (TIDAK di-crop/diwarnai
    ulang) — sumbernya tag `<image><url>` di RSS feed (LDII, ASAD, LDII Kota Bekasi) atau
    `favicon.ico` standar (SENKOM, Blogger tidak menyertakan `<image>` channel). Kalau gagal
    dimuat, fallback ke lencana inisial (`SUMBER_INISIAL`), bukan ikon patah/kosong.
  - Tab "Semua" (gabungan lintas sumber) ditambahkan sebagai union type `TabSumber` di level
    UI (`SumberBeritaOrganisasi | 'semua'`) — BUKAN nilai valid di kolom `sumber` database.
    Ditaruh PALING KANAN (bukan default) supaya prioritas LDII Kota Bekasi sebagai tab
    default (§12 di atas) tidak diam-diam berubah.
  - `backdrop-filter` aman dipakai — didukung Chrome/WebView/Samsung Internet Android sejak
    2019, Safari iOS sejak 15.4 (2022, tanpa prefix), Firefox sejak 103 (2022). Tailwind
    otomatis generate versi `-webkit-` sekalian. Fallback alami kalau browser tidak dukung:
    cuma efek blur yang hilang, warna semi-transparan tetap tampil (tidak pernah "patah").

## 13. Bookmark Berita (`berita_disimpan`)

User bisa menyimpan artikel dari Berita Organisasi (§12) untuk dibaca lagi nanti — ikon 🔖 di
tiap kartu (`app/(dashboard)/berita/page.tsx`) toggle simpan/hapus, halaman
`app/(dashboard)/berita/tersimpan/page.tsx` (nested route, bukan menu sidebar terpisah — pola
sama seperti `profil/*`) menampilkan daftarnya.

- **Tabel `berita_disimpan`**: `user_id` (FK `public.users`) + `link` (identifier unik artikel
  eksternal — RSS tidak punya PK yang stabil selain URL) + snapshot metadata (`judul`, `sumber`,
  `tanggal_publish`, `gambar_url`). **Sengaja BUKAN FK ke `berita_organisasi.id`** — baris
  `berita_organisasi` murni cache RSS yang bisa berubah/dibersihkan kapan saja, snapshot di sini
  memastikan bookmark tidak ikut rusak kalau itu terjadi. `unique(user_id, link)` mencegah
  bookmark dobel.
- **RLS**: satu policy `for all` dengan `user_id = (select auth.uid())` untuk qual dan
  with_check — pola identik `push_subscriptions` (data milik sendiri, tidak ada akses
  admin/lintas-user sama sekali, termasuk Super Admin).
- Frontend fetch `link` yang sudah tersimpan sekali saat mount (`Set<string>`), dipakai untuk
  render ikon terisi/kosong per kartu tanpa query berulang per item.

## 14. FAQ / Panduan Dalam-App (`faq`)

Menu "FAQ / Panduan" (`app/(dashboard)/faq/page.tsx`) — accordion pertanyaan-jawaban seputar
penggunaan GENSITI (absensi, reset password, ajukan izin, dll), terbuka untuk SEMUA jenjang
termasuk Generus biasa (tidak ada `hideForGenerus` — ini justru paling berguna buat mereka).

- **Tabel `faq`**: `pertanyaan`, `jawaban`, `kategori` (opsional, teks bebas + `<datalist>`
  saran dari kategori yang sudah ada), `urutan` (integer, diatur manual lewat input angka biasa
  di form — SENGAJA tidak drag-and-drop, supaya tidak over-engineer untuk kebutuhan yang
  mungkin cuma belasan FAQ), `is_active` (bisa "disembunyikan" tanpa hapus permanen).
- **RLS**: SELECT terbuka untuk `authenticated` kalau `is_active = true`, ATAU kalau
  `get_user_role() = 'super_admin'` (supaya Super Admin tetap bisa lihat & kelola FAQ non-aktif
  di halaman yang sama). INSERT/UPDATE/DELETE dibatasi `get_user_role() = 'super_admin'` saja —
  fungsi `get_user_role()` di-reuse dari pola yang sudah ada di `feature_toggles`/`system_config`,
  bukan ditulis ulang.
- **Satu halaman untuk publik + admin** (bukan halaman terpisah) — tombol "+ Tambah FAQ" dan
  aksi Edit/Hapus per item cuma muncul kalau `user.role.tingkatan === 'super_admin'`, memakai
  `components/Modal.tsx` + `lib/toast.ts` + `lib/konfirmasi.ts` + `lib/audit.ts` (`logAudit`) —
  toolkit CRUD-admin yang sama persis dipakai `Dokumen`/`Pengumuman`, bukan pola baru.
- Accordion single-open (`expandedId` state) — bukan multi-expand, konsisten dengan makna
  "accordion" pada umumnya. Pencarian & filter kategori client-side, pola sama dengan halaman
  Berita/Dokumen/Kegiatan.
- Menu ini (`menuKey: 'faq'`) langsung ditambahkan ke `MENU_GROUPS` di
  `app/(dashboard)/pengaturan-fitur/page.tsx` sejak awal dibuat — pelajaran dari kelalaian
  serupa di menu Berita (lihat §12).

## 15. Yang Belum Terdokumentasi / Perlu Update Berkala

- Dokumen ini snapshot per tanggal di atas — RPC & tabel baru harus ditambahkan ke §3/§4
  saat migrasi baru diterapkan lewat Supabase MCP (`apply_migration`).
- Detail lengkap tiap RLS policy (bukan cuma fungsi helper-nya) tidak direplikasi di sini
  — cek langsung lewat Supabase dashboard/MCP (`list_tables` verbose atau query
  `pg_policies`) kalau butuh detail policy spesifik.
