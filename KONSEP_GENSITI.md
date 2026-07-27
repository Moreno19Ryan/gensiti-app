# KONSEP_GENSITI — Visi, Alur Kerja & Roadmap

Dokumen ini adalah **pedoman utama** GENSITI dari sisi visi produk & keputusan Reno —
pelengkap dari dokumen teknis yang sudah ada:

| Dokumen | Isi |
|---|---|
| **KONSEP_GENSITI.md** (ini) | Visi, alur kerja, peta fitur, kesiapan rilis, roadmap — "kenapa" & "ke mana" |
| [CLAUDE.md](CLAUDE.md) | Konvensi coding & keamanan — "bagaimana cara kerja" |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Skema database, RPC, hak akses — "apa yang sudah dibangun" |
| [DESIGN_BRIEF_GENSITI.md](DESIGN_BRIEF_GENSITI.md) | Prinsip visual & warna — "bagaimana tampilannya" |
| [HANDOFF.md](HANDOFF.md) | Riwayat kerja & status per sesi — "apa yang baru dikerjakan" |

Draf pertama disusun **18 Juli 2026** lewat sesi tanya-jawab bertahap dengan Reno. Dokumen
ini hidup — update tiap kali ada keputusan besar baru soal arah GENSITI, jangan biarkan basi.

---

## 1. Visi & Tujuan

GENSITI adalah **asisten digital untuk memudahkan amal sholih pengurus PPG dan Muda-Mudi
se-Daerah Bekasi Timur** — bukan sekadar aplikasi administratif. Kalau berhasil sepenuhnya:
pengurus Kelompok tidak perlu lagi catat manual di buku/WA, laporan bulanan terkumpul ke
Daerah tanpa drama kejar-kejaran, dan semua jenjang (Kelompok → Desa → Daerah, plus PPG
sebagai pengawas paralel) punya alat yang benar-benar dipakai, bukan cuma "ada tapi nggak
disentuh".

**Masalah yang ingin diselesaikan** (kondisi sebelum GENSITI): semua serba manual — rekap
manual, input data manual, keuangan manual, absensi kegiatan manual (sering nggak direkap,
nggak disimpan, nggak dilaporkan sama sekali), monitoring manual. Ini PR besar yang sudah
lama dirasakan pengurus PPG dan Muda-Mudi.

**Siapa yang harus senang pakai app ini:** semua orang — Generus, pengurus Kelompok/Desa/
Daerah, PPG. Bukan cuma satu golongan yang diuntungkan sementara yang lain menanggung beban
input data.

---

## 2. Status Nyata Saat Ini (penting, jangan lupa)

