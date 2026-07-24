# GENSITI — Panduan Tone & Voice Bahasa Aplikasi

Pelengkap dari DESIGN_BRIEF_GENSITI.md (yang fokus ke visual). Dokumen ini fokus 
ke bahasa/copy — supaya aplikasi terasa luwes, asik, dan natural buat target 
pengguna: generus usia SMP sampai usia mandiri (±30 tahun).

---

## Prinsip Dasar

1. **Santai tapi tetap sopan.** Bahasa gaul boleh, tapi hindari yang terkesan 
   kasar/kurang ajar. Ingat konteksnya organisasi keagamaan.
2. **Menyenangkan, tidak berlebihan.** Sisipkan humor ringan, tapi jangan sampai 
   terasa "receh" di momen yang seharusnya serius (misal: pengumuman duka, 
   info keuangan).
3. **Tetap membawa nilai positif.** Guyonan boleh, tapi arahnya tetap membangun 
   — bukan sekadar lucu-lucuan kosong.
4. **Sesuaikan dengan rentang usia luas.** SMP dan usia 30-an punya selera beda. 
   Cari titik tengah yang tidak terlalu "kekanakan" tapi juga tidak kaku.
5. **Selalu punya opsi mematikan.** Beberapa user mungkin lebih suka tampilan 
   yang lebih formal — sediakan toggle di Pengaturan untuk menonaktifkan 
   pesan motivasi/pantun/gombalan kalau mereka mau.

---

## Prompt Siap Pakai untuk Claude Code

```
Titipan dari Reno soal bahasa aplikasi GENSITI: dibuat lebih luwes, asik, 
menyenangkan, dan natural — karena target pengguna generus usia SMP sampai 
usia mandiri (kebanyakan remaja-dewasa muda, paling tua sekitar 30-an).

Tolong terapkan prinsip berikut, baca dulu 
PANDUAN_TONE_VOICE_GENSITI.md untuk detail lengkap & contoh:

1. Audit microcopy yang ada sekarang (pesan sukses, error, empty state, 
   konfirmasi, dll) — identifikasi mana yang masih terasa kaku/formal, 
   usulkan versi yang lebih luwes tapi tetap sopan (tidak berlebihan, 
   ingat konteks organisasi keagamaan).

2. Tambahkan fitur pesan motivasi random (di Dashboard atau halaman utama) 
   — pakai daftar terkurasi (bukan generate on-the-fly setiap saat), 
   supaya kualitasnya konsisten dan bisa direview dulu sebelum tayang.

3. Pertimbangkan detail kecil tambahan: sapaan berdasarkan waktu (pagi/ 
   siang/malam), pakai nama panggilan bukan nama lengkap di sapaan 
   dashboard, apresiasi kecil untuk progress (misal streak kehadiran).

4. WAJIB sediakan toggle di halaman Pengaturan untuk menonaktifkan 
   fitur pesan motivasi/pantun/gombalan ini, untuk user yang lebih 
   suka tampilan formal.

Ini murni assessment + usulan dulu (termasuk contoh konten motivasi/ 
pantun untuk direview) — JANGAN implementasi kode dulu sampai Reno 
review dan approve arah + contoh kontennya.
```

---

## Contoh Microcopy — Sebelum vs Sesudah

| Situasi | Versi Formal (Sekarang) | Versi Luwes (Usulan) |
|---|---|---|
| Absen berhasil | "Data berhasil disimpan" | "Mantap! Kamu udah tercatat hadir" |
| Login gagal | "Autentikasi gagal" | "Yah, nama atau password-nya kayaknya belum pas nih" |
| Loading | "Memuat..." | "Sabar ya, lagi disiapin..." |
| Data kosong | "Tidak ada data" | "Belum ada apa-apa di sini, masih sepi" |
| Konfirmasi hapus | "Yakin ingin menghapus?" | "Yakin nih mau dihapus? Nanti nyesel lho" |
| Kegiatan selesai | "Kegiatan telah berakhir" | "Kegiatannya udah kelar, sampai jumpa di kegiatan berikutnya!" |
| Sinyal terputus | "Koneksi terputus" | "Sinyalnya lagi ngambek nih, tenang aja datanya aman kok" |

---

## Contoh Sapaan Berdasarkan Waktu

- Pagi (04.00–10.00): "Selamat pagi! Semangat mulai hari ya"
- Siang (10.00–15.00): "Met siang, jangan lupa istirahat sejenak"
- Sore (15.00–18.00): "Sore-sore gini enaknya buka GENSITI dulu"
- Malam (18.00–22.00): "Malam yang tenang, cocok buat cek kegiatan besok"
- Larut malam (22.00–04.00): "Masih melek nih? Jangan lupa istirahat ya"

---

## Contoh Pesan Motivasi (Draft Awal — Perlu Direview & Diperluas)

Catatan: ini draft awal orisinal untuk memberi gambaran gaya, bukan daftar 
final. Sebaiknya diperluas jadi puluhan variasi lewat sesi brainstorm 
terpisah supaya tidak cepat terasa berulang bagi user.

- "Yuk mulai hari dengan niat baik — sisanya, GENSITI yang bantu catat!"
- "Hadir bukan cuma soal absen, tapi soal semangat kebersamaan."
- "Satu langkah kecil hari ini, satu kebiasaan baik untuk seterusnya."
- "Istirahat boleh, tapi jangan lupa balik lagi ya!"
- "Konsisten itu keren — kayak kamu yang buka app ini hari ini."

---

## Rekomendasi Teknis (untuk Claude Code Pertimbangkan)

1. **Daftar terkurasi, bukan generate real-time.** Simpan pesan-pesan ini 
   di database atau file konfigurasi, dipilih random dari daftar tetap — 
   supaya kualitas konsisten dan mudah di-review/update oleh pengurus 
   tanpa perlu deploy ulang kode.
2. **Frekuensi wajar.** Jangan tampilkan di setiap interaksi — cukup 
   sekali per sesi/kunjungan, supaya tidak terasa mengganggu.
3. **Toggle di Pengaturan.** User yang tidak suka bisa matikan, kembali 
   ke tampilan lebih standar/formal.
4. **Hindari konten sensitif waktu tertentu.** Kalau ada pengumuman duka 
   cita atau info serius lain sedang ditampilkan, pesan motivasi/pantun 
   sebaiknya tidak muncul bersamaan di layar yang sama.

---

## Langkah Selanjutnya

Setelah Claude Code memberi usulan detail + contoh konten tambahan, 
sebaiknya direview dulu bersama (bisa juga melibatkan pengurus lain kalau 
memungkinkan) sebelum masuk ke implementasi kode — supaya nadanya benar-benar 
pas untuk komunitas GENSITI, bukan cuma "terdengar asik" secara umum.
