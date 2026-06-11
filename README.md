1. loop status
2. evaluate timestamp sync

## Setup

These quick instructions cover basic setup on Linux and macOS.

### Linux

- Install prerequisites: Node.js (v14 or newer) and npm/yarn.
- Install dependencies:

```bash
npm install
```

- Run the bridge (example):

```bash
node bridge.js
```

### macOS

- Install prerequisites: Node.js (v14 or newer) and npm/yarn (use Homebrew if needed).
- Install dependencies:

```bash
npm install
```

- Run the bridge:

```bash
node bridge.js
```

If you need platform-specific service integration (systemd on Linux or launchd on macOS), let me know and I can add examples.

#### macOS (Homebrew)

- If you don't have Homebrew installed, install it first:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

- Install Node.js (and yarn if desired):

```bash
brew install node
brew install yarn # optional
```

### Run as a service

Below are simple examples to run the bridge as a background service. Replace `/path/to/vesktop-youtube-music-rpc` and `USERNAME` with your actual path and user.

#### systemd (Linux)

Create a unit file `/etc/systemd/system/vesktop-bridge.service` with the contents:

```ini
[Unit]
Description=vesktop-youtube-music-rpc bridge
After=network.target

[Service]
Type=simple
User=USERNAME
WorkingDirectory=/path/to/vesktop-youtube-music-rpc
ExecStart=/usr/bin/node /path/to/vesktop-youtube-music-rpc/bridge.js
Restart=on-failure
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Enable and start the service:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now vesktop-bridge.service
```

#### launchd (macOS)

Create a plist file `~/Library/LaunchAgents/com.vesktop.bridge.plist` with the contents:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>com.vesktop.bridge</string>
	<key>ProgramArguments</key>
	<array>
		<string>/usr/local/bin/node</string>
		<string>/path/to/vesktop-youtube-music-rpc/bridge.js</string>
	</array>
	<key>WorkingDirectory</key>
	<string>/path/to/vesktop-youtube-music-rpc</string>
	<key>RunAtLoad</key>
	<true/>
	<key>KeepAlive</key>
	<true/>
	<key>StandardOutPath</key>
	<string>/tmp/vesktop-bridge.log</string>
	<key>StandardErrorPath</key>
	<string>/tmp/vesktop-bridge.err</string>
</dict>
</plist>
```

Load the agent:

```bash
launchctl load ~/Library/LaunchAgents/com.vesktop.bridge.plist
```

To unload or stop the agent:

```bash
launchctl unload ~/Library/LaunchAgents/com.vesktop.bridge.plist
```

Notes:
- Ensure the `node` path in the examples matches your installation (use `which node`).
- For system-wide macOS services, put the plist in `/Library/LaunchDaemons/` and adapt permissions.

### Browser userscript

This repository includes a userscript you can run in your browser to integrate YouTube Music with the bridge: `ytm-rpc-userscript.js`.

Install a userscript manager extension (examples):

- Tampermonkey (Chrome, Edge, Safari)
- Violentmonkey (Chrome, Firefox, Edge)
- Greasemonkey (Firefox)

Quick install steps (Tampermonkey / Violentmonkey):

1. Install the extension for your browser.
2. Create a new script and paste the contents of `ytm-rpc-userscript.js`, or use the extension's "Add from file" option.
3. Save/enable the script and ensure it runs on `music.youtube.com` (or `www.youtube.com` if appropriate).

Notes:
- If you prefer not to paste the file, you can host the script locally or on a gist and use the URL in the extension's "Install from URL" option.
- Check the userscript's metadata block for `@match` or `@include` entries to confirm which pages it runs on.

If you'd like, I can add an example hosted URL or include an installation-ready link for Tampermonkey/Violentmonkey.

#### macOS (Homebrew)

- Install Homebrew if you don't have it:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

- Install Node (and yarn if desired):

```bash
brew install node
brew install yarn # optional
```

### Run as a service

Below are example service configurations you can adapt. Replace paths and usernames as needed.

#### systemd (Linux)

Create a unit file like `/etc/systemd/system/vesktop-ytm-bridge.service` with:

```ini
[Unit]
Description=vesktop-youtube-music-rpc bridge
After=network.target

[Service]
Type=simple
User=YOUR_USER
WorkingDirectory=/path/to/vesktop-youtube-music-rpc
ExecStart=/usr/bin/node /path/to/vesktop-youtube-music-rpc/bridge.js
Restart=on-failure
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Install and start:

```bash
sudo cp vesktop-ytm-bridge.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now vesktop-ytm-bridge.service
```

#### launchd (macOS)

Create a plist like `~/Library/LaunchAgents/com.vesktop.ytm-bridge.plist` with:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
	<dict>
		<key>Label</key>
		<string>com.vesktop.ytm-bridge</string>
		<key>ProgramArguments</key>
		<array>
			<string>/usr/local/bin/node</string>
			<string>/path/to/vesktop-youtube-music-rpc/bridge.js</string>
		</array>
		<key>WorkingDirectory</key>
		<string>/path/to/vesktop-youtube-music-rpc</string>
		<key>RunAtLoad</key>
		<true/>
		<key>KeepAlive</key>
		<true/>
		<key>StandardOutPath</key>
		<string>/tmp/vesktop-bridge.log</string>
		<key>StandardErrorPath</key>
		<string>/tmp/vesktop-bridge.err</string>
	</dict>
</plist>
```

Load it for the current user:

```bash
cp com.vesktop.ytm-bridge.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.vesktop.ytm-bridge.plist
```

Use `sudo` and `/Library/LaunchDaemons` for system-wide daemons.

### Configuration (.env)

You can configure the bridge using a `.env` file at the project root. Copy the example and edit values as needed:

```bash
cp .env.example .env
# then edit .env with your preferred editor (vim, nano, code, etc.)
```

- Keep sensitive values (tokens, secrets) out of version control — add `.env` to `.gitignore` if it's not already ignored.
- Refer to `.env.example` for available keys and brief descriptions.
