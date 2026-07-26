# AUDIT MENYELURUH GENSITI — Juli 2026

Audit lintas lapisan (keamanan, RLS, performa database, UI/UX, kode) atas
permintaan Reno: *"jadikan aplikasi ini selayaknya aplikasi pada umumnya...
lebih profesional, intuitif, interaktif."*

**Semua temuan di bawah diverifikasi langsung** — advisor Supabase pada
project production `ccyqgcfjmzgkmkczuydv`, query `pg_proc`/`pg_policy`/
`cron.job` sungguhan, dan grep atas isi repo. Bukan tebakan atau hasil baca
sekilas. Query pembuktiannya disertakan supaya bisa dicek ulang.

**Status perubahan:** satu perbaikan keamanan (§1) sudah diterapkan **setelah
persetujuan eksplisit Reno**, lengkap dengan bukti verifikasi sesudahnya.
Semua temuan lain masih berupa rekomendasi dan **belum disentuh** — menunggu
persetujuan per-perubahan sesuai CLAUDE.md guardrail #3.

---

## Ringkasan Eksekutif

| Lapisan | Status | Catatan |
|---|---|---|
| **RLS coverage** | 🟢 Sangat baik | 24/24 tabel `public` punya RLS aktif. Tidak ada tabel telanjang. |
| **Otorisasi RPC** | ✅ **Sudah ditutup** | 3 fungsi cron sempat bisa dipanggil publik → sudah diperbaiki & diverifikasi (§1) |
| **Performa DB** | 🟡 Wajar untuk 82 user | 7 policy re-evaluasi `auth.uid()` per baris, 155 policy tumpang tindih |
| **UI/UX** | 🟠 **Ini gap terbesar** | 16 dialog native `alert()`/`confirm()`, modal tanpa a11y, nol skeleton |
| **Fondasi visual** | 🟢 Sudah baik | Dark mode 100%, aksesibilitas (B4), transisi di 35 file |

**Kesimpulan singkat:** fondasi keamanan & data GENSITI jauh lebih sehat
daripada rata-rata aplikasi organisasi seukuran ini. Yang membuat aplikasi
ini *terasa* belum "selayaknya aplikasi pada umumnya" bukan arsitekturnya —
tapi **lapisan interaksi paling atas** yang masih memakai dialog bawaan
browser. Itu justru kabar bagus: yang perlu dibenahi adalah bagian yang
paling terlihat sekaligus paling murah diperbaiki.

---

## 1. 🔴 TEMUAN KRITIS — Fungsi cron bisa dipicu siapa saja

### Apa yang ditemukan

Tiga fungsi `SECURITY DEFINER` yang **hanya ditujukan untuk cron** ternyata
bisa dieksekusi oleh role `anon` — yaitu kunci publik yang tertanam di
bundel JavaScript situs dan bisa diambil siapa pun yang membuka DevTools:

| Fungsi | `anon` | `authenticated` | Cek `auth.uid()` |
|---|---|---|---|
| `send_reminder_approval_kegiatan_pengumuman` | ✅ bisa | ✅ bisa | ❌ tidak ada |
| `send_reminder_approval_reimbursement` | ✅ bisa | ✅ bisa | ❌ tidak ada |
| `send_reminder_backup_belum_dilakukan` | ✅ bisa | ✅ bisa | ❌ tidak ada |

Pembuktian:

```sql
SELECT p.proname,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_bisa,
       (pg_get_functiondef(p.oid) ILIKE '%auth.uid()%') AS cek_auth_uid
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname='public' AND p.prosecdef
  AND has_function_privilege('anon', p.oid, 'EXECUTE');
```

### Kenapa ini berbahaya (pola *confused deputy*)

Primitif berbahayanya sendiri **sudah dikunci dengan benar**:

| Fungsi primitif | `anon` | `authenticated` |
|---|---|---|
| `notify_email` | ❌ | ❌ |
| `notify_push` | ❌ | ❌ |

Tapi ketiga wrapper di atas berstatus `SECURITY DEFINER` milik `postgres` —
artinya saat dipanggil, mereka **berjalan sebagai postgres** dan bebas
memanggil primitif terkunci itu atas nama si pemanggil. Pintu belakangnya
dikunci, tapi ada pelayan di depan yang mengantar siapa saja masuk.

