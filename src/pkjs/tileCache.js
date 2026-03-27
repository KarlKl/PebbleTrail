function createTileCache(options) {
  var ttlMs = options.ttlMs;
  var cleanupIntervalMs = options.cleanupIntervalMs;
  var maxEntries = options.maxEntries;
  var buildUrl = options.buildUrl;

  var entries = {};
  var lastCleanup = 0;

  // --- Persistence (localStorage) ---
  // Route tiles are fetched once, stored as base64 data-URLs, and never expired.
  var PERSIST_PREFIX = "ptc_"; // "pebbletrail cache"
  var PERSIST_INDEX_KEY = "ptc_index";

  function getPersistedIndex() {
    try {
      var raw = localStorage.getItem(PERSIST_INDEX_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }

  function persistDataUrl(key, dataUrl) {
    try {
      localStorage.setItem(PERSIST_PREFIX + key, dataUrl);
      var index = getPersistedIndex();
      index[key] = true;
      localStorage.setItem(PERSIST_INDEX_KEY, JSON.stringify(index));
    } catch (e) {
      console.log("Failed to persist tile " + key + ": " + e);
    }
  }

  function getPersistedDataUrl(key) {
    try {
      return localStorage.getItem(PERSIST_PREFIX + key);
    } catch (e) {
      return null;
    }
  }

  function clearPersistedTiles() {
    try {
      var index = getPersistedIndex();
      var keys = Object.keys(index);
      for (var i = 0; i < keys.length; i++) {
        localStorage.removeItem(PERSIST_PREFIX + keys[i]);
      }
      localStorage.removeItem(PERSIST_INDEX_KEY);
    } catch (e) {
      console.log("Failed to clear persisted tiles: " + e);
    }
  }

  function cacheKey(provider, zoom, x, y) {
    return provider + ":" + zoom + ":" + x + ":" + y;
  }

  function evict(key) {
    // Pinned entries survive until clearRouteCache() is called explicitly.
    if (entries[key] && entries[key].pinned) {
      return;
    }
    delete entries[key];
  }

  function trimToSize() {
    // Only un-pinned loaded entries are eligible for eviction.
    var keys = Object.keys(entries).filter(function (key) {
      return entries[key] && entries[key].status === "loaded" && !entries[key].pinned;
    });
    keys.sort(function (left, right) {
      var leftEntry = entries[left];
      var rightEntry = entries[right];
      return (leftEntry.lastAccess || 0) - (rightEntry.lastAccess || 0);
    });

    while (Object.keys(entries).length > maxEntries && keys.length > 0) {
      evict(keys.shift());
    }
  }

  function cleanup(force) {
    var now = Date.now();
    if (!force && now - lastCleanup < cleanupIntervalMs) {
      return;
    }

    lastCleanup = now;

    var keys = Object.keys(entries);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var entry = entries[key];
      if (!entry) {
        continue;
      }
      if (!entry.pinned && entry.status === "loaded" && entry.expiresAt <= now) {
        evict(key);
      }
    }

    if (Object.keys(entries).length > maxEntries) {
      trimToSize();
    }
  }

  function load(provider, zoom, x, y, onLoad, onError) {
    var key = cacheKey(provider, zoom, x, y);
    var now = Date.now();
    var entry = entries[key];

    cleanup(false);

    // Serve from in-memory cache; pinned entries never expire.
    if (entry && entry.status === "loaded" && (entry.pinned || entry.expiresAt > now)) {
      entry.lastAccess = now;
      onLoad(entry.image);
      return;
    }

    if (entry && entry.status === "loading") {
      entry.waiters.push({
        onLoad: onLoad,
        onError: onError,
      });
      return;
    }

    // Check localStorage for a previously persisted (pinned) tile.
    var persistedDataUrl = getPersistedDataUrl(key);
    if (persistedDataUrl) {
      entry = {
        image: null,
        status: "loading",
        pinned: true,
        waiters: [{ onLoad: onLoad, onError: onError }],
        lastAccess: now,
        expiresAt: Infinity,
      };
      entries[key] = entry;
      var persistedImg = new Image();
      persistedImg.onload = function () {
        var loadedEntry = entries[key];
        if (!loadedEntry) { return; }
        loadedEntry.image = persistedImg;
        loadedEntry.status = "loaded";
        loadedEntry.lastAccess = Date.now();
        var waiters = loadedEntry.waiters.slice();
        loadedEntry.waiters.length = 0;
        for (var wi = 0; wi < waiters.length; wi++) {
          waiters[wi].onLoad(persistedImg);
        }
      };
      persistedImg.onerror = function () {
        // Corrupt/stale data — remove and report error.
        localStorage.removeItem(PERSIST_PREFIX + key);
        var failedEntry = entries[key];
        var waiters = failedEntry ? failedEntry.waiters.slice() : [];
        delete entries[key];
        for (var wi = 0; wi < waiters.length; wi++) {
          waiters[wi].onError();
        }
      };
      persistedImg.src = persistedDataUrl;
      return;
    }

    // Network fetch.
    evict(key);

    var img = new Image();
    entry = {
      image: img,
      status: "loading",
      waiters: [
        {
          onLoad: onLoad,
          onError: onError,
        },
      ],
      lastAccess: now,
      expiresAt: now + ttlMs,
    };
    entries[key] = entry;

    img.crossOrigin = "Anonymous";
    img.onload = function () {
      var loadedEntry = entries[key];
      var callbackNow = Date.now();
      if (!loadedEntry) {
        return;
      }

      loadedEntry.status = "loaded";
      loadedEntry.lastAccess = callbackNow;
      loadedEntry.expiresAt = callbackNow + ttlMs;

      var waiters = loadedEntry.waiters.slice();
      loadedEntry.waiters.length = 0;

      for (var waiterIndex = 0; waiterIndex < waiters.length; waiterIndex++) {
        waiters[waiterIndex].onLoad(loadedEntry.image);
      }
    };

    img.onerror = function () {
      var failedEntry = entries[key];
      var waiters = failedEntry ? failedEntry.waiters.slice() : [];
      evict(key);

      for (var waiterIndex = 0; waiterIndex < waiters.length; waiterIndex++) {
        waiters[waiterIndex].onError();
      }
    };

    img.src = buildUrl(provider, zoom, x, y);
  }

  // Fetch a single tile via XHR, persist as a data-URL, and pin it in memory.
  function prefetchTile(provider, zoom, x, y, onDone) {
    var key = cacheKey(provider, zoom, x, y);

    // Already pinned and loaded in memory?
    var entry = entries[key];
    if (entry && entry.pinned && entry.status === "loaded") {
      onDone(true);
      return;
    }

    // Already persisted in localStorage?
    if (getPersistedDataUrl(key)) {
      if (!entry || entry.status !== "loaded") {
        load(provider, zoom, x, y, function () { onDone(true); }, function () { onDone(false); });
      } else {
        entry.pinned = true;
        entry.expiresAt = Infinity;
        onDone(true);
      }
      return;
    }

    // Fetch raw bytes so we can store the data-URL.
    var url = buildUrl(provider, zoom, x, y);
    var xhr = new XMLHttpRequest();
    xhr.open("GET", url, true);
    xhr.responseType = "arraybuffer";
    xhr.onload = function () {
      if (xhr.status >= 200 && xhr.status < 400) {
        try {
          var bytes = new Uint8Array(xhr.response);
          var binary = "";
          for (var i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
          }
          var dataUrl = "data:image/png;base64," + btoa(binary);
          persistDataUrl(key, dataUrl);
          var img = new Image();
          img.onload = function () {
            entries[key] = {
              image: img,
              status: "loaded",
              pinned: true,
              waiters: [],
              lastAccess: Date.now(),
              expiresAt: Infinity,
            };
            onDone(true);
          };
          img.onerror = function () { onDone(false); };
          img.src = dataUrl;
        } catch (e) {
          console.log("Error processing prefetch tile " + key + ": " + e);
          onDone(false);
        }
      } else {
        onDone(false);
      }
    };
    xhr.onerror = function () { onDone(false); };
    xhr.send();
  }

  // Pre-download all tiles in the list (computed externally via geo.getTilesAlongRoute).
  // Runs up to CONCURRENCY fetches in parallel; calls onProgress(done, total) and
  // onComplete(succeeded, total) when finished.
  function prefetchRoute(provider, zoom, tiles, onProgress, onComplete) {
    var total = tiles.length;
    var done = 0;
    var success = 0;

    if (total === 0) {
      if (onComplete) { onComplete(0, 0); }
      return;
    }

    var CONCURRENCY = 3;
    var idx = 0;

    function next() {
      if (idx >= tiles.length) { return; }
      var tile = tiles[idx++];
      prefetchTile(provider, zoom, tile.x, tile.y, function (ok) {
        done++;
        if (ok) { success++; }
        if (onProgress) { onProgress(done, total); }
        if (done === total) {
          if (onComplete) { onComplete(success, total); }
        } else {
          next();
        }
      });
    }

    for (var j = 0; j < Math.min(CONCURRENCY, total); j++) {
      next();
    }
  }

  // Remove all pinned/persisted route tiles from memory and localStorage.
  function clearRouteCache() {
    var keys = Object.keys(entries);
    for (var i = 0; i < keys.length; i++) {
      if (entries[keys[i]] && entries[keys[i]].pinned) {
        delete entries[keys[i]];
      }
    }
    clearPersistedTiles();
    console.log("Route tile cache cleared");
  }

  setInterval(function () {
    cleanup(false);
  }, cleanupIntervalMs);

  return {
    cleanup: cleanup,
    load: load,
    prefetchRoute: prefetchRoute,
    clearRouteCache: clearRouteCache,
  };
}

module.exports = {
  createTileCache: createTileCache,
};
