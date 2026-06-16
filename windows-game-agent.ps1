# YouTube Music RPC — Windows Game Agent
# Run this on your Windows gaming PC. It detects when a game is running
# and notifies the bridge on your Linux PC to pause YouTube Music RPC.
#
# Requirements: Windows 10/11, PowerShell 5.1+
# Usage: Right-click → "Run with PowerShell", or add it to your startup apps.

# ============================================================
# CONFIGURATION
# ============================================================
$BridgeHost   = "192.168.1.x"  # <-- IP address of your Linux PC
$BridgePort   = 7080
$PollInterval = 5               # seconds between game checks

# Add process names (no .exe) for any games not detected automatically.
# Steam games and fullscreen windows are detected without this list.
$ExtraGameProcesses = @(
    # "cyberpunk2077",
    # "eldenring",
    # "minecraft"
)
# ============================================================

Add-Type -AssemblyName System.Windows.Forms

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class WinAPI {
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    public struct RECT { public int Left, Top, Right, Bottom; }
}
"@ -ErrorAction SilentlyContinue

# Processes that should never be treated as games even if fullscreen.
$NonGameProcesses = @(
    'chrome', 'firefox', 'msedge', 'brave', 'opera', 'vivaldi',
    'discord', 'code', 'explorer', 'notepad', 'wordpad', 'powershell',
    'cmd', 'conhost', 'taskmgr', 'devenv', 'mstsc', 'teams', 'slack',
    'obs64', 'obs32', 'streamlabs'
)

function Test-SteamGameRunning {
    # GameOverlayUI.exe is injected into every running Steam game.
    return [bool](Get-Process -Name 'GameOverlayUI' -ErrorAction SilentlyContinue)
}

function Test-FullscreenGameRunning {
    # Returns true when a non-browser, non-shell process owns the fullscreen foreground window.
    try {
        $hwnd = [WinAPI]::GetForegroundWindow()
        $rect = New-Object WinAPI+RECT
        [WinAPI]::GetWindowRect($hwnd, [ref]$rect) | Out-Null

        $screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
        $winW = $rect.Right - $rect.Left
        $winH = $rect.Bottom - $rect.Top

        # Must fill the primary screen (covers both true fullscreen and borderless windowed).
        if ($winW -lt $screen.Width -or $winH -lt $screen.Height) { return $false }

        $procId = 0
        [WinAPI]::GetWindowThreadProcessId($hwnd, [ref]$procId) | Out-Null
        $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
        if (-not $proc) { return $false }

        $name = $proc.Name.ToLower()
        foreach ($ng in $NonGameProcesses) {
            if ($name -like "*$ng*") { return $false }
        }
        return $true
    } catch {
        return $false
    }
}

function Test-ExtraGameRunning {
    foreach ($proc in $ExtraGameProcesses) {
        if (Get-Process -Name $proc -ErrorAction SilentlyContinue) { return $true }
    }
    return $false
}

function Test-GameRunning {
    return (Test-SteamGameRunning) -or (Test-FullscreenGameRunning) -or (Test-ExtraGameRunning)
}

function New-BridgeConnection {
    $ws  = [System.Net.WebSockets.ClientWebSocket]::new()
    $uri = [Uri]"ws://${BridgeHost}:${BridgePort}"
    Write-Host "[Agent] Connecting to $uri ..."
    $ws.ConnectAsync($uri, [System.Threading.CancellationToken]::None).Wait()
    Write-Host "[Agent] Connected."
    return $ws
}

function Send-Control($ws, $action) {
    $json  = "{`"type`":`"control`",`"action`":`"$action`"}"
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    $seg   = [System.ArraySegment[byte]]::new($bytes)
    $ws.SendAsync($seg, [System.Net.WebSockets.WebSocketMessageType]::Text, $true,
                  [System.Threading.CancellationToken]::None).Wait()
}

Write-Host "[Agent] YouTube Music RPC — Windows Game Agent"
Write-Host "[Agent] Bridge: ${BridgeHost}:${BridgePort}  Poll: ${PollInterval}s"
Write-Host "[Agent] Press Ctrl+C to stop."

$backoffSeconds = 5

while ($true) {
    try {
        $ws = New-BridgeConnection
        $backoffSeconds = 5
        $gameActive = $false

        while ($ws.State -eq 'Open') {
            $nowGame = Test-GameRunning

            if ($nowGame -and -not $gameActive) {
                $gameActive = $true
                Send-Control $ws 'game_start'
                Write-Host "[Agent] $(Get-Date -Format 'HH:mm:ss') Game detected — bridge notified"

            } elseif (-not $nowGame -and $gameActive) {
                $gameActive = $false
                Send-Control $ws 'game_stop'
                Write-Host "[Agent] $(Get-Date -Format 'HH:mm:ss') Game closed — bridge notified"
            }

            Start-Sleep -Seconds $PollInterval
        }

        Write-Host "[Agent] Connection closed."

    } catch {
        Write-Host "[Agent] Error: $_"
    }

    Write-Host "[Agent] Reconnecting in ${backoffSeconds}s..."
    Start-Sleep -Seconds $backoffSeconds
    $backoffSeconds = [Math]::Min($backoffSeconds * 2, 60)
}
