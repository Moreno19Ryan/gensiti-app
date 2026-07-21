# Rencana Migrasi Otorisasi ke RPC / Edge Function (Prioritas #2)

> **Status: Fase 0+1+2 SELESAI. Fase 3 BERJALAN — 2 dari 3 endpoint `/api/generus` (GET live,
> PATCH menunggu spot-check).** Tiap endpoint mengubah jalur produksi (~82 user aktif), jadi
> dialihkan satu per satu & butuh spot-check live di preview sebelum merge ke `main`. Rujukan:
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

**Fase 2 (RPC data-only, memanggil helper di atas) -- dipecah jadi 3 langkah terpisah**
(bukan satu migrasi besar), diurutkan dari risiko terendah ke tertinggi karena
`update_user_profile` (langkah ke-3) menyentuh proteksi Super Admin, hierarki role, dan
arsip/pulihkan -- paling banyak guard keamanan.

1. ✅ **`get_generus_biodata(p_user_id)` -- SELESAI** (21 Juli 2026, migrasi
   `add_get_generus_biodata_rpc`). Mirror persis `GET /api/generus` (termasuk fix IDOR:
   pemilik sendiri ATAU `can_manage_members()` + `can_act_on_scope()` atas scope target).
   Sekaligus memperbaiki gap yang ditemukan saat menyiapkan RPC ini: 4 wrapper self-check
   Fase 1 tidak mengecek `is_active` caller (migrasi susulan
   `gate_authorization_helpers_on_caller_active` -- ditambahkan `caller_account_active()`
   sebagai gate tambahan, konsisten dengan `getCaller()` TS yang fail-closed kalau akun
   caller nonaktif). Diverifikasi lewat simulasi `auth.uid()` (teknik
   `set local request.jwt.claims`) dgn 3 skenario nyata (super_admin lintas scope berhasil,
   akses biodata sendiri berhasil, Generus biasa akses biodata Generus lain ditolak
   `Forbidden`) -- bukan cuma dites lewat parameter literal seperti Fase 1, karena fungsi
   ini bergantung pada `auth.uid()`. `get_advisors` bersih kecuali warning
   `authenticated_security_definer_function_executable` yang disengaja. Route lama
   `GET /api/generus` TETAP jalan -- RPC ini belum dipanggil kode manapun.
2. ✅ **`update_generus_biodata(p_user_id, p_generus_id, p_payload)` -- SELESAI** (21 Juli
   2026, migrasi `add_update_generus_biodata_rpc`). Mirror persis `PATCH /api/generus`:
   guard `hasAdminFields` (status_anggota/status_pengguna/pindah sambung hanya via
   `can_manage_members()`), guard PPG (field administratif akun PPG hanya Super Admin),
   guard tempat sambung (desa_id/kelompok_id GENERUS -- wajib `can_manage_members()` DAN
   `can_act_on_scope()` atas tujuan BARU, bukan cuma lokasi lama), sinkronisasi
   `login_username` otomatis saat `nama_panggilan` berubah (bug fix "Reno" yang sama persis
   dgn versi TS, termasuk fallback timestamp kalau 100x suffix bentrok). `p_payload` berupa
   `jsonb` (bukan parameter satu-satu) supaya operator `?` bisa membedakan "field tidak
   dikirim" vs "field dikirim null/kosong", sama seperti semantik `!== undefined` di TS.
   Update kolom pakai `CASE WHEN` eksplisit per kolom (bukan dynamic SQL) demi keamanan &
   review-ability pada data 82 pengguna nyata. Diverifikasi lewat 7 skenario tulis nyata
   (self-edit, cross-scope ditolak, admin field oleh Ketua Kelompok dlm scope, pindah
   sambung ke scope tak berwenang ditolak, sinkron login_username, guard PPG ditolak utk
   non-super-admin, guard PPG berhasil utk super_admin) -- masing-masing dijalankan dalam
   `BEGIN...ROLLBACK` di data user sungguhan (bukan data sintetis) supaya tervalidasi
   end-to-end TANPA mengubah data production secara permanen; dikonfirmasi tidak ada residu
   setelah semua transaksi di-rollback. `get_advisors` bersih. Route lama
   `PATCH /api/generus` TETAP jalan -- RPC ini belum dipanggil kode manapun.
