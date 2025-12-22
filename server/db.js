const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Ensure data directory exists
const storagePath = process.env.STORAGE_PATH || path.join(__dirname, 'data');
const dataDir = storagePath;

if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(path.join(dataDir, 'bot.db'), { verbose: console.log });

// Create tables
db.exec(`
    CREATE TABLE IF NOT EXISTS forwarding_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_chat_id TEXT NOT NULL,
        target_chat_id TEXT NOT NULL,
        title TEXT,
        active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS known_chats (
        chat_id TEXT PRIMARY KEY,
        title TEXT,
        type TEXT,
        username TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS known_topics (
        chat_id TEXT NOT NULL,
        topic_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (chat_id, topic_id)
    );

    CREATE TABLE IF NOT EXISTS media_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id TEXT NOT NULL,
        message_id INTEGER NOT NULL,
        topic_id INTEGER,
        media_group_id TEXT,
        file_id TEXT,
        caption TEXT,
        file_type TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(chat_id, message_id)
    );
    CREATE TABLE IF NOT EXISTS sent_history (
        target_chat_id TEXT NOT NULL,
        file_unique_id TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(target_chat_id, file_unique_id)
    );
`);

// Auto-migration for existing tables
try {
    db.prepare('ALTER TABLE media_log ADD COLUMN media_group_id TEXT').run();
} catch (e) { /* Column likely exists */ }

try {
    db.prepare('ALTER TABLE media_log ADD COLUMN file_id TEXT').run();
} catch (e) { /* Column likely exists */ }

try {
    db.prepare('ALTER TABLE media_log ADD COLUMN caption TEXT').run();
} catch (e) { /* Column likely exists */ }

try {
    db.prepare('ALTER TABLE forwarding_rules ADD COLUMN target_thread_id INTEGER').run();
} catch (e) { /* Column likely exists */ }

try {
    db.prepare('ALTER TABLE media_log ADD COLUMN topic_id INTEGER').run();
} catch (e) { /* Column likely exists */ }

try {
    db.prepare('ALTER TABLE forwarding_rules ADD COLUMN source_thread_id INTEGER').run();
} catch (e) { /* Column likely exists */ }

try {
    db.prepare('ALTER TABLE media_log ADD COLUMN file_unique_id TEXT').run();
} catch (e) { /* Column likely exists */ }

module.exports = db;
