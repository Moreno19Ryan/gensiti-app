# Design Brief — GENSITI UI/UX

Dokumen referensi desain untuk dipakai sebagai prompt ke Claude Code / Claude Design.
Gabungan inspirasi dari One UI 8.5, Linear, Notion, dan dashboard fintech modern,
disesuaikan dengan konteks GENSITI (aplikasi manajemen organisasi dengan struktur
hierarki berlapis dan data kompleks).

---

## Prompt Siap Pakai

```
Saya ingin redesign/perkaya UI GENSITI dengan menggabungkan beberapa inspirasi 
desain berikut. Sebelum mulai, tolong cek dulu design system yang sudah ada 
di codebase (components/, styling yang sudah dipakai) — jangan bikin dari nol 
kalau sudah ada pola established, tapi refine/perkaya secara konsisten.

## 1. Prinsip Dasar — Ambient Design (terinspirasi One UI 8.5)
- Interface bersih dan lega, elemen UI terasa responsif terhadap interaksi 
  (hover/focus/klik terasa halus, bukan kaku)
- Rounded corners besar di semua elemen (card, button, input field)
- Animasi/transisi halus antar state (buka modal, pindah tab, loading)
- Hierarki tipografi jelas — heading besar & tebal, body text mudah dibaca, 
  banyak whitespace antar section
- Target tap/klik area besar dan nyaman (thumb-friendly), karena banyak 
  generus akses lewat HP
- Palet warna: dominan putih/abu terang sebagai base, satu warna aksen 
  konsisten (hijau, mencerminkan identitas organisasi Islami)
- Card mengambang dengan shadow lembut, bukan border keras/tegas

## 2. Navigasi — terinspirasi Linear
- Sidebar navigasi compact tapi informatif, mengingat menu GENSITI banyak 
  (dashboard, absensi, generus, kegiatan, keuangan, pengumuman, dokumen, 
  catatan pembinaan, notifikasi, organisasi, ppg, users, dll)
- Status badge berwarna yang jelas dan konsisten (mis. status kehadiran 
  Hadir/Izin/Sakit/Alpha, status approval kegiatan)
- Kontras tinggi antara elemen aktif vs tidak aktif — penting untuk 
  highlight item yang butuh approval (PPG untuk kegiatan/pengumuman Daerah, 
  Bendahara untuk reimbursement)
- Pertimbangkan command palette (Cmd/Ctrl+K) untuk fitur global search 
  yang sudah ada

## 3. Struktur Data — terinspirasi Notion
- Tampilan nested/collapsible yang rapi untuk hierarki organisasi 
  (Daerah > Desa > Kelompok), plus jalur paralel PPG
- Toggle/collapse section untuk laporan bulanan yang datanya banyak 
  (biar tidak overwhelming saat drill-down per gender/individu)
- Tabel data dengan filter/sort yang mudah, untuk data generus (~83 aktif) 
  dan data pengurus

## 4. Dashboard & Laporan — terinspirasi dashboard fintech modern
- Card ringkasan/metric (hero stats) di bagian atas dashboard, memanfaatkan 
  RPC yang sudah ada: get_ringkasan_keuangan, get_jumlah_generus_aktif, 
  get_pertumbuhan_generus
- Grafik tren yang clean dan tidak berlebihan, untuk 
  get_tren_kehadiran_tahunan, get_rata_rata_kehadiran_6bulan
- Warna status konsisten: hijau = positif/aman, merah/kuning = perlu 
  perhatian (mis. tren kehadiran menurun, laporan belum diisi)

## Konteks Tambahan
- Role ada beberapa jenjang: Kelompok, Desa, Daerah, PPG (paralel, 
  read-only + approval), Super Admin (pengelola sistem, bukan pengurus 
  operasional) — desain harus bisa menyesuaikan tampilan per role tanpa 
  bikin komponen terpisah-pisah yang berlebihan
- Mobile-first, tapi tetap harus nyaman diakses dari desktop (banyak 
  pengurus kemungkinan input data dari laptop)
- Skala data: 19 tabel, ~65 RPC, ~82 user aktif — desain harus scalable, 
  bukan cuma cantik di data kecil/demo
```

---

## Ringkasan Peta Inspirasi (untuk referensi cepat)

| Elemen | Inspirasi | Kenapa Cocok untuk GENSITI |
|---|---|---|
| Nuansa & interaksi keseluruhan | One UI 8.5 | Ramah, lembut, nyaman — cocok organisasi kepemudaan, akses mayoritas dari HP |
| Navigasi/Sidebar | Linear | Menu sangat banyak (19 tabel), butuh navigasi cepat & jelas |
| Struktur data & hierarki | Notion | Hierarki organisasi berlapis (Daerah→Desa→Kelompok + PPG paralel) |
| Dashboard/ringkasan | Fintech dashboard | Banyak RPC ringkasan (keuangan, kehadiran) siap divisualisasikan |

---

## Warna Aksen Final (2026-07-18)

Setelah dibandingkan 3 opsi (biru yang sudah dipakai, biru logo resmi Samsung #1428A0,
biru interaktif ala One UI), Reno memilih **biru interaktif ala One UI** sebagai aksen
tetap aplikasi -- bukan hijau seperti disebut di draf awal brief ini.

Diterapkan lewat override skala `blue-*` bawaan Tailwind di `app/globals.css` (`@theme`),
supaya semua pemakaian `bg-blue-*`/`text-blue-*`/`border-blue-*` yang sudah ada di
seluruh app (termasuk halaman yang belum diporting dari mockup) otomatis ikut, tanpa
perlu sentuh tiap file:

```
blue-50  #EAF4FF   blue-500 #1A8CFF   blue-900 #0A3E7D
blue-100 #D2E9FF   blue-600 #0381FE   blue-950 #072951
blue-200 #A6D3FF   blue-700 #0468D1
blue-300 #70B8FF   blue-800 #0753A8
blue-400 #3D9EFF
```

`blue-600` (#0381FE) adalah warna dasar/DEFAULT. Untuk nilai hex literal yang tidak
lewat kelas Tailwind (gradient inline style, stroke chart Recharts, dsb), pakai hex
dari tabel ini secara langsung -- lihat contoh di `app/login/page.tsx` dan
`app/(dashboard)/dashboard/page.tsx`.

## Catatan

- Jangan redesign generik dari nol — GENSITI sudah production dengan 76 task 
  selesai dan komponen reusable di `components/`. Prioritaskan konsistensi 
  dengan yang sudah ada, sambil memperkaya sesuai prinsip di atas.
- Untuk halaman baru (misal "Hubungkan Akun Google" di Profil), pastikan 
  visualnya menyatu dengan halaman lain yang sudah ada, bukan terasa "tempelan".
