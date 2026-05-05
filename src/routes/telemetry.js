const express = require('express');
const router = express.Router();
const supabase = require('../config/supabaseClient');
const verifyToken = require('../middleware/authMiddleware');

// Endpoint: POST /api/telemetry
// Fungsi: Menerima data dari perangkat IoT dan menyimpannya ke database
router.post('/', async (req, res) => {
  try {
    // 1. Menangkap data yang dikirim oleh ESP32 (IoT)
    const { node_id, debit_air } = req.body;

    // 2. Validasi input: Pastikan data tidak kosong
    if (!node_id || debit_air === undefined) {
      return res.status(400).json({ 
        error: "Data tidak lengkap. Pastikan mengirim 'node_id' dan 'debit_air'." 
      });
    }

    // 3. Simpan data aliran air ke tabel 'telemetry_logs'
    const { data: logData, error: logError } = await supabase
      .from('telemetry_logs')
      .insert([{ node_id, debit_air }])
      .select();

    if (logError) throw logError;

    // 4. Perbarui status 'last_sync' di tabel 'node_devices' 
    // agar teknisi tahu kapan terakhir kali alat mengirim data
    const { error: updateError } = await supabase
      .from('node_devices')
      .update({ last_sync: new Date().toISOString() })
      .eq('id', node_id);

    if (updateError) console.error("Gagal update last_sync:", updateError.message);

    // 5. Berikan balasan sukses ke perangkat IoT
    res.status(201).json({
      message: "Data telemetri berhasil disimpan!",
      data: logData[0]
    });

  } catch (err) {
    console.error("Error API Telemetry:", err.message);
    res.status(500).json({ error: "Terjadi kesalahan internal pada server." });
  }
});

// Endpoint: GET /api/telemetry/:node_id
// Fungsi: Menarik data historis debit air (Dilindungi oleh JWT OAuth 2.0)
router.get('/:node_id', verifyToken, async (req, res) => {
  try {
    // Menangkap ID Node dari parameter URL
    const { node_id } = req.params;

    // Tarik 50 data terakhir dari Supabase, urutkan dari yang paling baru
    const { data, error } = await supabase
      .from('telemetry_logs')
      .select('debit_air, is_anomaly, created_at')
      .eq('node_id', node_id)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw error;

    // Berikan balasan sukses beserta array data ke frontend
    res.status(200).json({
      message: "Data telemetri historis berhasil ditarik.",
      count: data.length,
      data: data
    });

  } catch (err) {
    console.error("Error API GET Telemetry:", err.message);
    res.status(500).json({ error: "Terjadi kesalahan internal saat menarik data." });
  }
});

// Endpoint: PUT /api/telemetry/:node_id/resolve
// Fungsi: Teknisi menandai bahwa perbaikan selesai (Dilindungi JWT)
router.put('/:node_id/resolve', verifyToken, async (req, res) => {
  try {
    const { node_id } = req.params;

    const { error } = await supabase
      .from('node_devices')
      .update({ status: 'NORMAL' })
      .eq('id', node_id);

    if (error) throw error;

    res.status(200).json({ message: "Status node berhasil direset ke NORMAL." });
  } catch (err) {
    res.status(500).json({ error: "Gagal mereset status insiden." });
  }
});

// Endpoint: GET /api/telemetry/nodes/status
// Fungsi: Menarik daftar semua perangkat IoT beserta status terkininya
router.get('/nodes/status', verifyToken, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('node_devices')
      .select('*')
      .order('location_block', { ascending: true });

    if (error) throw error;
    res.status(200).json({ data });
  } catch (err) {
    res.status(500).json({ error: "Gagal menarik data node." });
  }
});

module.exports = router;