3. ✅ **`update_user_profile(p_id, p_payload)` -- SELESAI** (21 Juli 2026, migrasi
   `add_update_user_profile_rpc`). Mirror persis `PATCH /api/users` **bagian non-password**
   (password TETAP di GoTrue `auth.admin.updateUserById`, tidak pernah pindah ke RPC ini --
   lihat §2 kendala teknis). Guard yang dipindahkan: proteksi Super Admin (HANYA
   no_hp/avatar_url boleh diubah, field lain diblokir total termasuk oleh Super Admin lain),
   guard PPG (field administratif akun PPG hanya Super Admin), guard scope akun
   (desa_id/kelompok_id -- wajib `can_manage_members()` DAN `can_act_on_scope()` atas lokasi
   LAMA **dan** BARU, tidak pernah lewat self-edit), larangan role_id menjadi super_admin
   kedua (berlaku bahkan utk caller Super Admin sendiri), hierarki jenjang (`can_assign_tingkatan`)
   utk role_id target lain, dan semantik arsip/pulihkan (`archive`/`restore` override
   `is_active`+`is_archived`+`alasan_arsip`+`tanggal_arsip`).
   Diverifikasi lewat 10 skenario tulis nyata dalam `BEGIN...ROLLBACK` (data user sungguhan,
   tanpa mengubah production secara permanen): self-edit nama sendiri berhasil, cross-scope
   non-privileged ditolak, admin field (is_active) oleh Ketua Kelompok dlm scope berhasil,
   pindah scope ke tujuan tak berwenang ditolak, edit nama_lengkap Super Admin ditolak vs
   no_hp Super Admin berhasil, guard PPG ditolak utk non-super-admin, role_id->super_admin
   ditolak (bahkan dicoba oleh Super Admin sendiri), hierarki role_id lintas jenjang ditolak,
   archive mengarsipkan dgn benar, restore memulihkan dgn benar. Semua dikonfirmasi tanpa
   residu data setelah rollback. `get_advisors` bersih kecuali warning
   `authenticated_security_definer_function_executable` yang disengaja. Route lama
   `PATCH /api/users` TETAP jalan -- RPC ini belum dipanggil kode manapun.

**Fase 2 SELESAI TOTAL.** Ketiga RPC sudah hidup berdampingan dengan route lama, siap jadi
fondasi Fase 3 (pindahkan pemanggil web) kapan pun disetujui untuk dieksekusi -- masing-masing
langkah Fase 3 tetap butuh persetujuan eksplisit terpisah sesuai kesepakatan proses.

### Fase 3 -- Pindahkan pemanggil web ke RPC (BEHAVIOR-CHANGING, per-endpoint)

Beda kategori risiko dari Fase 0-2: ini pertama kalinya jalur produksi yang dipakai ~82 user
aktif benar-benar dialihkan. Prinsip: satu endpoint per langkah, route lama diubah jadi
**wrapper tipis** (kontrak HTTP tak berubah -> frontend tak perlu disentuh -> revert = 1 file),
spot-check live di preview sebelum merge ke `main`.

**Pola teknis kunci:** route memanggil RPC lewat **client ber-scope JWT pemanggil**
(`userClient(token)` = anon key + `Authorization: Bearer <token>`), BUKAN service-role. Dengan
begitu `auth.uid()` di dalam RPC terisi identitas asli & seluruh otorisasi ditegakkan di DB.
Ini juga persis pola yang akan dipakai client native (Flutter) -- memvalidasi seluruh
pendekatan sekaligus.

1. ✅ **`GET /api/generus` -> `get_generus_biodata` -- LIVE di produksi** (PR #8, commit
   `6c28682`). Handler GET jadi wrapper tipis yang memanggil RPC via `userClient`, memetakan
   error RPC ke status HTTP yang sama (`28000`->401, `42501`->403) & mengembalikan bentuk
   `{ data: <row|null> }` yang identik. Sekaligus merapikan `get_generus_biodata` (migrasi
   `gate_get_generus_biodata_on_caller_active`) agar menggate `caller_account_active()` juga utk
   akses biodata SENDIRI -- sebelumnya terlewat. Sudah di-spot-check di preview & health-check
   produksi bersih (deploy READY, 0 error 5xx).
2. ⏳ **`PATCH /api/generus` -> `update_generus_biodata` -- menunggu spot-check live.** Handler
   PATCH jadi wrapper tipis: bangun `p_payload` jsonb HANYA dari field yang dikirim client
   (mirror `!== undefined`; RPC beda-kan pakai operator `?`), teruskan `user_id`/`generus_id`
   sbg param terpisah, panggil RPC via `userClient`. Untuk error 4xx otorisasi, **pesan
   spesifik dari RPC diteruskan apa adanya** (RPC me-RAISE string yang SAMA PERSIS dgn route
   lama, mis. "Status keanggotaan akun PPG hanya dapat diubah oleh Super Admin.") -> UX pesan
   error tak berubah. Bentuk balik `{ success, newLoginUsername? }` identik. **Karena kedua
   handler kini RPC, seluruh helper duplikat TS (`getCaller`/`canManageMembers`/`canActOnScope`/
   `generateUniqueLoginUsername`/`adminClient`/`Caller`) DIHAPUS dari file** -- inilah "hapus
   duplikasi" yang jadi tujuan Fase 3. Bonus: RPC jalankan otorisasi+tulis dalam SATU transaksi,
   jadi sinkron `login_username` + update generus ATOMIK (route lama bisa partial-fail).
   `update_generus_biodata` sendiri sudah diverifikasi 7 skenario tulis saat dibuat (PR #6);
   `typecheck`/`lint`/`test`/`build` sukses. **Belum diverifikasi:** round-trip tulis live --
   perlu spot-check manual di preview PR (login -> edit & SIMPAN biodata di Data Generus /
   Profil > Data Diri, pastikan tersimpan + tak ada error) SEBELUM merge, karena ini jalur
   TULIS ke data ~82 user.
3. ⬜ `PATCH /api/users` (non-password) -> `update_user_profile` -- belum, paling sensitif.

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
