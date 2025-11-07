// Discord RPC Bridge Server
// Install dependencies: npm install ws discord-rpc
require('dotenv').config();
const WebSocket = require('ws');
const DiscordRPC = require('discord-rpc');

// Discord Application ID - You need to create one at https://discord.com/developers/applications
const CLIENT_ID = process.env.CLIENT_ID;

if (!CLIENT_ID) {
    console.error('[Bridge] ERROR: DISCORD_CLIENT_ID not found in .env file!');
    console.error('[Bridge] Please create a .env file with: DISCORD_CLIENT_ID=your_app_id');
    process.exit(1);
}

const rpc = new DiscordRPC.Client({ transport: 'ipc' });
let currentActivity = null;

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
});

async function updateDiscordPresence(songData) {
    if (!rpc || !songData) return;

    try {
        const activity = {
            details: songData.title,
            state: `by ${songData.artist}`,
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

        // Add timestamps if playing
        if (songData.isPlaying && songData.duration && songData.currentTime) {
            const now = Date.now();
            const elapsed = songData.currentTime * 1000;
            const total = songData.duration * 1000;
            
            activity.startTimestamp = now - elapsed;
            activity.endTimestamp = now - elapsed + total;
        }

        await rpc.setActivity(activity);
        currentActivity = activity;
        console.log('[Bridge] Updated Discord presence with album art');
    } catch (err) {
        console.error('[Bridge] Failed to update presence:', err);
        console.error('[Bridge] Error details:', err.message);
    }
}

// Connect to Discord
rpc.login({ clientId: CLIENT_ID }).catch(err => {
    console.error('[Bridge] Failed to connect to Discord:', err);
    console.error('[Bridge] Make sure Discord/Vesktop is running!');
    process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n[Bridge] Shutting down...');
    if (rpc) {
        await rpc.clearActivity();
        rpc.destroy();
    }
    wss.close();
    process.exit(0);
});
