// ==UserScript==
// @name         YouTube Music Discord RPC
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Send YouTube Music playback to Discord RPC
// @author       You
// @match        https://music.youtube.com/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    let ws = null;
    let lastSongData = null;

    let reconnectAttempts = 0;
    const MAX_RECONNECT_DELAY = 30000; // Max 30 seconds between retries

    // Connect to the bridge server
    function connectWebSocket() {
        try {
            // Close existing connection if any
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.close();
            }

            ws = new WebSocket('ws://localhost:8080');

            ws.onopen = () => {
                console.log('[YTM-RPC] Connected to bridge server');
                reconnectAttempts = 0; // Reset counter on successful connection

                // Send current song immediately on connect
                const songData = getSongInfo();
                if (songData) {
                    sendSongData(songData);
                }
            };

            ws.onclose = () => {
                reconnectAttempts++;
                const delay = Math.min(5000 * reconnectAttempts, MAX_RECONNECT_DELAY);
                console.log(`[YTM-RPC] Disconnected, retrying in ${delay/1000}s... (attempt ${reconnectAttempts})`);
                setTimeout(connectWebSocket, delay);
            };

            ws.onerror = (err) => {
                console.error('[YTM-RPC] WebSocket error:', err);
            };
        } catch (err) {
            console.error('[YTM-RPC] Failed to connect:', err);
            reconnectAttempts++;
            const delay = Math.min(5000 * reconnectAttempts, MAX_RECONNECT_DELAY);
            setTimeout(connectWebSocket, delay);
        }
    }

    // Extract song information from the page
    function getSongInfo() {
        try {
            const title = document.querySelector('.title.style-scope.ytmusic-player-bar')?.textContent?.trim();
            const artistInfo = document.querySelector('.byline.style-scope.ytmusic-player-bar')?.textContent?.trim();
            const thumbnail = document.querySelector('img.style-scope.ytmusic-player-bar')?.src;
            const playButton = document.querySelector('#play-pause-button');

            // Check if playing - when playing, the button shows "Pause", when paused it shows "Play"
            const ariaLabel = playButton?.getAttribute('aria-label') || playButton?.getAttribute('title') || '';
            const isPlaying = ariaLabel.toLowerCase().includes('pause');

            console.log('[YTM-RPC] Play button label:', ariaLabel, '| isPlaying:', isPlaying);

            // Get repeat/loop status
            const repeatButton = document.querySelector('ytmusic-player-bar tp-yt-paper-icon-button.repeat');
            let repeatMode = 'off'; // off, all, one

            if (repeatButton) {
                const title = repeatButton.getAttribute('title') || '';
                if (title.includes('Repeat all')) {
                    repeatMode = 'all';
                } else if (title.includes('Repeat one')) {
                    repeatMode = 'one';
                } else {
                    repeatMode = 'off';
                }
            }

            // Parse artist and album from byline
            let artist = artistInfo || 'Unknown Artist';
            let album = null;

            if (artistInfo?.includes('•')) {
                const parts = artistInfo.split('•').map(s => s.trim());
                artist = parts[0];
                album = parts[1];
            }

            // Get duration and current time
            const timeInfo = document.querySelector('.time-info.style-scope.ytmusic-player-bar');
            let duration = null;
            let currentTime = null;

            if (timeInfo) {
                const times = timeInfo.textContent.split('/').map(t => t.trim());
                if (times.length === 2) {
                    currentTime = parseTime(times[0]);
                    duration = parseTime(times[1]);
                }
            }

            if (!title) return null;

            return {
                title,
                artist,
                album,
                thumbnail: thumbnail?.split('=')[0], // Remove size parameters
                isPlaying,
                repeatMode,
                duration,
                currentTime,
                timestamp: Date.now()
            };
        } catch (err) {
            console.error('[YTM-RPC] Error extracting song info:', err);
            return null;
        }
    }

    // Convert time string (MM:SS) to seconds
    function parseTime(timeStr) {
        const parts = timeStr.split(':').map(p => parseInt(p));
        if (parts.length === 2) {
            return parts[0] * 60 + parts[1];
        } else if (parts.length === 3) {
            return parts[0] * 3600 + parts[1] * 60 + parts[2];
        }
        return 0;
    }

    // Send song data to bridge server
    function sendSongData(data) {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            console.log('[YTM-RPC] Not connected, attempting reconnect...');
            connectWebSocket();
            return;
        }

        try {
            ws.send(JSON.stringify(data));
        } catch (err) {
            console.error('[YTM-RPC] Failed to send data:', err);
            // Try to reconnect on send failure
            connectWebSocket();
        }
    }

    // Check for song changes
    function checkForUpdates() {
        const songData = getSongInfo();

        if (!songData) return;

        // Check if song changed or play state changed
        const dataChanged = !lastSongData ||
            lastSongData.title !== songData.title ||
            lastSongData.isPlaying !== songData.isPlaying ||
            lastSongData.repeatMode !== songData.repeatMode;

        if (dataChanged) {
            console.log('[YTM-RPC] Song update:', songData);
            sendSongData(songData);
            lastSongData = songData;
        }
    }

    // Initialize
    console.log('[YTM-RPC] Userscript loaded');
    connectWebSocket();

    // Check for updates every 2 seconds
    setInterval(checkForUpdates, 2000);

    // Also check when URL changes (for navigation within YouTube Music)
    let lastUrl = location.href;
    new MutationObserver(() => {
        const url = location.href;
        if (url !== lastUrl) {
            lastUrl = url;
            setTimeout(checkForUpdates, 1000);
        }
    }).observe(document, { subtree: true, childList: true });
})();