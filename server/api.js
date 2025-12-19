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

router.post('/batch-forward', async (req, res) => {
    const { source_chat_id, target_chat_id, limit, onlyAlbums } = req.body;
    const io = req.app.get('io');
    const bot = getBot();

    if (!bot) return res.status(500).json({ error: 'Bot inactive' });

    try {
        // Fetch last N media (fetching a bit more to ensure we get albums if mixed)
        // If we strictly limit by SQL, we might cut an album in half or get mostly singles.
        // Ideally we should filter in SQL for media_group_id IS NOT NULL but user might want "Albums mixed in last 100 messages".
        // Let's stick to fetch -> group -> filter logic for simplicity.
        const rows = db.prepare('SELECT message_id, media_group_id, file_id, caption, file_type FROM media_log WHERE chat_id = ? ORDER BY message_id DESC LIMIT ?')
            .all(source_chat_id, limit || 50);

        rows.reverse(); // Chronological order
        let batchItems = groupMessages(rows);

        // Filter if requested
        if (onlyAlbums) {
            batchItems = batchItems.filter(item => item.type === 'album');
        }

        if (batchItems.length === 0) {
            return res.json({ success: true, message: `Nenhum álbum encontrado nas últimas ${rows.length} mídias.` });
        }

        res.json({ success: true, message: `Started forwarding ${batchItems.length} batches (Only Albums).` });

        (async () => {
            let processed = 0;
            let i = 0;

            while (i < batchItems.length) {
                const batch = batchItems[i];

                try {
                    if (batch.type === 'album' && batch.items.every(item => item.file_id)) {
                        // SEND ALBUM
                        const mediaGroup = batch.items.map(item => ({
                            type: item.file_type === 'video' ? 'video' : 'photo', // Simplified
                            media: item.file_id,
                            caption: item.caption
                        }));
                        // Safety: ensure type is supported. Documents/Audio also supported by sendMediaGroup.
                        // Assuming basic types for now.

                        await bot.sendMediaGroup(target_chat_id, mediaGroup);

                        processed += batch.items.length;
                        io.emit('log', {
                            time: new Date().toLocaleTimeString(),
                            type: 'forward',
                            message: `📦 Batch Album (${batch.items.length} items) sent to [${target_chat_id}]`
                        });
                    } else {
                        // FALLBACK TO SINGLE (CopyMessage)
                        // If album missing file_id or it's single
                        for (const item of batch.items) {
                            // Inner loop for fallback items, handle rate limit individually?
                            // No, simpler to just process this batch block.
                            // But 429 might fail mid-batch.
                            // To keep simple: If fallback, we treat them one by one.
                            // But for the outer loop structure, let's just do them here.
                            await bot.copyMessage(target_chat_id, source_chat_id, item.message_id);
                            processed++;
                            io.emit('log', {
                                time: new Date().toLocaleTimeString(),
                                type: 'forward',
                                message: `📦 Batch Item sent to [${target_chat_id}]`
                            });
                            // Small delay between fallback items
                            await new Promise(r => setTimeout(r, 1000));
                        }
                    }

                    // Success: Next batch
                    i++;
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
        const info = db.prepare('INSERT INTO forwarding_rules (source_chat_id, target_chat_id, title) VALUES (?, ?, ?)').run(req.body.source_chat_id, req.body.target_chat_id, req.body.title || 'Untitled');
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
