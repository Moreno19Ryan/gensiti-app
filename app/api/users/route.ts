import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

interface Caller {
  id: string
  tingkatan: string | null
  nama_role: string | null
  desa_id: string | null
  kelompok_id: string | null
}

// Memverifikasi bearer token dari header Authorization dan mengambil profil + role pemanggil.
// Semua endpoint di file ini memakai service role key (bypass RLS), jadi verifikasi ini WAJIB
// dilakukan manual di server — tanpa ini siapapun bisa memanggil endpoint tanpa login sama sekali.
async function getCaller(req: NextRequest, supabaseAdmin: ReturnType<typeof adminClient>): Promise<Caller | null> {
  const authHeader = req.headers.get('authorization') || ''
  const token = authHeader.replace(/^Bearer\s+/i, '')
  if (!token) return null

  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token)
  if (userErr || !userData.user) return null

  const { data: profile } = await supabaseAdmin
    .from('users')
    .select('id, desa_id, kelompok_id, is_active, roles:role_id(nama_role, tingkatan)')
    .eq('id', userData.user.id)
    .single()

  if (!profile || profile.is_active === false) return null

  const role = profile.roles as { nama_role?: string; tingkatan?: string } | { nama_role?: string; tingkatan?: string }[] | null
  const roleObj = Array.isArray(role) ? role[0] : role

  return {
    id: profile.id,
    tingkatan: roleObj?.tingkatan || null,
    nama_role: roleObj?.nama_role || null,
    desa_id: profile.desa_id,
    kelompok_id: profile.kelompok_id,
  }
}

// Hanya Ketua/Wakil Ketua (semua scope) dan Super Admin yang boleh mengelola anggota lain.
function canManageMembers(caller: Caller): boolean {
  if (caller.tingkatan === 'super_admin') return true
  return !!caller.nama_role && caller.nama_role.toLowerCase().includes('ketua')
}

// Cek apakah caller berwenang bertindak atas target berdasarkan scope desa/kelompok.
function canActOnScope(caller: Caller, targetDesaId: string | null, targetKelompokId: string | null): boolean {
  if (!canManageMembers(caller)) return false
  if (caller.tingkatan === 'super_admin' || caller.tingkatan === 'daerah') return true
  if (caller.tingkatan === 'desa') return targetDesaId === caller.desa_id
  if (caller.tingkatan === 'kelompok') return targetKelompokId === caller.kelompok_id
  return false
}

// Super Admin adalah akun tunggal & mutlak — tidak boleh ada akun kedua yang dibuat
// dengan role bertingkatan super_admin, oleh siapapun (termasuk sesama Super Admin),
// lewat jalur aplikasi ini. Perubahan role sistem hanya boleh terjadi langsung di database.
async function isSuperAdminRole(supabaseAdmin: ReturnType<typeof adminClient>, roleId: string | null | undefined): Promise<boolean> {
  if (!roleId) return false
  const { data } = await supabaseAdmin.from('roles').select('tingkatan').eq('id', roleId).single()
  return data?.tingkatan === 'super_admin'
}

// GET: Ambil data anggota by userId (server-side, bypass RLS)
// Diizinkan untuk: pemilik data sendiri, atau pengguna yang berwenang mengelola anggota (Ketua/Wakil/Super Admin).
export async function GET(req: NextRequest) {
  try {
    const supabaseAdmin = adminClient()
    const caller = await getCaller(req, supabaseAdmin)
    if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const userId = searchParams.get('userId')
    if (!userId) return NextResponse.json({ error: 'userId wajib diisi' }, { status: 400 })

    if (userId !== caller.id && !canManageMembers(caller)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

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
// Hanya boleh dipanggil oleh Ketua/Wakil Ketua/Super Admin.
export async function POST(req: NextRequest) {
  try {
    const supabaseAdmin = adminClient()
    const caller = await getCaller(req, supabaseAdmin)
    if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!canManageMembers(caller)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

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

    // Admin desa/kelompok hanya boleh membuat user dalam scope-nya sendiri
    if (!canActOnScope(caller, desa_id || null, kelompok_id || null)) {
      return NextResponse.json({ error: 'Anda tidak berwenang membuat pengguna di luar scope Anda.' }, { status: 403 })
    }

    // Super Admin adalah akun tunggal mutlak — tidak boleh ada user baru dibuat dengan role ini.
    if (await isSuperAdminRole(supabaseAdmin, role_id)) {
      return NextResponse.json({ error: 'Tidak dapat membuat pengguna dengan role Super Admin.' }, { status: 403 })
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
    const caller = await getCaller(req, supabaseAdmin)
    if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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

    // Proteksi super_admin: cek role & scope target sebelum mengizinkan perubahan
    const { data: targetUserRole } = await supabaseAdmin
      .from('users')
      .select('desa_id, kelompok_id, roles:role_id(tingkatan)')
      .eq('id', id)
      .single()
    const targetRole = targetUserRole?.roles as { tingkatan?: string } | { tingkatan?: string }[] | null
    const isTargetSuperAdmin = (Array.isArray(targetRole) ? targetRole[0]?.tingkatan : targetRole?.tingkatan) === 'super_admin'

    const isSelf = id === caller.id
    // Otorisasi: harus salah satu dari — mengubah data diri sendiri, atau berwenang
    // mengelola anggota lain dalam scope-nya (Ketua/Wakil/Super Admin sesuai desa/kelompok).
    if (!isSelf) {
      const targetDesaId = targetUserRole?.desa_id ?? null
      const targetKelompokId = targetUserRole?.kelompok_id ?? null
      if (!canActOnScope(caller, targetDesaId, targetKelompokId)) {
        return NextResponse.json({ error: 'Anda tidak berwenang mengubah pengguna ini.' }, { status: 403 })
      }
    }

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

    // Field administratif (role, scope, status akun) hanya boleh diubah oleh yang berwenang
    // mengelola anggota — mencegah pengguna menaikkan hak aksesnya sendiri lewat halaman profil.
    const hasAdminFields = role_id !== undefined || is_active !== undefined || archive !== undefined
    if (hasAdminFields && !canManageMembers(caller)) {
      return NextResponse.json({ error: 'Anda tidak berwenang mengubah role atau status akun.' }, { status: 403 })
    }

    // Super Admin adalah akun tunggal mutlak — role_id siapapun tidak boleh diarahkan
    // menjadi Super Admin lewat aplikasi ini, oleh siapapun termasuk Super Admin itu sendiri.
    if (role_id !== undefined && await isSuperAdminRole(supabaseAdmin, role_id)) {
      return NextResponse.json({ error: 'Tidak dapat mengubah role pengguna menjadi Super Admin.' }, { status: 403 })
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
