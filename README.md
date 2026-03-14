# PebbleTrail

PebbleTrail is a Pebble smartwatch application that provides real-time GPS tracking and map rendering. It allows users to view their current location, display GPX tracks, and interact with the map using the watch buttons.

## Features
- Real-time GPS tracking
- Map rendering with different map providers
- GPX track display
  - GPX tracks can be loaded from URL or text input
- Configurable settings for map appearance and behavior
- Button interactions for zooming and updating the map

## Known limitations
- The app relies on the Canvas API for rendering maps, which may not be supported in all environments. If canvas support is unavailable, the app will display an error message on the watch.
