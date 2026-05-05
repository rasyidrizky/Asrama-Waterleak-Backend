require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json());

// Inisialisasi Koneksi ke Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// ============================================================================
// 1. RUTE IOT (EDGE LAYER) - Menerima Telemetri & Memicu AI
// ============================================================================
app.post('/api/iot/telemetry', async (req, res) => {
    const { node_id, debit_air } = req.body;

    try {
        // A. Simpan data ke tabel telemetry_logs (Interval 60s)
        const { error: logError } = await supabase
            .from('telemetry_logs')
            .insert([{ node_id, debit_air }]);

        if (logError) throw logError;

        // B. Perbarui status last_sync di node_devices
        await supabase
            .from('node_devices')
            .update({ last_sync: new Date() })
            .eq('id', node_id);

        // C. INTEGRASI AI (Simulasi Trigger)[cite: 2]
        // Di lingkungan produksi sesungguhnya, di titik inilah Node.js akan memanggil 
        // service Python/AI (Unsupervised Learning) untuk mengevaluasi data time-series.
        // Jika AI mengembalikan status "Anomali":
        /*
        const isAnomaly = await checkWithAIAgent(node_id, debit_air);
        if (isAnomaly) {
            // 1. Ubah status node menjadi BAHAYA
            await supabase.from('node_devices').update({ status: 'BAHAYA' }).eq('id', node_id);
            
            // 2. Buat record di incident_reports
            await supabase.from('incident_reports').insert([{ node_id, status: 'Tervalidasi' }]);
            
            // 3. Tembakkan Push Notification ke Mobile App Pengelola[cite: 2]
            await sendPushNotification("🚨 Kebocoran Terdeteksi", `Lokasi: ${node_id}, Debit: ${debit_air} L/m`);
        }
        */

        res.status(200).json({ success: true, message: "Telemetri berhasil disimpan." });
    } catch (error) {
        console.error("Gagal memproses telemetri:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Tambahkan di server.js
app.get('/api/web/telemetry-all', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('telemetry_logs')
            .select('node_id, debit_air, created_at')
            .order('created_at', { ascending: true })
            .limit(200); // Ambil lebih banyak data untuk mencakup semua node

        if (error) throw error;

        // Kelompokkan data berdasarkan waktu (timestamp) untuk Recharts
        const groupedData = data.reduce((acc, log) => {
            const time = new Date(log.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
            if (!acc[time]) acc[time] = { time };
            acc[time][log.node_id] = parseFloat(log.debit_air);
            return acc;
        }, {});

        res.status(200).json({ success: true, data: Object.values(groupedData) });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================================
// 2. RUTE APLIKASI MOBILE (EXECUTIVE MONITORING) - Data Ringkasan[cite: 2]
// ============================================================================
app.get('/api/mobile/dashboard', async (req, res) => {
    try {
        // Mengambil agregasi eksekutif: Total Node, Status, dan Air Terbuang[cite: 2]
        const { data: nodes } = await supabase.from('node_devices').select('status');
        const { data: incidents } = await supabase.from('incident_reports').select('estimasi_volume, durasi_menit').eq('status', 'Tervalidasi');

        const totalNodes = nodes.length;
        const activeNodes = nodes.filter(n => n.status === 'NORMAL').length;
        const issueNodes = nodes.filter(n => n.status === 'BAHAYA' || n.status === 'OFFLINE').length;
        
        const estimasiAirTerbuang = incidents.reduce((sum, inc) => sum + (Number(inc.estimasi_volume) || 0), 0);

        res.status(200).json({
            success: true,
            data: {
                total_nodes: totalNodes,
                active_nodes: activeNodes,
                issue_nodes: issueNodes,
                total_air_terbuang: estimasiAirTerbuang
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================================
// 4. RUTE PENGAMBILAN DATA WEBSITE TEKNISI
// ============================================================================

// Mengambil daftar inventaris infrastruktur (untuk halaman /infrastruktur)
app.get('/api/web/nodes', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('node_devices')
            .select('*')
            .order('id', { ascending: true });
            
        if (error) throw error;
        res.status(200).json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Mengambil rekam jejak anomali untuk Audit Historis (untuk halaman /audit)
app.get('/api/web/logs', async (req, res) => {
    try {
        // Melakukan join tabel untuk mendapatkan nama lokasi blok dari node_devices
        const { data, error } = await supabase
            .from('incident_reports')
            .select(`
                id, waktu_mulai, waktu_berakhir, durasi_menit, 
                estimasi_volume, rata_rata_debit, status, created_at,
                node_id,
                node_devices ( location_block )
            `)
            .order('created_at', { ascending: false });
            
        if (error) throw error;

        // Memformat data agar sesuai dengan struktur tabel di React
        const formattedData = data.map(log => ({
            id: log.id,
            node_id: log.node_id,
            location_block: log.node_devices?.location_block || 'Tidak diketahui',
            waktu_mulai: log.waktu_mulai,
            waktu_berakhir: log.waktu_berakhir,
            durasi_menit: log.durasi_menit,
            estimasi_volume: log.estimasi_volume,
            debit_air: log.rata_rata_debit,
            status: log.status,
            created_at: log.created_at
        }));

        res.status(200).json({ success: true, data: formattedData });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Mengambil data telemetri historis untuk Grafik Resolusi Tinggi di Dashboard
app.get('/api/web/telemetry/:nodeId', async (req, res) => {
    const { nodeId } = req.params;
    try {
        const { data, error } = await supabase
            .from('telemetry_logs')
            .select('debit_air, created_at')
            .eq('node_id', nodeId)
            .order('created_at', { ascending: true })
            .limit(60);

        if (error) throw error;

        const formattedData = data.map(log => {
            // Pastikan kita mengubah created_at menjadi objek Date terlebih dahulu
            const dateObj = new Date(log.created_at);
            return {
                // Kirim string ISO yang dijamin bisa dibaca oleh Frontend manapun
                timeISO: dateObj.toISOString(), 
                debit: parseFloat(log.debit_air)
            };
        });

        res.status(200).json({ success: true, data: formattedData });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.put('/api/web/resolve/:nodeId', async (req, res) => {
    const { nodeId } = req.params;
    console.log(`Menerima permintaan resolusi untuk Node: ${nodeId}`); // Log untuk debug

    try {
        // 1. Cari insiden terbaru yang masih berstatus 'Tervalidasi' untuk node ini
        const { data: incident, error: fetchError } = await supabase
            .from('incident_reports')
            .select('id')
            .eq('node_id', nodeId)
            .eq('status', 'Tervalidasi')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle(); // Menggunakan maybeSingle agar tidak error jika tidak ditemukan

        if (fetchError) throw fetchError;

        // 2. Jika ada insiden aktif, tutup insiden tersebut
        if (incident) {
            const { error: updateIncError } = await supabase
                .from('incident_reports')
                .update({ 
                    status: 'Selesai', 
                    waktu_berakhir: new Date() 
                })
                .eq('id', incident.id);
            
            if (updateIncError) throw updateIncError;
            console.log(`Insiden ID ${incident.id} berhasil ditutup.`);
        }

        // 3. Kembalikan status perangkat di tabel node_devices menjadi 'NORMAL'
        const { error: updateNodeError } = await supabase
            .from('node_devices')
            .update({ status: 'NORMAL' })
            .eq('id', nodeId);

        if (updateNodeError) throw updateNodeError;

        res.status(200).json({ success: true, message: "Resolusi berhasil." });
    } catch (error) {
        console.error("Detail Error Resolusi:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Jalankan Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Orkestrator Web Service berjalan di port ${PORT}`);
});