function createTileCache(options) {
  var ttlMs = options.ttlMs;
  var cleanupIntervalMs = options.cleanupIntervalMs;
  var maxEntries = options.maxEntries;
  var buildUrl = options.buildUrl;

  var entries = {};
  var lastCleanup = 0;

  function cacheKey(provider, zoom, x, y) {
    return provider + ":" + zoom + ":" + x + ":" + y;
  }

  function evict(key) {
    delete entries[key];
  }

  function trimToSize() {
    var keys = Object.keys(entries).filter(function (key) {
      return entries[key] && entries[key].status === "loaded";
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
      if (entry.status === "loaded" && entry.expiresAt <= now) {
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

    if (entry && entry.status === "loaded" && entry.expiresAt > now) {
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

  setInterval(function () {
    cleanup(false);
  }, cleanupIntervalMs);

  return {
    cleanup: cleanup,
    load: load,
  };
}

module.exports = {
  createTileCache: createTileCache,
};
