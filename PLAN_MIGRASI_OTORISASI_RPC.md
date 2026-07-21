# Rencana Migrasi Otorisasi ke RPC / Edge Function (Prioritas #2)

> **Status: Fase 0+1 SELESAI & diterapkan ke production (21 Juli 2026).** Fase 2 ke atas
> masih PROPOSAL — perlu di-review & disetujui sebelum eksekusi. Rujukan:
> [NATIVE_READINESS_AUDIT.md](NATIVE_READINESS_AUDIT.md) kategori A.1/A.2 dan prioritas #2.

Tanggal: 20 Juli 2026 (dibuat), 21 Juli 2026 (Fase 0+1 dieksekusi).

## 0. Status Eksekusi

**Fase 0+1 (helper SQL aditif) sudah diterapkan** lewat migrasi
`add_shared_authorization_helpers` + perbaikan `harden_authorization_helpers_search_path_and_grants`
(cabut grant `PUBLIC` implisit + kunci `search_path`, ditemukan lewat security advisor
pasca-migrasi). Fungsi baru (semua di schema `public`, belum dipanggil kode manapun -- nol
perubahan perilaku app):

- `normalize_login_username(text)` -- normalisasi nama login (trim+collapse+uppercase)
- `member_management_allowed(tingkatan, nama_role)` / `can_manage_members()` -- mirror
  `canManageMembers` di `app/api/users/route.ts`
- `scope_action_allowed(...)` / `can_act_on_scope(target_desa, target_kelompok)` -- mirror
  `canActOnScope`
- `tingkatan_hierarchy_allowed(tingkatan)` / `allowed_target_tingkatan()` -- mirror
  `getAllowedTargetTingkatan`
- `tingkatan_assignment_allowed(...)` / `can_assign_tingkatan(target_tingkatan)` -- mirror
  `canAssignTingkatan`

Setiap aturan dipecah 2 lapis: fungsi murni (parameter eksplisit, dites lewat `SELECT`
langsung tanpa perlu sesi login) + wrapper self-check (`SECURITY DEFINER`, `search_path`
terkunci, pakai `auth.uid()` via `get_user_tingkatan()`/dst yang sudah ada). **Verifikasi
paritas**: 30 test case (mirror kasus di `lib/roles.test.ts`) dijalankan langsung di DB
production setelah migrasi, semua cocok 100% dengan logika TS existing. `get_advisors`
pasca-migrasi bersih kecuali 4 warning `authenticated_security_definer_function_executable`
yang memang disengaja (pola sama seperti `is_pengurus()` dkk yang sudah ada).

DB branching Supabase (rencana awal utk testing sebelum production) ternyata butuh plan Pro
(project ini masih gratis) -- migrasi diterapkan langsung ke production karena sifatnya aditif
murni (`CREATE FUNCTION`/`GRANT`, tanpa `ALTER TABLE`/perubahan data) dan reversibel penuh
lewat `DROP FUNCTION`, dengan verifikasi dijalankan segera setelah apply.

**Fase 2 (RPC data-only, memanggil helper di atas) belum dikerjakan** -- lanjutan berikutnya
sesuai rencana di bawah, tetap butuh persetujuan eksplisit sebelum eksekusi.

---

---

## 1. Tujuan & Masalah yang Dipecahkan

**Masalah (dari audit A.2):** aturan otorisasi diduplikasi di **3 tempat**:
`lib/roles.ts` (gate UI), `app/api/users/route.ts`, dan `app/api/generus/route.ts`
(enforcement server). Flutter akan jadi **salinan ke-4 (Dart)**. Tiap salinan yang tak
sinkron = celah keamanan atau UX yang membingungkan.

**Tujuan:** jadikan **database sumber kebenaran tunggal** untuk otorisasi operasi tulis,
lewat RPC `SECURITY DEFINER` yang menegakkan aturan di SQL. Client manapun (web, Flutter,
desktop) cukup **memanggil RPC yang sama** — tidak menulis ulang aturannya. Efek samping
positif: backend jadi hidup independen dari deployment Vercel.

---

## 2. Kendala Teknis Kunci (menentukan desain)

⚠️ **Pembuatan akun & ganti password TIDAK bisa 100% pindah ke RPC Postgres.**

