# GENSITI — Wishlist Pengembangan (Perspektif Super Admin + Ide Umum)

Dokumen ini kumpulan ide pengembangan lanjutan untuk GENSITI, disusun dari simulasi 
perspektif Super Admin (menjalankan tugas sehari-hari) plus ide umum untuk membuat 
sistem lebih powerful, optimal, dan menyenangkan dipakai. Sifatnya wishlist/bahan 
diskusi — belum diprioritaskan secara resmi, perlu dikonfirmasi kelayakan & urutannya 
bersama Claude Code (cek kompleksitas implementasi) sebelum dieksekusi.

Untuk konteks arsitektur, lihat ARCHITECTURE.md, HANDOFF.md, CLAUDE.md. Untuk 
kesiapan native, lihat NATIVE_READINESS_AUDIT.md.

---

## Bagian A — Dari Perspektif Operasional Super Admin

Fokus: mengubah pekerjaan Super Admin dari **reaktif** (baru tahu ada masalah 
setelah dilaporkan) menjadi **proaktif** (tahu duluan, ada visibilitas terpusat).

### A1. Rencana Pemulihan Darurat Akun Super Admin
**Masalah:** Sistem sengaja membatasi hanya 1 akun Super Admin (trigger 
`enforce_single_super_admin`) — bagus untuk kejelasan otoritas, tapi jadi titik 
rawan tunggal. Belum ada prosedur terdokumentasi kalau akun ini ke-lock/lupa 
password/pemegangnya berhenti mendadak.
**Ide solusi:** Dokumentasikan (atau buat mekanisme) prosedur pemulihan darurat — 
misal akses langsung lewat Supabase Dashboard oleh pemilik project, dengan 
langkah yang jelas dan aman.

### A2. Dashboard Kesehatan Sistem Terpusat
**Masalah:** Informasi penting (audit log, email log, rate-limit hits, error 
production) tersebar di tabel/menu terpisah. Sentry sudah terintegrasi di kode 
tapi DSN belum diisi di Vercel, jadi belum aktif.
**Ide solusi:** 
- Aktifkan Sentry (isi environment variable yang diperlukan)
- Bikin satu halaman/section dashboard yang merangkum: jumlah error terbaru, 
  email gagal terkirim, percobaan login yang kena rate limit, dan aktivitas 
  audit log signifikan — semua dalam satu pandangan

### A3. Jadwal Backup Otomatis + Reminder
**Masalah:** Backup Data sepenuhnya manual (klik ekspor). Tidak ada pengingat 
kalau sudah lama tidak backup.
**Ide solusi:** Reminder otomatis (in-app/email) ke Super Admin kalau sudah 
melewati interval tertentu (misal 2 minggu) sejak backup terakhir. Opsional: 
backup terjadwal otomatis tersimpan di storage (bukan cuma download manual).

### A4. Redesain Single-Session → Multi-Device
**Masalah:** Sudah dibahas di NATIVE_READINESS_AUDIT.md (B.2) sebagai prasyarat 
native, tapi juga berdampak ke penggunaan sehari-hari — termasuk Super Admin 
sendiri yang mungkin perlu pantau sistem dari HP dan laptop bersamaan.
**Ide solusi:** Model `user_sessions` (multi-device dengan daftar sesi aktif), 
sudah direkomendasikan di audit sebelumnya.

### A5. Tampilan Sesi Aktif (Siapa Online Sekarang)
**Masalah:** Tidak ada cara cepat melihat daftar user yang sedang login, dari 
device apa — berguna saat investigasi aktivitas mencurigakan.
**Ide solusi:** Halaman/panel kecil di menu admin: daftar sesi aktif real-time 
(bisa dibangun di atas struktur `user_sessions` dari A4).

### A6. Eskalasi Otomatis untuk Approval yang Nyangkut
**Masalah:** Alur approval PPG (kegiatan/pengumuman Daerah) dan Bendahara 
(reimbursement) tidak punya mekanisme eskalasi kalau nyangkut lama tanpa 
tindakan.
**Ide solusi:** Reminder otomatis ke approver terkait kalau item pending lebih 
dari X hari, dan notifikasi ke Super Admin/pihak terkait kalau sudah sangat 
lama (indikasi bottleneck).

### A7. Alert untuk Rate-Limit Hits Berulang
**Masalah:** Rate limiter (`auth_rate_limit`) sudah aktif, tapi tidak ada 
notifikasi kalau ada pola yang mengindikasikan percobaan serangan nyata 
(bukan cuma user lupa password biasa).
**Ide solusi:** Threshold tertentu (misal 1 IP kena limit berkali-kali dalam 
periode singkat) trigger notifikasi ke Super Admin.

---

## Bagian B — Ide Pengembangan Umum (Powerful, Optimal, Menyenangkan)

### B1. Gamifikasi Ringan untuk Generus
Poin kehadiran, badge/lencana digital untuk konsistensi ikut kegiatan, 
leaderboard kelompok (opsional/hati-hati supaya tidak jadi kompetisi tidak 
sehat). Tujuannya: bikin generus lebih termotivasi ikut kegiatan, bukan cuma 
soal kewajiban absen.

### B2. Personalisasi Dashboard per Role
Dashboard yang menyesuaikan konten berdasarkan role yang login — misal Ketua 
Kelompok langsung lihat ringkasan kelompoknya, Bendahara langsung lihat 
ringkasan keuangan, tanpa perlu navigasi manual ke menu tertentu dulu.

### B3. Mode Gelap (Dark Mode)
Fitur yang umum diminta user modern, terutama untuk yang sering akses malam 
hari.

### B4. Aksesibilitas — Ukuran Teks & Kontras
Opsi perbesar teks / mode kontras tinggi, mengingat rentang usia pengguna 
GENSITI cukup beragam.

### B5. Export Data Personal untuk Anggota
Generus bisa mengunduh riwayat kehadiran/data pribadinya sendiri — sejalan 
dengan prinsip transparansi dan kepemilikan data individu, bukan hanya 
pengurus yang bisa export.

---

## Ringkasan Prioritas (Usulan Awal, Perlu Didiskusikan)

| Kategori | Item | Alasan Prioritas Tinggi |
|---|---|---|
| Kritis | A1 — Pemulihan darurat Super Admin | Titik rawan tunggal, risiko sistem "tersandera" |
| Kritis | A4 — Multi-device session | Prasyarat native + kebutuhan harian |
| Tinggi | A2 — Dashboard kesehatan sistem | Ubah reaktif jadi proaktif |
| Tinggi | A3 — Backup otomatis + reminder | Jangan bergantung ingatan manusia |
| Sedang | A5, A6, A7 | Visibilitas operasional, bisa menyusul setelah A1-A4 |
| Sedang | B1, B2 | Nilai tambah signifikan untuk engagement & UX |
| Rendah–Sedang | B3, B4, B5 | Peningkatan kualitas hidup pengguna, tidak mendesak |

---

## Catatan

Dokumen ini adalah hasil eksplorasi ide, bukan keputusan final. Sebelum dieksekusi, 
disarankan:
1. Diskusikan dengan pengurus/stakeholder GENSITI lain (bukan cuma sudut pandang 
   teknis) — terutama untuk B1 (gamifikasi) yang punya dimensi sosial/budaya 
   organisasi
2. Cek kelayakan teknis & effort lewat Claude Code sebelum masuk roadmap resmi
3. Gabungkan dengan urutan prioritas di NATIVE_READINESS_AUDIT.md kalau ada 
   overlap (misal A4 sudah muncul di sana sebagai item #4)
