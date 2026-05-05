const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const jwt = require('jsonwebtoken');
require('dotenv').config();

const verifyToken = async (req, res, next) => {  
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.log("[ERROR] Header 'Authorization' kosong atau tidak pakai 'Bearer '");
    return res.status(401).json({ error: "Token Autentikasi tidak ditemukan." });
  }

  const token = authHeader.split(' ')[1];
  console.log(`[DEBUG] Token JWT terdeteksi (Panjang: ${token.length} karakter)`);

  try {
    const { data, error } = await supabase.auth.getUser(token);

    if (error) {
      return res.status(403).json({ 
        error: "Akses Ditolak: Token tidak valid.", 
        detail: error.message 
      });
    }

    if (!data || !data.user) {
      return res.status(403).json({ error: "Data pengguna tidak ditemukan." });
    }

    req.user = data.user;
    next();
  } catch (err) {
    return res.status(500).json({ error: "Terjadi kesalahan sistem saat memverifikasi token." });
  }
};

module.exports = verifyToken;