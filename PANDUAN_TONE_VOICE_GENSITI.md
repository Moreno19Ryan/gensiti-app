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
| Sinyal terputus | "Koneksi terputus" | "Sinyal lagi kurang stabil nih, tenang aja datanya aman kok" |

---

## Contoh Sapaan Berdasarkan Waktu

- Pagi (04.00–10.00): "Selamat pagi! Semangat mulai hari ya"
- Siang (10.00–15.00): "Met siang, jangan lupa istirahat sejenak"
- Sore (15.00–18.00): "Sore-sore gini enaknya buka GENSITI dulu"
- Malam (18.00–22.00): "Malam yang tenang, cocok buat cek kegiatan besok"
- Larut malam (22.00–04.00): "Masih melek nih? Jangan lupa istirahat ya"

---

## Pesan Motivasi (Daftar Terkurasi — 35 Variasi)

Hasil brainstorm & review (bukan draft lagi) — dikelompokkan per gaya supaya 
pemilihan random tetap terasa konsisten nadanya dalam satu grup, sekaligus 
memudahkan penambahan/pengurangan di kemudian hari.

**Gaya ringan/lucu** (cocok generus lebih muda)
- "Absen dulu, baru boleh scroll HP lagi ya"
- "Semangat kayak sinyal WiFi rumah — full bar terus!"
- "Hari ini udah senyum belum? Kalau belum, mulai dari sini aja"
- "Rajin itu nular lho, kamu bisa jadi 'sumber virus' kebaikan"
- "Jangan cuma jadi generus yang aktif di grup WA doang, hehe"
- "Kalau niat udah kuat, alasan males otomatis kalah"
- "GENSITI setia nungguin kamu, masa kamu nggak setia balik?"

**Gaya santai/umum** (netral, aman untuk semua usia)
- "Konsisten itu keren — kayak kamu yang buka app ini hari ini."
- "Satu langkah kecil hari ini, satu kebiasaan baik untuk seterusnya."
- "Yuk mulai hari dengan niat baik — sisanya, GENSITI yang bantu catat!"
- "Setiap kehadiran itu bukti kamu peduli sama kebersamaan."
- "Semangat menjalani hari, semoga berkah selalu menyertai."
- "Kadang yang kecil justru yang paling berarti — kayak absen hari ini."
- "Terus berproses, hasil baik pasti mengikuti."
- "Hari ini adalah kesempatan baru untuk jadi lebih baik."
- "Kebersamaan itu dimulai dari hal sederhana — hadir aja dulu."
- "Langkahmu hari ini, jejak baik untuk esok."

**Gaya reflektif/menyentuh** (cocok untuk yang lebih dewasa)
- "Istirahat boleh, tapi jangan lupa balik lagi ya!"
- "Hadir bukan cuma soal absen, tapi soal semangat kebersamaan."
- "Kadang kita cuma butuh diingatkan, bukan dipaksa — ini pengingatnya."
- "Waktu yang kamu luangkan untuk kebaikan, tidak pernah sia-sia."
- "Perjalanan panjang dimulai dari niat yang sederhana."
- "Yang penting bukan seberapa sempurna, tapi seberapa istiqomah."
- "Setiap usaha kecil, tetap punya nilai di mata-Nya."
- "Semoga langkahmu hari ini membawa keberkahan."
- "Kadang lelah itu wajar, tapi jangan sampai berhenti ya."
- "Terima kasih sudah meluangkan waktu untuk hadir hari ini."

**Gaya semangat/motivational** (energik, cocok pembuka hari)
- "Bangkit, bergerak, dan jadi versi terbaik hari ini!"
- "Yuk buktikan, generus juga bisa jadi teladan!"
- "Hari baru, semangat baru, cerita baru untuk diukir."
- "Jangan tunggu sempurna untuk mulai — mulai aja dulu."
- "Kamu lebih kuat dari rasa males pagi ini, buktikan!"
- "Setiap kegiatan adalah kesempatan untuk belajar hal baru."
- "Ayo jadi generasi yang aktif, bukan cuma jadi penonton."
- "Semangat itu menular — mulai dari kamu dulu ya!"

---

## Pantun (Opsional, Momen Santai Saja)

Pantun cocok secara budaya (akrab di telinga generus Indonesia, tidak 
terasa "maksa gaul"), tapi khusus dipakai di momen santai — jangan 
ditempel di pesan penting/serius, karena polanya gampang jatuh ke nada 
receh kalau salah tempat.

- "Pergi ke pasar beli talas, jangan lupa mampir ke warung. Kalau hadir 
  jangan malas, biar hati jadi tenang."
- "Bunga melati di tepi jalan, wanginya semerbak sampai ke hati. 
  Kehadiranmu bukan paksaan, tapi bukti kepedulian sejati."
- "Ke sawah menanam padi, jangan lupa bawa cangkul. Konsisten itu kunci, 
  biar hasil tidak mudah luntur."
- "Air jernih di dalam gelas, diminum sambil duduk santai. Kebersamaan 
  itu terasa jelas, kalau semua saling menyapai."
- "Layang-layang terbang tinggi, ditiup angin dari selatan. Semangat 
  jangan sampai mati, teruslah jadi generus pilihan."

**Soal gombalan — sengaja TIDAK dipakai.** Gombalan bernuansa romantis/
flirty, kurang pas untuk konteks organisasi keagamaan dengan rentang usia 
campuran (termasuk anak SMP) — risiko disalahartikan antar generus yang 
belum tentu saling kenal dekat. Diganti candaan ringan non-romantis (lihat 
kategori "ringan/lucu" di atas).

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

## Ide Tambahan (Backlog Terpisah — Beda Kelas Effort dari Microcopy)

Muncul dari sesi brainstorm, tapi butuh kerja teknis nyata (bukan sekadar 
tambahan teks) — dicatat di sini supaya tidak hilang, tapi sengaja dipisah 
dari daftar konten di atas yang sudah siap pakai:

- **Perayaan streak kehadiran** — belum ada perhitungan "hadir berturut-turut" 
  di skema/RPC manapun sekarang, perlu dibangun dari nol. Hati-hati juga soal 
  nuansa kompetisi (lihat diskusi gamifikasi di `WISHLIST_ASSESSMENT.md` B1).
- **"Welcome back" setelah lama tidak aktif** — sinyal yang ada sekarang 
  (`active_session_created_at`, waktu login terakhir lewat form) tidak cukup 
  akurat untuk ini, karena user dengan "Ingat saya" aktif bisa tetap login 
  berminggu-minggu tanpa re-login walau rutin buka app. Butuh kolom 
  "aktivitas terakhir" baru yang di-update tiap kunjungan.
- **Ucapan hari besar keagamaan** (Ramadhan, Idul Fitri, dst) — bukan setup 
  sekali jadi, tanggal Hijriah bergeser ±11 hari tiap tahun, perlu daftar 
  tanggal yang di-maintain ulang setiap tahun.
- **Variasi sapaan per hari (Jumat/Senin)** — ini yang paling ringan, murni 
  logika tanggal di client, tidak butuh data baru.
- **Nama panggilan di sapaan dashboard** — sudah siap pakai sebenarnya: 
  `nama_panggilan` sudah tersedia di data user, dashboard sekarang masih 
  pakai nama lengkap. Tinggal ganti field, bukan pekerjaan besar.

---

## Langkah Selanjutnya

Konten di atas (pesan motivasi, pantun, microcopy, sapaan waktu) sudah 
final & siap diimplementasikan. Item di "Ide Tambahan" di atas perlu 
di-scope terpisah (effort & keputusan produknya beda kelas) sebelum masuk 
antrian kerja.
