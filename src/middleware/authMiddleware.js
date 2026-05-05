const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const jwt = require('jsonwebtoken');
require('dotenv').config();

// Fungsi Satpam (Middleware) Versi Cerewet (Debugging)
const verifyToken = async (req, res, next) => {
  console.log(`\n--- 🕵️ CEK AKSES UNTUK: ${req.method} ${req.originalUrl} ---`);
  
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.log("❌ GAGAL: Header 'Authorization' kosong atau tidak pakai 'Bearer '");
    return res.status(401).json({ error: "Token Autentikasi tidak ditemukan." });
  }

  const token = authHeader.split(' ')[1];
  console.log(`✅ Token JWT terdeteksi (Panjang: ${token.length} karakter)`);

  try {
    // Meminta Supabase memvalidasi token
    const { data, error } = await supabase.auth.getUser(token);

    if (error) {
      console.log("❌ SUPABASE MENOLAK TOKEN:", error.message);
      return res.status(403).json({ 
        error: "Akses Ditolak: Token tidak valid.", 
        detail: error.message 
      });
    }

    if (!data || !data.user) {
      console.log("❌ GAGAL: Token valid tapi data user kosong.");
      return res.status(403).json({ error: "Data pengguna tidak ditemukan." });
    }

    console.log(`✅ Akses Diberikan untuk Email: ${data.user.email}`);
    req.user = data.user;
    next();
  } catch (err) {
    console.log("❌ ERROR FATAL DI MIDDLEWARE:", err.message);
    return res.status(500).json({ error: "Terjadi kesalahan sistem saat memverifikasi token." });
  }
};

module.exports = verifyToken;