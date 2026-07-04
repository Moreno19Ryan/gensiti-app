import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

// Endpoint publik (dipanggil SEBELUM ada sesi Supabase, dari halaman login) untuk
// menerjemahkan "nama pengguna" yang diketik user menjadi email asli yang tersimpan di
// public.users.email -- email itu sendiri TETAP jadi identitas asli di Supabase Auth
// (dipakai signInWithPassword di client setelah endpoint ini merespons) dan tetap dipakai
// utuh oleh seluruh sistem notifikasi email (lihat trigger trg_notify_email_* di database),
// jadi tidak ada perubahan apapun pada alur notifikasi.
//
// Pakai service role karena RLS tabel users mengharuskan sesi aktif (autentikasi dulu),
// padahal endpoint ini justru dipanggil SEBELUM autentikasi terjadi. Untuk mencegah endpoint
// ini disalahgunakan sebagai celah enumerasi akun (menebak nama mana saja yang terdaftar),
// responsnya SENGAJA tidak membedakan "nama tidak ditemukan" vs "error lain" -- keduanya
// balik sebagai objek yang sama, dan HANYA field email yang pernah dikembalikan (bukan
// data profil lain).
function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export async function POST(req: NextRequest) {
  try {
    const { username } = await req.json()
    if (!username || typeof username !== 'string') {
      return NextResponse.json({ error: 'Nama pengguna wajib diisi' }, { status: 400 })
    }

    // Normalisasi HARUS identik dengan yang dilakukan di app/login/page.tsx (klien) dan
    // generateUniqueLoginUsername di app/api/users/route.ts (saat akun dibuat) -- trim
    // ujung + collapse spasi ganda jadi satu + uppercase. Kalau salah satu berubah tanpa
    // yang lain, nama dengan spasi tidak rapi (mis. "MORENO  RYANDIKA") bisa gagal cocok
    // padahal secara maksud sama persis.
    const normalized = username.trim().replace(/\s+/g, ' ').toUpperCase()
    if (!normalized) {
      return NextResponse.json({ error: 'Nama pengguna wajib diisi' }, { status: 400 })
    }

    const supabaseAdmin = adminClient()
    const { data } = await supabaseAdmin
      .from('users')
      .select('email')
      .eq('login_username', normalized)
      .eq('is_active', true)
      .maybeSingle()

    if (!data?.email) {
      // Sengaja pesan generik -- sama seperti kredensial salah, supaya tidak bisa dipakai
      // menebak nama pengguna mana saja yang valid/aktif.
      return NextResponse.json({ error: 'Nama pengguna atau password salah' }, { status: 404 })
    }

    return NextResponse.json({ email: data.email })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
