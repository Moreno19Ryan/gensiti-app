# GENSITI — Runbook Pemulihan Darurat Akun Super Admin

Prosedur manual (BUKAN fitur di dalam aplikasi) untuk memulihkan akses kalau
akun Super Admin (satu-satunya, dipegang Reno) ke-lock/lupa password/rusak.
Ditulis sebagai respons atas `WISHLIST_ASSESSMENT.md` bagian A1 — kesimpulan
di sana: solusi cukup runbook manual lewat Supabase Dashboard, TIDAK perlu
mekanisme recovery di dalam aplikasi (lihat bagian "Yang sengaja tidak
dibuat" di bawah untuk alasannya).

**Prasyarat mutlak**: akses ke Supabase Dashboard project `ccyqgcfjmzgkmkczuydv`
sebagai project owner (akun Supabase milik Reno sendiri — terpisah total dari
akun GENSITI yang dipulihkan). Semua langkah di bawah TIDAK bisa dilakukan
lewat aplikasi GENSITI itu sendiri — memang sengaja begitu, karena kalau akun
Super Admin sendiri yang bermasalah, aplikasi bukan lagi jalur yang bisa
diandalkan.

---

## Kenapa ini aman dilakukan langsung lewat Dashboard

Ada satu trigger di database yang perlu dipahami dulu supaya tidak salah
duga saat proses recovery: `enforce_single_super_admin` (`ARCHITECTURE.md`
§4). Isinya:

```sql
IF new_tingkatan = 'super_admin' THEN
  SELECT count(*) INTO existing_count
  FROM public.users u JOIN public.roles r ON u.role_id = r.id
  WHERE r.tingkatan = 'super_admin' AND u.id <> NEW.id;

  IF existing_count > 0 THEN
    RAISE EXCEPTION 'Super Admin hanya boleh satu akun...';
  END IF;
END IF;
```

Trigger ini **HANYA memblokir menjadikan akun LAIN sebagai Super Admin kedua**
(`u.id <> NEW.id`). Ia **tidak menghalangi** mengubah baris Super Admin yang
sudah ada (reaktivasi, ganti role_id balik ke super_admin, dst.) — jadi semua
skenario recovery di bawah aman dijalankan lewat SQL Editor/Table Editor di
Supabase Dashboard tanpa perlu menonaktifkan trigger ini dulu.

Role Super Admin sendiri adalah baris tetap di tabel `roles`:
```
id: 9a1f4c8c-bd33-4e30-9ebc-834ef6dd9807   nama_role: "Super Admin"   tingkatan: super_admin
```
(dipakai di beberapa query di bawah sebagai referensi — kalau baris ini
sendiri pernah dihapus/berubah, itu di luar cakupan runbook ini, cek dulu
`SELECT * FROM public.roles WHERE tingkatan = 'super_admin';`.)

---

## Skenario A — Lupa password

Paling sering terjadi, paling mudah diperbaiki. Login GENSITI memakai
Supabase Auth asli di baliknya (`nama pengguna` yang diketik di halaman
login cuma diterjemahkan jadi email lewat `/api/resolve-login`, baru email
itu yang dipakai `signInWithPassword` — lihat `app/login/page.tsx`).

**Langkah:**
1. Supabase Dashboard → **Authentication → Users**.
2. Cari baris dengan email akun Super Admin (email asli yang dipakai di
   `public.users.email` untuk akun ini).
3. Klik akun tsb → **Send password recovery** (kirim email reset ke email
   itu sendiri), ATAU langsung **Reset password** manual dari Dashboard
   kalau butuh lebih cepat (tidak tergantung akses email saat itu juga).
4. Login seperti biasa di GENSITI pakai password baru.

Tidak menyentuh `public.users` sama sekali — password murni ranah Supabase
Auth (`auth.users`), terpisah dari profil aplikasi.

---

## Skenario B — Akun ter-nonaktif di level aplikasi (`is_active = false`)

Beda dari Skenario A: password bisa saja benar, tapi login tetap ditolak.
Ada **DUA gerbang `is_active` terpisah** yang keduanya harus lolos:
- `/api/resolve-login` menolak resolve email kalau `is_active != true`
  (baris ~110 & ~125, `app/api/resolve-login/route.ts`) — gagal SEBELUM
  Supabase Auth sempat dicoba sama sekali.
- `app/login/page.tsx` (baris ~79-80) mengecek ulang `profile.is_active`
  SETELAH Supabase Auth sukses, dan paksa logout kalau `false`.

Jadi kalau baris Super Admin di `public.users` ke-set `is_active = false`
(sengaja/tidak sengaja), reset password di Skenario A TIDAK akan menolong
sampai `is_active` dikembalikan ke `true` dulu.

**Langkah:**
1. Supabase Dashboard → **SQL Editor**, jalankan dulu (cek dulu, jangan
   langsung UPDATE):
   ```sql
   SELECT id, email, login_username, is_active, role_id
   FROM public.users
   WHERE role_id = '9a1f4c8c-bd33-4e30-9ebc-834ef6dd9807';
   ```
2. Pastikan baris yang muncul memang akun Super Admin yang dimaksud (cocokkan
   email), lalu:
   ```sql
   UPDATE public.users
   SET is_active = true
   WHERE id = '<id dari langkah 1>';
   ```
3. Coba login lagi.

---

## Skenario C — `role_id` berubah, bukan Super Admin lagi

Secara desain ini sulit terjadi tanpa sengaja — tabel `users` cuma bisa
ditulis langsung oleh Super Admin sendiri (policy `users_all_superadmin`,
`ARCHITECTURE.md` §4), jadi tidak ada user lain yang bisa mengubah role ini.
Tapi kalau tetap terjadi (mis. salah klik di form edit, atau bug):

**Langkah:**
1. Cek dulu baris user yang dimaksud (cari lewat email/`login_username`,
   BUKAN lewat `role_id` karena itu justru yang salah):
   ```sql
   SELECT id, email, login_username, role_id, is_active
   FROM public.users
   WHERE email = '<email akun Super Admin>';
   ```
2. Kembalikan `role_id`-nya:
   ```sql
   UPDATE public.users
   SET role_id = '9a1f4c8c-bd33-4e30-9ebc-834ef6dd9807'
   WHERE id = '<id dari langkah 1>';
   ```
   Trigger `enforce_single_super_admin` tidak akan menolak ini selama tidak
   ada baris LAIN yang sudah berstatus `tingkatan = super_admin` saat ini
   (kalau ada — artinya ada Super Admin lain aktif, cek dulu manual sebelum
   lanjut, jangan asumsikan).

---

## Skenario D — Baris user Super Admin hilang/terhapus total

Skenario paling parah, seharusnya nyaris tidak mungkin (tidak ada jalur
DELETE untuk `users` di aplikasi manapun yang ditemukan sejauh ini), tapi
dicatat untuk kelengkapan:

**Langkah:**
1. Cek dulu apakah akun Auth (`auth.users`) masih ada — Dashboard →
   Authentication → Users, cari lewat email.
2. Kalau baris `auth.users` masih ada tapi baris `public.users` hilang:
   insert ulang baris `public.users` secara manual lewat SQL Editor,
   `id` HARUS sama persis dengan `auth.users.id` (foreign key), `role_id`
   diisi UUID Super Admin di atas, `is_active = true`.
3. Kalau baris `auth.users` JUGA hilang: ini di luar cakupan aplikasi sama
   sekali — berarti akun Auth sungguhan terhapus, perlu dibuat ulang dari
   nol lewat Dashboard (Create user) baru insert baris `public.users`
   mengikuti `id` baru itu.

Skenario ini sengaja tidak diberi contoh SQL INSERT persis (butuh melihat
struktur kolom `users` lengkap saat kejadian, bukan disalin buta dari sini)
— cek dulu `\d public.users` atau `list_tables` sebelum insert manual.

---

## Yang sengaja TIDAK dibuat

Wishlist awalnya membuka opsi "fitur recovery di dalam aplikasi" (mis. link
reset khusus, kode darurat tersimpan, dsb). **Sengaja tidak dikerjakan** —
alasan dari `WISHLIST_ASSESSMENT.md` A1: fitur recovery in-app butuh cara
memverifikasi "pemilik organisasi yang sah" DI LUAR sistem auth normal
(karena kalau sistem auth normal-nya sendiri yang bermasalah, recovery lewat
jalur yang sama tidak akan menolong) — desain seperti itu berisiko jadi
backdoor kalau tidak sangat hati-hati, untuk manfaat yang kecil (skenario ini
jarang terjadi, dan Supabase Dashboard sudah cukup sebagai jalur pemulihan).
Runbook manual ini dianggap cukup sampai ada alasan konkret untuk sebaliknya.

---

## Perawatan dokumen ini

Update runbook ini kalau:
- Skema `users`/`roles` berubah (kolom `is_active`/`role_id` di-rename atau
  logikanya berubah).
- Trigger `enforce_single_super_admin` diubah/diganti mekanismenya.
- Alur login (`resolve-login` / `app/login/page.tsx`) diubah signifikan.
- UUID role Super Admin di atas berubah (seharusnya tidak pernah, tapi kalau
  role di-drop & dibuat ulang, perbarui referensinya di sini).