Isi `send_reminder_backup_belum_dilakukan()` (dibaca dari
`pg_get_functiondef`) melakukan tiga hal nyata:
1. `INSERT INTO public.notifikasi` untuk tiap Super Admin aktif
2. `PERFORM public.notify_push(...)` — push notification sungguhan
3. `PERFORM public.notify_email(...)` — email sungguhan lewat Resend

**Dampak kalau disalahgunakan:** siapa pun yang menyalin anon key dari situs
bisa memanggil endpoint `/rest/v1/rpc/<nama_fungsi>` berulang-ulang untuk
membanjiri pengguna dengan email & push, menghabiskan kuota Resend, dan
berisiko membuat domain pengirim ditandai spam.

**Faktor peringan:** `send_reminder_backup_belum_dilakukan` punya
*early-return* kalau backup terakhir < 30 hari, jadi radius ledakannya
sekarang terbatas. Dua fungsi approval tidak punya rem sejenis dan akan
bekerja setiap kali ada approval yang menggantung.

> **Catatan jujur:** dua dari tiga fungsi ini
> (`send_reminder_approval_*`) **saya sendiri yang buat di PR #18 sesi ini.**
> Saya memverifikasi logika otorisasi *di dalam* fungsi dengan teliti waktu
> itu, tapi lalai memeriksa siapa yang boleh **memanggil** fungsinya. Ini
> kelas bug yang berbeda, dan saya melewatkannya.

### Perbaikan — ✅ SUDAH DITERAPKAN (migrasi `kunci_fungsi_reminder_cron_dari_publik`)

> **Jebakan yang hampir terlewat.** Usulan awal saya di draf dokumen ini
> adalah `REVOKE EXECUTE ... FROM anon, authenticated`. **Itu tidak akan
> berfungsi.** Pemeriksaan `p.proacl` menunjukkan ketiga fungsi bernilai
> `NULL` — artinya memakai *default privilege* Postgres, dan default untuk
> fungsi adalah `EXECUTE TO PUBLIC`. Jadi `anon` mendapat haknya **lewat
> `PUBLIC`, bukan lewat grant langsung**. Perintah `REVOKE ... FROM anon`
> akan berjalan sukses tanpa error sama sekali, tapi tidak mencabut apa pun —
> jenis perbaikan palsu yang paling berbahaya, karena terlihat berhasil.
>
> Petunjuknya ada di database sendiri: `notify_email` sudah benar dengan ACL
> eksplisit `postgres=X/postgres | service_role=X/postgres`, yang hanya bisa
> terbentuk kalau `PUBLIC` dicabut.

SQL yang benar-benar dijalankan:

```sql
REVOKE ALL ON FUNCTION public.send_reminder_approval_kegiatan_pengumuman() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.send_reminder_approval_reimbursement()       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.send_reminder_backup_belum_dilakukan()       FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.send_reminder_approval_kegiatan_pengumuman() TO service_role;
GRANT EXECUTE ON FUNCTION public.send_reminder_approval_reimbursement()       TO service_role;
GRANT EXECUTE ON FUNCTION public.send_reminder_backup_belum_dilakukan()       TO service_role;
```

`GRANT` ke `service_role` sengaja ditambahkan agar polanya **identik** dengan
`notify_email`/`notify_push` di subsistem yang sama — konsisten, dan kalau
nanti ada tombol admin "kirim reminder sekarang" lewat API route service-role,
tidak perlu migrasi ulang. Keamanannya tidak berkurang: service-role key
hanya ada di server, tidak pernah dikirim ke browser.

**Hasil verifikasi setelah diterapkan** (tiga sudut independen):

| Bukti | Hasil |
|---|---|
| `has_function_privilege('anon', ...)` | `false` untuk ketiganya |
| `proacl` sekarang | `postgres=X/postgres \| service_role=X/postgres` |
| Pembanding: 2 fungsi reminder yang memang sudah benar sejak awal | ACL **identik** — konfirmasi kondisi target tepat |
| Advisor Supabase `anon_security_definer_function_executable` | 28 → **25** (tepat −3) |
| Advisor `authenticated_security_definer_function_executable` | 54 → **51** (tepat −3) |
| `cron.job` | kelima job tetap `active: true`, tetap `username: postgres` |

