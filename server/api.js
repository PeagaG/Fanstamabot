const express = require('express');
const router = express.Router();
const db = require('./db');
const { getBotInfo, getBot } = require('./bot');

router.get('/bot-info', (req, res) => res.json(getBotInfo()));
router.get('/chats', (req, res) => {
    try { res.json(db.prepare('SELECT * FROM known_chats ORDER BY updated_at DESC').all()); }
    catch (e) { res.status(500).json({ error: e.message }); }
});
router.get('/media-count/:chatId', (req, res) => {
    try { res.json(db.prepare('SELECT COUNT(*) as count FROM media_log WHERE chat_id = ?').get(req.params.chatId)); }
    catch (e) { res.status(500).json({ error: e.message }); }
});

// Group messages by album logic
function groupMessages(messages) {
    const groups = [];
    let currentMap = new Map(); // GroupId -> [items]
    let singles = [];

    // Since query is ordered (reverse chronologically), we reverse it back to normal time to grouping makes sense?
    // Actually, SQL was DESC, then we reversed in JS to be ASC. So messages are in order.
    // Consecutive messages with same media_group_id belong together.

    let lastGroupId = null;
    let currentAlbum = [];

    for (const msg of messages) {
        if (msg.media_group_id) {
            if (lastGroupId === msg.media_group_id) {
                currentAlbum.push(msg);
            } else {
                if (currentAlbum.length > 0) {
                    groups.push({ type: 'album', items: currentAlbum });
                }
                currentAlbum = [msg];
                lastGroupId = msg.media_group_id;
            }
        } else {
            if (currentAlbum.length > 0) {
                groups.push({ type: 'album', items: currentAlbum });
                currentAlbum = [];
                lastGroupId = null;
            }
            groups.push({ type: 'single', items: [msg] });
        }
    }
    if (currentAlbum.length > 0) groups.push({ type: 'album', items: currentAlbum });

    return groups;
}