`POST /api/users` sekarang memanggil `supabaseAdmin.auth.admin.createUser(...)` dan
`auth.admin.updateUserById(...)` — ini **GoTrue Admin API**, bukan SQL. RPC Postgres tidak
bisa membuat baris di `auth.users` atau mengubah password auth. Jadi:

- **Bisa pindah ke RPC** (murni data + otorisasi): update biodata generus, update profil
  users (nama/no_hp/role/scope/status), arsip/pulihkan akun, klaim sesi.
- **Harus tetap di konteks service-role** (Edge Function / API route): buat akun baru
  (`createUser`), set/ganti password (`updateUserById`), hapus akun (`deleteUser`).

**Solusinya (pola hybrid):** operasi yang butuh GoTrue tetap di Edge Function tipis, TAPI
otorisasinya tetap dipanggil dari **helper SQL yang sama** dengan RPC lain — jadi aturannya
tetap satu sumber, hanya orkestrasi GoTrue yang di luar SQL.

---

## 3. Desain Target

### 3a. Lapisan helper otorisasi di DB (satu sumber kebenaran)

Sebagian sudah ada (`get_user_tingkatan`, `get_user_nama_role`, `is_pengurus`, dst — lihat
ARCHITECTURE.md §4). Tambahkan yang belum ada sebagai fungsi SQL, dipakai bersama oleh RPC
DAN Edge Function:

| Fungsi (baru/formalisasi) | Isi | Padanan TS sekarang |
|---|---|---|
| `can_manage_members(p_caller uuid default auth.uid())` | ketua/sekretaris/super_admin | `canManageMembers` (roles.ts + 2 route) |
| `can_act_on_scope(p_caller, p_desa_id, p_kelompok_id)` | scope desa/kelompok/daerah/superadmin | `canActOnScope` (2 route) |
| `allowed_target_tingkatan(p_caller)` → text[] | hierarki jenjang | `getAllowedTargetTingkatan` (roles.ts + users route) |
| `can_assign_tingkatan(p_caller, p_target_tingkatan)` | boleh menetapkan role jenjang X | `canAssignTingkatan` (users route) |
| `normalize_login_username(p_raw text)` → text | trim+collapse spasi+uppercase | diduplikasi di 4 tempat |

### 3b. RPC operasi (SECURITY DEFINER, dipanggil semua client dgn JWT-nya)

Menegakkan otorisasi via helper di atas, lalu menulis. Pola persis seperti RPC yang **sudah
ada & terbukti** (`approve_kegiatan`, `proses_reimbursement`, `ajukan_izin_presensi` —
semuanya self-check `auth.uid()` di dalam).

| RPC baru | Menggantikan | Catatan |
|---|---|---|
| `update_generus_biodata(p_user_id, p_payload jsonb)` | `PATCH /api/generus` | Termasuk sinkron `login_username` saat `nama_panggilan` berubah, cek isTargetPPG, scope tujuan pindah-sambung |
| `update_user_profile(p_id, p_payload jsonb)` | `PATCH /api/users` (bagian non-auth) | Field akun: nama/no_hp/role/scope/status/avatar/arsip/pulihkan. **Password TIDAK di sini** (GoTrue) |
| `get_generus_biodata(p_user_id)` | `GET /api/generus` | Baca biodata dgn cek scope (anti-IDOR) |

### 3c. Edge Function (service-role, hanya untuk yang butuh GoTrue)

| Edge Function | Isi | Otorisasi |
|---|---|---|
| `create-member` | `auth.admin.createUser` + insert users + generus (satu transaksi) + set password default | Verifikasi JWT caller → panggil helper `can_manage_members` / `can_assign_tingkatan` / `can_act_on_scope` via `rpc()` sebelum createUser |
| `set-user-password` | `auth.admin.updateUserById({password})` | idem (self, atau berwenang) |
| `resolve-login` (pindahan) | nama → email, pakai `normalize_login_username`, + rate limit (sudah ada `check_auth_rate_limit`) | anon (pra-login), self-guard |
| `password-reset-request` / `-confirm` (pindahan) | OTP flow | anon, rate limit sudah ada |

> Edge Function memakai Deno (Supabase), **lepas dari Vercel** — inilah yang membuat backend
> hidup independen dari deployment web.

---

## 4. Strategi Rollout (bertahap, non-breaking — pola "strangler")

Prinsip: **jangan** ganti besar sekaligus di produksi. Tambah yang baru berdampingan,
pindahkan pemanggil satu per satu, verifikasi, baru buang yang lama.

