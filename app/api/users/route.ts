import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

// GET: Ambil data anggota by userId (server-side, bypass RLS)
export async function GET(req: NextRequest) {
  try {
    const supabaseAdmin = adminClient()
    const { searchParams } = new URL(req.url)
    const userId = searchParams.get('userId')
    if (!userId) return NextResponse.json({ error: 'userId wajib diisi' }, { status: 400 })

    const { data, error } = await supabaseAdmin
      .from('anggota')
      .select('*')
      .eq('user_id', userId)
      .single()

    if (error && error.code !== 'PGRST116') {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ data: data || null })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// POST: Buat user baru + anggota record
export async function POST(req: NextRequest) {
  try {
    const supabaseAdmin = adminClient()
    const {
      email, password, nama_lengkap, no_hp,
      role_id, desa_id, kelompok_id,
      tempat_lahir, tanggal_lahir, jenis_kelamin, alamat,
      nama_ayah, nama_ibu, nama_wali, no_hp_orangtua_wali,
      nama_orang_tua, no_hp_orang_tua,
      status_anggota,
      status_pengguna,
      anak_ke,
      jumlah_saudara,
    } = await req.json()

    if (!email || !password || !nama_lengkap) {
      return NextResponse.json({ error: 'Email, password, dan nama wajib diisi' }, { status: 400 })
    }

    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })
    if (authError) return NextResponse.json({ error: authError.message }, { status: 400 })

    const userId = authData.user.id

    const { error: profileError } = await supabaseAdmin.from('users').insert({
      id: userId,
      email,
      nama_lengkap,
      no_hp: no_hp || null,
      role_id: role_id || null,
      desa_id: desa_id || null,
      kelompok_id: kelompok_id || null,
      is_active: true,
      is_archived: false,
    })

    if (profileError) {
      await supabaseAdmin.auth.admin.deleteUser(userId)
      return NextResponse.json({ error: profileError.message }, { status: 500 })
    }

    const { error: anggotaError } = await supabaseAdmin.from('anggota').insert({
      user_id: userId,
      nama_lengkap,
      tempat_lahir: tempat_lahir || null,
      tanggal_lahir: tanggal_lahir || null,
      jenis_kelamin: jenis_kelamin || null,
      alamat: alamat || null,
      desa_id: desa_id || null,
      kelompok_id: kelompok_id || null,
      status: status_anggota || 'aktif',
      nama_ayah: nama_ayah || null,
      nama_ibu: nama_ibu || null,
      nama_wali: nama_wali || null,
      no_hp_orangtua_wali: no_hp_orangtua_wali || null,
      nama_orang_tua: nama_ayah || nama_orang_tua || null,
      no_hp_orang_tua: no_hp_orangtua_wali || no_hp_orang_tua || null,
      status_pengguna: status_pengguna || 'lajang',
      pindah_ke_daerah_lain: false,
      anak_ke: anak_ke || null,
      jumlah_saudara: jumlah_saudara || null,
    })

    if (anggotaError) {
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
      avatar_url,
      anggota_id, tempat_lahir, tanggal_lahir, jenis_kelamin, alamat,
      nama_ayah, nama_ibu, nama_wali, no_hp_orangtua_wali,
      nama_orang_tua, no_hp_orang_tua,
      status_anggota,
      status_pengguna,
      pindah_desa_id, pindah_kelompok_id, pindah_ke_daerah_lain,
      archive, alasan_arsip,
      anak_ke, jumlah_saudara,
    } = await req.json()

    if (!id) return NextResponse.json({ error: 'ID wajib diisi' }, { status: 400 })

    // Proteksi super_admin: cek role target sebelum mengizinkan perubahan
    const { data: targetUserRole } = await supabaseAdmin
      .from('users')
      .select('roles:role_id(tingkatan)')
      .eq('id', id)
      .single()
    const isTargetSuperAdmin = (targetUserRole?.roles as any)?.tingkatan === 'super_admin'

    if (isTargetSuperAdmin) {
      // Super admin HANYA boleh update: no_hp, avatar_url, dan password
      // Semua field lain — termasuk nama_lengkap — diblokir sepenuhnya
      const hasProtectedFields = nama_lengkap !== undefined
        || role_id !== undefined || desa_id !== undefined || kelompok_id !== undefined
        || is_active !== undefined || archive !== undefined
        || tempat_lahir !== undefined || tanggal_lahir !== undefined
        || jenis_kelamin !== undefined || alamat !== undefined
        || nama_ayah !== undefined || nama_ibu !== undefined
        || status_pengguna !== undefined || status_anggota !== undefined
      if (hasProtectedFields) {
        return NextResponse.json({ error: 'Profil Super Admin tidak dapat diubah.' }, { status: 403 })
      }
    }

    if (password) {
      await supabaseAdmin.auth.admin.updateUserById(id, { password })
    }

    const userPayload: Record<string, unknown> = {}
    if (nama_lengkap !== undefined) userPayload.nama_lengkap = nama_lengkap
    if (no_hp !== undefined) userPayload.no_hp = no_hp || null
    if (role_id !== undefined) userPayload.role_id = role_id || null
    if (desa_id !== undefined) userPayload.desa_id = desa_id || null
    if (kelompok_id !== undefined) userPayload.kelompok_id = kelompok_id || null
    if (is_active !== undefined) userPayload.is_active = is_active
    if (avatar_url !== undefined) {
      userPayload.avatar_url = avatar_url || null
      userPayload.foto_url = avatar_url || null
    }

    if (archive === true) {
      userPayload.is_active = false
      userPayload.is_archived = true
      userPayload.alasan_arsip = alasan_arsip || 'Tidak diketahui'
      userPayload.tanggal_arsip = new Date().toISOString()
    }

    if (Object.keys(userPayload).length > 0) {
      const { error } = await supabaseAdmin.from('users').update(userPayload).eq('id', id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const hasAnggotaFields = anggota_id != null
      || tempat_lahir !== undefined
      || tanggal_lahir !== undefined
      || jenis_kelamin !== undefined
      || alamat !== undefined
      || nama_ayah !== undefined
      || nama_ibu !== undefined
      || nama_wali !== undefined
      || no_hp_orangtua_wali !== undefined
      || anak_ke !== undefined
      || jumlah_saudara !== undefined
      || status_pengguna !== undefined
      || status_anggota !== undefined
      || nama_orang_tua !== undefined
      || pindah_ke_daerah_lain !== undefined

    if (hasAnggotaFields) {
      const anggotaPayload: Record<string, unknown> = {}
      if (nama_lengkap !== undefined) anggotaPayload.nama_lengkap = nama_lengkap || null
      if (tempat_lahir !== undefined) anggotaPayload.tempat_lahir = tempat_lahir || null
      if (tanggal_lahir !== undefined) anggotaPayload.tanggal_lahir = tanggal_lahir || null
      if (jenis_kelamin !== undefined) anggotaPayload.jenis_kelamin = jenis_kelamin || null
      if (alamat !== undefined) anggotaPayload.alamat = alamat || null
      if (desa_id !== undefined) anggotaPayload.desa_id = desa_id || null
      if (kelompok_id !== undefined) anggotaPayload.kelompok_id = kelompok_id || null
      if (status_anggota !== undefined) anggotaPayload.status = status_anggota
      if (nama_ayah !== undefined) {
        anggotaPayload.nama_ayah = nama_ayah || null
        anggotaPayload.nama_orang_tua = nama_ayah || null
      }
      if (nama_ibu !== undefined) anggotaPayload.nama_ibu = nama_ibu || null
      if (nama_wali !== undefined) anggotaPayload.nama_wali = nama_wali || null
      if (no_hp_orangtua_wali !== undefined) {
        anggotaPayload.no_hp_orangtua_wali = no_hp_orangtua_wali || null
        anggotaPayload.no_hp_orang_tua = no_hp_orangtua_wali || null
      }
      if (nama_orang_tua !== undefined && !nama_ayah) anggotaPayload.nama_orang_tua = nama_orang_tua || null
      if (no_hp_orang_tua !== undefined && !no_hp_orangtua_wali) anggotaPayload.no_hp_orang_tua = no_hp_orang_tua || null
      if (status_pengguna !== undefined) anggotaPayload.status_pengguna = status_pengguna
      if (pindah_desa_id !== undefined) anggotaPayload.pindah_desa_id = pindah_desa_id || null
      if (pindah_kelompok_id !== undefined) anggotaPayload.pindah_kelompok_id = pindah_kelompok_id || null
      if (pindah_ke_daerah_lain !== undefined) anggotaPayload.pindah_ke_daerah_lain = pindah_ke_daerah_lain === true
      if (anak_ke !== undefined) anggotaPayload.anak_ke = anak_ke || null
      if (jumlah_saudara !== undefined) anggotaPayload.jumlah_saudara = jumlah_saudara || null

      if (Object.keys(anggotaPayload).length > 0) {
        // Selalu cari anggota by user_id dulu (lebih reliable daripada upsert tanpa constraint)
        const { data: existingAnggota } = await supabaseAdmin
          .from('anggota')
          .select('id')
          .eq('user_id', id)
          .single()

        if (existingAnggota?.id) {
          const { error: anggotaErr } = await supabaseAdmin
            .from('anggota')
            .update(anggotaPayload)
            .eq('id', existingAnggota.id)
          if (anggotaErr) console.error('Anggota update error:', anggotaErr.message)
        } else {
          // Buat record anggota baru jika belum ada
          const { error: anggotaErr } = await supabaseAdmin
            .from('anggota')
            .insert({ ...anggotaPayload, user_id: id, status: 'aktif', status_pengguna: 'lajang' })
          if (anggotaErr) console.error('Anggota insert error:', anggotaErr.message)
        }
      }
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
