import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

// Endpoint ini KHUSUS biodata Generus (tempat lahir, jenis kelamin, nama ortu/wali, dll).
// Dipisah dari app/api/users/route.ts (yang murni akun: email, no_hp, role, status aktif)
// supaya tiap endpoint punya satu tanggung jawab jelas -- sebelumnya satu file PATCH
// mencampur field akun & biodata sekaligus, membuat validasi & otorisasi sulit dibaca dan
// caller yang sebenarnya cuma butuh satu domain (mis. profil/page.tsx saveDataDiri) terpaksa
// ikut mengirim field akun (nama_lengkap) hanya supaya lolos pengecekan di server.
//
// CATATAN PENTING -- alur PEMBUATAN akun baru (POST /api/users) TIDAK dipindah ke sini.
// Membuat akun + biodata generus tetap satu transaksi di app/api/users/route.ts POST,
// karena keduanya memang harus tercipta bersamaan (biodata butuh user_id dari akun yang
// baru dibuat) dan alur itu sudah teruji -- memecahnya jadi 2 request berurutan dari
// frontend hanya menambah risiko partial-failure tanpa manfaat kejelasan yang sepadan.

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

// Duplikat kecil dari app/api/users/route.ts (getCaller, canManageMembers, canActOnScope).
// Sengaja tidak diekstrak ke modul bersama supaya masing-masing endpoint tetap independen
// dan tidak saling mematahkan lewat perubahan yang niatnya cuma menyentuh satu domain.
async function getCaller(req: NextRequest, supabaseAdmin: ReturnType<typeof adminClient>): Promise<{ caller: Caller | null; reason?: string }> {
  const authHeader = req.headers.get('authorization') || ''
  const token = authHeader.replace(/^Bearer\s+/i, '')
  if (!token) {
    return { caller: null, reason: 'Tidak ada token autentikasi (silakan login ulang).' }
  }

  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token)
  if (userErr || !userData.user) {
    return { caller: null, reason: `Sesi tidak valid: ${userErr?.message || 'user tidak ditemukan'} (silakan login ulang).` }
  }

  const { data: profile, error: profileErr } = await supabaseAdmin
    .from('users')
    .select('id, desa_id, kelompok_id, is_active, roles:role_id(nama_role, tingkatan)')
    .eq('id', userData.user.id)
    .single()

  if (profileErr) {
    return { caller: null, reason: `Gagal memuat profil: ${profileErr.message}` }
  }
  if (!profile) {
    return { caller: null, reason: 'Profil pengguna tidak ditemukan di database.' }
  }
  if (profile.is_active === false) {
    return { caller: null, reason: 'Akun tidak aktif.' }
  }

  const role = profile.roles as { nama_role?: string; tingkatan?: string } | { nama_role?: string; tingkatan?: string }[] | null
  const roleObj = Array.isArray(role) ? role[0] : role

  return {
    caller: {
      id: profile.id,
      tingkatan: roleObj?.tingkatan || null,
      nama_role: roleObj?.nama_role || null,
      desa_id: profile.desa_id,
      kelompok_id: profile.kelompok_id,
    },
  }
}

// Harus SELALU konsisten dengan canManageMembers() di lib/roles.ts dan di
// app/api/users/route.ts -- lihat komentar di sana.
function canManageMembers(caller: Caller): boolean {
  if (caller.tingkatan === 'super_admin') return true
  if (!caller.nama_role) return false
  const nama = caller.nama_role.toLowerCase()
  return nama.includes('ketua') || nama.includes('sekretaris')
}

function canActOnScope(caller: Caller, targetDesaId: string | null, targetKelompokId: string | null): boolean {
  if (!canManageMembers(caller)) return false
  if (caller.tingkatan === 'super_admin' || caller.tingkatan === 'daerah') return true
  if (caller.tingkatan === 'desa') return targetDesaId === caller.desa_id
  if (caller.tingkatan === 'kelompok') return targetKelompokId === caller.kelompok_id
  return false
}

