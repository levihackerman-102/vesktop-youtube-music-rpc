// Discord RPC Bridge Server
// Install dependencies: npm install ws discord-rpc dotenv

require('dotenv').config();
const WebSocket = require('ws');
const DiscordRPC = require('discord-rpc');

// Discord Application ID from .env file
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;

if (!CLIENT_ID) {
    console.error('[Bridge] ERROR: DISCORD_CLIENT_ID not found in .env file!');
    console.error('[Bridge] Please create a .env file with: DISCORD_CLIENT_ID=your_app_id');
    process.exit(1);
}

const rpc = new DiscordRPC.Client({ transport: 'ipc' });
let currentActivity = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_DELAY = 60000; // Max 60 seconds

// Start WebSocket server
const wss = new WebSocket.Server({ port: 8080 });

console.log('[Bridge] WebSocket server started on ws://localhost:8080');

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
        console.log('[Bridge] Client disconnected');
    });
});

// Connect to Discord RPC
rpc.on('ready', () => {
    console.log('[Bridge] Connected to Discord RPC');
    console.log('[Bridge] Logged in as:', rpc.user.username);
    reconnectAttempts = 0; // Reset counter on successful connection
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
        // Destroy old RPC instance and create new one
        try {
            rpc.destroy();
        } catch (e) {
            // Ignore errors when destroying
        }
        
        // Create new RPC client
        const newRpc = new DiscordRPC.Client({ transport: 'ipc' });
        
        // Copy event handlers
        newRpc.on('ready', () => {
            console.log('[Bridge] Connected to Discord RPC');
            console.log('[Bridge] Logged in as:', newRpc.user.username);
            reconnectAttempts = 0;
            Object.assign(rpc, newRpc); // Replace old client
        });
        
        newRpc.on('disconnected', () => {
            console.error('[Bridge] Disconnected from Discord RPC, attempting reconnect...');
            reconnectToDiscord();
        });
        
        // Try to login
        newRpc.login({ clientId: CLIENT_ID }).catch(err => {
            console.error('[Bridge] Reconnection failed:', err.message);
            reconnectToDiscord();
        });
    }, delay);
}

async function updateDiscordPresence(songData) {
    if (!rpc || !songData) return;

    try {
        // Check if RPC is ready
        if (!rpc.user) {
            console.log('[Bridge] Discord RPC not ready, skipping update');
            return;
        }

        // Build status string with play/pause and repeat mode
        let statusParts = [];
        
        // Add play/pause status
        if (songData.isPlaying) {
            statusParts.push('▶️ Playing');
        } else {
            statusParts.push('⏸️ Paused');
        }
        
        // Add repeat mode
        if (songData.repeatMode === 'one') {
            statusParts.push('🔂 Repeat One');
        } else if (songData.repeatMode === 'all') {
            statusParts.push('🔁 Repeat All');
        }
        
        const status = statusParts.join(' • ');
        
        // Show play/pause status on its own line (details)
        // and put title + artist (+ album if available) on the second line (state)
        const activity = {
            // Show song title in details. Prefix with a visible emoji fallback
            // (▶️ / ⏸️) so status remains visible even if the small image asset
            // (corner overlay) is not present in the Discord app assets.
            details: `${songData.isPlaying ? '▶️' : '⏸️'} ${songData.title}`,
            state: `${songData.artist}`,
            instance: false,
        };

        // Use external image URL directly (supported by Discord now)
        if (songData.thumbnail) {
            activity.largeImageKey = songData.thumbnail;
            activity.largeImageText = songData.album || 'YouTube Music';
        } else {
            activity.largeImageKey = 'ytmusic'; // Fallback to uploaded asset
            activity.largeImageText = 'YouTube Music';
        }

        // Add play/pause indicator
        if (songData.isPlaying) {
            activity.smallImageKey = 'play';
            activity.smallImageText = 'Playing';
        } else {
            activity.smallImageKey = 'pause';
            activity.smallImageText = 'Paused';
        }

        // IMPROVED TIMESTAMP HANDLING
        if (songData.isPlaying && songData.duration && songData.currentTime !== null) {
            // Use the capture timestamp for more accurate calculation
            const captureTime = songData.captureTimestamp || Date.now();
            const now = Date.now();
            
            // Account for network delay between capture and now
            const networkDelay = now - captureTime;
            
            // Calculate adjusted elapsed time
            const elapsedSeconds = songData.currentTime + (networkDelay / 1000);
            const elapsed = elapsedSeconds * 1000;
            const total = songData.duration * 1000;
            
            // Don't set end timestamp if repeating one song (it's misleading)
            if (songData.repeatMode === 'one') {
                // Only show elapsed time, no end time
                activity.startTimestamp = now - elapsed;
                // Omit endTimestamp - Discord will show "XX:XX elapsed" instead of countdown
            } else {
                // Normal behavior: show progress bar
                activity.startTimestamp = now - elapsed;
                activity.endTimestamp = now - elapsed + total;
            }
            
            console.log(`[Bridge] Timestamps set: elapsed=${elapsedSeconds.toFixed(1)}s, total=${songData.duration}s, delay=${networkDelay}ms`);
        }
        // Explicitly clear timestamps when paused
        else if (!songData.isPlaying) {
            // Don't set any timestamps when paused
            delete activity.startTimestamp;
            delete activity.endTimestamp;
        }

        await rpc.setActivity(activity);
        currentActivity = activity;
        console.log('[Bridge] Updated Discord presence with album art');
    } catch (err) {
        console.error('[Bridge] Failed to update presence:', err.message);
        // If RPC connection is lost, try to reconnect
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