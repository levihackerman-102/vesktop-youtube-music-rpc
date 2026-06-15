// Discord RPC Bridge Server
// Install dependencies: npm install ws discord-rpc dotenv

require('dotenv').config();
const fs = require('fs');
const { execSync } = require('child_process');
const WebSocket = require('ws');
const DiscordRPC = require('discord-rpc');

// Discord Application ID from .env file
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;

if (!CLIENT_ID) {
    console.error('[Bridge] ERROR: DISCORD_CLIENT_ID not found in .env file!');
    console.error('[Bridge] Please create a .env file with: DISCORD_CLIENT_ID=your_app_id');
    process.exit(1);
}

// Optional: comma-separated list of non-Steam game process names to watch for.
// e.g.  GAME_PROCESSES=cyberpunk2077,eldenring,minecraft
const EXTRA_GAME_PROCESSES = (process.env.GAME_PROCESSES || '')
    .split(',').map(s => s.trim()).filter(Boolean);

const rpc = new DiscordRPC.Client({ transport: 'ipc' });
let currentActivity = null;   // last song data sent to Discord
let gamingMode = false;       // true while a game is detected
let reconnectAttempts = 0;
const MAX_RECONNECT_DELAY = 60000;

// --- Game detection ---

// Scans /proc for any process that has SteamAppId set (non-zero).
// Works on both X11 and Wayland — no extra tools required.
function isSteamGameRunning() {
    try {
        for (const entry of fs.readdirSync('/proc')) {
            if (!/^\d+$/.test(entry)) continue;
            try {
                const environ = fs.readFileSync(`/proc/${entry}/environ`, 'utf8');
                const match = environ.match(/SteamAppId=(\d+)/);
                if (match && match[1] !== '0') return true;
            } catch {
                // Process ended or no permission — skip
            }
        }
    } catch {
        // /proc unavailable (non-Linux)
    }
    return false;
}

// Checks GAME_PROCESSES env var entries via pgrep.
function isExtraGameRunning() {
    if (EXTRA_GAME_PROCESSES.length === 0) return false;
    try {
        const pattern = EXTRA_GAME_PROCESSES.join('|');
        const result = execSync(`pgrep -f "${pattern}" 2>/dev/null; true`).toString().trim();
        return result.length > 0;
    } catch {
        return false;
    }
}

function isGameRunning() {
    return isSteamGameRunning() || isExtraGameRunning();
}

// Check every 5 seconds. Clears YTM activity while a game is running;
// restores it automatically when the game closes.
setInterval(async () => {
    const gameDetected = isGameRunning();

    if (gameDetected && !gamingMode) {
        gamingMode = true;
        console.log('[Bridge] Game detected — suspending YouTube Music RPC');
        if (rpc?.user) await rpc.clearActivity().catch(() => {});

    } else if (!gameDetected && gamingMode) {
        gamingMode = false;
        console.log('[Bridge] Game closed — resuming YouTube Music RPC');
        if (currentActivity && rpc?.user) {
            await updateDiscordPresence(currentActivity);
        }
    }
}, 5000);

// --- WebSocket server ---

const wss = new WebSocket.Server({ port: 7080 });

console.log('[Bridge] WebSocket server started on ws://localhost:7080');

wss.on('connection', (ws) => {
    console.log('[Bridge] Client connected');

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            console.log('[Bridge] Received:', data.title, '-', data.artist);

            await updateDiscordPresence(data);
        } catch (err) {
            console.error('[Bridge] Error processing message:', err);
        }
    });

    ws.on('close', () => {
        console.log('[Bridge] Client disconnected — clearing Discord activity');
        currentActivity = null;
        if (rpc?.user) rpc.clearActivity().catch(() => {});
    });
});

// Connect to Discord RPC
rpc.on('ready', () => {
    console.log('[Bridge] Connected to Discord RPC');
    console.log('[Bridge] Logged in as:', rpc.user.username);
    reconnectAttempts = 0;
});

rpc.on('disconnected', () => {
    console.error('[Bridge] Disconnected from Discord RPC, attempting reconnect...');
    reconnectToDiscord();
});

