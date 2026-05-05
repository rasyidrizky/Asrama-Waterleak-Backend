require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json());

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const authenticateJWT = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, error: "Akses ditolak: Token JWT tidak ditemukan." });
    }

    const token = authHeader.split(' ')[1];

    try {
        const { data: { user }, error } = await supabase.auth.getUser(token);
        
        if (error || !user) {
            return res.status(401).json({ success: false, error: "Token kedaluwarsa atau tidak valid." });
        }

        req.user = user;
        next();
    } catch (error) {
        return res.status(500).json({ success: false, error: "Kesalahan internal validasi keamanan." });
    }
};

app.post('/api/iot/telemetry', async (req, res) => {
    const { node_id, debit_air } = req.body;

    try {
        // A. Simpan data ke tabel telemetry_logs
        const { error: logError } = await supabase
            .from('telemetry_logs')
            .insert([{ node_id, debit_air }]);

        if (logError) throw logError;

        // B. Perbarui status last_sync di node_devices
        await supabase
            .from('node_devices')
            .update({ last_sync: new Date() })
            .eq('id', node_id);

        // C. [PLACEHOLDER] Integrasi Agen AI & Notifikasi FCM
        /*
        const isAnomaly = await checkWithAIAgent(node_id, debit_air);
        if (isAnomaly) {
            await supabase.from('node_devices').update({ status: 'BAHAYA' }).eq('id', node_id);
            await supabase.from('incident_reports').insert([{ node_id, status: 'Tervalidasi' }]);
            // Trigger FCM Mobile App...
        }
        */

        res.status(200).json({ success: true, message: "Telemetri berhasil disimpan." });
    } catch (error) {
        console.error("Gagal memproses telemetri:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/mobile/dashboard', async (req, res) => {
    try {
        const { data: nodes } = await supabase.from('node_devices').select('status');
        const { data: incidents } = await supabase.from('incident_reports').select('estimasi_volume').eq('status', 'Tervalidasi');

        const activeNodes = nodes.filter(n => n.status === 'NORMAL').length;
        const issueNodes = nodes.filter(n => n.status === 'BAHAYA' || n.status === 'OFFLINE').length;
        const estimasiAirTerbuang = incidents.reduce((sum, inc) => sum + (Number(inc.estimasi_volume) || 0), 0);

        res.status(200).json({
            success: true,
            data: {
                total_nodes: nodes.length,
                active_nodes: activeNodes,
                issue_nodes: issueNodes,
                total_air_terbuang: estimasiAirTerbuang
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/web/telemetry-all', authenticateJWT, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('telemetry_logs')
            .select('node_id, debit_air, created_at')
            .order('created_at', { ascending: true })
            .limit(200); 

        if (error) throw error;

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

app.get('/api/web/nodes', authenticateJWT, async (req, res) => {
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

app.get('/api/web/logs', authenticateJWT, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('incident_reports')
            .select(`
                id, waktu_mulai, waktu_berakhir, durasi_menit, 
                estimasi_volume, rata_rata_debit, status, created_at, node_id,
                node_devices ( location_block )
            `)
            .order('created_at', { ascending: false });
            
        if (error) throw error;

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

app.get('/api/web/telemetry/:nodeId', authenticateJWT, async (req, res) => {
    const { nodeId } = req.params;
    try {
        const { data, error } = await supabase
            .from('telemetry_logs')
            .select('debit_air, created_at')
            .eq('node_id', nodeId)
            .order('created_at', { ascending: true })
            .limit(60);

        if (error) throw error;

        const formattedData = data.map(log => ({
            timeISO: new Date(log.created_at).toISOString(), 
            debit: parseFloat(log.debit_air)
        }));

        res.status(200).json({ success: true, data: formattedData });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.put('/api/web/resolve/:nodeId', authenticateJWT, async (req, res) => {
    const { nodeId } = req.params;
    
    try {
        const { data: incident, error: fetchError } = await supabase
            .from('incident_reports')
            .select('id')
            .eq('node_id', nodeId)
            .eq('status', 'Tervalidasi')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle(); 

        if (fetchError) throw fetchError;

        if (incident) {
            const { error: updateIncError } = await supabase
                .from('incident_reports')
                .update({ status: 'Selesai', waktu_berakhir: new Date() })
                .eq('id', incident.id);
            
            if (updateIncError) throw updateIncError;
        }

        const { error: updateNodeError } = await supabase
            .from('node_devices')
            .update({ status: 'NORMAL' })
            .eq('id', nodeId);

        if (updateNodeError) throw updateNodeError;

        res.status(200).json({ success: true, message: "Resolusi berhasil dicatat oleh teknisi." });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Web Service mengudara di port ${PORT}`);
});