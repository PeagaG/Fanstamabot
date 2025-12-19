const TelegramBot = require('node-telegram-bot-api');
const db = require('./db');
require('dotenv').config();

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
        const rules = db.prepare('SELECT target_chat_id FROM forwarding_rules WHERE source_chat_id = ? AND active = 1').all(chatId);
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
                await bot.sendMediaGroup(rule.target_chat_id, mediaGroup);
                console.log(`Forwarded Album (${messages.length}) to ${rule.target_chat_id}`);
                io.emit('log', {
                    time: new Date().toLocaleTimeString(),
                    type: 'forward',
                    message: `✅ Forwarded Album (${messages.length}) to [${rule.target_chat_id}]`
                });
            } catch (error) {
                console.error(`Failed album to ${rule.target_chat_id}:`, error.message);
                io.emit('log', {
                    time: new Date().toLocaleTimeString(),
                    type: 'error',
                    message: `❌ Failed album: ${error.message}`
                });
            }
        }
    };

    const handleMessage = async (msg) => {
        const chatId = msg.chat.id.toString();
        const chatTitle = msg.chat.title || msg.chat.first_name || 'Unknown';

        saveChat(msg.chat);

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

        // Save to DB
        if (fileType) {
            try {
                db.prepare('INSERT OR IGNORE INTO media_log (chat_id, message_id, media_group_id, file_id, caption, file_type) VALUES (?, ?, ?, ?, ?, ?)')
                    .run(chatId, msg.message_id, mediaGroupId || null, fileId, caption, fileType);
            } catch (e) { console.error('Error saving media log:', e.message); }
        }

        io.emit('log', {
            time: new Date().toLocaleTimeString(),
            type: 'receive',
            message: `Msg from [${chatTitle}]`
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
            albumBuffer.get(chatId).get(mediaGroupId).push(msg);
            return; // Don't forward immediately
        }

        // Single Message Forwarding
        for (const rule of rules) {
            try {
                await bot.copyMessage(rule.target_chat_id, chatId, msg.message_id, {
                    caption: msg.caption,
                    parse_mode: msg.parse_mode,
                    caption_entities: msg.caption_entities
                });
                io.emit('log', { time: new Date().toLocaleTimeString(), type: 'forward', message: `✅ Forwarded to [${rule.target_chat_id}]` });
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
