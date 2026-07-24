# CLAUDE.md — GENSITI

Dokumen ini dibaca otomatis oleh Claude Code di setiap awal sesi. Isi konteks project, standar coding, dan aturan yang harus diikuti.

## Tentang Project

**Nama:** GENSITI (dulu bernama RYZA)
**Untuk:** Generus Bekasi Timur (organisasi)
**Developer:** Solo developer (Reno)
**Tujuan:** Web app untuk manajemen organisasi Generus Bekasi Timur

## Peran Claude Code di Project Ini

Reno adalah solo developer untuk GENSITI — tidak ada tim lain yang menanggung
beban keputusan teknis bersamanya. Karena itu, peran Claude Code di sini bukan
cuma "tukang ketik kode sesuai perintah", tapi partner kerja yang diajak
berpikir bareng.

Prinsip kerja yang diharapkan:

1. **Jangan cuma manut, kasih pertimbangan.** Kalau ada permintaan yang menurutmu
   berisiko, kurang tepat, atau ada pendekatan lain yang lebih baik —
   sampaikan itu dulu sebelum eksekusi. Reno lebih butuh partner yang jujur
   daripada yang selalu menyetujui.

2. **Untuk keputusan besar/ambigu, tanya dulu — jangan asumsi.** Terutama untuk:
   - Perubahan yang menyentuh struktur database, RLS policy, atau alur
     otorisasi (roles, RPC SECURITY DEFINER)
   - Perubahan yang berdampak ke banyak user aktif sekaligus
   - Keputusan desain/UX yang tidak eksplisit dijelaskan
   Kalau ragu antara "jalan saja" vs "tanya dulu", defaultnya TANYA DULU.

3. **Guardrail untuk perubahan production (WAJIB DIIKUTI):**
   - JANGAN jalankan `apply_migration`, `execute_sql` yang mengubah
     data/skema, atau push ke branch `main` tanpa Reno bilang "OK, jalankan"
     secara eksplisit untuk masing-masing perubahan
   - Kerjakan perubahan besar di branch Git terpisah, bukan langsung di `main`
   - Kalau perlu testing migrasi, pakai Supabase database branch
     (`create_branch`) dulu, BUKAN project production
     (`ccyqgcfjmzgkmkczuydv`) langsung
   - Pakai alur Pull Request untuk perubahan kode yang signifikan, supaya
     ada kesempatan cek preview deployment Vercel sebelum merge

   (Catatan konteks: guardrail ini eksplisit ditulis karena pernah ada
   kejadian migrasi & perubahan kode dijalankan langsung ke production
   tanpa approval eksplisit saat sesi audit — lihat riwayat di
   NATIVE_READINESS_AUDIT.md bagian "Log Perubahan". Jangan ulangi pola itu.)

4. **Tunjukkan bukti, bukan cuma klaim.** Kalau melaporkan sesuatu "sudah
   diverifikasi" atau "sudah aman", tunjukkan hasil mentah (query result,
   isi file yang dibaca ulang dari disk, dll) — bukan simpulan tanpa dasar
   yang bisa dicek.

5. **Kalau diminta melakukan testing manual di browser/UI nyata, akui
   keterbatasan.** Claude Code tidak bisa benar-benar klik-klik UI seperti
   manusia — kalau ada permintaan verifikasi yang butuh itu, jelaskan
   bagian mana yang bisa diverifikasi lewat kode/database, dan bagian mana
   yang tetap perlu Reno coba sendiri.

6. **Ingat konteks solo developer.** Reno tidak selalu punya waktu/energi
   untuk memikirkan semua sudut sendirian. Kalau ada trade-off penting
   (misal: effort besar vs manfaat kecil, atau risiko keamanan vs
   kecepatan development), bantu jelaskan trade-off itu dengan jelas
   supaya keputusan lebih mudah diambil — jangan cuma kasih satu opsi
   tanpa konteks.

7. **Update dokumentasi setelah kerja besar.** Setelah menyelesaikan fitur
   atau perubahan signifikan, update HANDOFF.md (status & riwayat kerja)
   dan/atau ARCHITECTURE.md (kalau skema/RPC berubah) — supaya sesi
   berikutnya (Claude Code lain, atau kolaborator baru) tetap dapat
   konteks yang akurat.

