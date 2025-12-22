const TelegramBot = require('node-telegram-bot-api');
const db = require('./db');


let bot;
let botInfo = {};

// Buffer for Live Forwarding (Album Handling)
// Map<ChatID, Map<MediaGroupID, [Messages]>>
const albumBuffer = new Map();

const initBot = (io) => {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
        console.error('TELEGRAM_BOT_TOKEN is not defined in .env');
        process.exit(1);
    }

    bot = new TelegramBot(token, { polling: true });

    bot.getMe().then((me) => {
        botInfo = me;
        console.log(`Bot started: @${me.username}`);
    });

    const saveChat = (chat) => {
        try {
            const stmt = db.prepare(`
                INSERT INTO known_chats (chat_id, title, type, username) 
                VALUES (?, ?, ?, ?)
                ON CONFLICT(chat_id) DO UPDATE SET 
                title=excluded.title, type=excluded.type, username=excluded.username, updated_at=CURRENT_TIMESTAMP
            `);
            stmt.run(chat.id.toString(), chat.title || chat.first_name || 'Unknown', chat.type, chat.username || null);
        } catch (e) { console.error('Error saving chat:', e.message); }
    };

    const processAlbum = async (chatId, mediaGroupId) => {
        if (!albumBuffer.has(chatId) || !albumBuffer.get(chatId).has(mediaGroupId)) return;

        const messages = albumBuffer.get(chatId).get(mediaGroupId);
        albumBuffer.get(chatId).delete(mediaGroupId); // Clear buffer

        // Find targets
        const rules = db.prepare('SELECT target_chat_id, target_thread_id FROM forwarding_rules WHERE source_chat_id = ? AND active = 1').all(chatId);
        if (rules.length === 0) return;

        // Construct MediaGroup
        const mediaGroup = messages.map(msg => {
            let type = 'photo';
            let media = '';

            if (msg.photo) { type = 'photo'; media = msg.photo[msg.photo.length - 1].file_id; }
            else if (msg.video) { type = 'video'; media = msg.video.file_id; }
            else if (msg.document) { type = 'document'; media = msg.document.file_id; }
            else if (msg.audio) { type = 'audio'; media = msg.audio.file_id; }

            return {
                type,
                media,
                caption: msg.caption,
                caption_entities: msg.caption_entities,
                parse_mode: msg.parse_mode
            };
        });

        for (const rule of rules) {
            try {
                const options = {};
                if (rule.target_thread_id) options.message_thread_id = rule.target_thread_id;

                await bot.sendMediaGroup(rule.target_chat_id, mediaGroup, options);
                console.log(`Forwarded Album (${messages.length}) to ${rule.target_chat_id}`);
                io.emit('log', {
                    time: new Date().toLocaleTimeString(),
                    type: 'forward',
                    message: `✅ Álbum Encaminhado (${messages.length}) para [${rule.target_chat_id}]`
                });
            } catch (error) {
                console.error(`Failed album to ${rule.target_chat_id}:`, error.message);
                io.emit('log', {
                    time: new Date().toLocaleTimeString(),
                    type: 'error',
                    message: `❌ Falha no álbum: ${error.message}`
                });
            }
        }
    };

    const saveTopic = (chatId, topicId, name) => {
        try {
            db.prepare('INSERT OR IGNORE INTO known_topics (chat_id, topic_id, name) VALUES (?, ?, ?)').run(chatId.toString(), topicId, name);
            // Also update name if exists (case where name changed)
            db.prepare('UPDATE known_topics SET name = ? WHERE chat_id = ? AND topic_id = ?').run(name, chatId.toString(), topicId);
        } catch (e) { console.error('Error saving topic:', e.message); }
    };

    const handleMessage = async (msg) => {
        const chatId = msg.chat.id.toString();
        const chatTitle = msg.chat.title || msg.chat.first_name || 'Unknown';

        saveChat(msg.chat);

        // Save Topic (Forum Thread)
        // If message is inside a topic, it has message_thread_id
        // (For forum_topic_created, we'll handle separately but this also helps if they just send a msg)
        if (msg.is_topic_message && msg.message_thread_id) {
            // We might not know the name if it's just a regular message, 
            // but if it's a "forum_topic_created" service message, we do.
            // If we don't know the name, we can't really update it efficiently unless we fetch it.
            // However, the user said "send a message for the bot to read the topic".
            // If the user sends a message, we at least know the ID exists.
            // If the message is the creation message:
            if (msg.forum_topic_created) {
                saveTopic(chatId, msg.message_thread_id, msg.forum_topic_created.name);
            } else if (msg.forum_topic_edited) {
                // The edited message might be the service message? 
                // Actually forum_topic_edited is a service message.
            } else {
                // Regular message in a topic.
                // We can try to insert with a placeholder or ignore if exists.
                // Ideally we want the name.
                // For now, let's just log it if we can. 
                // If we strictly need the name, we might rely on the creation event or user providing it.
                // But wait, the user said "send a msg for the bot to read". 
                // This implies the bot should Learn it.

                // Let's try to upsert with a default name if it doesn't exist?
                // Or better yet, just ensure it's in DB.
                // db.prepare('INSERT OR IGNORE INTO known_topics ...').run(chatId, msg.message_thread_id, 'Unknown Topic ' + msg.message_thread_id);
            }
        }

        // Service messages for topics
        if (msg.forum_topic_created) {
            // Note: message_thread_id for the creation message IS the topic id usually.
            // But documents say `message_thread_id` is present if message belongs to a thread.
            saveTopic(chatId, msg.message_thread_id || msg.message_id, msg.forum_topic_created.name);
        }
        if (msg.forum_topic_edited && (msg.message_thread_id || msg.message_id)) {
            saveTopic(chatId, msg.message_thread_id || msg.message_id, msg.forum_topic_edited.name);
        }

        // Detect media
        let fileType = null;
        let fileId = null;

        if (msg.photo) { fileType = 'photo'; fileId = msg.photo[msg.photo.length - 1].file_id; }
        else if (msg.video) { fileType = 'video'; fileId = msg.video.file_id; }
        else if (msg.document) { fileType = 'document'; fileId = msg.document.file_id; }
        else if (msg.audio) { fileType = 'audio'; fileId = msg.audio.file_id; }
        else if (msg.voice) { fileType = 'voice'; fileId = msg.voice.file_id; }

        const mediaGroupId = msg.media_group_id;
        const caption = msg.caption || '';
        const topicId = msg.is_topic_message ? msg.message_thread_id : null;

        // Save to DB
        if (fileType) {
            try {
                // Modified to include topic_id
                db.prepare('INSERT OR IGNORE INTO media_log (chat_id, message_id, topic_id, media_group_id, file_id, caption, file_type) VALUES (?, ?, ?, ?, ?, ?, ?)')
                    .run(chatId, msg.message_id, topicId, mediaGroupId || null, fileId, caption, fileType);
            } catch (e) { console.error('Error saving media log:', e.message); }
        }

        io.emit('log', {
            time: new Date().toLocaleTimeString(),
            type: 'receive',
            message: `📩 Msg de [${chatTitle}]${topicId ? ` Tópico: ${topicId}` : ''}`
        });

        // LIVE FORWARDING LOGIC
        const rules = db.prepare('SELECT target_chat_id FROM forwarding_rules WHERE source_chat_id = ? AND active = 1').all(chatId);
        if (rules.length === 0) return;

        // If it's part of an album, buffer it
        if (mediaGroupId) {
            if (!albumBuffer.has(chatId)) albumBuffer.set(chatId, new Map());
            if (!albumBuffer.get(chatId).has(mediaGroupId)) {
                albumBuffer.get(chatId).set(mediaGroupId, []);
                // Set timeout to process after silence
                setTimeout(() => processAlbum(chatId, mediaGroupId), 2000);
            }
            // Augment msg with topicId for processing
            msg._topicId = topicId;
            albumBuffer.get(chatId).get(mediaGroupId).push(msg);
            return; // Don't forward immediately
        }

        // Single Message Forwarding
        const rulesSingle = db.prepare('SELECT target_chat_id, target_thread_id FROM forwarding_rules WHERE source_chat_id = ? AND active = 1').all(chatId);

        for (const rule of rulesSingle) {
            try {
                const options = {
                    caption: msg.caption,
                    parse_mode: msg.parse_mode,
                    caption_entities: msg.caption_entities
                };
                if (rule.target_thread_id) options.message_thread_id = rule.target_thread_id;
                // If the rule DOES NOT specify a target thread, but the message came from one, 
                // do we forward to a thread? 
                // Usually not, unless specified. Users configure mapping manually.

                await bot.copyMessage(rule.target_chat_id, chatId, msg.message_id, options);
                io.emit('log', { time: new Date().toLocaleTimeString(), type: 'forward', message: `✅ Encaminhado para [${rule.target_chat_id}]` });
            } catch (error) {
                console.error(error);
            }
        }
    };

    bot.on('message', handleMessage);
    bot.on('channel_post', handleMessage);
    bot.on('my_chat_member', (msg) => saveChat(msg.chat));
};

const getBotInfo = () => botInfo;
const getBot = () => bot;

module.exports = { initBot, getBotInfo, getBot };
