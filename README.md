# PoE2 Trade Sniper

A desktop application for Path of Exile 2 that monitors live trade searches and automatically teleports you to sellers when new listings appear.

## Features

- **Live Search Monitoring** - Connect to multiple PoE2 trade searches simultaneously
- **Auto-Teleport** - Automatically triggers the whisper/teleport when new items are listed
- **Fast Response Times** - Optimized for speed with fire-and-forget requests
- **Auto-Reconnect** - Automatically reconnects if the connection drops (up to 5 attempts)
- **Health Checks** - Monitors connections every 30 seconds to ensure reliability
- **Desktop Notifications** - Get notified when new listings appear
- **System Tray** - Runs in the background with system tray integration
- **Auto-Updates** - Automatically checks for and installs updates from GitHub

### UI Features

- Dark mode interface
- Real-time stats (listings found, teleports triggered, average response time, uptime)
- Connection status indicators per query
- Collapsible sections for a clean interface
- Multiple sound options (Alert, Chime, Ping, or None)

### Hotkeys

- `Ctrl+Shift+S` - Toggle sniper on/off
- `Ctrl+Shift+H` - Show/hide window

## Requirements

- Windows 10/11
- Google Chrome or Microsoft Edge installed (used for web automation)
- Valid PoE2 account with POESESSID cookie

## Installation

1. Download the latest release from the [Releases page](https://github.com/njsdca/poe2-trade-sniper/releases)
2. Run the installer (`PoE2-Trade-Sniper-Setup-x.x.x.exe`)
3. Launch the application

## Setup

### Getting Your POESESSID

1. Log in to [pathofexile.com](https://www.pathofexile.com)
2. Open browser DevTools (F12)
3. Go to Application > Cookies > pathofexile.com
4. Copy the value of `POESESSID`

Alternatively, use the built-in **Extract Cookies** button which will open a browser window for you to log in.

### Adding Trade Searches

1. Create a search on the [PoE2 Trade Site](https://www.pathofexile.com/trade2/search/poe2/)
2. Copy the query ID from the URL (e.g., `https://www.pathofexile.com/trade2/search/poe2/Standard/ABC123` -> `ABC123`)
3. Add the query ID in the app with an optional name

## Usage

1. Enter your POESESSID (and optionally cf_clearance if needed)
2. Select your league
3. Add one or more trade search query IDs
4. Click **Start Sniper**
5. The app will monitor for new listings and auto-teleport when found

## Configuration Options

| Option | Description |
|--------|-------------|
| POESESSID | Your PoE session cookie (required) |
| cf_clearance | Cloudflare cookie (optional, may be needed) |
| League | The league to search in |
| Sound | Alert sound when listings are found |
| Start Minimized | Launch the app minimized to system tray |

## How It Works

1. The app uses Puppeteer with your system Chrome/Edge to connect to PoE2's live trade search
2. When new items are listed, the trade site sends real-time updates via WebSocket
3. The app intercepts these updates and automatically calls the whisper/teleport API
4. You get teleported to the seller's hideout instantly

## Building from Source

```bash
# Clone the repository
git clone https://github.com/njsdca/poe2-trade-sniper.git
cd poe2-trade-sniper

# Install dependencies
npm install

# Run in development
npm run electron

# Build for Windows
npm run build
```

## Troubleshooting

### "No browser found" error
Make sure you have Google Chrome or Microsoft Edge installed.

### "Cookie expired" error
Your cf_clearance cookie has expired. Use the Extract Cookies button to get fresh cookies.

### Connection keeps dropping
This can happen if PoE's servers are under heavy load. The app will automatically attempt to reconnect up to 5 times.

## Disclaimer

This tool automates interactions with the Path of Exile trade site. Use at your own risk. The author is not responsible for any actions taken against your account.

## License

MIT