---

## 2. 🟡 Temuan keamanan lain (tidak mendesak)

### 2a. `search_path` bisa dimanipulasi — 2 fungsi presensi

`submit_presensi` dan `submit_presensi_rfid` adalah `SECURITY DEFINER`
tanpa `SET search_path`. Secara teori pemanggil bisa menggeser `search_path`
agar fungsi menyasar tabel palsu. Eksploitasinya tidak trivial (butuh hak
membuat schema), tapi ini praktik standar yang murah dipenuhi:

```sql
ALTER FUNCTION public.submit_presensi(...)      SET search_path = public;
ALTER FUNCTION public.submit_presensi_rfid(...) SET search_path = public;
```

Fungsi `SECURITY DEFINER` lain di project ini sudah memakai
`SET search_path TO 'public'` — jadi dua ini memang anomali, bukan pola.

### 2b. Proteksi password bocor belum aktif

Advisor menandai `auth_leaked_password_protection` mati. Ini fitur Supabase
yang mencocokkan password baru dengan basis data kebocoran HaveIBeenPwned.
Bukan perubahan kode — cukup satu sakelar di Supabase Dashboard
(*Authentication → Policies*). Sangat sepadan untuk organisasi dengan 82
akun yang kemungkinan besar memakai ulang password.

### 2c. 24 fungsi `SECURITY DEFINER` lain juga anon-executable

Berbeda dengan tiga fungsi di §1, **24 fungsi sisanya sudah menjaga diri
sendiri** — semuanya memanggil `auth.uid()` dan melempar `RAISE EXCEPTION`
kalau pemanggil tidak berhak (terverifikasi lewat query yang sama di §1).
Jadi ini **bukan lubang**, hanya kebersihan: idealnya `anon` dicabut juga
sebagai lapisan pertahanan kedua, tapi tidak mendesak dan menyentuh 24
fungsi sekaligus lebih berisiko daripada manfaatnya sekarang.

Pengecualian yang memang disengaja: `get_landing_stats` (statistik halaman
depan, wajar publik).

### 2d. Tabel usang masih tertinggal

`reset_password_requests` masih ada di database dengan 1 policy, padahal
CLAUDE.md menyatakan tabel ini sudah *retired* dan digantikan
`password_reset_otp`. Bukan risiko aktif, tapi permukaan serangan dan
kebingungan yang tidak perlu. Perlu dikonfirmasi dulu isinya benar-benar
tidak terpakai sebelum di-`DROP`.

### 2e. Dua tabel RLS aktif tanpa policy — kemungkinan besar BENAR

`auth_rate_limit` dan `password_reset_otp` punya RLS aktif tapi nol policy.
Advisor menandainya INFO, tapi analisis saya: ini **justru pola yang tepat**
— RLS aktif tanpa policy berarti *tolak semua* untuk `anon`/`authenticated`,
sementara service-role tetap bisa mengaksesnya dari API route. Untuk tabel
rate-limit dan OTP, itu memang yang diinginkan. Tidak perlu diubah.

---

## 3. 🟡 Performa database

Semua temuan di bawah **belum terasa pada skala 82 user**, tapi akan menjadi
beban nyata kalau organisasi tumbuh atau kalau nanti ada mobile app yang
lebih sering polling.

### 3a. `auth.uid()` dievaluasi ulang per baris — 7 policy

Postgres tidak tahu `auth.uid()` konstan dalam satu query, jadi ia
memanggilnya untuk **setiap baris** yang dipindai. Perbaikannya mekanis:
bungkus jadi `(select auth.uid())` supaya dievaluasi sekali.

Policy terdampak:

| Tabel | Policy |
|---|---|
| `pengajuan_reimbursement` | `pengajuan_reimbursement_insert`, `pengajuan_reimbursement_select` |
| `pengajuan_izin_presensi` | `pengajuan_izin_insert_sendiri`, `pengajuan_izin_select_sendiri` |
| `feature_toggles` | `feature_toggles_select_all` |
| `audit_log` | `audit_log_insert_own` |
| `push_subscriptions` | `push_subscriptions_own` |