**GENSITI belum pernah dipakai oleh organisasi nyata.** Sistem sudah production-grade secara
teknis (76 task selesai, ~12.000 baris kode, RLS aktif di 19 tabel, ~65 RPC, audit
keamanan RLS/API sudah pernah dilakukan — task #74), tapi semua pengujian sejauh ini
dilakukan Reno sendiri (tsc, eslint, cek manual di browser) — **belum pernah dijalankan oleh
pengurus sungguhan di lapangan.**

Ini artinya rasa "belum sempurna" yang dirasakan Reno bukan berarti fondasinya kosong —
fondasinya justru sudah cukup matang. Yang belum ada adalah **bukti nyata bahwa sistem ini
tahan dipakai orang banyak**, dan itu yang jadi fokus utama dokumen ini menuju rilis
September 2026.

**Catatan 19 Juli 2026:** ini bukan status yang "selesai dicek sekali lalu lupa". Reno ingin
audit, problem-solving, cari ide baru, dan optimasi jadi **kebiasaan berkala**, bukan
one-off menjelang rilis. Jadikan kebiasaan tiap beberapa minggu (atau tiap ada fitur besar
baru): cek ulang RLS/akses, cari celah UX yang belum kepikiran, dan cari cara
menyederhanakan/mengoptimalkan yang sudah ada — bukan cuma menambah baru.

---

## 3. Alur Kerja & Peran

Struktur organisasi & hak akses detail ada di [ARCHITECTURE.md §2, §6](ARCHITECTURE.md).
Ringkasnya: `Kelompok < Desa < Daerah`, dengan `PPG` sebagai jalur paralel read-only +
approval untuk konten tingkat Daerah, dan `Super Admin` murni pengelola sistem.

**Titik-titik yang selama ini paling terasa manual/ribet** (jadi prioritas dibuktikan
lewat penggunaan nyata, bukan dibangun ulang — fiturnya sudah ada):
- Absensi kegiatan — sering nggak direkap/disimpan/dilaporkan sama sekali secara manual
- Monitoring kegiatan
- Rekap & laporan kegiatan
- Sistem & laporan keuangan
- Biodata generus

**Gap yang diketahui — belum diaudit:** Reno sendiri belum pernah login sebagai role lain
(Ketua Desa, Bendahara, PPG, dll), jadi belum ada kepastian apakah hak akses tiap role
sudah pas di lapangan (bukan cuma benar secara kode). **Disepakati jadi sesi tersendiri**
setelah dokumen ini selesai — jalan-jalan cek akses tiap role satu per satu sebelum pilot
test (lihat §6).

---

## 4. Peta Fitur — Status & Prioritas

### Sudah ada & matang secara teknis (tinggal dibuktikan lewat pemakaian nyata)
Biodata generus, absensi/presensi (kode rotasi 6-digit + self check-in + auto-alpha),
laporan bulanan (v1→v4, per jenjang, drill-down gender/individu, export PDF/Excel),
keuangan + reimbursement (approval Bendahara), kegiatan + approval PPG, pengumuman + approval
PPG, dokumen, catatan pembinaan, notifikasi in-app + push + email, global search, audit log,
feature toggle per menu × jenjang, backup data (ekspor), mode perawatan sistem.

### Akan dibangun sebelum launch (disepakati 18 Juli 2026)
| Fitur | Alasan | Catatan scope |
|---|---|---|
| **Absensi QR Code** | Evolusi dari kode presensi 6-digit yang sudah ada — lebih cepat & minim salah ketik saat check-in massal | Generate QR dari `generate_kode_presensi` yang sudah ada, tambah scan kamera di sisi Generus |

### Ditunda ke versi pembaruan berikutnya (bukan prioritas September, revisi 19 Juli 2026)
| Fitur | Alasan ditunda | Catatan buat nanti |
|---|---|---|
| **Notifikasi WhatsApp** | Reno memutuskan ini masuk GENSITI v2, bukan blocking rilis pertama — fokus September tetap pembuktian sistem lewat pilot dulu | Kalau dikerjakan nanti: perbandingan provider resmi (WhatsApp Cloud API) vs pihak ketiga (Fonnte dkk) ada di riwayat keputusan §9 — tetap disarankan bungkus di satu fungsi `notify_whatsapp()` supaya provider gampang diganti |

### Ditunda dulu (dipertimbangkan lagi di lain waktu, bukan prioritas menuju September)
| Tools | Alasan ditunda |
|---|---|
| **Clerk** | Akan menggantikan Supabase Auth yang sudah jadi keputusan arsitektur eksplisit (lihat CLAUDE.md) — migrasi besar ke seluruh RLS/session/`lib/roles.ts` (36 test), risiko terlalu tinggi 6 minggu sebelum launch. Belum ada kebutuhan spesifik yang tidak bisa dipenuhi Supabase Auth |
| **Stripe** | Belum ada kebutuhan pemasukan/iuran/donasi online yang dikumpulkan lewat app — GENSITI saat ini sistem internal, bukan e-commerce |
| **Pinecone** | Vector DB untuk AI semantic search — belum ada fitur AI konkret yang direncanakan (`global_search` berbasis Postgres sudah menutup kebutuhan pencarian saat ini) |

### Akan ditambahkan untuk kesiapan rilis (bukan fitur produk, tapi infrastruktur)
**Sentry** (error monitoring) dan **UptimeRobot** (uptime alert) — ringan, tidak konflik
dengan arsitektur yang ada, langsung menambah rasa aman menjelang launch. Lihat §6.

---

## 5. Prinsip Desain (revisi 19 Juli 2026)

Arah baru disepakati Reno: cari inspirasi dari web app modern yang **menarik, modern,
menyenangkan, mudah digunakan, intuitif, interaktif, minimalis, dan dinamis** — bukan cuma
"rapi". Riset dilakukan 19 Juli 2026 lewat pencarian tren desain dashboard/SaaS 2026 (sumber
di §9).

### Referensi Konkret
| App | Kenapa relevan buat GENSITI |
|---|---|
| **Linear** | kecepatan & kejelasan navigasi — cocok untuk sidebar GENSITI yang menunya banyak (19+ menu) |
| **Notion** | struktur nested/collapsible — cocok untuk hierarki Daerah>Desa>Kelompok + drill-down laporan bulanan |
| **Stripe Dashboard** | dashboard data finansial padat tapi tetap jernih — cocok untuk modul Keuangan |
| **Vercel Dashboard** | minimalis, production-grade, satu stack sama GENSITI (Next.js + Vercel) — pattern-nya gampang diadaptasi langsung |
| **Asana** | micro-interaction kecil yang terasa "menyenangkan" saat menyelesaikan aksi (approve, submit) — nambah rasa fun tanpa norak |
| **Figma** | onboarding halus, UI minimalis yang fokus ke konten bukan ke "chrome"/dekorasi |

### Prinsip yang Diambil dari Tren Dashboard 2026
1. **Progressive disclosure** — tampilkan info minimum dulu, detail baru muncul saat
   diminta. Pas untuk laporan bulanan (ringkasan dulu → drill-down gender/individu saat
   diklik) dan hierarki organisasi (collapse/expand, bukan semua terbuka sekaligus)
2. **Jawab pertanyaan utama dalam ~2 detik** — hero metric dashboard harus langsung
   kejawab begitu halaman kebuka, 5–9 elemen penting, bukan puluhan angka sekaligus
   (RPC ringkasan yang sudah ada — `get_ringkasan_keuangan`, `get_jumlah_generus_aktif` —
   sudah pas untuk pola ini)
3. **Card interaktif** — bisa expand/collapse/trigger aksi, padding konsisten (24–32px),
   shadow lembut yang "mengangkat" bukan bikin ramai (sejalan dengan prinsip One UI di
   design brief lama, jadi tidak bertentangan — cuma diperkaya)
4. **Micro-interaction di momen penting** — feedback instan + sedikit "delight" saat aksi
   selesai (submit presensi, approve kegiatan, kirim laporan) — bikin app kerasa hidup,
   bukan kaku kayak formulir birokrasi
5. **Dark mode** — makin jadi ekspektasi standar 2026, worth dipertimbangkan sebagai opsi
   (bukan wajib di fase pertama, bisa nyusul)
6. **Cepat & ringan** — target render/load di bawah 2 detik, penting karena banyak generus
   akses dari HP dengan koneksi yang belum tentu kencang

### Yang Tetap Dipertahankan dari Design Brief Lama
- Warna aksen biru `#0381FE` — sudah final, **tidak berubah**
- Mobile-first tapi tetap nyaman diakses dari desktop
- **Jangan redesign dari nol.** Refine incremental per halaman, konfirmasi dulu scope-nya
  ke Reno sebelum ubah komponen yang dipakai lintas halaman (sidebar/topbar) — pelajaran
  dari percobaan reskin sebelumnya yang sempat ditolak meski awalnya disetujui verbal

[DESIGN_BRIEF_GENSITI.md](DESIGN_BRIEF_GENSITI.md) tetap jadi rujukan detail teknis
(kode warna, spacing) — section ini menyegarkan arah/filosofinya biar sejalan riset baru.
Prioritas eksekusi: **dashboard utama → sidebar/navigasi → halaman laporan & data**,
berjalan bareng roadmap fitur (§7), bukan proyek terpisah yang menyita semua waktu.

---

## 6. Kesiapan Rilis — Checklist

Checklist ini yang mengubah kecemasan "takut prematur/bocor data" jadi hal konkret yang bisa
dicentang, bukan kekhawatiran mengambang.

- [x] Audit RLS & endpoint API menyeluruh (task #74, sudah selesai — lihat ARCHITECTURE.md)
- [ ] Audit hak akses per role — Reno login & coba tiap role (Ketua/Sekretaris/Bendahara
      tiap jenjang, PPG, Super Admin) untuk pastikan akses sesuai kenyataan, bukan cuma
      benar di kode (sesi terpisah, lihat §3)
- [ ] Pasang **Sentry** — supaya error di production kelihatan real-time, bukan nunggu
      laporan manual dari pengguna. Free tier cukup untuk skala GENSITI (cek pricing
      terkini sebelum pasang, terakhir dicek konsep per Jan 2026)
- [ ] Pasang **UptimeRobot** — alert kalau situs down, terutama penting begitu dipakai
      organisasi nyata. Free tier cukup, tidak perlu ubah kode (cukup daftarkan URL
      production di dashboard mereka)
- [ ] Reno jalankan sendiri seluruh alur inti end-to-end sebagai "pengguna biasa" (bukan
      baca kode): input absensi kegiatan, generate laporan bulanan, catat transaksi
      keuangan, ajukan & approve reimbursement, approve kegiatan/pengumuman PPG
- [ ] **Pilot kilat 3–5 hari** dengan beberapa pengurus terpercaya (bukan full launch
      langsung) — cukup untuk menangkap bug fatal & kebingungan alur sebelum diumumkan ke
      seluruh Daerah
- [ ] Siapkan materi sosialisasi singkat (cara login, cara pakai fitur inti) untuk pengurus
      yang belum familiar — supaya adopsi tidak bergantung ke Reno menjelaskan satu-satu
- [ ] **Susun buku panduan / user guide** — panduan cara pakai per fitur (absensi, laporan
      bulanan, keuangan, approval, dst), idealnya per role biar nggak bikin bingung fitur
      yang nggak relevan buat mereka. Bisa dalam bentuk PDF/halaman in-app. Disepakati
      19 Juli 2026, dikerjakan menjelang rilis (lihat §7)

---

## 7. Roadmap Menuju Rilis September 2026

Draf urutan kerja ~6–7 minggu dari 18 Juli 2026. **Ini draf awal Claude — perlu dikoreksi
Reno**, terutama soal pilihan provider WhatsApp dan apakah urutannya realistis di tengah
kesibukan lain.

| Periode | Fokus |
|---|---|
| Minggu 1–2 (18 Jul – 1 Ags) | Audit akses per role (§3/§6) — pasang Sentry + UptimeRobot — mulai terapkan arah desain baru (§5) ke dashboard & sidebar |
| Minggu 3 (1–8 Ags) | Bangun absensi QR Code — lanjut polish desain |
| Minggu 4 (8–15 Ags) | Reno uji sendiri seluruh alur end-to-end sebagai pengguna biasa — lanjut polish desain halaman laporan/data |
| Minggu 5 (15–22 Ags) | Susun buku panduan/user guide + materi sosialisasi — buffer perbaikan desain |
| Minggu 6 (22–29 Ags) | **Pilot kilat 3–5 hari** dengan pengurus terpercaya — kumpulkan bug & feedback |
| Minggu 7 (29 Ags – 5 Sep) | Perbaiki temuan pilot — finalisasi buku panduan |
| **September 2026** | **Rilis ke seluruh organisasi** |

**Setelah rilis (GENSITI v2, belum dijadwalkan):** Notifikasi WhatsApp (lihat §4) jadi
kandidat utama pembaruan pertama pasca-launch.

---

## 8. Prompt Siap Pakai (untuk sesi Claude berikutnya)

Salin bagian ini di awal sesi baru kalau mau lanjut kerja sesuai pedoman ini:

```
Sebelum mulai kerja, baca dulu KONSEP_GENSITI.md (visi, roadmap, status kesiapan rilis),
lalu ARCHITECTURE.md (skema DB, RPC, hak akses) dan CLAUDE.md (konvensi & keamanan).
Kalau tugasnya menyentuh visual, baca juga DESIGN_BRIEF_GENSITI.md.

Kerjakan sesuai prioritas roadmap di KONSEP_GENSITI.md §7 kecuali aku minta sesuatu di
luar itu. Jangan bangun ulang fitur yang sudah ada (lihat §4) — refine/lengkapi yang
sudah ada. Selalu cek RLS & scope akses server-side untuk perubahan apapun yang menyentuh
data (lihat §6 ARCHITECTURE.md soal celah yang pernah ditemukan). Setelah selesai,
verifikasi dengan tsc --noEmit + eslint, dan kalau memungkinkan uji langsung di browser.
```

---

## 9. Log Perubahan

- **2026-07-18** — Draf pertama, disusun lewat tanya-jawab dengan Reno. Cakupan: visi,
  alur kerja, peta fitur (WA notif + QR absensi disepakati; Clerk/Stripe/Pinecone
  ditunda), kesiapan rilis, roadmap ke September 2026.
- **2026-07-19** — Review pertama Reno atas draf. Perubahan: (1) status kesiapan jadi
  kebiasaan audit/optimasi berkala, bukan one-off; (2) **notifikasi WhatsApp ditunda ke
  GENSITI v2** pasca-launch, bukan lagi prasyarat September — perbandingan provider resmi
  vs pihak ketiga di §4 tetap disimpan untuk dipakai nanti; (3) **§5 Prinsip Desain diganti
  total** — riset baru arah modern/menarik/menyenangkan/intuitif/interaktif/minimalis/
  dinamis (sumber: [Muzli — 50 Best Dashboard Design Examples 2026](https://muz.li/blog/best-dashboard-design-examples-inspirations-for-2026/),
  [Design Studio UI/UX — 12 Inspiring Web App UI Examples 2026](https://www.designstudiouiux.com/blog/web-app-design-examples/));
  (4) tambah item **buku panduan/user guide** ke checklist kesiapan rilis & roadmap Minggu
  5/7; (5) Reno menandai kemungkinan minta Claude eksekusi roadmap lebih mandiri (gaya
  PR-review, bukan konfirmasi tiap langkah) kalau sedang sibuk — lihat memori kolaborasi.