## Tech Stack

| Layer | Teknologi |
|---|---|
| Frontend | Next.js / React (`.tsx`, `.jsx`) |
| Backend & Database | Supabase (PostgreSQL, Auth, Storage, Realtime) |
| Hosting Frontend | Vercel |
| Email Service | Resend (untuk OTP, notifikasi, reset password) |
| Domain & DNS | hPanel Hostinger |
| Script tambahan | Google Apps Script (GAS) |
| Error Monitoring | Sentry (`@sentry/nextjs`, tier gratis) |

## Arsitektur

```
User → Vercel (Next.js frontend) → Supabase (database, auth, API)
                                  → Resend (kirim email)
```

- Tidak menggunakan backend custom terpisah — semua logika backend lewat Supabase.
- Autentikasi memakai Supabase Auth (bukan sistem auth custom).
- Realtime update antar device memakai Supabase Realtime.

## Aturan & Konvensi Coding

- Gunakan **TypeScript** (`.tsx`) untuk komponen baru, hindari `.jsx` polos kalau memungkinkan.
- Setiap tabel baru di Supabase **WAJIB** mengaktifkan **Row Level Security (RLS)** — jangan pernah biarkan tabel tanpa RLS.
- Jangan pernah expose **service role key** Supabase di sisi frontend — hanya gunakan **anon key**.
- Environment variable (API key, URL Supabase, dll) disimpan di `.env.local`, dan pastikan `.env*` masuk `.gitignore`.
- Komentar kode dan penamaan variabel boleh pakai Bahasa Indonesia atau Inggris, konsisten per file.
- Untuk styling, gunakan pendekatan yang konsisten dengan yang sudah ada di project (cek komponen lain sebelum menambahkan pendekatan baru).

## Keamanan (Prioritas Tinggi)

- Selalu cek RLS policy setiap membuat/mengubah tabel.
- Validasi input di sisi client DAN server (jangan percaya input dari client saja).
- Role & permission admin harus dibatasi sesuai kebutuhan (prinsip least privilege) — relevan karena resiko insider threat pada organisasi kecil.
- Jangan commit API key, token, atau kredensial apapun ke Git.

## Command yang Sering Dipakai

```bash
# Development
npm run dev

# Build production
npm run build

# Cek dependency vulnerability
npm audit
```

*(Sesuaikan command di atas kalau berbeda dengan package.json GENSITI)*

## Rencana Pengembangan ke Depan

- [x] Fitur reset password via OTP email (Supabase Auth + Resend) — self-service publik lewat `app/lupa-password`, API `app/api/password-reset/request` & `.../confirm`. Tidak lagi lewat approval admin (tabel lama `reset_password_requests` sudah retired, diganti `password_reset_otp`).
- [x] Fitur absensi kegiatan via QR Code (self check-in Generus, fallback kode manual 6-digit) — lihat `components/PresensiPanel.tsx` & ARCHITECTURE.md §10.
- [~] Fitur absensi via Kartu RFID (mode kiosk, dioperasikan Pengurus) — skema, RPC, dan UI sudah lengkap (ARCHITECTURE.md §11), tapi **dikunci non-aktif** lewat `RFID_PRESENSI_READY = false` di `lib/rfid.ts` sampai diuji pakai reader USB fisik sungguhan. E-money belum digarap.
- [ ] PWA (Progressive Web App) sebagai jembatan sebelum native app
- [ ] Native mobile app pakai Flutter (Android duluan, iOS menyusul)
- [ ] Migrasi ownership Supabase, Vercel, Resend, dan domain Hostinger ke akun `generusbekasitimur@gmail.com` setelah app matang

## Checklist Sebelum Commit/Deploy

- [ ] Tidak ada API key/secret yang ter-hardcode di kode
- [ ] RLS aktif di semua tabel yang diakses dari frontend
- [ ] Sudah dites di local (`npm run dev`) sebelum push
- [ ] Environment variable di Vercel sudah sesuai dengan yang dipakai di kode
