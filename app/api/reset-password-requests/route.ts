import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

// Memverifikasi bearer token dan memastikan pemanggil adalah Super Admin. Sama seperti
// app/api/users/route.ts -- endpoint ini memakai service role key (bypass RLS) untuk bisa
// mengubah password akun ORANG LAIN lewat supabase.auth.admin, jadi verifikasi manual di
// server ini WAJIB, bukan opsional. Reset password sengaja dibatasi HANYA Super Admin
// (bukan Ketua/Wakil manapun) sesuai kesepakatan: RLS reset_password_requests juga sudah
// membatasi SELECT/UPDATE tabel ini hanya untuk get_user_role() = 'super_admin'.
async function requireSuperAdmin(req: NextRequest, supabaseAdmin: ReturnType<typeof adminClient>): Promise<{ id: string } | null> {
  const authHeader = req.headers.get('authorization') || ''
  const token = authHeader.replace(/^Bearer\s+/i, '')
  if (!token) return null

  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token)
  if (userErr || !userData.user) return null

  const { data: profile } = await supabaseAdmin
    .from('users')
    .select('id, is_active, roles:role_id(tingkatan)')
    .eq('id', userData.user.id)
    .single()

  if (!profile || profile.is_active === false) return null
  const role = profile.roles as { tingkatan?: string } | { tingkatan?: string }[] | null
  const roleObj = Array.isArray(role) ? role[0] : role
  if (roleObj?.tingkatan !== 'super_admin') return null

  return { id: profile.id }
}

// GET: daftar permintaan reset password (untuk Super Admin saja)
export async function GET(req: NextRequest) {
  try {
    const supabaseAdmin = adminClient()
    const caller = await requireSuperAdmin(req, supabaseAdmin)
    if (!caller) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { data, error } = await supabaseAdmin
      .from('reset_password_requests')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ data: data || [] })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// POST: proses satu permintaan -- set password baru untuk akun bersangkutan (by email) dan
// tandai permintaan sebagai processed/ditolak.
export async function POST(req: NextRequest) {
  try {
    const supabaseAdmin = adminClient()
    const caller = await requireSuperAdmin(req, supabaseAdmin)
    if (!caller) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { requestId, action, newPassword, notes } = await req.json()
    if (!requestId || !action) {
      return NextResponse.json({ error: 'requestId dan action wajib diisi' }, { status: 400 })
    }

    const { data: reqRow } = await supabaseAdmin
      .from('reset_password_requests')
      .select('*')
      .eq('id', requestId)
      .single()
    if (!reqRow) return NextResponse.json({ error: 'Permintaan tidak ditemukan' }, { status: 404 })

    if (action === 'reject') {
      const { error } = await supabaseAdmin
        .from('reset_password_requests')
        .update({ status: 'ditolak', processed_at: new Date().toISOString(), processed_by: caller.id, notes: notes || null })
        .eq('id', requestId)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ success: true })
    }

    if (action === 'process') {
      if (!newPassword || String(newPassword).length < 6) {
        return NextResponse.json({ error: 'Password baru wajib diisi, minimal 6 karakter' }, { status: 400 })
      }

      // Cari akun berdasarkan email yang tertulis di permintaan
      const { data: targetUser } = await supabaseAdmin
        .from('users')
        .select('id, email')
        .ilike('email', reqRow.email)
        .maybeSingle()

      if (!targetUser) {
        return NextResponse.json({ error: `Tidak ditemukan akun dengan email ${reqRow.email}. Periksa kembali permintaan atau tolak jika tidak valid.` }, { status: 404 })
      }

      const { error: pwError } = await supabaseAdmin.auth.admin.updateUserById(targetUser.id, { password: newPassword })
      if (pwError) return NextResponse.json({ error: pwError.message }, { status: 400 })

      const { error: updateError } = await supabaseAdmin
        .from('reset_password_requests')
        .update({ status: 'processed', processed_at: new Date().toISOString(), processed_by: caller.id, notes: notes || null })
        .eq('id', requestId)
      if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })

      // Kirim email otomatis berisi password baru -- supaya user tidak harus menunggu
      // Super Admin menghubungi manual satu-satu (Super Admin tidak online 24/7). Pakai RPC
      // notify_email yang sudah ada (dipakai juga oleh trigger pengumuman/kegiatan/approval_ppg),
      // yang membungkus pemanggilan edge function send-email beserta secret internalnya.
      // Kegagalan kirim email TIDAK membatalkan proses reset password -- password sudah
      // terlanjur berhasil diubah, jadi kegagalan ini hanya dicatat, tidak menggagalkan respons.
      try {
        const emailHtml = await supabaseAdmin.rpc('build_email_html', {
          p_tipe: 'reset_password',
          p_data: { password_baru: newPassword },
        })
        if (!emailHtml.error) {
          // p_reference_id bertipe uuid di kolom lain (kegiatan.id, pengumuman.id dst),
          // sedangkan id reset_password_requests adalah bigint -- jadi sengaja tidak dikirim
          // (biarkan default NULL) supaya tidak error "invalid input syntax for type uuid".
          await supabaseAdmin.rpc('notify_email', {
            p_to: [targetUser.email],
            p_subject: 'Password Akun GENSITI Anda Telah Diperbarui',
            p_html: emailHtml.data,
            p_tipe: 'reset_password',
          })
        }
      } catch (emailErr) {
        console.error('Gagal mengirim email reset password:', emailErr)
      }

      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'action tidak dikenali' }, { status: 400 })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
