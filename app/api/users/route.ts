import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

// POST: Buat user baru + anggota record
export async function POST(req: NextRequest) {
  try {
    const supabaseAdmin = adminClient()
    const {
      email, password, nama_lengkap, no_hp,
      role_id, desa_id, kelompok_id,
      // Data anggota (opsional)
      tanggal_lahir, jenis_kelamin, alamat,
      nama_orang_tua, no_hp_orang_tua, status_anggota,
    } = await req.json()

    if (!email || !password || !nama_lengkap) {
      return NextResponse.json({ error: 'Email, password, dan nama wajib diisi' }, { status: 400 })
    }

    // 1. Buat Supabase Auth user
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })
    if (authError) return NextResponse.json({ error: authError.message }, { status: 400 })

    const userId = authData.user.id

    // 2. Insert ke public.users
    const { error: profileError } = await supabaseAdmin.from('users').insert({
      id: userId,
      email,
      nama_lengkap,
      no_hp: no_hp || null,
      role_id: role_id || null,
      desa_id: desa_id || null,
      kelompok_id: kelompok_id || null,
      is_active: true,
    })

    if (profileError) {
      await supabaseAdmin.auth.admin.deleteUser(userId) // rollback
      return NextResponse.json({ error: profileError.message }, { status: 500 })
    }

    // 3. Insert ke anggota (server-side pakai service role agar tidak kena permission issue)
    const { error: anggotaError } = await supabaseAdmin.from('anggota').insert({
      user_id: userId,
      nama_lengkap,
      tanggal_lahir: tanggal_lahir || null,
      jenis_kelamin: jenis_kelamin || null,
      alamat: alamat || null,
      desa_id: desa_id || null,
      kelompok_id: kelompok_id || null,
      status: status_anggota || 'aktif',
      nama_orang_tua: nama_orang_tua || null,
      no_hp_orang_tua: no_hp_orang_tua || null,
    })

    if (anggotaError) {
      // anggota gagal tapi user sudah terbuat — log saja, jangan rollback
      console.error('Anggota insert error:', anggotaError.message)
    }

    return NextResponse.json({ success: true, userId })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// PATCH: Update user + anggota record
export async function PATCH(req: NextRequest) {
  try {
    const supabaseAdmin = adminClient()
    const {
      id, nama_lengkap, no_hp, role_id, desa_id, kelompok_id, is_active, password,
      // Data anggota (opsional)
      anggota_id, tanggal_lahir, jenis_kelamin, alamat,
      nama_orang_tua, no_hp_orang_tua, status_anggota,
    } = await req.json()

    if (!id) return NextResponse.json({ error: 'ID wajib diisi' }, { status: 400 })

    // Update password jika ada
    if (password) {
      await supabaseAdmin.auth.admin.updateUserById(id, { password })
    }

    // Update public.users
    const userPayload: Record<string, unknown> = {}
    if (nama_lengkap !== undefined) userPayload.nama_lengkap = nama_lengkap
    if (no_hp !== undefined) userPayload.no_hp = no_hp || null
    if (role_id !== undefined) userPayload.role_id = role_id || null
    if (desa_id !== undefined) userPayload.desa_id = desa_id || null
    if (kelompok_id !== undefined) userPayload.kelompok_id = kelompok_id || null
    if (is_active !== undefined) userPayload.is_active = is_active

    if (Object.keys(userPayload).length > 0) {
      const { error } = await supabaseAdmin.from('users').update(userPayload).eq('id', id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Update anggota jika ada data
    if (anggota_id) {
      const anggotaPayload: Record<string, unknown> = {
        nama_lengkap: nama_lengkap || null,
        tanggal_lahir: tanggal_lahir || null,
        jenis_kelamin: jenis_kelamin || null,
        alamat: alamat || null,
        desa_id: desa_id || null,
        kelompok_id: kelompok_id || null,
        status: status_anggota || 'aktif',
        nama_orang_tua: nama_orang_tua || null,
        no_hp_orang_tua: no_hp_orang_tua || null,
      }
      await supabaseAdmin.from('anggota').update(anggotaPayload).eq('id', anggota_id)
    } else if (nama_orang_tua !== undefined) {
      // Tidak ada anggota_id tapi ada data anggota → upsert by user_id
      await supabaseAdmin.from('anggota').upsert({
        user_id: id,
        nama_lengkap: nama_lengkap || null,
        tanggal_lahir: tanggal_lahir || null,
        jenis_kelamin: jenis_kelamin || null,
        alamat: alamat || null,
        desa_id: desa_id || null,
        kelompok_id: kelompok_id || null,
        status: status_anggota || 'aktif',
        nama_orang_tua: nama_orang_tua || null,
        no_hp_orang_tua: no_hp_orang_tua || null,
      }, { onConflict: 'user_id' })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
