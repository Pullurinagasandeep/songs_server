const express = require('express');
const axios = require('axios');
const mongoose = require('mongoose');

const app = express();
const token = '8744829387:AAG52cKmPf772VySZBV4wdmHVNGcYu2DnfA';
const API_URL = `https://api.telegram.org/bot${token}`;

const mongoURI = 'mongodb+srv://atheist582_db_user:yTUZ77T57cYtGVxN@cluster0.d6wrs8q.mongodb.net/music-app?retryWrites=true&w=majority&appName=Cluster0';
mongoose.connect(mongoURI)
    .then(() => console.log('Connected to MongoDB Atlas!'))
    .catch(err => console.error('MongoDB connection error:', err));

const songSchema = new mongoose.Schema({
    title: { type: String, required: true },
    fileId: { type: String, required: true }
});
const Song = mongoose.model('Song', songSchema);

app.use(express.static('public'));

let lastUpdateId = 0;
setInterval(async () => {
    try {
        const response = await axios.get(`${API_URL}/getUpdates?offset=${lastUpdateId + 1}`);
        if (response.data.ok) {
            for (const update of response.data.result) {
                lastUpdateId = update.update_id;
                if (update.message && update.message.audio) {
                    const title = update.message.audio.title || 'Unknown Title';
                    const fileId = update.message.audio.file_id;
                    
                    const exists = await Song.findOne({ fileId });
                    if (!exists) {
                        await Song.create({ title, fileId });
                        console.log(`\nSaved to database: ${title}`);
                    }
                }
            }
        }
    } catch (err) {}
}, 3000);

app.get('/api/songs', async (req, res) => {
    try {
        const songs = await Song.find();
        res.json(songs);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch songs' });
    }
});

app.get('/stream/:fileId', async (req, res) => {
    try {
        const fileId = req.params.fileId;
        const fileData = await axios.get(`${API_URL}/getFile?file_id=${fileId}`);
        if (!fileData.data.ok) return res.status(404).send('File not found');
        
        const filePath = fileData.data.result.file_path;
        const downloadUrl = `https://api.telegram.org/file/bot${token}/${filePath}`;
        if (req.query.download === '1') {
            const song = await Song.findOne({ fileId });
            const filename = (song?.title || 'sandstream-audio')
                .replace(/[\\/:*?"<>|\u0000-\u001F\u007F]/g, '')
                .trim() || 'sandstream-audio';
            res.setHeader('Content-Disposition', `attachment; filename="${filename}.mp3"`);
        }
        
        // Forward the browser's Range request to Telegram
        const options = { method: 'get', url: downloadUrl, responseType: 'stream', headers: {} };
        if (req.headers.range) {
            options.headers['Range'] = req.headers.range;
        }
        // Allow 206 Partial Content status to pass through without error
        options.validateStatus = (status) => status >= 200 && status < 300;

        const audioStream = await axios(options);
        
        // Forward Telegram's chunking headers back to the browser
        if (audioStream.headers['content-range']) res.setHeader('Content-Range', audioStream.headers['content-range']);
        if (audioStream.headers['accept-ranges']) res.setHeader('Accept-Ranges', audioStream.headers['accept-ranges']);
        if (audioStream.headers['content-length']) res.setHeader('Content-Length', audioStream.headers['content-length']);
        res.setHeader('Content-Type', 'audio/mpeg');
        
        // Send 206 Partial Content if seeking, otherwise 200 OK
        res.status(audioStream.status);
        audioStream.data.pipe(res);
    } catch (error) {
        console.error('\nStream error:', error.response ? error.response.data : error.message);
        res.status(500).send('Streaming failed');
    }
});

app.listen(3000, () => console.log('Server active on port 3000.'));