`feature_toggles_select_all` paling berdampak — dibaca **setiap kali sidebar
dirender** (`loadFeatureToggles()` di `app/(dashboard)/layout.tsx`), jadi
praktis di setiap kunjungan halaman oleh setiap user.

### 3b. 155 policy permisif tumpang tindih

Terkonsentrasi di enam tabel: `pengumuman`, `keuangan`, `kegiatan`,
`dokumen`, `absensi` (masing-masing 20) dan `notifikasi` (15). Setiap policy
permisif untuk peran+aksi yang sama harus dievaluasi lalu di-OR-kan, jadi
biayanya berlipat.

**Rekomendasi saya: JANGAN disentuh sekarang.** Menggabungkan policy RLS
adalah operasi berisiko tinggi pada alur otorisasi inti — persis kategori
yang CLAUDE.md minta ditanyakan dulu. Manfaatnya (performa yang belum jadi
masalah) tidak sebanding dengan risikonya (salah gabung = kebocoran data
lintas jenjang). Catat sebagai utang teknis, kerjakan hanya kalau performa
benar-benar terasa, dan wajib lewat Supabase database branch.

### 3c. 40 foreign key tanpa index, 5 index tak terpakai

Rutin dan berisiko rendah. Relevan saat tabel `absensi` membesar. Bisa
dikerjakan kapan saja sebagai paket terpisah.

---

## 4. 🟠 UI/UX — sumber utama kesan "belum profesional"

Inilah jawaban paling langsung atas permintaan Reno. Hasil inventaris pola
di seluruh `app/` + `components/`:

| Pola | Jumlah file | Penilaian |
|---|---|---|
| `alert()` / `confirm()` native | **5 file, 16 pemanggilan** | 🔴 Penyebab #1 kesan amatir |
| Sistem toast/notifikasi | **0** | 🔴 Tidak ada sama sekali |
| Skeleton loader | **0** | 🔴 Semua loading pakai spinner/"..." |
| `role="dialog"` | **0** | 🔴 Modal tanpa semantik a11y |
| `aria-label` | 6 file | 🟠 Cakupan tipis |
| `transition` | 35 file | 🟢 Fondasi bagus |
| `animate-*` | 27 file | 🟢 Fondasi bagus |

### 4a. Dialog bawaan browser — 16 tempat di 5 halaman

```
app/(dashboard)/keuangan/page.tsx     5  (3 alert + 2 confirm)
app/(dashboard)/absensi/page.tsx      4  (4 alert)
app/(dashboard)/kegiatan/page.tsx     4  (3 alert + 1 confirm)
app/(dashboard)/dokumen/page.tsx      2  (1 alert + 1 confirm)
app/(dashboard)/pengumuman/page.tsx   1  (1 confirm)
```

Kenapa ini yang paling merusak kesan profesional:

- **Memblokir total** — seluruh halaman beku sampai diklik
- **Tidak bisa distyle** — menampilkan URL mentah `gensiti-app.vercel.app`
- **Mengabaikan Mode Gelap** — putih menyilaukan padahal user pilih gelap;
  ini langsung membatalkan seluruh kerja B3 di titik-titik itu
- **Buruk di mobile** — tampil sebagai dialog sistem, bukan bagian aplikasi
- **Tidak ada hierarki** — konfirmasi hapus (destruktif) terlihat identik
  dengan pesan info biasa

Contoh paling terasa: `keuangan/page.tsx:284` memakai `confirm()` untuk
menyetujui reimbursement — keputusan finansial yang berdampak nyata,
disajikan lewat kotak abu-abu bawaan browser.

### 4b. `Modal.tsx` tanpa aksesibilitas sama sekali

File 49 baris ini **nol** atribut a11y: tidak ada `role="dialog"`, tidak ada
`aria-modal`, tidak ada focus trap, tidak ada tutup-dengan-Escape, tidak ada
pengembalian fokus saat ditutup.

Ini menciptakan ketidakkonsistenan yang mencolok: kita baru saja mengirim
B4 (Ukuran Teks + Kontras Tinggi) untuk pengguna dengan keterbatasan
penglihatan, tapi pengguna keyboard masih terjebak di dalam modal begitu
terbuka. Fitur aksesibilitas yang setengah jalan.