// GET: Ambil biodata Generus by userId (server-side, bypass RLS)
// Diizinkan untuk: pemilik data sendiri, atau pengguna yang berwenang mengelola Generus.
export async function GET(req: NextRequest) {
  try {
    const supabaseAdmin = adminClient()
    const { caller, reason } = await getCaller(req, supabaseAdmin)
    if (!caller) return NextResponse.json({ error: reason || 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const userId = searchParams.get('userId')
    if (!userId) return NextResponse.json({ error: 'userId wajib diisi' }, { status: 400 })

    if (userId !== caller.id && !canManageMembers(caller)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { data, error } = await supabaseAdmin
      .from('generus')
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

// PATCH: Update biodata Generus murni (bukan field akun). Dipakai oleh:
// - profil/page.tsx saveDataDiri (edit biodata sendiri)
// - data-generus/page.tsx (edit biodata generus lain oleh Ketua/Wakil/Sekretaris)
// Field akun (nama_lengkap, no_hp, role_id, is_active, dst) TIDAK diterima di sini --
// itu tetap lewat app/api/users/route.ts PATCH.
export async function PATCH(req: NextRequest) {
  try {
    const supabaseAdmin = adminClient()
    const { caller, reason } = await getCaller(req, supabaseAdmin)
    if (!caller) return NextResponse.json({ error: reason || 'Unauthorized' }, { status: 401 })

    const {
      user_id, generus_id,
      nama_panggilan, tempat_lahir, tanggal_lahir, jenis_kelamin, alamat,
      tinggi_badan, berat_badan, kelas_ngaji,
      nama_ayah, nama_ibu, nama_wali, no_hp_orangtua_wali,
      status_anggota, status_pengguna,
      pindah_desa_id, pindah_kelompok_id, pindah_ke_daerah_lain,
      desa_id, kelompok_id,
      anak_ke, jumlah_saudara,
    } = await req.json()

    if (!user_id) return NextResponse.json({ error: 'user_id wajib diisi' }, { status: 400 })

    const isSelf = user_id === caller.id
    // Otorisasi: harus salah satu dari — mengubah biodata diri sendiri, atau berwenang
    // mengelola Generus lain dalam scope-nya. Sama seperti users/route.ts PATCH.
    if (!isSelf) {
      const { data: targetUserRole } = await supabaseAdmin
        .from('users')
        .select('desa_id, kelompok_id')
        .eq('id', user_id)
        .single()
      const targetDesaId = targetUserRole?.desa_id ?? null
      const targetKelompokId = targetUserRole?.kelompok_id ?? null
      if (!canActOnScope(caller, targetDesaId, targetKelompokId)) {
        return NextResponse.json({ error: 'Anda tidak berwenang mengubah biodata pengguna ini.' }, { status: 403 })
      }
    }

    // Field administratif (status_anggota, status_pengguna, pindah sambung) hanya boleh
    // diubah oleh yang berwenang mengelola Generus -- sama seperti larangan di users/route.ts,
    // mencegah pengguna mengubah status keanggotaannya sendiri lewat halaman profil.
    const hasAdminFields = status_anggota !== undefined || status_pengguna !== undefined
      || pindah_desa_id !== undefined || pindah_kelompok_id !== undefined || pindah_ke_daerah_lain !== undefined
    if (hasAdminFields && !canManageMembers(caller)) {
      return NextResponse.json({ error: 'Anda tidak berwenang mengubah status keanggotaan.' }, { status: 403 })
    }

    const generusPayload: Record<string, unknown> = {}
    if (nama_panggilan !== undefined) generusPayload.nama_panggilan = nama_panggilan || null
    if (tempat_lahir !== undefined) generusPayload.tempat_lahir = tempat_lahir || null
    if (tanggal_lahir !== undefined) generusPayload.tanggal_lahir = tanggal_lahir || null
    if (jenis_kelamin !== undefined) generusPayload.jenis_kelamin = jenis_kelamin || null
    if (alamat !== undefined) generusPayload.alamat = alamat || null
    if (tinggi_badan !== undefined) generusPayload.tinggi_badan = tinggi_badan || null
    if (berat_badan !== undefined) generusPayload.berat_badan = berat_badan || null
    if (kelas_ngaji !== undefined) generusPayload.kelas_ngaji = kelas_ngaji || null
    if (desa_id !== undefined) generusPayload.desa_id = desa_id || null
    if (kelompok_id !== undefined) generusPayload.kelompok_id = kelompok_id || null
    if (status_anggota !== undefined) generusPayload.status = status_anggota
    if (nama_ayah !== undefined) generusPayload.nama_ayah = nama_ayah || null
    if (nama_ibu !== undefined) generusPayload.nama_ibu = nama_ibu || null
    if (nama_wali !== undefined) generusPayload.nama_wali = nama_wali || null
    if (no_hp_orangtua_wali !== undefined) generusPayload.no_hp_orangtua_wali = no_hp_orangtua_wali || null
    if (status_pengguna !== undefined) generusPayload.status_pengguna = status_pengguna
    if (pindah_desa_id !== undefined) generusPayload.pindah_desa_id = pindah_desa_id || null
    if (pindah_kelompok_id !== undefined) generusPayload.pindah_kelompok_id = pindah_kelompok_id || null
    if (pindah_ke_daerah_lain !== undefined) generusPayload.pindah_ke_daerah_lain = pindah_ke_daerah_lain === true
    if (anak_ke !== undefined) generusPayload.anak_ke = anak_ke || null
    if (jumlah_saudara !== undefined) generusPayload.jumlah_saudara = jumlah_saudara || null

    if (Object.keys(generusPayload).length === 0) {
      return NextResponse.json({ success: true })
    }

    // Selalu cari generus by user_id dulu (lebih reliable daripada upsert tanpa constraint).
    // generus_id opsional dari caller dipakai sbg shortcut kalau sudah tahu, tapi tetap
    // fallback ke lookup by user_id supaya tidak gagal kalau caller tidak mengirimkannya.
    let existingId: string | null = generus_id || null
    if (!existingId) {
      const { data: existingGenerus } = await supabaseAdmin
        .from('generus')
        .select('id')
        .eq('user_id', user_id)
        .single()
      existingId = existingGenerus?.id || null
    }

    // Error di sini SELALU dikembalikan sebagai response error yang jelas (bukan
    // console.error diam-diam) -- lihat insiden bug jenis_kelamin di commit 0d4cfd6:
    // CHECK constraint database yang menolak value salah format sempat menggagalkan
    // seluruh insert/update tanpa admin pernah tahu karena endpoint tetap balas success.
    if (existingId) {
      const { error: generusErr } = await supabaseAdmin
        .from('generus')
        .update(generusPayload)
        .eq('id', existingId)
      if (generusErr) {
        console.error('Generus update error:', generusErr.message)
        return NextResponse.json({ error: `Gagal menyimpan data Generus: ${generusErr.message}` }, { status: 500 })
      }
    } else {
      const { error: generusErr } = await supabaseAdmin
        .from('generus')
        .insert({ ...generusPayload, user_id, status: 'aktif', status_pengguna: 'lajang' })
      if (generusErr) {
        console.error('Generus insert error:', generusErr.message)
        return NextResponse.json({ error: `Gagal menyimpan data Generus: ${generusErr.message}` }, { status: 500 })
      }
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
