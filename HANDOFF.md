# GENSITI -- Handoff ke Claude Code

Dokumen ini merangkum status proyek per **16 Juli 2026** untuk melanjutkan kerja di Claude Code
(sebelumnya dikerjakan lewat Cowork). Baca file ini dulu sebelum mulai kerja apa pun.

---

## 1. Tentang Proyek

**GENSITI** (Smart Organization Management System) -- aplikasi manajemen organisasi untuk PPG
(Persatuan Pemuda... / organisasi induk keagamaan dengan struktur jenjang berlapis: Daerah >
Desa > Kelompok, plus jalur khusus PPG). Fungsi utamanya: data keanggotaan (Generus/anggota
muda & Pembina/PPG), absensi kegiatan, laporan bulanan, keuangan, dokumen, dan monitoring
sistem.

- **Repo**: `github.com/Moreno19Ryan/gensiti-app` (branch `main`)
- **Live**: `gensiti-app.vercel.app` -- auto-deploy dari push ke `main` lewat Vercel
- **Stack**: Next.js (App Router) + TypeScript + Supabase (Postgres, Auth, RLS, Realtime,
  Edge Functions) + Tailwind
- **Supabase project_id**: `ccyqgcfjmzgkmkczuydv`
- **Ukuran kode**: ~12.000 baris di `app/`, ~2.000 di `lib/`, ~2.200 di `components/`
- **Skala pengguna**: ~82 akun aktif (per audit terakhir)

### Struktur folder inti
```
app/(dashboard)/     -- semua halaman menu (absensi, generus, keuangan, monitoring, dst.)
app/api/              -- API routes server-side (pakai service role key utk bypass RLS,
                          dengan verifikasi manual identitas pemanggil di tiap route)
app/login, app/lupa-password  -- alur autentikasi (di luar dashboard layout)
lib/                  -- helper inti: roles.ts (hierarki akses), auth.ts, feature-toggles.ts,
                          user-context.tsx (session), export.ts (PDF/Excel), audit.ts
components/           -- komponen reusable (Modal, PasswordInput, LaporanBulananModal, dst.)
```

### Aturan penting yang HARUS diikuti (dari instruksi proyek Reno)
> Kerjakan semua dengan teliti dan hati-hati. Selalu cek ulang hasil pekerjaan setelah
> melakukan update. Setelah selesai, semua isi proyek dicek ulang lagi dan pastikan aplikasi
> web berjalan dengan baik dan optimal.

Praktik yang sudah berjalan dan sebaiknya diteruskan:
- Setiap fix/fitur diverifikasi dengan `tsc --noEmit` + `eslint` sebelum commit (bukan cuma
  baca kode).
- Kalau memungkinkan, uji langsung di browser (live site) setelah deploy, bukan cuma percaya
  logika di kepala -- beberapa bug (race condition, dsb.) hanya kelihatan saat direproduksi
  nyata.
- Komentar kode di proyek ini SENGAJA panjang dan naratif (menjelaskan histori keputusan/bug),
  bukan cuma deskriptif. Pertahankan gaya ini saat menambah kode baru di file yang sudah
  punya gaya komentar begini.
- Migrasi database dilakukan lewat Supabase MCP (`apply_migration`), bukan file migrasi lokal
  (folder `supabase/migrations` tidak dipakai di proyek ini).

### Isu lingkungan yang perlu diketahui (BUKAN bug aplikasi)
- Repo Git di komputer Windows Reno pakai `core.autocrlf=true` bawaan Git -- ini bisa bikin
  `git status` menampilkan file "modified" padahal isinya identik (cuma beda LF/CRLF). Kalau
  ketemu ini, cek dulu pakai `git diff --stat` atau `git hash-object` vs `git ls-tree HEAD`
  sebelum menyimpulkan ada perubahan nyata.
- Push ke GitHub dari sandbox terpisah (kalau dipakai) tidak selalu punya kredensial git --
  push sebaiknya lewat mesin asli Reno.

---

## 2. Yang Baru Saja Dikerjakan

### Sesi 28 Juli 2026 (lanjutan 8) — Bugfix kritis: keyboard HP menutup tiap 1 karakter di SEMUA form modal

Laporan Reno: di PWA, pas nambah Generus dan ngetik di field Nama Lengkap, keyboard virtual
langsung menutup setelah 1 huruf, berulang tiap karakter -- harus tap manual balik ke field
tiap kali. Diminta cek juga halaman lain siapa tahu ada bug serupa.

- **Root cause ditemukan di `components/Modal.tsx`** (komponen modal bersama, dipakai 13
  halaman: Generus, Absensi, Kegiatan, Data Pembina, Profil, Monitoring, Keuangan, Pengumuman,
  Dokumen, Organisasi, PPG, FAQ, `PengajuanIzinPanel`) -- BUKAN cuma bug di halaman Generus.
  `useEffect` focus-trap punya dependency array `[open, onClose]`. Karena pemanggil hampir
  selalu mengoper `onClose` sbg inline arrow function (`onClose={() => setModalOpen(false)}`),
  referensinya baru tiap render induk. Tiap keystroke di form → state berubah → induk re-render
  → `onClose` baru → effect ini dianggap "berubah" → re-run → `panelRef.current?.focus()`
  merebut fokus dari input yang sedang diketik ke panel modal (`<div>` biasa) → browser
  mobile langsung menutup keyboard virtual krn fokus pindah dari elemen teks.
- **Fix**: `onClose` disimpan lewat `useRef` (di-update di `useEffect` terpisah tanpa dependency
  array, BUKAN langsung di badan render -- lint `react-hooks/refs` versi baru melarang tulis
  ref saat render), effect focus-trap utama diubah jadi cuma depend `[open]`. Pola ini meniru
  persis `components/KonfirmasiHost.tsx` yang sudah benar dari awal (jadi referensi perbaikan,
  sesuai komentar yang sudah ada di `Modal.tsx`).
- **Dicek juga tempat lain** yang berpotensi bug serupa: `grep role="dialog"` di seluruh
  codebase cuma kena `Modal.tsx` & `KonfirmasiHost.tsx` (KonfirmasiHost sudah benar).
  `ExportPreviewModal.tsx` & `LaporanBulananModal.tsx` (modal custom lain yang match pola
  `fixed inset-0 z-*`) TIDAK punya focus-trap/`.focus()` sama sekali, jadi tidak kena bug ini.
  Jadi bug ini genuinely cuma di satu tempat, tapi berdampak ke hampir semua form di app.
- **Verifikasi dgn bukti before/after** (bukan cuma klaim): halaman preview sementara
  (`app/modal-bug-preview-temp`, dihapus setelah selesai) + Playwright ketik 4 karakter
  berturut-turut sambil cek `document.activeElement` tiap keystroke. SEBELUM fix: fokus lompat
  ke `<div>` panel modal setelah karakter pertama, karakter selanjutnya tidak masuk ke field
  sama sekali (persis gejala yang dilaporkan Reno). SESUDAH fix: fokus tetap di `<input>` di
  semua 4 keystroke, value ke-update benar. `tsc`/`eslint` bersih.

### Sesi 28 Juli 2026 (lanjutan 7) — Redesain nav tab Berita jadi "liquid glass"/glassmorphism

Permintaan Reno: tab sumber di halaman Berita diubah jadi model kaca (terinspirasi iOS Liquid
Glass & Samsung One UI), ikon tiap tab pakai favicon resmi tiap situs, + tab "Semua". Murni
redesain visual, tidak menyentuh Edge Function/pg_cron.

- **Riset dulu sebelum coding** (sesuai instruksi Reno): dicek pola tab yang sudah ada
  (segmented-control Akun/Biodata di `generus/page.tsx` — dipakai sebagai basis struktur,
  bukan bikin baru), dicek keamanan `backdrop-filter` (aman sejak lama di Chrome/Safari/
  Firefox modern), dan dicek ketersediaan favicon resmi tiap 4 sumber lewat `net.http_get`
  langsung ke tag `<image>` RSS feed / `favicon.ico` — semua 4 ternyata ada & bisa di-hotlink
  apa adanya.
- **Mockup ditunjukkan dulu** sebagai HTML interaktif (dipublish sbg Artifact) sebelum coding,
  sesuai instruksi "tunjukkan rencana/mockup dulu" -- pakai lencana inisial placeholder krn
  Artifact API tidak bisa memuat gambar dari domain luar (CSP), dijelaskan eksplisit ke Reno.
  3 poin keputusan desain ditanyakan lewat mockup ini (posisi tab "Semua", bentuk bingkai
  ikon, jenis animasi) -- semua dijawab "gas lanjutkan" (setuju rekomendasi default).
- Implementasi: track tab jadi `backdrop-blur-xl` + semi-transparan + `rounded-full` + border
  highlight, chip aktif mengambang (shadow+ring). Tab "Semua" ditambah sbg union type
  `TabSumber` khusus UI (bukan nilai valid kolom `sumber` di database), ditaruh PALING KANAN
  (bukan default) supaya tidak diam-diam mengubah keputusan lama (LDII Kota Bekasi = default).
  Fallback lencana inisial (`SUMBER_INISIAL`) kalau favicon gagal dimuat.
- **Verifikasi favicon nyata TIDAK bisa dipastikan render dari sandbox ini** -- dicek lewat
  Playwright, 3 dari 4 favicon eksplisit gagal dimuat (`net::ERR_TUNNEL_CONNECTION_FAILED`,
  sandbox ini memang blokir domain eksternal, sudah berkali-kali dikonfirmasi sepanjang sesi
  ini) dan fallback ke lencana inisial terlihat rapi. Sudah dipastikan lewat `net.http_get`
  dari database bahwa keempat URL favicon itu VALID (200 OK) -- tinggal Reno cek preview
  Vercel (akses internet penuh) utk pastikan favicon asli tampil benar, bukan cuma lencana
  inisial fallback.
- `tsc`/`eslint` bersih, logic tab-switching (termasuk "Semua" menggabungkan data lintas
  sumber) diverifikasi lewat halaman preview sementara + Playwright, dihapus setelah selesai.

### Sesi 28 Juli 2026 (lanjutan 6) — Dua fitur baru: Bookmark Berita & FAQ/Panduan

Sebelum coding, dicek dulu pola reusable di codebase: tidak ada accordion/bookmark sebelumnya,
tapi pola RLS "data milik sendiri" (`push_subscriptions`) dan toolkit CRUD-admin
(`Modal`+`toast`+`konfirmasi`+`logAudit`, dipakai Dokumen/Pengumuman) sudah established dan
di-reuse langsung, bukan dibuat ulang.

- **Bookmark Berita** (`berita_disimpan`): ikon 🔖 toggle di tiap kartu Berita Organisasi (semua
  4 sumber), halaman baru `app/(dashboard)/berita/tersimpan/page.tsx` (nested route, bukan menu
  sidebar baru). Tabel pakai `link` sebagai identifier + snapshot metadata (judul/sumber/
  tanggal/gambar) -- BUKAN FK ke `berita_organisasi.id`, supaya bookmark tidak ikut rusak kalau
  baris cache RSS-nya berubah. RLS: satu policy `user_id = (select auth.uid())`, pola identik
  `push_subscriptions`.
- **FAQ/Panduan** (`faq`): accordion pertanyaan-jawaban, terbuka semua jenjang termasuk Generus
  biasa. **Keputusan desain yang diubah dari rencana awal** (dikonfirmasi implisit lewat "jalankan
  keduanya" setelah proposal ditunjukkan): SATU halaman (bukan 2 halaman publik+admin terpisah
  seperti diminta awal) — tombol +Tambah/Edit/Hapus cuma muncul kalau Super Admin, persis pola
  Dokumen/Pengumuman yang sudah established di app ini. RLS pakai `get_user_role()` (fungsi yang
  sudah ada, dipakai `feature_toggles`/`system_config`) -- bukan tulis ulang subquery join.
  `urutan` FAQ diatur lewat input angka biasa (bukan drag-and-drop) supaya tidak over-engineer.
- Menu FAQ (`menuKey: 'faq'`) langsung dimasukkan ke `MENU_GROUPS` di halaman Pengaturan Fitur
  sejak awal dibuat -- pelajaran dari kelalaian yang sama persis terjadi di menu Berita
  sebelumnya (baru ketahuan & diperbaiki belakangan).
- Verifikasi: `tsc`/`eslint` bersih di semua file yang diubah/ditambah, grants+RLS kedua tabel
  dicek via `information_schema.role_table_grants` (pelajaran dari bug grants `berita_ldii`
  lama, diterapkan sejak awal migrasi kali ini), halaman preview sementara + Playwright utk
  kedua fitur (toggle bookmark, accordion single-open, search/filter kategori, visibility
  tombol admin) -- dihapus setelah selesai. Sempat ketemu artefak false-positive saat cek dark
  mode (`addInitScript` men-set class sebelum hydration React lalu ke-reset root layout `<html>`
  JSX-nya) -- bukan bug aplikasi, cuma metode testing yang salah, diperbaiki dengan
  `page.evaluate()` SETELAH `networkidle` (pola yang sudah terbukti benar di sesi-sesi sebelumnya).