### 4c. Nol skeleton loader

Setiap halaman menampilkan spinner atau teks `'...'` saat memuat. Skeleton
(kerangka abu-abu berbentuk konten yang akan datang) sudah jadi standar
karena secara terukur **terasa** lebih cepat — pengguna melihat struktur
langsung alih-alih layar kosong.

Ini kandidat terkuat untuk "efek yang menyenangkan pengguna" yang Reno
minta: dampak persepsi besar, risiko nol, murni presentasional.

---

## 5. Yang sudah bagus dan jangan diutak-atik

Penting disebut supaya perbaikan tidak merusak yang sudah benar:

- **RLS 24/24 tabel** — disiplin yang konsisten, jarang ditemui
- **Primitif berbahaya terkunci rapat** — `notify_email`/`notify_push`
  tertutup untuk anon *dan* authenticated
- **Pemisahan wewenang keuangan** — Super Admin sengaja tidak bisa melihat
  data keuangan, dan itu konsisten sampai ke fitur backup
- **`useSyncExternalStore` untuk preferensi UI** — pola yang tepat, sudah
  dipakai ulang dengan benar oleh B4
- **Override `.dark` global di `globals.css`** — hemat ratusan kelas manual
- **Budaya komentar naratif** — komentar menjelaskan *kenapa*, bukan *apa*.
  Sangat berharga untuk solo developer.

---

## 6. Rekomendasi urutan kerja

Diurutkan berdasarkan (dampak ÷ risiko), bukan berdasarkan besarnya usaha.

| # | Pekerjaan | Dampak | Risiko | Butuh persetujuan? |
|---|---|---|---|---|
| ~~1~~ | ~~Cabut EXECUTE 3 fungsi cron (§1)~~ | ✅ **SELESAI** — disetujui & diverifikasi | — | — |
| ~~2~~ | ~~Toast + dialog konfirmasi berstyle, ganti 16 `alert`/`confirm`~~ | ✅ **SELESAI** — lihat §7 | — | — |
| **3** | `Modal.tsx`: focus trap, Escape, `role="dialog"` | Melengkapi B4 | Rendah | Tidak |
| **4** | Skeleton loader di halaman utama | "Efek menyenangkan" | Nol | Tidak |
| **5** | `SET search_path` 2 fungsi presensi (§2a) | Kebersihan | Rendah | ✅ **Ya — DB production** |
| **6** | Aktifkan proteksi password bocor (§2b) | Keamanan akun | Nol | Sakelar dashboard Reno |
| **7** | `(select auth.uid())` di 7 policy (§3a) | Performa | Sedang | ✅ **Ya — DB production** |
| **8** | Index FK (§3c) | Performa skala | Rendah | ✅ **Ya — DB production** |
| — | Gabungkan 155 policy (§3b) | Performa | **Tinggi** | ❌ Sebaiknya jangan sekarang |

### Catatan jujur soal "banyak efek yang menyenangkan"

Satu hal yang perlu saya sampaikan, bukan untuk mengerem semangat tapi
supaya hasilnya benar-benar terasa profesional: **animasi yang terlalu
banyak justru membuat aplikasi terasa lambat dan murahan.** Aplikasi yang
terasa canggih biasanya memakai *sedikit* animasi yang dieksekusi dengan
sangat rapi — transisi 150–250ms, gerakan yang punya alasan (mengarahkan
mata, memberi umpan balik), bukan gerakan yang sekadar ada.

Selain itu, kita baru saja membangun fitur aksesibilitas di B4. Setiap
animasi baru sebaiknya menghormati `prefers-reduced-motion` — polanya sudah
ada di `globals.css` (`.animate-page-in`), tinggal diteruskan.

Usulan saya: **kualitas gerakan, bukan kuantitas.** Toast yang meluncur
mulus + skeleton yang berdenyut halus + modal yang muncul dengan skala
lembut akan terasa jauh lebih canggih daripada sepuluh elemen yang
bergerak bersamaan.

---

## 7. ✅ Yang sudah dikerjakan dari audit ini

### §1 — Lubang keamanan RPC (migrasi `kunci_fungsi_reminder_cron_dari_publik`)

