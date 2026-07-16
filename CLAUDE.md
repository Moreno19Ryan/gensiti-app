# CLAUDE.md — GENSITI

Dokumen ini dibaca otomatis oleh Claude Code di setiap awal sesi. Isi konteks project, standar coding, dan aturan yang harus diikuti.

## Tentang Project

**Nama:** GENSITI (dulu bernama RYZA)
**Untuk:** Generus Bekasi Timur (organisasi)
**Developer:** Solo developer (Reno)
**Tujuan:** Web app untuk manajemen organisasi Generus Bekasi Timur

## Tech Stack

| Layer | Teknologi |
|---|---|
| Frontend | Next.js / React (`.tsx`, `.jsx`) |
| Backend & Database | Supabase (PostgreSQL, Auth, Storage, Realtime) |
| Hosting Frontend | Vercel |
| Email Service | Resend (untuk OTP, notifikasi, reset password) |
| Domain & DNS | hPanel Hostinger |
| Script tambahan | Google Apps Script (GAS) |

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

- [ ] Fitur reset password via OTP email (Supabase Auth + Resend)
- [ ] Fitur absensi kegiatan (mulai dari QR Code, nanti bisa RFID/E-money)
- [ ] PWA (Progressive Web App) sebagai jembatan sebelum native app
- [ ] Native mobile app pakai Flutter (Android duluan, iOS menyusul)
- [ ] Migrasi ownership Supabase, Vercel, Resend, dan domain Hostinger ke akun `generusbekasitimur@gmail.com` setelah app matang

## Checklist Sebelum Commit/Deploy

- [ ] Tidak ada API key/secret yang ter-hardcode di kode
- [ ] RLS aktif di semua tabel yang diakses dari frontend
- [ ] Sudah dites di local (`npm run dev`) sebelum push
- [ ] Environment variable di Vercel sudah sesuai dengan yang dipakai di kode