router.get('/chats/:chatId/topics', (req, res) => {
    try {
        const topics = db.prepare('SELECT * FROM known_topics WHERE chat_id = ? ORDER BY name ASC').all(req.params.chatId);
        res.json(topics);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/chats/:chatId/media-topics', (req, res) => {
    try {
        const topics = db.prepare(`
            SELECT DISTINCT m.topic_id, t.name 
            FROM media_log m 
            LEFT JOIN known_topics t ON m.chat_id = t.chat_id AND m.topic_id = t.topic_id 
            WHERE m.chat_id = ? AND m.topic_id IS NOT NULL
        `).all(req.params.chatId);
        res.json(topics);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/batch-forward', async (req, res) => {
    const { source_chat_id, target_chat_id, limit, onlyAlbums, source_topic_id, target_thread_id } = req.body;
    const io = req.app.get('io');
    const bot = getBot();

    if (!bot) return res.status(500).json({ error: 'Bot inactive' });

    try {
        // Fetch last N media (fetching a bit more to ensure we get albums if mixed)
        // If we strictly limit by SQL, we might cut an album in half or get mostly singles.
        let sql = 'SELECT message_id, media_group_id, file_id, caption, file_type, topic_id FROM media_log WHERE chat_id = ?';
        const params = [source_chat_id];

        if (source_topic_id) {
            sql += ' AND topic_id = ?';
            params.push(source_topic_id);
        }

        sql += ' ORDER BY message_id DESC LIMIT ?';
        params.push(limit || 50);

        const rows = db.prepare(sql).all(...params);

        rows.reverse(); // Chronological order
        let batchItems = groupMessages(rows);

        // Filter if requested
        if (onlyAlbums) {
            batchItems = batchItems.filter(item => item.type === 'album');
        }

        if (batchItems.length === 0) {
            return res.json({ success: true, message: `Nenhum item encontrado nas últimas ${rows.length} mídias.` });
        }

        res.json({ success: true, message: `Started forwarding ${batchItems.length} batches.` });

        (async () => {
            const total = batchItems.length;
            let processed = 0;
            let i = 0;
            io.emit('progress', { processed: 0, total });

            while (i < batchItems.length) {
                const batch = batchItems[i];

                try {
                    const options = {
                        message_thread_id: target_thread_id || null
                    };

                    if (batch.type === 'album' && batch.items.every(item => item.file_id)) {
                        // SEND ALBUM
                        const mediaGroup = batch.items.map(item => ({
                            type: item.file_type === 'video' ? 'video' : 'photo', // Simplified
                            media: item.file_id,
                            caption: item.caption
                        }));

                        await bot.sendMediaGroup(target_chat_id, mediaGroup, options);

                        processed += batch.items.length;
                        io.emit('log', {
                            time: new Date().toLocaleTimeString(),
                            type: 'forward',
                            message: `📦 Batch Album (${batch.items.length} items) sent to [${target_chat_id}]`
                        });
                    } else {
                        // FALLBACK TO SINGLE (CopyMessage)
                        for (const item of batch.items) {

                            // Copy options need to be per item + thread_id
                            const copyOptions = {
                                caption: item.caption,
                                message_thread_id: options.message_thread_id
                            };

                            await bot.copyMessage(target_chat_id, source_chat_id, item.message_id, copyOptions);
                            processed++;
                            io.emit('log', {
                                time: new Date().toLocaleTimeString(),
                                type: 'forward',
                                message: `📦 Batch Item sent to [${target_chat_id}]`
                            });
                            await new Promise(r => setTimeout(r, 1000));
                        }
                    }

                    // Success: Next batch
                    i++;
                    io.emit('progress', { processed: i, total });
                    await new Promise(r => setTimeout(r, 4000)); // 4s delay between batches

                } catch (e) {
                    const msg = e.message || '';
                    if (msg.includes('429')) {
                        const match = msg.match(/retry after (\d+)/);
                        const wait = ((match ? parseInt(match[1]) : 10) + 2) * 1000;
                        io.emit('log', { time: new Date().toLocaleTimeString(), type: 'error', message: `⚠️ Rate Limit. Pausing ${wait / 1000}s...` });
                        await new Promise(r => setTimeout(r, wait));
                        // Retry SAME index 'i'
                    } else {
                        console.error('Batch error:', msg);
                        io.emit('log', { time: new Date().toLocaleTimeString(), type: 'error', message: `❌ Error: ${msg}` });
                        i++; // Skip on fatal error
                    }
                }
            }

            io.emit('log', { time: new Date().toLocaleTimeString(), type: 'system', message: `✅ Batch Complete` });
            io.emit('progress', null); // Reset progress

        })();

    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ... CRUD Rules ...
router.get('/rules', (req, res) => {
    try { res.json(db.prepare(`SELECT r.*, k1.title as source_title, k2.title as target_title FROM forwarding_rules r LEFT JOIN known_chats k1 ON r.source_chat_id = k1.chat_id LEFT JOIN known_chats k2 ON r.target_chat_id = k2.chat_id ORDER BY r.created_at DESC`).all()); }
    catch (e) { res.status(500).json({ error: e.message }); }
});
router.post('/rules', (req, res) => {
    try {
        const info = db.prepare('INSERT INTO forwarding_rules (source_chat_id, target_chat_id, title, target_thread_id) VALUES (?, ?, ?, ?)').run(req.body.source_chat_id, req.body.target_chat_id, req.body.title || 'Untitled', req.body.target_thread_id || null);
        res.json({ id: info.lastInsertRowid, ...req.body, active: 1 });
    } catch (e) { res.status(500).json({ error: e.message }); }
});
router.delete('/rules/:id', (req, res) => {
    db.prepare('DELETE FROM forwarding_rules WHERE id = ?').run(req.params.id);
    res.json({ success: true });
});
router.patch('/rules/:id/toggle', (req, res) => {
    const rule = db.prepare('SELECT active FROM forwarding_rules WHERE id = ?').get(req.params.id);
    db.prepare('UPDATE forwarding_rules SET active = ? WHERE id = ?').run(rule.active ? 0 : 1, req.params.id);
    res.json({ success: true });
});

module.exports = router;