Sudah diterapkan & diverifikasi. Detail lengkap beserta jebakan `PUBLIC` yang
hampir terlewat ada di §1 di atas.

### Fondasi UX — toast + dialog konfirmasi

Menggantikan **seluruh 16** `alert()`/`confirm()` bawaan browser. Berkas baru:

| Berkas | Peran |
|---|---|
| `lib/toast.ts` | Store toast (module-level + `useSyncExternalStore`) |
| `lib/konfirmasi.ts` | Dialog konfirmasi berbasis Promise |
| `components/ToastHost.tsx` | Penampil toast, dipasang sekali di layout |
| `components/KonfirmasiHost.tsx` | Penampil dialog, lengkap dengan a11y |

**Keputusan desain yang penting:** store-nya dibuat di level modul (meniru
`lib/dark-mode.ts`), bukan React Context. Konsekuensinya `toast.gagal(x)` bisa
dipanggil dari event handler mana pun tanpa hook dan tanpa provider — sehingga
mengganti `alert(x)` benar-benar penggantian satu baris, bukan refactor
struktural di lima halaman. `konfirmasi()` berbasis Promise dengan alasan yang
sama: `if (!confirm(...))` cukup jadi `if (!await konfirmasi({...}))`.

**Yang ikut membaik selain tampilan:**

- **Mode Gelap tidak lagi bolong.** Sebelumnya 16 titik itu memaksa kotak putih
  menyilaukan ke pengguna tema gelap — di situ kerja B3 praktis batal.
- **Hierarki aksi.** Prop `destruktif` membedakan "Hapus permanen" (merah,
  ikon peringatan) dari "Setujui reimbursement" (biru). Sebelumnya keduanya
  tampil identik sebagai kotak abu-abu sistem.
- **Pesan konfirmasi jadi spesifik.** Dari `"Hapus dokumen ini?"` menjadi
  `"Dokumen \"Laporan Juni\" akan dihapus permanen dan tidak bisa dikembalikan."`
- **Umpan balik sukses.** Sebelumnya aksi berhasil sama sekali senyap —
  pengguna tidak tahu apakah tindakannya berhasil kecuali menebak dari daftar
  yang berubah.
- **Aksesibilitas dialog** — `role="dialog"`, `aria-modal`, focus trap,
  tutup dengan Escape, dan pengembalian fokus. Pola di `KonfirmasiHost.tsx`
  sengaja dibuat sebagai rujukan untuk membenahi `Modal.tsx` (item #3).
- **Bug ikutan yang ditemukan & diperbaiki:** `pengumuman/page.tsx` sama
  sekali tidak memeriksa error saat menghapus, sehingga penghapusan yang
  ditolak RLS tetap terlihat "berhasil" bagi pengguna.

Animasi sengaja ditahan di 180–220ms dengan easing `cubic-bezier(0.16, 1, 0.3, 1)`
dan seluruhnya dinonaktifkan di bawah `prefers-reduced-motion` — konsisten
dengan komitmen aksesibilitas B4.

---

## Lampiran — cara memverifikasi ulang

```sql
-- §1: fungsi SECURITY DEFINER yang anon bisa panggil + apakah menjaga diri
SELECT p.proname,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_bisa,
       (pg_get_functiondef(p.oid) ILIKE '%auth.uid()%') AS cek_auth_uid
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.prosecdef
ORDER BY cek_auth_uid, p.proname;

-- §1: konfirmasi cron jalan sebagai postgres (jadi REVOKE aman)
SELECT jobid, schedule, command, username, active FROM cron.job ORDER BY jobid;

-- §5: cakupan RLS seluruh tabel
SELECT c.relname, c.relrowsecurity,
       (SELECT count(*) FROM pg_policy p WHERE p.polrelid=c.oid) AS jml_policy
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind='r'
ORDER BY c.relrowsecurity, jml_policy;
```

```bash
# §4a: inventaris dialog native
grep -rnE "(^|[^.\w])(alert|confirm)\(" app components --include=*.tsx

# §4: inventaris pola UX
grep -rl "role=\"dialog\"\|Skeleton\|toast" app components --include=*.tsx
```
