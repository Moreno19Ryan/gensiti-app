import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'

// Endpoint untuk mengklaim "sesi aktif tunggal" -- dipanggil client SEKALI, tepat setelah
// signInWithPassword berhasil (lihat app/login/page.tsx), SEBELUM redirect ke dashboard.
// Alur single-session: setiap login lewat FORM LOGIN (bukan reload/tab baru di browser yang
// sama -- itu memakai sesi tersimpan & tidak memanggil endpoint ini) menghasilkan token acak
// baru yang disimpan di kolom users.active_session_token DAN di localStorage browser
// tsb. Kalau nanti ada browser LAIN login dgn akun yang sama, token di database akan
// tertimpa token baru itu -- browser PERTAMA (lama) tidak di-logout paksa oleh sistem,
// tapi begitu dia reload/navigasi, lib/user-context.tsx akan mendeteksi token lokalnya
// tidak lagi cocok dengan token di database, lalu menampilkan peringatan & memaksa
// logout HANYA sesi itu sendiri (bukan sesi baru yang menggantikannya).
//
// Pakai service role karena tabel users tidak punya policy UPDATE untuk self (hanya
// SELECT self yang diizinkan) -- update kolom administratif seperti ini konsisten dengan
// pola PATCH /api/users yang sudah ada.
function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '')
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const supabaseAdmin = adminClient()
    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token)
    if (userErr || !userData.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const sessionToken = randomUUID()

    const { error } = await supabaseAdmin
      .from('users')
      .update({ active_session_token: sessionToken, active_session_created_at: new Date().toISOString() })
      .eq('id', userData.user.id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ sessionToken })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
