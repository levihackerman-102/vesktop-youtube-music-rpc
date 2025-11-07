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

    // Connect to the bridge server
    function connectWebSocket() {
        try {
            ws = new WebSocket('ws://localhost:8080');

            ws.onopen = () => {
                console.log('[YTM-RPC] Connected to bridge server');
            };

            ws.onclose = () => {
                console.log('[YTM-RPC] Disconnected, retrying in 5s...');
                setTimeout(connectWebSocket, 5000);
            };

            ws.onerror = (err) => {
                console.error('[YTM-RPC] WebSocket error:', err);
            };
        } catch (err) {
            console.error('[YTM-RPC] Failed to connect:', err);
            setTimeout(connectWebSocket, 5000);
        }
    }

    // Extract song information from the page
    function getSongInfo() {
        try {
            const title = document.querySelector('.title.style-scope.ytmusic-player-bar')?.textContent?.trim();
            const artistInfo = document.querySelector('.byline.style-scope.ytmusic-player-bar')?.textContent?.trim();
            const thumbnail = document.querySelector('img.style-scope.ytmusic-player-bar')?.src;
            const playButton = document.querySelector('#play-pause-button');
            const isPlaying = playButton?.getAttribute('aria-label')?.includes('Pause');

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
            return;
        }

        try {
            ws.send(JSON.stringify(data));
        } catch (err) {
            console.error('[YTM-RPC] Failed to send data:', err);
        }
    }

    // Check for song changes
    function checkForUpdates() {
        const songData = getSongInfo();

        if (!songData) return;

        // Check if song changed or play state changed
        const dataChanged = !lastSongData ||
            lastSongData.title !== songData.title ||
            lastSongData.isPlaying !== songData.isPlaying;

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