**Fase 0 — Fondasi test (prioritas #3, prasyarat).**
Tulis test kontrak untuk aturan otorisasi SEBELUM memindahkannya, supaya ada jaring pengaman
(pgTAP di DB atau integration test yang memanggil RPC dgn berbagai role). Tanpa ini, migrasi
otorisasi berisiko regresi senyap.

**Fase 1 — Helper SQL (aditif, zero-risk).**
Buat fungsi §3a. Belum ada yang memanggilnya → tidak mengubah perilaku. Uji hasilnya sama
dengan logika TS sekarang (test paritas).

**Fase 2 — RPC data-only (§3b).**
Buat `update_generus_biodata`, `update_user_profile`, `get_generus_biodata`. Route lama TETAP
jalan. Test RPC menyeluruh (semua kombinasi role × scope × PPG-guard).

**Fase 3 — Pindahkan web ke RPC.**
Ubah `app/api/generus` & bagian non-password `app/api/users` jadi **wrapper tipis** yang
memanggil RPC (atau ubah client memanggil `supabase.rpc()` langsung). Verifikasi live end-to-end
(edit biodata, ganti role, arsip/pulihkan, pindah-sambung). **Hapus duplikasi TS** setelah stabil.

**Fase 4 — Edge Function untuk GoTrue (§3c).**
Pindahkan `create-member` & `set-user-password` ke Edge Function. Pindahkan `resolve-login` &
`password-reset` ke Edge Function (rate limit sudah di DB, tinggal panggil). Retire route Vercel
terkait.

**Fase 5 — Native tinggal panggil.**
Flutter/desktop memanggil RPC & Edge Function yang sama. **Nol** aturan otorisasi ditulis ulang
di Dart — hanya panggil + render.

---

## 5. Risiko & Mitigasi

| Risiko | Mitigasi |
|---|---|
| Regresi otorisasi senyap saat pindah | Fase 0 test kontrak dulu; test paritas RPC vs TS di Fase 1–2 |
| Perilaku beda antara route lama & RPC baru | Fase 3 verifikasi live end-to-end sebelum hapus route |
| RPC SECURITY DEFINER salah (lupa self-check) | Ikuti pola RPC existing yg sudah teraudit; `search_path` dikunci; review + test negatif (role tak berwenang HARUS ditolak) |
| GoTrue admin ops tak bisa transaksional dgn insert profil | Pertahankan pola kompensasi yg SUDAH ada (rollback `deleteUser` kalau insert profil gagal — lihat users route sekarang) di Edge Function |
| Downtime saat cutover | Strangler: lama & baru hidup berdampingan; cutover per-endpoint, reversible |

**Rollback tiap fase:** semua migrasi DB aditif (CREATE FUNCTION) reversible; perpindahan
pemanggil web reversible lewat git revert selama route lama belum dihapus.

---

## 6. Estimasi Effort

| Fase | Effort | Bisa paralel? |
|---|---|---|
| 0 — test kontrak | Menengah | Ya (mulai kapan saja) |
| 1 — helper SQL | Kecil | — |
| 2 — RPC data-only | Menengah | — |
| 3 — pindah web + hapus duplikasi | Menengah | — |
| 4 — Edge Function (GoTrue + auth publik) | Menengah–Besar | Sebagian |
| 5 — native pakai | (masuk proyek Flutter) | — |

**Total: Besar** — tapi terpecah jadi langkah-langkah kecil yang masing-masing aman & reversible.

---

## 7. Rekomendasi Urutan Eksekusi

1. **Fase 0 + Fase 1 dulu** (test kontrak + helper SQL) — aditif, zero-risk, langsung
   memberi nilai (jaring pengaman + mulai menyatukan aturan) tanpa mengubah perilaku.
2. Lanjut **Fase 2 → 3** untuk `generus` **dulu** (lebih sederhana dari `users`: tanpa GoTrue),
   sebagai pilot. Kalau lancar, ulangi pola untuk bagian non-password `users`.
3. **Fase 4** (Edge Function) paling akhir dari sisi backend web, dan menjadi prasyarat nyata
   hanya saat proyek Flutter benar-benar mulai.

> Saran praktis: kerjakan **Fase 0+1 sebagai satu PR/commit kecil** lebih dulu, review
> hasilnya, baru putuskan lanjut ke Fase 2. Ini menjaga tiap langkah tetap "teliti & hati-hati".
