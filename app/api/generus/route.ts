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

// Client ber-scope JWT si PEMANGGIL (anon key + token user), BUKAN service-role. Dipakai
// untuk memanggil RPC yang menegakkan otorisasi lewat auth.uid() di dalam database
// (get_generus_biodata dst) -- supaya identitas pemanggil sampai ke fungsi SQL apa adanya,
// dan seluruh aturan akses jadi satu sumber kebenaran di DB (bukan diduplikasi lagi di TS).
// Ini persis pola yang nanti dipakai client native (Flutter/desktop): mereka juga memanggil
// RPC yang sama dengan JWT mereka sendiri, tanpa menulis ulang aturannya. autoRefresh/persist
// dimatikan -- request server berumur pendek, cuma butuh token sekali pakai dari header.
function userClient(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    }
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
  // Fail-closed: apapun selain is_active TEPAT true (termasuk null/undefined) dianggap
  // TIDAK aktif -- lihat komentar identik di app/api/users/route.ts getCaller.
  if (profile.is_active !== true) {
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

// Duplikat dari generateUniqueLoginUsername() di app/api/users/route.ts (sengaja, sama seperti
// getCaller/canManageMembers/canActOnScope di atas -- masing-masing endpoint independen).
// Normalisasi HARUS identik dengan app/login/page.tsx & app/api/resolve-login/route.ts (trim +
// collapse spasi ganda + uppercase).
async function generateUniqueLoginUsername(
  supabaseAdmin: ReturnType<typeof adminClient>,
  baseName: string,
  excludeUserId: string
): Promise<string> {
  const base = baseName.trim().replace(/\s+/g, ' ').toUpperCase()
  let candidate = base
  let suffix = 2
  for (let i = 0; i < 100; i++) {
    const { data } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('login_username', candidate)
      .neq('id', excludeUserId)
      .maybeSingle()
    if (!data) return candidate
    candidate = `${base} (${suffix})`
    suffix++
  }
  return `${base} (${Date.now()})`
}

// GET: Ambil biodata Generus by userId.
// Diizinkan untuk: pemilik data sendiri, atau pengguna yang berwenang mengelola Generus
// (dalam scope-nya). FASE 3 (strangler, audit native #2): otorisasi + query sekarang
// dilakukan RPC get_generus_biodata (SECURITY DEFINER, sumber kebenaran tunggal di DB),
// bukan lagi service-role + cek manual di TS di route ini. Route TETAP ada sebagai wrapper
// tipis supaya kontrak HTTP-nya (dipanggil authFetch('/api/generus?userId=...') dari client)
// TIDAK berubah sama sekali -- client tak perlu tahu backend-nya pindah. Dipanggil dengan JWT
// si pemanggil (userClient, bukan service-role) supaya auth.uid() di dalam RPC terisi
// identitas asli; SEMUA cek (akun aktif, pemilik/scope, anti-IDOR) ditegakkan di RPC.
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const userId = searchParams.get('userId')
    if (!userId) return NextResponse.json({ error: 'userId wajib diisi' }, { status: 400 })

    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
    if (!token) {
      return NextResponse.json({ error: 'Tidak ada token autentikasi (silakan login ulang).' }, { status: 401 })
    }

    const { data, error } = await userClient(token).rpc('get_generus_biodata', { p_user_id: userId })

    if (error) {
      // Petakan SQLSTATE yang di-RAISE RPC ke status HTTP yang SAMA seperti route lama, supaya
      // perilaku yang dilihat client identik: 28000 (akun nonaktif/tak login) -> 401,
      // 42501 (bukan pemilik & tak berwenang atas scope) -> 403. Pesan sengaja generik
      // ('Unauthorized'/'Forbidden') -- tidak membocorkan detail internal DB ke client.
      const status = error.code === '28000' ? 401 : error.code === '42501' ? 403 : 500
      const message = status === 401 ? 'Unauthorized' : status === 403 ? 'Forbidden' : error.message
      return NextResponse.json({ error: message }, { status })
    }

    // RPC mengembalikan setof generus (0 atau 1 baris -- generus.user_id UNIQUE), samakan
    // dengan kontrak lama yang balik objek tunggal atau null.
    return NextResponse.json({ data: (data && data[0]) || null })
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
    // Dipakai juga untuk guard isTargetPPG di bawah -- diisi hanya kalau !isSelf (self-edit
    // tidak pernah butuh cek target PPG, lihat catatan di guard hasAdminFields).
    let isTargetPPG = false
    // Otorisasi: harus salah satu dari — mengubah biodata diri sendiri, atau berwenang
    // mengelola Generus lain dalam scope-nya. Sama seperti users/route.ts PATCH.
    if (!isSelf) {
      const { data: targetUserRole } = await supabaseAdmin
        .from('users')
        .select('desa_id, kelompok_id, roles:role_id(tingkatan)')
        .eq('id', user_id)
        .single()
      const targetDesaId = targetUserRole?.desa_id ?? null
      const targetKelompokId = targetUserRole?.kelompok_id ?? null
      if (!canActOnScope(caller, targetDesaId, targetKelompokId)) {
        return NextResponse.json({ error: 'Anda tidak berwenang mengubah biodata pengguna ini.' }, { status: 403 })
      }
      const targetRole = targetUserRole?.roles as { tingkatan?: string } | { tingkatan?: string }[] | null
      isTargetPPG = (Array.isArray(targetRole) ? targetRole[0]?.tingkatan : targetRole?.tingkatan) === 'ppg'
    }

    // Field administratif (status_anggota, status_pengguna, pindah sambung) hanya boleh
    // diubah oleh yang berwenang mengelola Generus -- sama seperti larangan di users/route.ts,
    // mencegah pengguna mengubah status keanggotaannya sendiri lewat halaman profil.
    const hasAdminFields = status_anggota !== undefined || status_pengguna !== undefined
      || pindah_desa_id !== undefined || pindah_kelompok_id !== undefined || pindah_ke_daerah_lain !== undefined
    if (hasAdminFields && !canManageMembers(caller)) {
      return NextResponse.json({ error: 'Anda tidak berwenang mengubah status keanggotaan.' }, { status: 403 })
    }

    // Sama seperti app/api/users/route.ts PATCH (lihat catatan isTargetPPG di sana) -- PPG
    // berada DI ATAS jenjang Daerah, jadi status_pengguna/pindah sambung (yang bisa memicu
    // arsip/nonaktif otomatis) pada akun PPG hanya boleh diubah Super Admin. Biodata biasa
    // (nama, alamat, TTL, dst -- dikelola lewat menu Data Pembina) TIDAK termasuk hasAdminFields
    // sehingga tetap bisa diedit Daerah seperti biasa, hanya field administratif ini yang dikunci.
    if (hasAdminFields && isTargetPPG && caller.tingkatan !== 'super_admin') {
      return NextResponse.json({ error: 'Status keanggotaan akun PPG hanya dapat diubah oleh Super Admin.' }, { status: 403 })
    }

    // SECURITY FIX -- desa_id/kelompok_id di sini adalah TEMPAT SAMBUNG Generus (beda dari
    // scope akun di users/route.ts, tapi otorisasinya harus sama ketatnya). Field ini
    // sebelumnya TIDAK termasuk hasAdminFields, jadi siapapun bisa mengubah tempat
    // sambungnya sendiri lewat halaman Profil tanpa lolos canManageMembers. Sekarang WAJIB
    // canManageMembers DAN caller harus berwenang ATAS Desa/Kelompok TUJUAN (bukan cuma
    // lokasi lama) -- mencegah Ketua Desa A memindahkan tempat sambung anggotanya sendiri
    // ke Desa B tanpa Desa B pernah menyetujui.
    if (desa_id !== undefined || kelompok_id !== undefined) {
      if (!canManageMembers(caller)) {
        return NextResponse.json({ error: 'Anda tidak berwenang mengubah tempat sambung (Desa/Kelompok).' }, { status: 403 })
      }
      const newDesaId = desa_id || null
      const newKelompokId = kelompok_id || null
      if (!canActOnScope(caller, newDesaId, newKelompokId)) {
        return NextResponse.json({ error: 'Anda tidak berwenang memindahkan tempat sambung ke Desa/Kelompok tujuan ini.' }, { status: 403 })
      }
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

    // Sinkronkan login_username setiap kali nama_panggilan berubah -- login_username dibuat
    // dari nama_panggilan saat akun pertama dibuat (lihat generateUniqueLoginUsername di
    // app/api/users/route.ts), tapi TIDAK PERNAH disinkronkan ulang kalau nama_panggilan
    // diedit belakangan lewat form biodata -- ini menyebabkan bug nyata: user "Moreno Ryandika
    // Fernando" (nama_panggilan "Reno") tidak bisa login pakai "Reno" karena login_username-nya
    // masih "MORENO RYANDIKA FERNANDO" (fallback nama_lengkap saat akun dibuat sebelum
    // nama_panggilan diisi). Regenerate HANYA kalau nilai normalisasi-nya benar-benar berubah
    // (bukan setiap kali form disave) supaya login_username tidak berubah tanpa alasan --
    // login_username yang berubah berarti password lama tetap sama tapi user harus tahu nama
    // login barunya, jadi perubahan ini sebaiknya memang cuma terjadi saat nama_panggilan-nya
    // sendiri benar-benar berubah.
    let newLoginUsername: string | null = null
    if (nama_panggilan !== undefined && nama_panggilan) {
      const { data: currentUser } = await supabaseAdmin
        .from('users')
        .select('login_username, nama_lengkap')
        .eq('id', user_id)
        .single()
      const normalizedNew = String(nama_panggilan).trim().replace(/\s+/g, ' ').toUpperCase()
      const currentUsername = currentUser?.login_username || ''
      if (normalizedNew && normalizedNew !== currentUsername) {
        newLoginUsername = await generateUniqueLoginUsername(supabaseAdmin, nama_panggilan, user_id)
      }
    }

    if (Object.keys(generusPayload).length === 0 && !newLoginUsername) {
      return NextResponse.json({ success: true })
    }

    if (newLoginUsername) {
      const { error: usernameErr } = await supabaseAdmin
        .from('users')
        .update({ login_username: newLoginUsername })
        .eq('id', user_id)
      if (usernameErr) {
        console.error('login_username sync error:', usernameErr.message)
        return NextResponse.json({ error: `Gagal menyinkronkan nama login: ${usernameErr.message}` }, { status: 500 })
      }
    }

    if (Object.keys(generusPayload).length === 0) {
      return NextResponse.json({ success: true, newLoginUsername })
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

    return NextResponse.json({ success: true, newLoginUsername })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