// Function to connect/reconnect to Discord
async function connectToDiscord() {
    try {
        await rpc.login({ clientId: CLIENT_ID });
    } catch (err) {
        console.error('[Bridge] Failed to connect to Discord:', err.message);
        console.error('[Bridge] Make sure Discord/Vesktop is running!');
        reconnectToDiscord();
    }
}

// Reconnect with exponential backoff
function reconnectToDiscord() {
    reconnectAttempts++;
    const delay = Math.min(5000 * reconnectAttempts, MAX_RECONNECT_DELAY);
    console.log(`[Bridge] Retrying Discord connection in ${delay/1000}s... (attempt ${reconnectAttempts})`);

    setTimeout(() => {
        console.log('[Bridge] Attempting to reconnect to Discord...');
        try {
            rpc.destroy();
        } catch (e) {
            // Ignore errors when destroying
        }

        const newRpc = new DiscordRPC.Client({ transport: 'ipc' });

        newRpc.on('ready', () => {
            console.log('[Bridge] Connected to Discord RPC');
            console.log('[Bridge] Logged in as:', newRpc.user.username);
            reconnectAttempts = 0;
            Object.assign(rpc, newRpc);
        });

        newRpc.on('disconnected', () => {
            console.error('[Bridge] Disconnected from Discord RPC, attempting reconnect...');
            reconnectToDiscord();
        });

        newRpc.login({ clientId: CLIENT_ID }).catch(err => {
            console.error('[Bridge] Reconnection failed:', err.message);
            reconnectToDiscord();
        });
    }, delay);
}

async function updateDiscordPresence(songData) {
    if (!rpc || !songData) return;

    try {
        if (!rpc.user) {
            console.log('[Bridge] Discord RPC not ready, skipping update');
            return;
        }

        // Don't override the game's activity slot while gaming
        if (gamingMode) {
            currentActivity = songData;
            return;
        }

        const largeImage = songData.thumbnail || 'ytmusic';
        const largeText  = songData.album || 'YouTube Music';

        let stateText = songData.artist;
        if (songData.repeatMode === 'one')  stateText += ' • 🔂';
        else if (songData.repeatMode === 'all') stateText += ' • 🔁';

        let timestamps = null;
        if (songData.isPlaying && songData.duration && songData.currentTime !== null) {
            const now          = Date.now();
            const networkDelay = now - (songData.captureTimestamp || now);
            const elapsedMs    = (songData.currentTime + networkDelay / 1000) * 1000;
            const startMs      = Math.floor(now - elapsedMs);
            timestamps = { start: startMs };
            if (songData.repeatMode !== 'one') {
                timestamps.end = Math.floor(startMs + songData.duration * 1000);
            }
            console.log(`[Bridge] Timestamps set: elapsed=${(elapsedMs/1000).toFixed(1)}s, total=${songData.duration}s, delay=${networkDelay}ms`);
        }

        if (!songData.isPlaying) {
            // clearActivity wipes the previous timestamps; the immediate re-set
            // then shows the paused activity with no timer at all.
            await rpc.clearActivity();
        }

        await rpc.request('SET_ACTIVITY', {
            pid: process.pid,
            activity: {
                details: songData.title,
                state: songData.isPlaying ? stateText : `⏸️ Paused • ${stateText}`,
                assets: {
                    large_image: largeImage,
                    large_text:  largeText,
                    small_image: songData.isPlaying ? 'play' : 'pause',
                    small_text:  songData.isPlaying ? 'Playing' : 'Paused',
                },
                ...(timestamps && { timestamps }),
                instance: false,
            },
        });
        currentActivity = songData;
        console.log('[Bridge] Updated Discord presence with album art');
    } catch (err) {
        console.error('[Bridge] Failed to update presence:', err.message);
        if (err.message.includes('connection') || err.message.includes('RPC') || err.message.includes('ECONNREFUSED')) {
            console.log('[Bridge] RPC connection issue detected, reconnecting...');
            reconnectToDiscord();
        }
    }
}

// Connect to Discord
connectToDiscord();

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n[Bridge] Shutting down...');
    if (rpc) {
        try {
            await rpc.clearActivity();
            rpc.destroy();
        } catch (e) {
            // Ignore errors during shutdown
        }
    }
    wss.close();
    process.exit(0);
});