### Sesi 28 Juli 2026 (lanjutan 5) — Tambah sumber ke-4: DPD LDII Kota Bekasi (paling relevan lokal, jadi tab default)

Temuan Reno: `ldiibekasikota.or.id` adalah situs resmi DPD LDII Kota Bekasi (sudah pernah ada di
bio Instagram GENSITI) — SANGAT relevan karena GENSITI untuk Generus Bekasi Timur (bagian dari
Kota Bekasi), beritanya soal kegiatan PAC/PC spesifik wilayah Bekasi, bukan nasional.

- **Riset**: `https://ldiibekasikota.or.id/feed/` VALID (WordPress 6.9.5, pola identik LDII
  nasional termasuk wording boilerplate Yoast "appeared first on"), artikel terbaru 24 Juli 2026
  (4 hari sebelum sesi ini) — aktif, cadence-nya di antara LDII nasional dan ASAD. Kategori
  bervariasi (Berita Kegiatan, Dakwah, Berita Daerah, dst). Karena pola persis sama dengan LDII
  nasional, **tidak butuh penanganan khusus baru** (beda dengan kasus SENKOM/Blogger sebelumnya)
  — tinggal 1 baris config di `SOURCES`.
- **Keputusan tata letak** (2 opsi diajukan ke Reno sebelum eksekusi, sesuai instruksi "tunjukkan
  usulan dulu"): Opsi A (tab biasa tapi jadi default + badge penanda) vs Opsi B (section "Sorotan
  Lokal" terpisah di atas tab, selalu tampil terlepas tab aktif). **Reno pilih Opsi A** — tab
  "LDII Kota Bekasi" ditaruh paling kiri, jadi `activeSumber` default saat halaman dibuka (bukan
  LDII nasional lagi), plus ikon 📍 di label tab-nya. Tidak menambah komponen/lapisan render baru.
- Migrasi `berita_organisasi_tambah_sumber_ldii_bekasi` (extend check constraint tambah
  `'ldii-bekasi'`), Edge Function `fetch-berita-organisasi` tambah 1 entry di `SOURCES` (tanpa
  `truncateRingkasan`, karena WordPress auto-potong seperti LDII/ASAD). Tidak perlu ubah pg_cron
  sama sekali — job yang sudah ada otomatis memanggil source baru karena Edge Function loop atas
  `SOURCES`.
- Diuji manual langsung ke production: 10 artikel ter-upsert bersih (0 boilerplate, 0 entity
  mentah), 2 dari 3 artikel terbaru punya gambar asli (regex `<img>` dari `content:encoded`,
  proxy `i0.wp.com` Jetpack — tetap hotlink, bukan salinan).
- Frontend: `SUMBER_LIST` diurutkan ulang (`'ldii-bekasi'` pertama), `activeSumber` default
  diganti dari `'ldii'` ke `'ldii-bekasi'`, tab button dapat ikon 📍 kondisional. `lib/types.ts`:
  `SumberBeritaOrganisasi` tambah `'ldii-bekasi'`.
- Verifikasi: `tsc`/`eslint` bersih, halaman preview sementara + Playwright (tab default benar
  menampilkan `ldii-bekasi`, label tab berisi ikon pin, light/dark mode rapi) — dihapus setelah
  selesai.

### Sesi 28 Juli 2026 (lanjutan 4) — Berita LDII digeneralisasi jadi "Berita Organisasi" (multi-sumber: LDII, PERSINAS ASAD, SENKOM)

Berawal dari upgrade kecil (tombol Bagikan WhatsApp + ikon asli, filter kategori, pencarian di
halaman Berita LDII — PR #30, #31, sudah merge), lalu Reno minta riset 2 organisasi afiliasi
baru (PERSINAS ASAD, SENKOM Mitra Polri) apakah punya RSS feed yang bisa dipakai pola serupa.

- **Riset feed baru** (semua lewat `net.http_get` dari database, bukan tebakan):
  - **PERSINAS ASAD** (`https://official.asad.or.id/feed/`) — VALID, WordPress, update harian.
    `www.berita.asad.or.id` (yang tadinya dikira sumber sebenarnya) TIMEOUT total dari jaringan
    Supabase — tidak dipakai, tidak perlu, karena `official.asad.or.id` sendiri sudah lengkap.
    **Beda penting dari LDII**: feed ASAD TIDAK punya `<content:encoded>` sama sekali — jadi
    tidak ada mekanisme thumbnail apapun, `gambar_url` selalu `null` utk sumber ini. Kategori
    di 10 artikel terbaru selalu sama ("PERSINAS ASAD") — filter kategori kurang berguna utk
    sumber ini dibanding LDII.
  - **SENKOM Mitra Polri** (`https://www.senkom.or.id/feeds/posts/default?alt=rss`) — VALID,
    platform Blogger (bukan WordPress). Update jauh lebih jarang/tidak teratur dari LDII/ASAD
    (jeda bisa 3-4 minggu) — bukan mati seperti forsgi.com (mati sejak 2022), tapi cadence
    beda jauh. **Temuan struktural penting**: `<description>` Blogger BUKAN cuplikan seperti
    WordPress — isinya ARTIKEL LENGKAP (dicek: 4.000–11.000+ karakter per item). Kalau
    diperlakukan sama seperti LDII/ASAD, itu MELANGGAR prinsip hak cipta "cuma cuplikan".
    **Dikonfirmasi eksplisit dgn Reno**: solusinya potong ringkasan SENDIRI di sisi kita
    (280 karakter pertama, potong di batas kata + elipsis), bukan mengandalkan pemotongan dari
    sumber (karena memang tidak ada). Thumbnail pakai `<media:thumbnail url="...">` (field
    resmi Blogger, bukan regex dari body).
- **Keputusan arsitektur** (ditanyakan eksplisit ke Reno via pertanyaan, bukan diasumsikan):
  generalisasi jadi SATU tabel (`berita_organisasi`, kolom `sumber`) + SATU Edge Function
  (`fetch-berita-organisasi`, loop atas array `SOURCES` config) — dipilih Reno dibanding bikin
  tabel/function terpisah per sumber. Nama tabel awalnya diusulkan `berita_eksternal`, Reno
  ganti jadi `berita_organisasi`. Frontend digabung jadi satu halaman `/berita` ("Berita
  Organisasi") dengan tab pemilih sumber, bukan 3 menu terpisah di sidebar (juga pilihan Reno).
- **Migrasi**: `berita_organisasi_generalisasi_multi_sumber` (tabel baru + RLS + GRANT eksplisit
  dari awal, sudah belajar dari bug grants `berita_ldii` — tidak diulang kali ini + copy data
  LDII lama), `berita_organisasi_tambah_sumber_senkom` (extend check constraint), pg_cron job
  lama `fetch_berita_ldii_cron` di-unschedule, ganti `fetch_berita_organisasi_cron` (timeout
  30 detik, pola sama). Tabel `berita_ldii` lama SENGAJA belum di-drop — nunggu tabel baru
  terbukti stabil dulu di production, drop-nya migrasi terpisah (perlu approval eksplisit lagi).
- **3 bug nyata ditemukan & diperbaiki lewat testing manual berulang thd Edge Function
  (bukan asumsi kode benar)**:
  1. `fast-xml-parser` punya batas pengaman "entity expansion" (default 1000) yang kelampauan
     oleh banyaknya entity di HTML ter-embed description SENKOM → error "Entity expansion
     limit exceeded". Fix: `processEntities: false` di parser, semua decode entity diserahkan
     ke fungsi sendiri (`decodeHtmlEntities`).
  2. Konsekuensi fix #1: teks yang diterima jadi masih ter-escape (`&lt;p&gt;` literal, bukan
     `<p>`) — urutan `stripHtml` lalu `decodeHtmlEntities` (urutan lama, cocok utk LDII/ASAD)
     jadi salah utk SENKOM karena `stripHtml` dijalankan SEBELUM tag di-decode jadi nyata.
     Fix: dibalik jadi decode-dulu-baru-strip, berlaku utk semua sumber.
  3. Regex `bersihkanRingkasan` (pembersih boilerplate Yoast) TERNYATA punya bug lama yang baru
     ketahuan sekarang: marker `"[…]"` di depan "The post..." diwajibkan (bukan opsional) di
     regex lama — cocok utk LDII (yang memang sering punya marker ini di cuplikannya) tapi
     GAGAL TOTAL utk ASAD (yang tidak pernah punya marker itu, cuplikannya cuma berhenti bersih
     + baris baru) — boilerplate ASAD lolos tidak terpotong sama sekali sampai fix ini
     (dibuktikan lewat query SQL langsung ke tabel, bukan asumsi). Fix: marker dibuat opsional
     sebagai satu grup `(?:\[?…\]?\s*)?`.
- Semua 3 bug di atas ditemukan lewat re-test manual berulang thd Edge Function (panggil,
  cek isi tabel via SQL, ulangi) — bukan cuma baca kode dan asumsi benar.
- Frontend: `app/(dashboard)/berita-ldii/` dipindah jadi `app/(dashboard)/berita/`, tab
  switcher (LDII/PERSINAS ASAD/SENKOM Mitra Polri) di atas kartu, filter kategori & pencarian
  & tombol Bagikan WhatsApp (dari kerjaan sebelumnya) di-scope per tab aktif, filter/pencarian
  otomatis reset saat ganti tab (supaya tidak nyangkut ke kategori yang tidak ada di sumber
  baru). `lib/types.ts`: `BeritaLdii` → `BeritaOrganisasi` (+ field `sumber`).
- **Ditemukan sekalian saat rename `menuKey`**: menu ini (`berita-ldii`) ternyata dari awal
  dibuat TIDAK PERNAH masuk `MENU_GROUPS` di `app/(dashboard)/pengaturan-fitur/page.tsx` —
  Super Admin sebenarnya belum pernah punya UI untuk mematikan menu ini per jenjang. Ditambahkan
  sekalian (`menu_key: 'berita-organisasi'`) saat rename, bukan bug baru dari sesi ini.
- Verifikasi: `tsc`/`eslint` bersih di semua file yang diubah, halaman preview sementara +
  Playwright (tab switching mengisolasi data per sumber dengan benar, filter reset saat ganti
  tab, kategori filter & pencarian & tombol Bagikan berfungsi, light/dark mode rapi) — dihapus
  setelah selesai. Data live di production sudah dicek langsung lewat SQL: 0 baris tersisa
  dengan boilerplate "The post" atau entity mentah `&nbsp;`/`&amp;` di ketiga sumber.

### Sesi 28 Juli 2026 (lanjutan 2) — Berita LDII: bersihkan teks feed, tambah gambar, redesain kartu

Feedback langsung dari Reno setelah lihat halaman live: tampilannya "kurang menarik" (tidak
ada gambar) dan ternyata ada sisa teks kotor di ringkasan.

- **Ditemukan lewat cek langsung ke feed mentah** (`net.http_get` dari database, bukan
  tebakan): (1) entity HTML `&#8230;` tidak ke-decode, tampil harfiah sebagai `[&#8230;]`;
  (2) plugin Yoast SEO di situs sumber nempelin boilerplate otomatis `"The post X appeared
  first on Lembaga Dakwah Islam Indonesia."` di ekor tiap ringkasan; (3) feed TIDAK punya
  field gambar terpisah (`<enclosure>`/`media:content` tidak ada) — satu-satunya gambar ada
  di dalam `<content:encoded>`, field yang tadinya dijanjikan "tidak pernah disentuh sama
  sekali".
- **Keputusan hak cipta (dikonfirmasi ulang eksplisit dgn Reno)**: boleh regex keluarkan URL
  `<img src="...">` PERTAMA dari `content:encoded` sebagai thumbnail -- setara ekstraksi
  `og:image` pada link preview media sosial (hotlink ke gambar yang sudah di-hosting publik
  di server LDII, BUKAN salinan teks/konten). Teks `content:encoded` itu sendiri tetap TIDAK
  PERNAH disimpan/diekspos ke field manapun -- cuma satu string URL yang diambil, sisanya
  langsung dibuang.
- Migrasi `berita_ldii_tambah_gambar_url` (kolom baru `gambar_url text`, nullable), Edge
  Function `fetch-berita-ldii` di-update (decode HTML entity, potong boilerplate Yoast,
  ekstrak gambar), dipanggil ulang manual utk backfill 10 baris yang sudah ada -- **2 dari 10
  artikel** ternyata punya gambar terdeteksi (wajar, tidak semua artikel LDII ada foto).
- **Redesain kartu** (`app/(dashboard)/berita-ldii/page.tsx`) -- gaya majalah: 1 kartu
  unggulan besar (berita terbaru, gambar 16:9/21:9) + grid galeri 1-2 kolom utk sisanya
  (gambar 24x24/28x28 thumbnail), badge "🔥 Baru" merah utk artikel <48 jam, placeholder
  gradient + ikon 📰 kalau tidak ada gambar (bukan kotak kosong), seluruh kartu jadi link
  yang bisa diklik (bukan cuma teks "Baca Selengkapnya"-nya).
- **Catatan jujur soal verifikasi visual**: gambar hotlink ke ldii.or.id TIDAK bisa saya lihat
  render sungguhan dari sandbox Claude Code ini (jaringan sandbox diblokir ke domain luar,
  sama seperti riset RSS sebelumnya) -- layout/struktur/badge sudah dicek lewat screenshot
  Playwright, tapi gambar aslinya baru bisa dipastikan tampil benar lewat preview Vercel
  (akses internet penuh), perlu dicek langsung oleh Reno.
- `tsc`, `eslint` (sempat ketangkap 1 error murni: `Date.now()` dipanggil langsung di badan
  render melanggar aturan purity komponen, diperbaiki pakai lazy `useState` snapshot sekali
  saat mount — pola sama seperti `sisaDetik` di `PresensiPanel.tsx`), `npm run test`,
  `npm run build` semua sukses.

### Sesi 28 Juli 2026 (lanjutan) — Menu "Berita LDII": mirror RSS feed publik ldii.or.id

Ide dari Reno (dikonfirmasi ada RSS feed valid via sesi Claude.ai terpisah yang punya akses
browsing -- environment Claude Code ini sendiri dibatasi jaringannya, tidak bisa fetch situs
sembarangan). Fitur baru: mirror ringkasan berita organisasi induk (LDII) ke dalam GENSITI,
diperbarui otomatis.

**Prinsip hak cipta (disepakati eksplisit sebelum kode ditulis)**: HANYA cuplikan (title,
description WordPress yang SUDAH terpotong otomatis, link, tanggal, kategori) yang pernah
disimpan -- `<content:encoded>` (isi artikel LENGKAP milik LDII) **secara sengaja tidak
pernah dibaca sama sekali** di kode Edge Function, bukan cuma "dibaca lalu tidak disimpan".
Pola setara preview link media sosial: cuplikan + link ke sumber asli, bukan salinan penuh.

**Migrasi database** (`berita_ldii_rss_mirror` + 1 migrasi susulan kecil):
- Tabel baru `berita_ldii` (guid unique utk upsert idempotent, judul, ringkasan, link,
  tanggal_publish, kategori text[]). RLS: SELECT utk `authenticated` semua jenjang (termasuk
  Generus -- berita organisasi induk relevan buat semua, bukan cuma Pengurus), TANPA policy
  tulis (cuma service role dari Edge Function yang menulis)
- **Ketemu bug saat testing langsung** (bukan cuma dites di kepala): tabel baru TERNYATA
  tidak otomatis warisi default privileges project seperti tabel lama (`push_subscriptions`
  dkk sudah punya GRANT SELECT/INSERT/UPDATE/DELETE ke `authenticated`/`service_role`, tabel
  baru ini TIDAK) -- RLS policy saja tidak cukup tanpa GRANT dasar, dua lapisan terpisah.
  Ketahuan lewat pesan error asli `"permission denied for table berita_ldii"` saat tes
  manual, diperbaiki via migrasi susulan `berita_ldii_grant_privileges`
- **Ketemu bug kedua**: `net.http_post` default timeout 5 detik terlalu pendek utk Edge
  Function yang fetch KELUAR ke situs pihak ketiga (ldii.or.id) + parse + upsert -- dinaikkan
  ke 30 detik (`fetch_berita_ldii_cron_naikkan_timeout`)
- Fungsi tipis `fetch_berita_ldii_cron()` -- pola identik `notify_push`/`send_reminder_*`
  yang sudah ada (`net.http_post` ke Edge Function, otorisasi header `x-internal-secret`,
  bukan JWT)
- pg_cron job `fetch-berita-ldii`, jadwal tiap 4 jam (`0 */4 * * *`)
- **Diverifikasi jalan sungguhan** (bukan cuma "seharusnya jalan"): dipanggil manual 3x
  selama debugging, akhirnya berhasil fetch **10 artikel asli** dari feed sungguhan
  (tanggal 24-27 Juli 2026, kategori & ringkasan bersih tanpa sisa tag HTML) -- data ini
  TETAP tersimpan di production sebagai starter content, bukan dihapus lagi

**Edge Function baru** `fetch-berita-ldii` (Deno, `fast-xml-parser`) -- fetch, parse RSS 2.0,
upsert by guid. Komentar eksplisit di kepala file soal field mana yang boleh/tidak boleh
pernah dibaca.

**Frontend**: halaman baru `app/(dashboard)/berita-ldii/page.tsx` (nav item baru, semua
jenjang termasuk Generus, menuKey `berita-ldii` -- fail-open by design jadi tidak perlu seed
`feature_toggles`), card list judul/ringkasan/kategori/tanggal + tombol "Baca Selengkapnya"
selalu `target="_blank"` ke ldii.or.id (tidak pernah render isi lengkap di dalam app).
Visual dicek lewat halaman preview sementara (dihapus lagi) + screenshot Playwright pakai
data asli hasil fetch. `tsc`, `eslint`, `npm run test`, `npm run build` semua sukses.

### Sesi 28 Juli 2026 — Redesain alur Tambah Kegiatan: jendela presensi otomatis berbasis waktu

Permintaan besar langsung dari Reno, menyentuh alur otorisasi inti (`submit_presensi` dkk) --
dikerjakan lewat 1 migrasi database (`kegiatan_jendela_presensi_otomatis`, diterapkan setelah
"OK, jalankan" eksplisit) + perubahan frontend di 3 file. Sebelum eksekusi, RPC yang ada
(`submit_presensi`, `submit_presensi_rfid`, `generate_kode_presensi`) dan trigger auto-alpha
dibaca LANGSUNG dari `pg_proc` production (bukan ditebak) supaya perubahannya presisi.

**Keputusan desain** (dikonfirmasi eksplisit dgn Reno lewat AskUserQuestion):
1. "Templat kegiatan" = preset jenis kegiatan yang pre-fill field umum (bukan sistem
   template tersimpan terpisah yang jauh lebih besar scope-nya)
2. Status kegiatan & jendela presensi dihitung LIVE dari waktu (bukan job terjadwal
   pg_cron) -- lebih sederhana, tanpa infrastruktur produksi baru, trade-off diterima:
   auto-alpha baru tersimpan permanen saat ada yang membuka halaman berikutnya

**Migrasi database** (`kegiatan_jendela_presensi_otomatis`):
- Kolom baru `kegiatan.lokasi_maps_url` (text) & `kegiatan.presensi_buka_lebih_awal_menit`
  (integer, default 0, CHECK IN (0,15,30,60))
- `submit_presensi` & `submit_presensi_rfid`: cek `status = 'ongoing'` diganti cek jendela
  waktu (`tanggal_mulai - presensi_buka_lebih_awal_menit` s/d `tanggal_selesai`)
- RPC baru `sinkron_status_kegiatan_jika_selesai(p_kegiatan_id)` -- housekeeping idempotent,
  dipanggil client saat kegiatan sudah lewat tanggal_selesai, cuma `UPDATE status='selesai'`
  SEKALI supaya trigger `trg_auto_alpha_generus_kegiatan_selesai` yang **sudah ada** (TIDAK
  disentuh sama sekali di migrasi ini) otomatis jalan dari situ
- Diverifikasi: `get_advisors` tidak ada temuan baru (`sinkron_status_kegiatan_jika_selesai`
  cuma executable oleh `authenticated`, bukan `anon` -- sesuai desain), functiondef dibaca
  ulang dari `pg_proc` utk konfirmasi perubahan benar-benar diterapkan

**Frontend:**
- `lib/kegiatan-status.ts` (+ 15 test) -- `computeKegiatanStatus`, `isPresensiWindowOpen`,
  `isTepatWaktu`, dipakai bersama oleh `kegiatan/page.tsx`, `PresensiPanel.tsx`,
  `absensi/page.tsx`
- `kegiatan/page.tsx`: dropdown "Jenis Kegiatan" (preset, hanya saat Tambah bukan Edit),
  validasi tanggal tidak boleh sebelum hari ini (hanya saat Tambah), field Link G-Maps,
  dropdown "Buka Presensi Lebih Awal", dropdown Status manual **dihapus** (jadi teks
  read-only "otomatis, mengikuti jadwal"), badge status & filter & export kolom Status
  semua pindah ke `computeKegiatanStatus()`, panggil RPC sync di `loadData()`
- `PresensiPanel.tsx`: gate render ganti dari `kegiatan.status !== 'ongoing'` jadi
  `!isPresensiWindowOpen(kegiatan)`
- `absensi/page.tsx`: badge "Tepat Waktu"/"Terlambat" di baris hadir, modal wajib pilih
  alasan (Lupa Absen/Kendala Teknis/Lainnya) + catatan sebelum koreksi kehadiran tersimpan
  (dulu teks generik hardcoded), panggil RPC sync di `loadKegiatan()`
- Visual diverifikasi lewat halaman preview sementara (dihapus lagi) + screenshot Playwright
  utk 3 potongan UI baru (form preset+maps+buka-lebih-awal, badge Tepat Waktu/Terlambat,
  modal alasan koreksi). `tsc`, `eslint`, `npm run test` (73 test), `npm run build` semua
  sukses.

### Sesi 27 Juli 2026 (lanjutan 5) — Pratinjau+Cetak langsung di semua export, filter jenis kelamin Data Generus

Permintaan langsung dari Reno (bukan hasil audit): (1) konsistensikan pratinjau dokumen
di SEMUA tempat yang bisa export, dan (2) opsi cetak langsung tanpa wajib unduh dulu, (3)
Data Generus perlu bisa disaring per jenis kelamin -- kegiatan muda-mudi organisasi ini rutin
memisahkan tempat laki-laki/perempuan (menghindari bersentuhan dgn bukan mahram), jadi
Pengurus butuh bisa menarik data salah satu gender saja ATAU keduanya untuk rekap/kebutuhan
pengurus.

**Temuan awal**: pratinjau (`ExportPreviewModal`, PDF asli di iframe sebelum diunduh) TERNYATA
sudah ada & dipakai di **Keuangan** dan **Absensi** -- tapi **Data Generus, Data Pembina,
Kegiatan, dan Riwayat Absensi pribadi** masih pakai `exportToPDF`/`exportToExcel` LANGSUNG
tanpa pratinjau (2 tombol terpisah "📄 PDF" / "📊 Excel", download langsung).

**Dikerjakan:**
- **`components/ExportPreviewModal.tsx`**: tambah tombol **"🖨️ Cetak"** (gelap, paling
  menonjol) di antara Tutup dan Export PDF/Excel -- memicu `iframe.contentWindow.print()`
  atas PDF yang SUDAH tampil di pratinjau, jadi user bisa langsung cetak tanpa unduh file
  dulu. Karena komponen ini shared, **Keuangan & Absensi otomatis dapat tombol ini juga**
  tanpa disentuh.
- **4 halaman diubah dari 2-tombol-langsung-unduh jadi 1 tombol "🔍 Pratinjau & Export"**
  yang membuka `ExportPreviewModal` (pola disalin persis dari `absensi/page.tsx`):
  `generus/page.tsx` (Data Generus), `data-pembina/page.tsx` (Data Pembina),
  `kegiatan/page.tsx`, `profil/riwayat-absensi/page.tsx`. Audit log export (`logAudit`)
  dipindah ke callback `onExported` (dipanggil `ExportPreviewModal` setelah export
  PDF/Excel beneran terjadi, BUKAN saat cetak -- cetak tidak menghasilkan file baru jadi
  tidak perlu dicatat sbg "export").
  - **Catatan teknis**: di `data-pembina/page.tsx`, `previewOptions` (objek biasa, beda
    dari fungsi `buildExportData`/`exportSubtitle` yang dievaluasi belakangan lewat
    closure) harus dipindah ke SETELAH deklarasi `const filtered` -- kalau tetap di posisi
    lama (sebelum `filtered` dideklarasikan) akan kena *temporal dead zone* JS
    ("Cannot access 'filtered' before initialization").
- **Filter Jenis Kelamin di Data Generus**: dropdown baru "Laki-laki & Perempuan" (default,
  tarik keduanya) / "Laki-laki Saja" / "Perempuan Saja", masuk ke rantai filter yang sama
  dgn pencarian/role/status. Karena `buildExportData()` selalu ambil dari `filtered` (bukan
  data mentah), filter ini otomatis ikut kepakai saat pratinjau/export/cetak -- tidak perlu
  logic terpisah. Data Pembina/Kegiatan TIDAK diberi filter ini (di luar scope permintaan --
  PPG bukan peserta kegiatan muda-mudi yang dipisah gender).
- Visual diverifikasi lewat halaman preview sementara (dihapus lagi) + screenshot
  Playwright: tombol Cetak baru tampil benar di pratinjau PDF ASLI (bukan tiruan, generated
  via jsPDF sungguhan di iframe), dropdown filter jenis kelamin terbaca jelas.
  `tsc --noEmit`, `eslint`, `npm run test` (58 test), `npm run build` semua sukses.

### Sesi 27 Juli 2026 (lanjutan 4) — Audit fitur Notifikasi/push + banner ajakan aktifkan push

Menindaklanjuti gap terakhir yang tercatat di §4B dokumen ini ("push notification
sudah ada lib/push.ts + ServiceWorkerRegister.tsx -- perlu dicek status pemakaian
nyata"). Hasil audit menyeluruh (kode + query production):

- **Pipeline push TERNYATA lengkap & aktif end-to-end**, bukan setengah jalan
  seperti dugaan awal: `lib/push.ts` (subscribe/unsubscribe browser) ->
  `push_subscriptions` -> trigger DB `notify_push`/`notify_push_scope`
  (dipanggil dari trigger kegiatan/pengumuman baru, approval reimbursement,
  approval PPG, DAN 5 job `pg_cron` reminder) -> Edge Function `send-push`
  (`web-push` + VAPID asli) -> service worker `public/sw.js`. Semua
  dikonfirmasi lewat `pg_get_functiondef`/`pg_trigger` di database production,
  bukan cuma baca kode.
- **Masalah sebenarnya: adopsi, bukan kode.** Dari 83 akun aktif, cuma **2**
  yang pernah mengaktifkan toggle push (baris `push_subscriptions`).
  Kemungkinan besar karena togglenya "tersembunyi" di sub-halaman
  `Profil -> Notifikasi`, bukan di halaman **Notifikasi** utama, dan tidak ada
  ajakan apapun.
- **Perbaikan yang dikerjakan**: banner ajakan "Aktifkan Notifikasi Push?" di
  atas halaman `app/(dashboard)/notifikasi/page.tsx` (halaman utama, bukan
  sub-profil) -- klik "Aktifkan" langsung memanggil `subscribeToPush` di
  tempat (tidak perlu pindah halaman). Muncul HANYA kalau: browser mendukung,
  izin belum ditolak permanen, belum ada subscription aktif di device ini, dan
  belum pernah di-dismiss ("Nanti Saja" -> `localStorage`, dismiss permanen,
  sengaja TIDAK muncul lagi otomatis supaya tidak nagging). Super Admin
  dikecualikan (konsisten dengan `profil/notifikasi/page.tsx` yang sudah lebih
  dulu redirect Super Admin keluar dari pengaturan push).
- Visual diverifikasi lewat preview page sementara + screenshot Playwright
  (Mode Terang & Gelap, termasuk state pesan error) -- halaman preview sudah
  dihapus lagi, bukan bagian permanen kode. `tsc`, `eslint`, `npm run test`,
  `npm run build` semua sukses.
- **Item #6 (proteksi password bocor) masih pending** -- ternyata BUKAN
  sekadar toggle gratis seperti dugaan awal audit: fitur "Prevent use of
  leaked passwords" (Authentication -> Attack Protection) cuma tersedia di
  **Supabase Pro plan ke atas** (project masih FREE plan). Jadi ini sekarang
  keputusan upgrade berbayar berulang (~$25/bulan, cek angka pasti di
  Billing), bukan cuma sakelar gratis -- ditunda dulu sampai Reno putuskan
  worth it atau tidak.

### Sesi 27 Juli 2026 (lanjutan 3) — Tabel usang §2d (no action) + B1 Gamifikasi v1 (badge personal)

Melanjutkan diskusi prioritas pasca-batch DB di atas: 2 hal dari sisa
`AUDIT_MENYELURUH_2026-07.md` yang belum diputuskan.

- **§2d tabel usang `reset_password_requests`** -- dicek isinya (`execute_sql`,
  read-only): cuma 1 baris historis (request Reno sendiri, 14 Juli, sudah
  `processed`). **Keputusan: JANGAN di-drop** -- komentar di
  `backup-data/page.tsx:9` sudah eksplisit bilang tabel ini sengaja dibiarkan
  ada untuk histori, jadi rekomendasi audit "pertimbangkan drop" ternyata
  bentrok dengan keputusan yang sudah diambil sebelumnya. Ditutup sebagai *no
  action*.
- **B1 Gamifikasi Ringan v1** -- didiskusikan dulu 2 keputusan non-teknis
  sebelum nulis kode (sesuai catatan `WISHLIST_ASSESSMENT.md` §B1):
  1. **Badge personal, BUKAN leaderboard** -- disetujui Reno, karena ranking
     publik antar-orang/kelompok berisiko memicu kompetisi tidak sehat di
     organisasi keagamaan/sosial begini.
  2. **Pemicu: bertahap dari presensi dulu** (bukan poin datar atau
     kegiatan-selesai/streak dari awal) -- badge dihitung dari pola presensi
     yang sudah ada, bukan sistem poin baru.

  Implementasi v1 (3 badge, kegiatan berjalan mingguan):
  - 🔥 **Streak** -- hadir >=4x berturut-turut (izin/sakit dilewati/tidak
    memutus, `tidak_hadir`/alpha memutus)
  - 📅 **Rajin Bulan Ini** -- hadir >=75% dari minimal 3 kegiatan bulan berjalan
  - 🌱 **Kontribusi Konsisten** -- 3 bulan KALENDER berturut-turut (bukan cuma
    3 bulan yang kebetulan ada datanya) masing-masing >=75% hadir

  **Sengaja TANPA tabel/RPC baru** -- semua badge dihitung on-the-fly di
  client dari data `absensi` yang sudah ada (pola sama seperti
  `profil/riwayat-absensi/page.tsx`, RLS sudah membatasi ke baris milik
  generus sendiri), jadi tidak ada skema/RLS baru yang perlu didesain atau
  di-review. Lihat `lib/badges.ts` (+ `lib/badges.test.ts`, 9 test) untuk
  logikanya, ditampilkan di kartu hero `app/(dashboard)/profil/page.tsx`
  (disembunyikan total kalau generus belum punya badge apapun -- menghindari
  kesan "0 pencapaian").

  **Catatan penting**: saat ini baru ada **1 kegiatan tercatat di database**
  (24 Juli 2026, 79 baris absensi) -- threshold di atas cuma tebakan awal
  berdasar asumsi kegiatan mingguan, belum tervalidasi dengan data multi-bulan
  asli. Wajar dikalibrasi ulang setelah beberapa bulan berjalan kalau ternyata
  terlalu gampang/susah dicapai. `tsc`, `eslint`, `npm run test` (58 test),
  dan `npm run build` semua sukses tanpa error.

### Sesi 27 Juli 2026 (lanjutan) — Beres-beres teknis DB pasca-A4 (item #5, #7, #8 audit)

Setelah insiden deploy A4 tuntas (lihat entri sesi di bawah), Reno diajak diskusi
soal prioritas kerja berikutnya (semua A1-A7 & B2-B5 sudah selesai, sisa hanya
item hardening DB dari audit + B1 yang belum mulai). Reno pilih beres-beres
teknis dulu -- 3 item dari `AUDIT_MENYELURUH_2026-07.md` §6, semuanya digabung
jadi satu batch krn sama-sama perubahan DB tanpa efek perilaku aplikasi:

- **#5** `SET search_path = public` pada `submit_presensi`/`submit_presensi_rfid`
  (migrasi `fix_search_path_fungsi_presensi`) -- 2 fungsi ini anomali, semua
  fungsi `SECURITY DEFINER` lain sudah konsisten pakai ini.
- **#7** `(select auth.uid())` di 6 policy/7 klausul yang sebelumnya bare
  `auth.uid()` (migrasi `optimasi_rls_select_auth_uid`) -- perf murni, logika
  identik. Diverifikasi lewat `BEGIN...ROLLBACK` + `SET LOCAL role authenticated`:
  user pemilik 1 baris `push_subscriptions` tetap cuma lihat persis 1 baris
  miliknya pasca-rewrite (bukan 0/kebocoran tertutup, bukan 2/kebocoran ke user
  lain). **Ketemu 1 kasus tambahan** saat verifikasi ulang lewat advisor:
  `feature_toggles_select_all` pakai `auth.role()` (bukan `auth.uid()`) dan kena
  initplan issue yang sama -- terlewat dari audit awal krn query pembuktian lama
  cuma menyaring pola `auth.uid()`. Sempat salah tulis di percobaan pertama (lupa
  benar-benar membungkus ekspresinya), ketahuan saat verifikasi ulang & langsung
  diperbaiki (migrasi susulan `..._fix`).
- **#8** Index baru utk 40 foreign key yang sebelumnya tanpa index pendukung
  (migrasi `index_fk_tanpa_index`), termasuk `reset_password_requests` (tabel
  usang, tetap diberi index demi kelengkapan). Diverifikasi: advisor performance
  `unindexed_foreign_keys` 40 → 0.

Item #6 (proteksi password bocor) masih pending -- itu sakelar di Supabase
Dashboard Auth settings, harus Reno sendiri yang nyalain, bukan sesuatu yang
bisa dikerjakan lewat migrasi/kode. Detail lengkap tiap item ada di
`AUDIT_MENYELURUH_2026-07.md` §6-7.

### Sesi 27 Juli 2026 — Audit menyeluruh (keamanan+UX), fondasi toast/dialog, a11y Modal, skeleton loader, transisi navigasi, A4 (multi-device session)

**PR #21** -- docs-only, catat penyelesaian B4 (menu Pengaturan) di HANDOFF/WISHLIST_ASSESSMENT yang sempat tertinggal dari sesi sebelumnya.

**PR #22 -- Audit menyeluruh + fondasi UX (toast/dialog konfirmasi)**
- Audit lintas lapisan atas permintaan Reno ("jadikan aplikasi selayaknya aplikasi pada umumnya") -- dokumen lengkap `AUDIT_MENYELURUH_2026-07.md`, semua temuan diverifikasi lewat advisor Supabase + query `pg_proc`/`pg_policy`/`cron.job` production, bukan tebakan.
- **Temuan kritis, sudah diperbaiki:** 3 fungsi cron `SECURITY DEFINER` (`send_reminder_*`, 2 di antaranya buatan sesi 26 Juli sendiri) ternyata bisa dieksekusi role `anon` -- tidak ada cek `auth.uid()` sama sekali, padahal berjalan sebagai `postgres` yang bisa memanggil `notify_email`/`notify_push` yang justru sudah terkunci rapat (pola *confused deputy*). **Jebakan yang hampir terlewat:** usulan awal `REVOKE ... FROM anon, authenticated` TIDAK akan berfungsi krn ketiga fungsi memakai default privilege Postgres (`EXECUTE TO PUBLIC`) -- harus `REVOKE ... FROM PUBLIC` juga. Diverifikasi 3 sudut (privilege check, ACL, advisor sebelum/sesudah 28→25).
- **Fondasi UX:** `lib/toast.ts` + `lib/konfirmasi.ts` (module-level store + `useSyncExternalStore`, meniru pola `lib/dark-mode.ts`) + `components/ToastHost.tsx`/`KonfirmasiHost.tsx`. Mengganti SELURUH 16 `alert()`/`confirm()` native di 5 halaman -- gap terbesar: dialog native mengabaikan Mode Gelap total (kotak putih menyilaukan), jadi kerja B3 praktis batal di 16 titik itu.
- Bug ikutan ditemukan & diperbaiki: `pengumuman/page.tsx` tidak memeriksa error saat hapus (delete gagal RLS tetap terlihat "berhasil").

**PR #23 -- a11y Modal.tsx + skeleton loader 6 halaman utama**
- `Modal.tsx` (dipakai ~15 halaman form tambah/edit) sebelumnya nol atribut a11y -- ditambah focus trap, Escape, `role="dialog"`, meniru pola `KonfirmasiHost.tsx`.
- `components/Skeleton.tsx` (`SkeletonCards`/`SkeletonRows`/`SkeletonTable`) menggantikan pola "spinner di kotak putih kosong" di 6 halaman tersibuk (Data Generus, Kegiatan, Pengumuman, Dokumen, Absensi, Keuangan) -- bentuk diambil dari inventaris pola yang sudah ada, bukan didesain dari nol.
- Konflik merge nyata terjadi antara PR #23 & #24 (sama-sama menyentuh blok `prefers-reduced-motion` di `globals.css`) -- di-resolve manual (union kedua class, bukan pilih salah satu) setelah salah satu merge duluan.

**PR #24 -- Transisi halus antar halaman & antar menu**
- Permintaan langsung Reno ("kaku"). Highlight menu aktif sidebar dapat animasi "pop" (class `animate-nav-pop` HANYA disematkan saat item baru jadi aktif, sehingga `animation-name` berubah none→nav-pop dan browser otomatis memutar ulang -- tanpa perlu JS mengukur posisi elemen ala sliding-pill). Judul topbar (`currentLabel`) diberi `key={currentLabel}` supaya remount + fade tiap ganti menu (sebelumnya cuma meloncat, krn hidup di `layout.tsx` yang tidak remount antar halaman). Easing `animate-page-in` disamakan dgn toast/dialog.
- Insiden proses: sempat salah cabang branch dari PR #23 yang belum merge -- ketahuan sebelum push, branch di-recreate dari `main` bersih.

**PR #25 -- A4: Redesain single-session → multi-device**
- Diskusi eksplisit dgn Reno dulu (bukan asumsi): batas **maks 2 sesi aktif** per akun (bukan unlimited -- sengaja dipertahankan sbg "rem alami" terhadap sharing akun antar orang, sekaligus cukup utk kebutuhan harian mis. Super Admin pantau dari laptop+HP), DAN UI kelola/logout device **sejak versi pertama** (bukan menyusul).
- Skema baru `user_sessions` (1 baris per device) menggantikan kolom tunggal `users.active_session_token`/`active_session_created_at` (di-DROP, sudah dicek tidak ada view/trigger/fungsi lain yg bergantung). RPC `claim_session` (`SECURITY DEFINER`, menggantikan `app/api/session/claim` -- sesuai rekomendasi lama NATIVE_READINESS_AUDIT.md §B.2) insert baris baru lalu tendang sesi TERTUA kalau sudah >2.
- Diverifikasi lewat `BEGIN...ROLLBACK` di production (bukan Supabase database branch -- org masih plan Free, branching butuh billing yg belum terpasang, Reno pilih skip branch). **Bug ketemu saat testing:** eviksi awalnya salah tendang sesi TERBARU bukan TERTUA -- `created_at DEFAULT now()` ternyata SAMA sepanjang satu transaksi Postgres (bukan per-statement), jadi 3 login berturut dlm 1 transaksi test dapat timestamp identik & urutan jadi acak. Diganti `clock_timestamp()`. Total 8 skenario diverifikasi lolos (eviksi, RLS lintas-user, self-service, anon terkunci, agregat count, kolom lama benar-benar hilang) sebelum apply ke production.
- Halaman baru `/profil/perangkat` (self-service lihat/keluarkan device sendiri, semua role) + tab Sesi Aktif Monitoring & Log dirombak total (1 baris = 1 SESI, bukan 1 user lagi -- "Sesi Ini" dicocokkan via `session_token`, bukan sekadar id user, krn 1 user kini bisa punya 2 baris).
- `count_sesi_aktif()` RPC baru (agregat murni) menggantikan query langsung `users.active_session_token` di kartu Kesehatan Sistem -- sengaja dibuka utk semua `authenticated` (bukan cuma Super Admin/Team IT) krn cuma 1 angka total tanpa detail per-device.
- **Insiden produksi pasca-merge PR #25 (self-inflicted, sudah tuntas):** migrasi men-DROP `users.active_session_token`/`active_session_created_at`, tapi kode FRONTEND lama (belum ter-deploy) masih men-select kolom itu di `getUserProfile()` -- setiap load halaman gagal utk SEMUA user selama jeda antara migrasi & deploy kode baru. Dimitigasi cepat dgn mengembalikan kedua kolom (nullable, additive) lewat migrasi darurat `mitigasi_darurat_restore_kolom_session_lama` sampai kode baru live.
- **Vercel sempat tidak auto-deploy commit merge PR #25 ke production** (anomali -- biasanya instan, PR-PR sebelumnya semua auto-deploy normal). Root cause tidak pernah dipastikan (kemungkinan besar 1 event webhook GitHub→Vercel gagal terkirim/terproses); tombol "Redeploy" di dashboard Vercel terbukti TIDAK membantu krn cuma membangun ulang commit yang sama persis, bukan menarik HEAD terbaru. Diselesaikan dgn PR #26 (1 commit kosong ke `main`, disetujui eksplisit Reno) yg berhasil memicu build production baru dari kode terkini.
- Setelah deployment production dikonfirmasi pindah ke kode A4 (commit `d9b94a1c`), kedua kolom mitigasi darurat di-DROP lagi (migrasi `bersihkan_kolom_mitigasi_darurat_sesi_lama`, dikonfirmasi izin eksplisit Reno, diverifikasi 0/84 baris terisi sebelum drop) -- skema kembali bersih sesuai desain A4 final.

### Sesi 26 Juli 2026 — Tone/voice, A6 (eskalasi approval), B3 (Mode Gelap rollout penuh), fix PPG di Data Generus, B4 (Aksesibilitas) + menu Pengaturan

Enam PR berurutan (#15-#20), semua sudah di-merge ke `main`. Ringkasan per PR:

**PR #15 -- Tone/voice: pesan motivasi, sapaan waktu & nama panggilan di Dashboard**
- Fase A (fondasi data): tabel baru `pesan_motivasi` (40 baris seed, teks
  penyemangat/pantun) + kolom `users.tampilkan_pesan_motivasi` (default
  `true`) + RPC `set_tampilkan_pesan_motivasi` (`SECURITY DEFINER`, hanya
  menyentuh `auth.uid()` sendiri -- tulis langsung ke `users` tetap terkunci
  Super Admin lewat RLS, jadi toggle preferensi butuh RPC khusus).
- Fase B (Dashboard UI): `SapaanWaktuCard` (kartu terpisah, emoji & gradasi
  warna beda tiap periode waktu -- pagi/siang/sore/malam/larut malam, frasa
  persis dari `PANDUAN_TONE_VOICE_GENSITI.md`) + `PesanMotivasiCard` (random
  1x per sesi browser via `sessionStorage`, respek toggle, disembunyikan
  utk Super Admin). Toggle baru "Pesan Motivasi di Dashboard" di
  `profil/notifikasi/page.tsx`.
- Fase C (microcopy audit menyeluruh): pesan loading/empty-state/error
  diperhalus di ~15 halaman (Dashboard, Kegiatan, Absensi, Dokumen, Generus,
  Catatan Pembinaan, Pengumuman, Monitoring, GlobalSearch, login, dst.) --
  polanya konsisten dgn suara GENSITI di panduan, bukan perubahan fungsional.
- Diperluas ke **email otomatis & subjek notifikasi** (3 lapisan, atas
  permintaan eksplisit "biar generus tertarik untuk membacanya"): subjek
  emoji-aware untuk pengumuman/kegiatan/approval/reminder H-1/reminder
  laporan, badan email `build_email_html` cabang `reminder` diperhalus,
  footer email (satu sumber, dipakai semua tipe email) diperlunak. Migrasi
  `tone_voice_email_notifikasi` (`CREATE OR REPLACE` 6 fungsi, tidak ada
  perubahan skema).
- Bug ditemukan & diperbaiki selama testing: kartu pesan motivasi sempat
  "hilang" -- ternyata bukan bug, user sendiri tidak sengaja mematikan
  toggle-nya saat uji coba (dikonfirmasi lewat `get_logs` + query langsung
  ke baris user, bukan asumsi).

**PR #18 -- A6: Eskalasi approval reimbursement yang nyangkut**
- Assessment awal & desain lengkap ada di
  [WISHLIST_ASSESSMENT.md §A6](WISHLIST_ASSESSMENT.md). Desain final BUKAN
  auto-approve (opsi awal yang diusulkan, ditolak eksplisit krn risiko
  governance keuangan -- lihat diskusi) -- tetap perlu aksi manual manusia.
- Backend (migrasi terpisah, diverifikasi lewat `BEGIN...ROLLBACK`
  multi-skenario dgn identitas user nyata sebelum deploy): `proses_reimbursement`
  diperluas menerima 2 tier caller (Bendahara ATAU Ketua di jenjang sama
  kalau sudah >3 hari nyangkut), + 2 RPC reminder baru
  (`send_reminder_approval_kegiatan_pengumuman`/`send_reminder_approval_reimbursement`)
  + 2 cron harian 08:00 WIB. **Bug ditemukan & diperbaiki sendiri** (bukan
  laporan user) selama verifikasi: reminder reimbursement awalnya salah pakai
  pola broadcast ala notifikasi kegiatan (`tingkatan='daerah'` lihat semua) --
  seharusnya otorisasi sungguhan (scope caller harus PERSIS sama dgn
  pengajuan), diperbaiki migrasi susulan `fix_scope_reminder_approval_reimbursement`.
- Frontend (`app/(dashboard)/keuangan/page.tsx`): badge "⚡ Sudah >3 hari
  menunggu Bendahara -- Anda bisa ambil alih" + tombol Setujui/Tolak utk
  Ketua yang eligible, `bisaKetuaAmbilAlih()` di client mirror persis gate
  RPC (client cuma menentukan tampilan, bukan sumber otorisasi).
- Detail lengkap di [ARCHITECTURE.md §4](ARCHITECTURE.md#4-fungsi--rpc-database-schema-public-65-fungsi).

**PR #16 -- B3: Mode Gelap, sinkronisasi toggle & rollout penuh**
- **Bug sinkronisasi ditemukan & diperbaiki** (laporan user: ikon mode gelap
  di header tidak sinkron dgn toggle di menu Profil): dua `useState` terpisah
  yang masing-masing baca `localStorage` sekali saat mount, tidak saling
  memberi tahu. Diperbaiki dgn hook bersama `lib/dark-mode.ts` berbasis
  `useSyncExternalStore` (React 18+) sebagai satu-satunya sumber kebenaran --
  toggle di satu tempat langsung ter-refleksi di semua komponen yang pakai
  hook ini, tanpa reload.
- **Rollout ke seluruh aplikasi** (assessment awal di
  [WISHLIST_ASSESSMENT.md §B3](WISHLIST_ASSESSMENT.md) memperkirakan ~37
  file tersisa dari klaim 47 total -- ternyata jauh lebih sedikit yang
  BENAR-BENAR butuh sentuhan: `app/globals.css` sudah override warna dasar
  Tailwind (`bg-white`, `border-slate-*`, `text-slate-*`, input, table,
  shadow) secara global lewat `.dark` class, jadi mayoritas styling otomatis
  ikut gelap TANPA perlu kelas `dark:` eksplisit. Yang genuinely perlu
  disentuh murni **aksen warna non-slate** -- badge status, box info/warning
  berwarna, link, hover state). Metodologi: grep pola
  `(bg|border|text|hover:)-{warna}-{angka}` per file, exclude yang sudah
  ada `dark:`, patch dgn konvensi warna konsisten (`bg-{c}-100` →
  `dark:bg-{c}-900/30`, dst.), verifikasi `tsc`/`eslint`/test tiap file.
  Tombol solid berwarna + teks putih, spinner, dan `focus:ring` SENGAJA
  dibiarkan apa adanya (kontras sudah cukup di kedua mode).
- **30 file disentuh** (29 commit): seluruh halaman `app/(dashboard)/*`,
  semua sub-halaman Profil, komponen bersama (`PresensiPanel`,
  `PengajuanIzinPanel`, `LaporanBulananModal`, `RfidKioskInput`,
  `GlobalSearch`), plus halaman publik (`login`, `lupa-password`).
- **Konflik merge ditemukan & diperbaiki**: branch sempat dibuat dari commit
  `main` yang lebih lama (sebelum PR #15 merge), sehingga wording microcopy
  Fase C (PR #15) bentrok dgn kelas `dark:` yang ditambahkan di baris yang
  sama pada 6 file (`dokumen`, `generus`, `kegiatan`, `keuangan`,
  `pengumuman`, `profil/notifikasi`). Diselesaikan dgn merge `main` terbaru
  + resolusi manual per-file (selalu pertahankan wording terbaru + tambahkan
  `dark:`), termasuk fitur baru "Pesan Motivasi di Dashboard" toggle
  (dari PR #15) yang belum ada dark-mode-treated sebelumnya -- ikut
  dirapikan sekalian saat resolusi konflik.

**PR #17 -- Fix: kecualikan PPG dari daftar Data Generus**
- Bug ditemukan lewat laporan user (akun "RIZAL FIRDAUS" muncul di menu
  Data Generus, padahal PPG). Dikonfirmasi lewat query langsung ke DB
  production: role-nya memang "PPG Bekasi Timur" (`tingkatan='ppg'`, aktif) --
  bukan salah data, murni filter `loadData()` di
  `app/(dashboard)/generus/page.tsx` yang cuma exclude `super_admin`, belum
  exclude `ppg` (peninggalan dari sebelum menu "Data Pembina" jadi halaman
  mandiri dgn kontrol akun+biodata lengkap sendiri). Fix 1 baris: tambah
  `&& m.roles?.tingkatan !== 'ppg'`, filter tetap di client (bukan query
  PostgREST) sesuai catatan lama di file yg sama soal filter negasi pada
  relasi nested/embedded.

**PR #19 -- Dokumentasi (HANDOFF/ARCHITECTURE/WISHLIST_ASSESSMENT), tanpa perubahan kode**
- Menyelaraskan 3 dokumen ini dgn hasil PR #15-#18 yang sempat tertunda
  ("nanti saja") -- ditulis begitu ketiga PR itu selesai di-merge.

**PR #20 -- B4: Menu Pengaturan (Ukuran Teks, Kontras Tinggi) + pindahkan Mode Gelap dari Profil**
- Assessment awal di [WISHLIST_ASSESSMENT.md §B4](WISHLIST_ASSESSMENT.md).
  Reno minta diperluas sekalian: bukan cuma Ukuran Teks + Kontras Tinggi,
  tapi juga menu sidebar baru "Pengaturan" yang mengumpulkan SEMUA preferensi
  tampilan aplikasi jadi satu tempat.
- `lib/accessibility.ts` (baru) -- `useTextSize()` & `useHighContrast()`,
  mencontek persis pola `useSyncExternalStore` dari `lib/dark-mode.ts`
  (satu key `localStorage` + class di `<html>` per fitur, listener set
  supaya semua komponen yang pakai hook ini sinkron real-time). Dipanggil
  juga (tanpa render toggle) di `app/(dashboard)/layout.tsx` supaya class-nya
  diterapkan begitu dashboard mount, terlepas dari halaman mana yang dibuka
  duluan -- sama seperti Mode Gelap.
- `app/globals.css` -- `html.text-size-besar`/`.text-size-lebih-besar`
  men-scale `font-size` ROOT saja (semua ukuran teks Tailwind berbasis
  `rem`, otomatis ikut proporsional tanpa sentuh tiap kelas satu-satu);
  `.high-contrast` mem-override warna teks/border jadi lebih tajam,
  independen dari `.dark` (selector 2-3 class spesifik supaya menang saat
  kedua mode aktif bersamaan) + outline focus lebih tebal.
- `app/(dashboard)/pengaturan/page.tsx` (baru) -- menu sidebar baru, terbuka
  utk semua jenjang termasuk Generus biasa (sama seperti Notifikasi). Isi:
  Mode Gelap (dipindah dari Profil), Ukuran Teks (3 level), Kontras Tinggi,
  Ganti Bahasa, Versi Aplikasi.
- **Keputusan scope eksplisit soal Ganti Bahasa**: Reno awalnya minta
  "sekalian" ditambah ganti bahasa di menu Pengaturan. Diangkat ke Reno
  dulu bahwa i18n sungguhan (ekstraksi string, locale switching) di luar
  cakupan sesi ini -- disepakati taruh placeholder **"Segera Hadir"**
  (disabled, non-fungsional) drpd dikerjakan penuh atau dihilangkan total.
- `app/(dashboard)/profil/page.tsx` -- Mode Gelap, Bahasa, dan Versi
  Aplikasi (yang sebelumnya sudah ada di sini sbg placeholder/display)
  dihapus dari sini supaya tidak ada 2 tempat berbeda utk pengaturan yang
  sama; diganti 1 link "Tampilan & Aksesibilitas" menuju `/pengaturan`.

Semua 6 PR diverifikasi `tsc --noEmit` + `eslint` + `npm run test` (49
lulus) sebelum tiap commit/merge. `npm run build` gagal di sandbox
pengembangan (tidak ada `.env.local`, bukan disebabkan perubahan kode) --
diverifikasi lewat preview deployment Vercel per PR sebagai gantinya.

**Belum dikerjakan (di luar cakupan sesi ini):** A4 (redesain single-session
ke multi-device -- Besar, sudah ada analisis desain lengkap di
`NATIVE_READINESS_AUDIT.md`), A5 (Tampilan Sesi Aktif -- direkomendasikan
digabung ke A4, gap-nya identik), B1 (Gamifikasi Ringan -- Besar + perlu
diskusi non-teknis dgn Reno soal bentuknya dulu sebelum coding). Juga
verifikasi visual manual langsung di browser oleh Reno (Claude Code tidak
bisa klik-klik UI nyata -- lihat `CLAUDE.md` prinsip #5), termasuk kombinasi
Mode Gelap + Kontras Tinggi + Ukuran Teks dari PR #20.

### Sesi 24 Juli 2026 (lanjutan 2) — A1, A3 (Opsi B), A2/A7 dari `WISHLIST_ASSESSMENT.md`

Urutan disepakati lewat sesi strategi Claude.ai: item ringan/berisiko-tinggi-
kalau-ditunda dulu (A1), baru item yang butuh keputusan tools (A3), baru item
"nice to have" (A2 sisa). Detail lengkap tiap item + status di
[WISHLIST_ASSESSMENT.md §Status Implementasi](WISHLIST_ASSESSMENT.md).

- **A1 -- Runbook recovery Super Admin** (`RUNBOOK_RECOVERY_SUPER_ADMIN.md`,
  commit `260aad3`). 4 skenario (lupa password, akun nonaktif, role_id
  berubah, baris user hilang), semua lewat Supabase Dashboard manual --
  SENGAJA tidak ada fitur recovery di dalam aplikasi (red flag: kalau auth
  normal bermasalah, jalur recovery yang sama tidak menolong). Trigger
  `enforce_single_super_admin` diverifikasi ulang lewat `pg_get_functiondef`
  sebelum ditulis -- cuma memblokir akun LAIN jadi Super Admin kedua, tidak
  menghalangi memulihkan baris yang sudah ada.
- **A3 -- Reminder backup mingguan** (migrasi `add_backup_reminder_schedule`,
  commit `a195537`). Opsi B dari 3 opsi yang diajukan (A: upgrade Supabase
  Pro, B: reminder-only via pg_cron, C: backup otomatis ke Storage) -- pola
  identik 2 reminder existing (`send_reminder_h1_kegiatan` dkk). Kolom baru
  `system_config.last_backup_at` (diisi `/api/backup` tiap backup manual
  selesai) + RPC `send_reminder_backup_belum_dilakukan` (in-app+push+email
  ke Super Admin kalau >30 hari) + cron mingguan Senin 08:00 WIB. Tambah 1
  cabang baru `reminder_umum` di `build_email_html` (cabang lain tidak
  diubah) -- cabang `reminder` lama ternyata hard-coded utk kegiatan, tidak
  reusable. Opsi C (backup otomatis) DITUNDA -- butuh keputusan scope akses
  storage terpisah (lihat red flag di `WISHLIST_ASSESSMENT.md` A3).
- **A2 sisa + A7 -- Card rate-limit & link Sentry** (migrasi
  `add_rate_limit_summary_rpc`, commit `254e168`). RPC baru
  `get_rate_limit_summary` (gate super_admin/Team IT) karena tabel
  `auth_rate_limit` deny-all utk `authenticated` -- beda dari card lain di
  `KesehatanTab` yang query langsung krn RLS sudah mengizinkan. Live error
  count Sentry DITUNDA (butuh `SENTRY_AUTH_TOKEN`/`SENTRY_ORG`/
  `SENTRY_PROJECT` diisi Vercel dulu, belum ada saat ini) -- diganti link-out
  ke Sentry Issues (`https://generus-bekasi-timur.sentry.io`) sbg langkah
  pertama tanpa secret baru.
- Semua 3 item di atas diverifikasi lewat `BEGIN...ROLLBACK`/simulasi RLS
  penuh (identitas Super Admin + Generus, cek fail-closed) sebelum commit,
  plus `tsc`/`eslint`/`npm run test` (49 lulus) utk perubahan kode.
- Ketiga commit di atas sudah di-merge ke `main` lewat PR #14 (26 Juli 2026).

### Sesi 24 Juli 2026 — Insiden: 2 commit lolos ke main tanpa PR/review, branch protection diaktifkan

- Ditemukan Reno (bukan lewat proses audit terjadwal) bahwa 2 commit sempat masuk ke
  `main` LANGSUNG (push tanpa PR, tanpa review) sebelum sesi ini:
  - `eeccd81` (2026-07-22 10:35 UTC) -- "fix: ganti checkbox metode presensi (QR/RFID)
    jadi toggle switch"
  - `4611126` (2026-07-22 10:53 UTC) -- "fix: cegah kegiatan tersimpan tanpa metode
    presensi aktif (QR & RFID mati)" (isinya sudah didokumentasikan di atas, bagian
    "Sesi 22 Juli 2026 (lanjutan 2)")
- Keduanya commit non-merge (1 parent), diverifikasi TIDAK punya PR terkait (dicek
  terhadap seluruh 13 PR yang pernah ada di repo ini) dan tidak punya footer
  `Claude-Session` (beda dari commit sesi ini/sesi lain yang biasa mencantumkan link
  session) -- artinya tidak bisa diidentifikasi sesi/entitas Claude Code mana yang
  melakukan push ini.
- Sebagai pembanding: commit `7e558bf` (PR #11, "Prioritas #3 contract test otorisasi")
  yang sempat dicurigai serupa ternyata SAH -- benar-benar lewat PR, di-merge manual
  oleh Reno, hanya dari sesi Claude Code lain (bukan sesi yang sedang berjalan sekarang).
- **Root cause**: branch protection untuk `main` belum aktif saat itu -- tidak ada
  gerbang teknis yang mencegah push langsung dari sesi mana pun, termasuk sesi yang
  tidak diawasi Reno secara real-time.
- **Respons**: branch protection diaktifkan untuk `main` -- wajib lewat Pull Request,
  minimal 1 approval dari reviewer ber-akses write sebelum merge (dikonfirmasi lewat
  `list_repository_collaborators`: `Moreno19Ryan` [admin/pemilik] dan
  `generusbekasitimur-arch` [write]; approval PR berikutnya, #12 & #13, memang datang
  dari `generusbekasitimur-arch`). Sejak itu tidak ada lagi commit yang masuk `main`
  tanpa lewat proses PR.
- Dampak isi 2 commit itu sendiri: tidak berbahaya secara fungsional (satu perbaikan
  bug validasi form, satu perubahan UI checkbox->toggle) -- risiko yang jadi perhatian
  di sini murni soal PROSES (bypass review), bukan soal kerusakan dari isi perubahannya.
- **Belum terkonfirmasi**: apakah setting "Require status checks to pass before
  merging" juga aktif di branch protection `main` -- tidak ada tool yang bisa mengecek
  ini langsung dari sesi Claude Code, perlu dicek manual oleh Reno lewat GitHub
  Settings > Branches.

### Sesi 22 Juli 2026 (lanjutan) — Prioritas #3 (sebagian): contract test otorisasi

- **`lib/authz-rpc.contract.test.ts`** (baru): 31 test Vitest mengunci 5 fungsi otorisasi
  murni (Fase 1) lewat anon key -- mirror 30 skenario yang sebelumnya cuma diverifikasi
  manual via SQL. Masuk `ci.yml` (env publik, bukan secret). Lokal tanpa env, test skip
  diam-diam. Detail + batasan (RPC ber-`auth.uid()` & super_admin belum bisa diotomasi
  penuh) di [NATIVE_READINESS_AUDIT.md §5](NATIVE_READINESS_AUDIT.md).

### Sesi 22 Juli 2026 (lanjutan 2) — Fix: kegiatan bisa tersimpan tanpa metode presensi aktif

- **Bug ditemukan Reno**: form Tambah/Edit Kegiatan tidak mencegah kedua toggle metode
  presensi (QR/RFID) dimatikan bersamaan — kegiatan tetap bisa tersimpan & berjalan, cuma
  mengandalkan kode manual (Pengurus membacakan kode 6-digit satu per satu, tanpa cara
  lebih cepat sama sekali), hampir pasti bukan yang dimaksud saat kelupaan menyalakan
  salah satu toggle.
- **Diperbaiki di dua lapis** (konsisten dgn prinsip proyek ini -- proteksi harus di
  database, bukan cuma UI):
  1. Validasi form (`handleSave` di `app/(dashboard)/kegiatan/page.tsx`) menolak simpan
     dgn pesan jelas kalau `presensi_metode_qr` dan `presensi_metode_rfid` sama-sama mati.
  2. Migrasi Supabase `require_at_least_one_presensi_metode`: constraint
     `kegiatan_minimal_satu_metode_presensi` (`CHECK (presensi_metode_qr OR
     presensi_metode_rfid)`) di tabel `kegiatan` -- backstop kalau ada jalur tulis lain di
     luar form ini. Pesan error Postgres mentah dipetakan ke pesan ramah di
     `handleSave` kalau backstop ini yang kena. Diverifikasi lewat `BEGIN...ROLLBACK`
     langsung di DB (insert dgn keduanya `false` ditolak, dgn salah satu `true` diterima).
- Data existing aman (1 baris kegiatan di DB, sudah `presensi_metode_qr=true` dari
  default kolom) -- constraint tidak butuh backfill. Detail di
  [ARCHITECTURE.md §11](ARCHITECTURE.md#11-presensi-via-kartu-rfid-struktur-siap-belum-aktif).
- Diverifikasi: `tsc --noEmit`, `eslint` (0 error), `npm run test` (38/38), `npm run build`
  sukses.

### Sesi 22 Juli 2026 — Fase 3 endpoint 3 (TERAKHIR, hibrida): `PATCH /api/users` lewat RPC

- **Endpoint terakhir Fase 3**, beda karakter dari 2 sebelumnya: **HYBRID**. Field non-password
  (nama/no_hp/role/scope/is_active/avatar/archive/restore) dialihkan ke RPC `update_user_profile`;
  `password` TETAP di route via GoTrue Admin API (tak bisa 100% RPC). RPC dipanggil LEBIH DULU
  (bahkan payload kosong) supaya jadi gerbang otorisasi ganda: field akun DAN ganti password --
  password tak pernah tersentuh kalau caller tak berwenang atas target. `getCaller`/
  `canManageMembers`/`canActOnScope` TIDAK dihapus dari file (masih dipakai `POST` bikin-akun).
- **Perbaikan sebelum wiring**: pesan error hierarki role di RPC sebelumnya generik, diperbaiki
  (migrasi `fix_update_user_profile_role_hierarchy_message`) agar identik dgn route lama
  (sebut jenjang tujuan + daftar jenjang yang boleh ditetapkan) -- wrapper meneruskan pesan RPC
  apa adanya, jadi harus benar-benar sama dulu.
- Diverifikasi ulang (self, Super Admin protected, PPG guard, pesan hierarki role, 2 skenario
  baru gerbang password) + `typecheck`/`lint`/`test`/`build` sukses. **Belum:** spot-check live
  (termasuk ganti password nyata) SEBELUM merge. Detail di
  [PLAN_MIGRASI_OTORISASI_RPC.md §0](PLAN_MIGRASI_OTORISASI_RPC.md) Fase 3 poin 3.

### Sesi 21 Juli 2026 (lanjutan 6) — Fase 3 endpoint 2: `PATCH /api/generus` lewat RPC

- **Handler PATCH `/api/generus` dialihkan ke RPC `update_generus_biodata`** (wrapper tipis,
  `userClient` + JWT pemanggil). Bangun `p_payload` jsonb hanya dari field yang dikirim client
  (mirror `!== undefined`), teruskan `user_id`/`generus_id` sbg param. Error 4xx otorisasi:
  pesan spesifik dari RPC diteruskan apa adanya (string di-RAISE identik dgn route lama). Bentuk
  balik `{ success, newLoginUsername? }` identik → frontend tak berubah.
- **Karena GET (endpoint 1) sudah RPC juga, seluruh helper duplikat TS di file itu DIHAPUS**
  (`getCaller`/`canManageMembers`/`canActOnScope`/`generateUniqueLoginUsername`/`adminClient`/
  `Caller`) — file generus route kini bersih: 2 wrapper RPC + helper token. Ini "hapus
  duplikasi" tujuan Fase 3. Bonus: otorisasi+tulis kini ATOMIK (satu transaksi RPC).
- `typecheck`/`lint`/`test`/`build` sukses. RPC-nya sendiri sudah diverifikasi 7 skenario saat
  dibuat (PR #6). **Belum:** round-trip TULIS live — HARUS spot-check di preview PR (login →
  edit & SIMPAN biodata) SEBELUM merge, karena ini jalur tulis ke data ~82 user. Detail di
  [PLAN_MIGRASI_OTORISASI_RPC.md §0](PLAN_MIGRASI_OTORISASI_RPC.md) Fase 3 poin 2.

### Sesi 21 Juli 2026 (lanjutan 5) — Fase 3 pilot: `GET /api/generus` lewat RPC

- **Fase 3 DIMULAI** (pertama kalinya jalur produksi dialihkan, bukan cuma aditif). Pilot:
  handler `GET` di `app/api/generus/route.ts` sekarang **wrapper tipis** yang memanggil RPC
  `get_generus_biodata` lewat `userClient(token)` (anon key + JWT pemanggil, bukan
  service-role) -- otorisasi ditegakkan di DB via `auth.uid()`. Kontrak HTTP tak berubah
  (client tetap `authFetch('/api/generus?userId=...')`), error RPC dipetakan ke status yang
  sama (28000→401, 42501→403), bentuk balik `{ data: <row|null> }` identik.
- Sekaligus merapikan `get_generus_biodata` (migrasi `gate_get_generus_biodata_on_caller_active`)
  agar menggate `caller_account_active()` utk akses biodata SENDIRI juga (sebelumnya terlewat).
- Diverifikasi: `typecheck`/`lint`/`test`/`build` sukses; RPC diverifikasi ulang di DB (4
  skenario, termasuk self-nonaktif→Unauthorized). **Belum:** spot-check round-trip live --
  HARUS dicek manual di URL preview PR (login → buka Data Generus/Profil>Data Diri) SEBELUM
  merge ke `main`, karena merge = langsung live ke ~82 user. Detail di
  [PLAN_MIGRASI_OTORISASI_RPC.md §0](PLAN_MIGRASI_OTORISASI_RPC.md) Fase 3.

### Sesi 21 Juli 2026 (lanjutan 4) — Fase 2 langkah 3 (TERAKHIR): RPC `update_user_profile`

- **RPC penutup Fase 2** diterapkan (migrasi `add_update_user_profile_rpc`), mirror persis
  `PATCH /api/users` bagian non-password (password tetap di GoTrue, di luar RPC). Guard yang
  dipindahkan: proteksi Super Admin, guard PPG, guard scope lama+baru, larangan role_id jadi
  super_admin kedua, hierarki jenjang, semantik arsip/pulihkan. Detail lengkap di
  [PLAN_MIGRASI_OTORISASI_RPC.md §0](PLAN_MIGRASI_OTORISASI_RPC.md) langkah 3.
- Diverifikasi lewat 10 skenario tulis nyata dalam `BEGIN...ROLLBACK` (data user sungguhan,
  tanpa mengubah production secara permanen) -- semua sesuai ekspektasi, dikonfirmasi tanpa
  residu. `get_advisors` bersih. Route lama tetap jalan.
- **Fase 2 (RPC data-only, prioritas #2 audit native) SELESAI TOTAL** -- ketiga RPC
  (`get_generus_biodata`, `update_generus_biodata`, `update_user_profile`) sudah hidup
  berdampingan dgn route lama, siap jadi fondasi Fase 3 (pindahkan pemanggil web) kapan pun
  disetujui.

### Sesi 21 Juli 2026 (lanjutan 3) — Fase 2 langkah 2: RPC `update_generus_biodata`

- **RPC tulis biodata Generus** diterapkan (migrasi `add_update_generus_biodata_rpc`),
  mirror persis `PATCH /api/generus` (guard admin field, guard PPG, guard tempat sambung
  lama+baru, sinkron `login_username`). Detail lengkap di
  [PLAN_MIGRASI_OTORISASI_RPC.md §0](PLAN_MIGRASI_OTORISASI_RPC.md) langkah 2.
- Diverifikasi lewat 7 skenario tulis nyata di dalam `BEGIN...ROLLBACK` (data user
  sungguhan, tanpa mengubah production secara permanen) -- semua sesuai ekspektasi,
  dikonfirmasi tidak ada residu. `get_advisors` bersih. Route lama tetap jalan.

### Sesi 21 Juli 2026 (lanjutan 2) — Fase 2 langkah 1: RPC `get_generus_biodata`

- **RPC pertama Fase 2** ([PLAN_MIGRASI_OTORISASI_RPC.md](PLAN_MIGRASI_OTORISASI_RPC.md) §0)
  diterapkan: `get_generus_biodata(p_user_id)`, mirror persis `GET /api/generus` (termasuk
  fix IDOR scope). Route lama tetap jalan, RPC belum dipanggil kode manapun.
- **Gap ditemukan & diperbaiki**: 4 wrapper self-check dari Fase 1 (`can_manage_members`
  dkk) ternyata tidak mengecek `is_active` caller -- beda dari `getCaller()` TS yang selalu
  fail-closed kalau akun caller nonaktif. Ditambahkan `caller_account_active()` sebagai
  gate tambahan (migrasi `gate_authorization_helpers_on_caller_active`).
- Diverifikasi lewat simulasi `auth.uid()` (`set local request.jwt.claims`) dgn user
  sungguhan (read-only): super_admin lintas scope berhasil, akses biodata sendiri berhasil,
  Generus biasa akses biodata Generus lain ditolak. `get_advisors` bersih.

### Sesi 21 Juli 2026 (lanjutan) — Fase 0+1 migrasi otorisasi RPC (audit native #2)

- **Perbaikan kecil**: audit log `logAudit()` di modal edit Data Generus sekarang ikut
  mencatat `is_active` (sebelumnya cuma tombol cepat toggle yang eksplisit log
  ACTIVATE/DEACTIVATE; edit lewat modal tidak tercermin di detail log).
- **Fase 0+1 dari [PLAN_MIGRASI_OTORISASI_RPC.md](PLAN_MIGRASI_OTORISASI_RPC.md) dieksekusi**
  (prioritas #2 audit native) -- 9 fungsi helper SQL aditif (`can_manage_members`,
  `can_act_on_scope`, `allowed_target_tingkatan`, `can_assign_tingkatan`,
  `normalize_login_username`, + versi "pure" masing-masing) yang mirror persis logika
  otorisasi di `app/api/users/route.ts`/`app/api/generus/route.ts`. Belum dipanggil kode
  manapun -- nol perubahan perilaku. Diverifikasi lewat 30 test case paritas (cocok dgn
  `lib/roles.test.ts`) + `get_advisors` (ditemukan & diperbaiki: search_path belum terkunci
  di 5 fungsi, grant PUBLIC implisit di 4 wrapper -- kedua isu diperbaiki migrasi susulan).
  DB branching Supabase tidak tersedia (butuh plan Pro) -- migrasi diterapkan langsung ke
  production karena aditif murni & reversibel, sesuai persetujuan eksplisit per langkah.
  Detail lengkap di PLAN_MIGRASI_OTORISASI_RPC.md §0.

### Sesi 21 Juli 2026 — Sentry terverifikasi jalan di production

- **Sentry error monitoring** (dipasang sesi 19 Juli) **sudah diverifikasi jalan penuh di
  production**, bukan cuma terpasang di kode. Langkah verifikasi: project Sentry dibuat
  (org `generus-bekasi-timur`, project `javascript-nextjs`, platform Next.js), DSN diisi ke
  Vercel env vars (`NEXT_PUBLIC_SENTRY_DSN` + `SENTRY_DSN`), redeploy, lalu error test
  dilempar langsung dari browser production (`gensiti-app.vercel.app`) dan dikonfirmasi
  muncul di Sentry Issues (`JAVASCRIPT-NEXTJS-1`, route `/login`) dalam hitungan detik.
  `SENTRY_ORG`/`SENTRY_PROJECT`/`SENTRY_AUTH_TOKEN` (source map upload) masih belum diisi --
  opsional, build tetap sukses tanpa itu (cuma warning "will not upload source maps").
  Tidak ada perubahan kode aplikasi di sesi ini.

### Sesi 20 Juli 2026 (lanjutan) — RLS hardening (audit native #1, Batch A)

- **Audit kesiapan native** ([NATIVE_READINESS_AUDIT.md](NATIVE_READINESS_AUDIT.md)) — assessment
  arsitektur sebelum pengembangan Flutter/Tauri. Kesiapan ±60%; 3 gap struktural terbesar +
  urutan prioritas perbaikan.
- **Prioritas #1 (Batch A) sudah dijalankan** — verifikasi RLS langsung di DB (`pg_policies`,
  `pg_proc`, security advisor) lalu migrasi `harden_rls_generus_write_and_cleanup`:
  1. `generus` — policy tulis disamakan dgn `users` (super_admin saja; sebelumnya semua
     tingkatan `daerah` bisa tulis langsung tanpa cek nama_role). Baca tak berubah.
  2. `reset_password_requests` (retired) — cabut policy INSERT `WITH CHECK (true)` yg terbuka.
  3. `increment_otp_attempt` — kunci `search_path`.
  Verified tak memutus flow app (generus tak pernah ditulis langsung client). Security advisor
  pasca-migrasi: 2 temuan hilang. Detail + sisa item (Batch B opsional, leaked-password
  protection) di NATIVE_READINESS_AUDIT.md §5 Log Perubahan.
- **Temuan penting audit:** fondasi RLS ternyata sudah kuat — `users` write-locked ke
  super_admin (self-escalation terblokir), semua fungsi SECURITY DEFINER anon-executable
  punya guard `auth.uid()`/tingkatan internal (tidak bocor).
- **Prioritas #8 (rate limiting) juga dijalankan** — migrasi `add_auth_rate_limit` (tabel
  `auth_rate_limit` deny-all + RPC `check_auth_rate_limit`, service_role only) + limiter
  per-IP di `resolve-login` (120/10 mnt) & `password-reset/request` (20/15 mnt, di atas
  throttle per-user yg sudah ada). Fail-open. Detail di NATIVE_READINESS_AUDIT.md §5.

### Sesi 22 Juli 2026

- **Struktur presensi via Kartu RFID** (mode kiosk, reader dipegang Pengurus) -- disiapkan
  penuh atas permintaan Reno, tapi **sengaja belum diaktifkan di UI produksi** karena QR
  masih dianggap cukup untuk saat ini dan fiturnya belum pernah diuji pakai reader USB
  fisik sungguhan. Dikunci lewat `RFID_PRESENSI_READY = false` di `lib/rfid.ts` -- ganti
  ke `true` + deploy setelah pengujian fisik berhasil, tidak perlu perubahan kode lain.
  - Migrasi Supabase (`add_rfid_presensi`, diterapkan lewat MCP `apply_migration`):
    kolom `generus.kartu_rfid_uid` (unique) dan `kegiatan.presensi_metode_qr`/
    `presensi_metode_rfid` (boolean, default `true`/`false`), plus 3 RPC baru
    (`daftarkan_kartu_rfid`, `cabut_kartu_rfid`, `submit_presensi_rfid`) -- detail lengkap
    di [ARCHITECTURE.md §11](ARCHITECTURE.md#11-presensi-via-kartu-rfid-struktur-siap-belum-aktif).
  - Kode baru: `lib/rfid.ts` (flag kesiapan), `components/RfidKioskInput.tsx` (input
    kiosk auto-focus utk reader keyboard-wedge). Terintegrasi ke `PresensiPanel.tsx`
    (kiosk RFID sisi Pengurus), `app/(dashboard)/kegiatan/page.tsx` (toggle metode
    presensi QR/RFID per kegiatan -- kode manual tetap selalu tersedia di luar toggle
    ini), dan `app/(dashboard)/generus/page.tsx` (tombol "Kartu RFID" di modal Detail
    Generus utk daftar/cabut kartu). Semua elemen UI RFID di-gate lewat
    `RFID_PRESENSI_READY` -- kalau `false`, tombol/checkbox-nya tidak dirender sama
    sekali (bukan cuma disabled), supaya tidak ada dead-end UI di produksi.
  - Diverifikasi: `tsc --noEmit`, `eslint` (0 error, warning sama seperti baseline),
    `npm run test` (38/38), `npm run build` sukses. `get_advisors` Supabase menunjukkan
    RPC baru memicu advisory generik yang sama seperti `generate_kode_presensi`/
    `submit_presensi` yang sudah ada (SECURITY DEFINER + authenticated executable) --
    bukan temuan baru, pola yang sudah diterima proyek ini.
  - **Belum dilakukan** (di luar cakupan sesi ini): uji end-to-end pakai reader RFID USB
    fisik. Sebelum `RFID_PRESENSI_READY` diganti `true`, sebaiknya dicoba dulu di satu
    kegiatan kecil (mirip kegiatan "tes" yang dipakai audit QR sebelumnya).

### Sesi 20 Juli 2026

- **Audit fitur absensi via QR Code** (diminta sebagai permintaan fitur baru, ternyata sudah
  ada) -- ditemukan fitur ini sudah diimplementasikan penuh & live sejak commit `1c2a222`
  (`feat: QR check-in presensi + audit trail koreksi kehadiran`):
  `components/PresensiPanel.tsx` men-generate QR dari `kode_presensi_aktif` (RPC
  `generate_kode_presensi`) untuk Pengurus di kartu kegiatan, dan menyediakan scan kamera
  (`qr-scanner`) untuk Generus dengan **fallback kode manual 6-digit tetap ada** (bukan
  dihapus). Yang ternyata belum sinkron cuma dokumentasi: `CLAUDE.md` §"Rencana Pengembangan"
  masih menandainya `[ ]` belum dikerjakan, dan `ARCHITECTURE.md` belum punya bagian yang
  menjelaskan alur QR ini secara eksplisit (RPC-nya sudah terdaftar di §4, tapi lapisan
  client -- payload QR, rotasi 5 menit, fallback manual -- belum). Diperbaiki: checklist
  `CLAUDE.md` diceklis, ditambahkan [ARCHITECTURE.md §10](ARCHITECTURE.md#10-presensi-via-qr-code-client-side).
  Tidak ada perubahan kode aplikasi -- `tsc --noEmit`, `eslint`, dan `npm run test` (38 test)
  tetap sukses tanpa error/regresi, dan `npm run build` diverifikasi sukses (pakai
  placeholder `NEXT_PUBLIC_SUPABASE_*` di sandbox tanpa akses `.env.local` asli).

### Sesi 19 Juli 2026

- **Pasang Sentry error monitoring** (`@sentry/nextjs`, tier gratis) --
  `instrumentation-client.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`,
  `instrumentation.ts` (`onRequestError`), `app/global-error.tsx`, dan
  `next.config.ts` dibungkus `withSentryConfig`. DSN & konfigurasi lain lewat
  environment variable (`NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_DSN`, `SENTRY_ORG`,
  `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN`), tidak di-hardcode -- lihat
  `.env.example` (file baru, mendokumentasikan semua env var yang dipakai app
  ini). Detail lihat [ARCHITECTURE.md §9](ARCHITECTURE.md#9-error-monitoring-sentry).
  `npm run build` + `tsc --noEmit` + `eslint` sukses tanpa error setelah
  perubahan ini.

### Sesi 16 Juli 2026

1. **Fix bug kritis PasswordInput** (`components/PasswordInput.tsx`) -- input password lama
   memakai `<input type="text">` dengan value hasil masking manual, dan salah menafsirkan
   `e.target.value` (yang sudah berisi bullet campuran) sebagai password asli. Password yang
   diketik panjang bisa tersimpan salah tanpa user sadar. **Sudah diperbaiki total**: sekarang
   pakai `<input type="password">` NATIVE, value selalu asli dari browser, tidak pernah
   direkonstruksi. Preview karakter terakhir cuma badge visual di luar `<input>`, sama sekali
   tidak menyentuh value. Dipakai di 4 tempat: login, profil (3x), generus (1x). Sudah
   diverifikasi live end-to-end.
2. **Fix race condition menu Monitoring & Log** (`app/(dashboard)/monitoring/page.tsx`) --
   halaman redirect ke `/dashboard` sebelum pengecekan `feature_toggles` selesai (state
   `featureChecking` belum `false`), sehingga role yang sebenarnya berhak (mis. Ketua
   Daerah) kadang gagal masuk tergantung kecepatan koneksi. Diperbaiki dengan menunda
   keputusan redirect sampai `featureChecking` selesai.
3. **Audit RLS & endpoint API menyeluruh** (task #74) -- ditemukan & diperbaiki celah
   keamanan nyata lewat migrasi Supabase (detail spesifik ada di riwayat migrasi Supabase,
   bukan di kode lokal).
4. **Reset password akun RENO** (morenoryandika@gmail.com) lewat Supabase Dashboard setelah
   dikonfirmasi password lama corrupt akibat bug #1 di atas (password lama sempat diganti
   lewat form yang masih bug).

Commit terakhir: `6165084` (fix Monitoring), sudah live di production.

---

## 3. Riwayat Pencapaian (kronologis, ringkas)

Total **76 task selesai**. Kelompok besar pekerjaan yang sudah dituntaskan:

- **Absensi & Presensi**: filter target peserta (alamat sambung > kelas ngaji > dapukan),
  auto-alpha untuk yang belum ditandai, rename "Presensi" -> "Absensi" (UI+URL).
- **Laporan Bulanan** (evolusi v1 -> v4): mulai dari agregasi RPC dasar per Daerah/Desa/
  Kelompok, sampai hero metric, perbandingan bulan lalu, rata-rata bergerak 6 bulan + deteksi
  anomali, drill-down per gender, dan daftar rekap individu per Generus. Termasuk export
  PDF/Excel dengan grafik, logo PPG+GENSITI, dan lembar absen kosong cetak.
  fitur ini kompleks & jadi salah satu kekuatan utama aplikasi (RPC-heavy, banyak agregasi).
- **Hak akses & hierarki**: sistem role bertingkat (kelompok < desa < daerah < ppg/super_admin
  paralel) di `lib/roles.ts`, ditegakkan di form tambah/edit pengguna dan API `/api/users`.
  Sistem toggle fitur per menu x jenjang (`feature_toggles`, fail-open by design, Super Admin
  selalu tidak terdampak).
- **Data quality**: backfill & sinkronisasi otomatis `login_username`, import massal 80 data
  Generus (Kartika Wanasari) dengan dry-run dulu, scan data quality seluruh tabel.
  fitur "Pulihkan akun diarsipkan" (menikah/meninggal/pindah) untuk Generus & PPG.
- **Export PDF/Excel**: redesain visual (kartu ringkasan, badge status berwarna), riwayat
  kehadiran bulan berjalan, grafik built-in Excel (sempat ditambah lalu dihapus lagi -- pie
  chart Excel dianggap tidak perlu setelah dicoba).
  fitur "Rekap Absensi Kegiatan" v2/v3 dengan polish berlapis.
- **Kualitas kode**: pembersihan menyeluruh error eslint `react-hooks/set-state-in-effect` di
  seluruh `app/` (0 error app-wide), termasuk perbaikan purity bug di `PresensiPanel`.
- **Keamanan**: audit RLS & endpoint API menyeluruh (task #74), fix login gagal saat pakai
  nama lengkap vs nama panggilan, fix rate limit 429 di edge function `send-email`.
- **UX**: global search lintas modul, sistem reminder terjadwal, toggle show/hide password.
- **Login system**: 2 bug besar ditemukan & diperbaiki (nama lengkap tidak bisa login;
  PasswordInput corrupt value) -- keduanya sudah diverifikasi live.

---

## 4. Target & Arah Pengembangan ke Depan

Belum ada roadmap tertulis eksplisit dari Reno selain permintaan ad-hoc per sesi, jadi bagian
ini disusun dari pola kerja & gap yang terlihat selama audit. **Perlu dikonfirmasi ulang
prioritasnya bersama Reno**, tapi ini kandidat area lanjutan yang masuk akal:

### A. Kesehatan & keamanan sistem (berkelanjutan)
- [x] Endpoint health check publik `/api/health` (`GET`, tanpa autentikasi) -- balas `200`
  + `{status: "ok", timestamp}`, sengaja tidak menyentuh Supabase sama sekali (tetap
  menjawab walau database bermasalah) dan tidak membocorkan data internal apapun. Siap
  dipantau UptimeRobot -- registrasi monitor-nya sendiri ke uptimerobot.com tetap manual
  oleh Reno.
- Audit RLS/API sudah dilakukan sekali (#74) -- sebaiknya jadi rutinitas berkala, terutama
  setiap kali ada fitur baru yang menyentuh tabel sensitif (users, keuangan, reset_password).
- Belum ada rate limiting eksplisit di `/api/resolve-login` -- saat ini mengandalkan rate
  limit bawaan Supabase Auth di level `signInWithPassword`. Layak dicek apakah itu cukup
  untuk skala 82+ pengguna, atau perlu lapisan tambahan (mis. lockout sementara per IP/nama
  setelah beberapa kali gagal).
- Pertimbangkan menambahkan `.gitattributes` (`* text=auto eol=lf`) untuk menghindari isu
  autocrlf berulang di masa depan.

### B. Fitur yang kemungkinan besar masih dibutuhkan
- ~~**Notifikasi**: menu `notifikasi` sudah ada, tapi belum diaudit mendalam sejauh mana
  cakupannya~~ ✅ **Sudah diaudit** (Sesi 27 Juli 2026 lanjutan 4) -- pipeline push
  end-to-end TERNYATA lengkap & aktif, gap-nya cuma adopsi (2/83 user). Banner ajakan
  aktifkan push sudah ditambahkan di halaman Notifikasi utama.
- **Backup data**: menu `backup-data` sudah ada -- perlu dipastikan alurnya (manual/terjadwal)
  dan diuji end-to-end kalau belum pernah dicoba pemulihan datanya.
- **Laporan bulanan untuk jenjang PPG**: sejauh ini RPC laporan bulanan dibangun untuk
  Daerah/Desa/Kelompok -- perlu dicek apakah PPG (jalur paralel) butuh laporan serupa atau
  memang di luar cakupan.
- **Dashboard real-time**: ada indikasi awal (`get_jumlah_generus_aktif`,
  `get_ringkasan_keuangan`, dsb. sebagai RPC) -- kemungkinan ada ruang untuk memperkaya
  dashboard utama dengan lebih banyak insight otomatis, mengikuti pola "ringkasan otomatis"
  yang sudah terbukti bagus di Laporan Bulanan v2.

### C. Kualitas & keberlanjutan jangka panjang
- [x] Automated test dasar sudah ada: `lib/roles.test.ts` (36 test, hak akses/hierarki) +
  2 test lain (38 total lewat `npm run test` / vitest). **Masih gap**: RPC laporan bulanan
  (agregasi berlapis) dan `resolve-login` belum ada test otomatis (pgTAP atau test level
  aplikasi) -- kalau mau nambah cakupan, ini kandidat berikutnya.
- [x] CI/CD gate sudah ada: `.github/workflows/ci.yml` menjalankan `typecheck` + `lint` +
  `test` di tiap push/PR ke `main` (bukan lagi murni Vercel auto-deploy tanpa gate).
- [x] Dokumentasi arsitektur sudah ada di [ARCHITECTURE.md](ARCHITECTURE.md) -- skema
  database, daftar RPC, peta hak akses, alur QR presensi, dan setup Sentry semua
  terdokumentasi di satu tempat untuk onboarding cepat.

### D. Segera dikonfirmasi dengan Reno di awal sesi Claude Code
1. Prioritas: lanjut fitur baru, atau dulukan hardening (test, CI, dokumentasi)?
2. Apakah ada keluhan/laporan bug lain dari pengguna yang belum sempat disampaikan ke Cowork?
3. Target rilis atau musim aktivitas organisasi tertentu yang perlu dikejar (mis. sebelum
   kegiatan besar tertentu, ada fitur yang harus siap)?

---

## 5. Cara Mulai di Claude Code

```powershell
cd "C:\Users\Moreno\Claude\Projects\GENSITI - Smart Organization Management System\gensiti-app"
claude
```

Karena `CLAUDE.md` di root proyek meng-import `AGENTS.md`, instruksi proyek otomatis kebaca.
Sarankan langkah pertama di Claude Code: minta ia baca file ini (`HANDOFF.md`) dan
`lib/roles.ts` + `lib/types.ts` dulu untuk membangun peta mental struktur akses & data
sebelum mengerjakan apa pun.
