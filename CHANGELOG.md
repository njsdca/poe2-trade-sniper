# Changelog

All notable changes to Divinge will be documented in this file.

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
