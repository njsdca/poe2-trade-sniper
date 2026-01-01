# Changelog

All notable changes to Divinge will be documented in this file.

## [3.0.2] - 2025-12-31

### Fixed

- **Duplicate Sale Notifications**: Fixed bug where the same sales were being reported as "new" on every sync. Now properly tracks seen sales using the correct API field (`id` instead of `item_id`).

- **Rate Limit Protection**: Added 5-minute minimum interval between syncs to prevent hitting GGG's rate limits. The Sync button now shows an error if you try to sync too frequently.

- **Persistent Rate Limit State**: Rate limit expiration is now saved to disk and persists across app restarts.

---

## [3.0.1] - 2025-12-31

### Changed

- **Manual Sync for Merchant History**: Disabled automatic background sync to prevent rate limiting. Added a manual "Sync" button in the Merchant History tab header. Click to refresh your sales on demand.

### Fixed

- **Rate Limit Handling**: When rate-limited by GGG's API, the Sync button is now disabled and shows a countdown until you can sync again.

---

## [3.0.0] - 2025-12-31

### Added

- **Merchant History Tab**: New "Merchant History" tab in sidebar showing all your completed sales from the official PoE2 merchant history. Displays item icon, name, mods, price, and sale timestamp. Items are styled by rarity (Normal, Magic, Rare, Unique, Gem, Currency) with colored borders.

- **Discord Webhook Integration**: Get notified in Discord when items sell! Configure a Discord webhook URL in Settings to receive real-time sale notifications. Features:
  - PoE-styled item card images rendered for each sale
  - Batched notifications (up to 10 items per message)
  - Configurable minimum Divine value filter
  - Custom display name for personalized messages

- **Item Card Renderer**: New canvas-based renderer generates authentic PoE-styled item cards for Discord notifications, complete with rarity colors, mod lists, and item icons.

- **Auto-Sync on App Start**: Merchant history automatically syncs when the app launches, detecting any new sales that occurred while you were away.

- **Persistence**: Merchant history and known item IDs are saved to disk, so the app remembers which sales you've already seen and only notifies for new ones.

### Fixed

- **WebSocket Handler Not Firing**: Fixed a critical bug where the WebSocket frame handler was checking for `data.new` property but GGG sends `data.result`. The WebSocket handler now correctly processes incoming item notifications.

- **Duplicate Processing Race Condition**: Added token-based deduplication between WebSocket handler and response interceptor. When the WebSocket handler processes an item, the response interceptor now correctly skips it, preventing double teleports and duplicate sounds.

- **Processing Lock Extended**: The `processingIds` set now holds tokens for 5 seconds after processing completes, ensuring late-arriving duplicate events are properly filtered.

- **API Rate Limit Handling**: Added automatic detection and handling of trade history API rate limits. The app now pauses syncing when rate-limited and automatically resumes after the cooldown period.

### New Files

- `src/trade-history.js`: Core module handling API fetching, persistence, sale detection, and Discord integration
- `src/item-card-renderer.js`: Canvas-based PoE item card image generator for Discord embeds
- `src/renderer/history.js`: UI module for the Merchant History tab

### Settings

- Discord webhook URL input with Test and Save buttons
- Enable/disable toggle for Discord notifications

### Technical Details

- Uses official PoE2 `/api/trade2/history` endpoint with POESESSID authentication
- Discord embeds include rarity-based colors matching the game's item frame colors
- History stored in `trade-history.json` in the app's userData directory
- New sales are detected by comparing item_id against previously seen items

## [2.4.0] - 2025-01-01

### Fixed

- **Race Condition in Teleport Detection**: Fixed a race condition where both the WebSocket frame handler and response interceptor could process the same listing, potentially causing duplicate teleport attempts. Added in-flight tracking to prevent this.

- **Memory Management**: Replaced the simple Set-based token tracking with an LRU (Least Recently Used) cache. Previously, the DirectSniper would clear all seen tokens at once when reaching the limit, risking immediate duplicate processing of recent items. The LRU cache now evicts only the oldest entries.

- **Blocking File I/O**: Converted synchronous file operations (`readFileSync`/`writeFileSync`) to async versions in the main process. This prevents the Electron main process from blocking during config load/save operations.

- **Browser Process Cleanup**: Fixed an issue where the update installation would kill ALL Chrome/Edge processes on the system, potentially closing the user's browser tabs. Now tracks the specific browser PID spawned by the app and only terminates that process tree.

- **Event Listener Accumulation**: Added listener cleanup support to the preload bridge. Previously, IPC event listeners could accumulate if the renderer was reinitialized. New `removeListener()` and `removeAllListeners()` methods are now available for cleanup.

### Added

- New `src/lru-cache.js` utility module for efficient token tracking with automatic eviction of oldest entries.
- Browser PID tracking for safer process cleanup during updates.
- Listener management API in preload bridge (`api.removeListener()`, `api.removeAllListeners()`).

### Technical Details

- LRU cache limit: 10,000 tokens (same as previous MAX_SEEN_TOKENS)
- In-flight item tracking prevents race conditions between WebSocket and response handlers
- Async config operations use `fs/promises` module
- macOS support for PID-based process termination using process groups
