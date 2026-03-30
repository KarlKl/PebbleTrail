try {
  // window.MOCK = require("./mock");
  var geo = require("./geo");
  var imagePacking = require("./imagePacking");
  var createTileCache = require("./tileCache").createTileCache;
  var createTileRenderer = require("./tileRenderer").createTileRenderer;
  var getTileUrl = require("./tileUrl").getTileUrl;
  var gpx = require("./gpx");

  // Import the Clay package
  var Clay = require("@rebble/clay");
  // Load our Clay configuration file
  var clayConfig = require("./config");
  // Initialize Clay
  var clay = new Clay(clayConfig, null, { autoHandleEvents: false });
} catch (e) {
  console.log("Could not load dependencies " + JSON.stringify(e));
}

const CHUNK_SIZE = 7 * 1024;
const TILE_CACHE_TTL_MS = 5 * 60 * 1000;
const TILE_CACHE_CLEANUP_INTERVAL_MS = 60 * 1000;
const TILE_CACHE_MAX_ENTRIES = 64;
const BTN_UP = -1;
const BTN_SELECT = 0;
const BTN_DOWN = 1;

const ZOOM_LEVEL_MIN = 0;
const ZOOM_LEVEL_MAX = 20;

const CMD_INIT = 1;
const CMD_IMAGE_CHUNK = 2;
const CMD_BUTTON_CLICK = 3;
const CMD_SAVE_SETTINGS = 4;
const CMD_UPDATE_TIME_OVERLAY = 5;

// initial configuration values, can be overridden by saved settings in localStorage or by the configuration page
var config = {
  tileProvider: undefined,
  updateIntervalMs: 15000,
  onlyUpdateOnSelectPress: false,
  zoomLevel: 16,
  showZoomLevel: false,
  showZoomButtons: true,
  showCurrentLocationDot: true,
  showGpxTrack: true,
  cacheGpxTrack: false,
  gpxUrl: "",
  gpxText: "",
  gpxPoints: [],
  gpxLineStyle: "[5,5]", // dashed by default for better visibility on monochrome watches
  gpxTrackColor: "0000FF", // blue by default
  enforceMonochrome: false,
  showTime: true,
};

var renderState = {
  width: 0,
  height: 0,
  bytesPerRow: 0,
  isColor: false,
  outputBytesPerRow: 0,
  outputIsColor: false,
  compressionFormat: 0,
  sendData: null,
  sendIndex: 0,
  totalBytes: 0,
  sendToken: 0,
};

var gpsState = {
  latitude: undefined,
  longitude: undefined,
  accuracy: 0,
  timestamp: 0,
};

var tileCache = createTileCache({
  ttlMs: TILE_CACHE_TTL_MS,
  cleanupIntervalMs: TILE_CACHE_CLEANUP_INTERVAL_MS,
  maxEntries: TILE_CACHE_MAX_ENTRIES,
  buildUrl: getTileUrl,
});
var tileRenderer = createTileRenderer({
  geo: geo,
  imagePacking: imagePacking,
  tileCache: tileCache,
});

var geolocationUpdateInterval = null;

function sendNextChunk(sendToken) {
  // Ignore stale send loops after a new frame has started.
  if (sendToken !== renderState.sendToken) {
    return;
  }

  if (!renderState.sendData) {
    return;
  }

  if (renderState.sendIndex * CHUNK_SIZE >= renderState.totalBytes) {
    console.log("Finished sending map bytes");
    if (sendToken === renderState.sendToken) {
      renderState.sendData = null;
    }
    return;
  }

  var offset = renderState.sendIndex * CHUNK_SIZE;
  var end = Math.min(offset + CHUNK_SIZE, renderState.totalBytes);
  var chunk = renderState.sendData.slice(offset, end);

  var dict = {
    cmd: CMD_IMAGE_CHUNK,
    width: renderState.width,
    height: renderState.height,
    bytes_per_row: renderState.outputBytesPerRow,
    is_color: renderState.outputIsColor ? 1 : 0,
    compression_format: renderState.compressionFormat,
    total_bytes: renderState.totalBytes,
    chunk_index: renderState.sendIndex,
    chunk_offset: offset,
    chunk_data: Array.from(chunk),
  };

  Pebble.sendAppMessage(
    dict,
    function () {
      if (sendToken !== renderState.sendToken) {
        return;
      }
      renderState.sendIndex += 1;
      sendNextChunk(sendToken);
    },
    function (err) {
      if (sendToken !== renderState.sendToken) {
        return;
      }
      console.log("Chunk send failed, retrying: " + JSON.stringify(err));
      setTimeout(function () {
        sendNextChunk(sendToken);
      }, 300);
    }
  );
}

function startChunkTransfer(frame) {
  // Bump token so any previous in-flight send callbacks become no-ops.
  renderState.sendToken += 1;
  var sendToken = renderState.sendToken;

  renderState.outputIsColor = frame.outputIsColor;
  renderState.outputBytesPerRow = frame.outputBytesPerRow;
  renderState.compressionFormat = frame.compressionFormat || 0;
  renderState.sendData = frame.packed;
  renderState.sendIndex = 0;
  renderState.totalBytes = frame.packed.length;
  sendNextChunk(sendToken);
}

function renderTileToWatch() {
  if (gpsState.latitude === undefined || gpsState.longitude === undefined) {
    console.log("GPS position not available, cannot render tile");
    renderErrorToWatch("GPS position\nnot available", "⌖");
    return;
  }
  if (typeof(MOCK) !== "undefined") {
    console.log("MOCKING ENABLED, sending test frame");
    MOCK.sendTestFrame(
      startChunkTransfer,
      "checkerboard",
      renderState.width,
      renderState.height,
      renderState.isColor
    );
    return;
  }
  tileRenderer.render({
    renderState: renderState,
    config: config,
    gpsState: gpsState,
    onFrameReady: function (frame) {
      startChunkTransfer(frame);
    },
  });
}

function saveSettings() {
  localStorage.settings = JSON.stringify(config);
}

function setGpxPoints(points) {
  config.gpxPoints = points;
  saveSettings();
}

function parseGpxTrackPointsAndSave(gpxString) {
  var points = [];
  try {
    points = gpx.parseGpxTrackPoints(gpxString);
  } catch (err) {
    console.log("Error parsing GPX track points: " + JSON.stringify(err));
  }

  if (points.length > 0) {
    console.log(
      "Parsed " +
        points.length +
        " GPX track points, sample: " +
        JSON.stringify(points[0])
    );
  } else {
    console.log("No GPX track points found in provided data");
  }

  setGpxPoints(points);
  return points;
}

function handleButtonClick(buttonId) {
  if (buttonId === BTN_UP) {
    config.zoomLevel = Math.min(ZOOM_LEVEL_MAX, config.zoomLevel + 1);
    console.log("Up button clicked, zoom level: " + config.zoomLevel);
    renderTileToWatch();
  } else if (buttonId === BTN_SELECT) {
    console.log("Select button clicked");
    getCurrentPosition();
  } else if (buttonId === BTN_DOWN) {
    config.zoomLevel = Math.max(ZOOM_LEVEL_MIN, config.zoomLevel - 1);
    console.log("Down button clicked, zoom level: " + config.zoomLevel);
    renderTileToWatch();
  }
  saveSettings();
}

function getCurrentPosition() {
  navigator.geolocation.getCurrentPosition(
    function (position) {
      // update watch if changed significantly (more than 10m)
      var distance = geo.getDistanceFromLatLonInMeters(
        gpsState.latitude,
        gpsState.longitude,
        position.coords.latitude,
        position.coords.longitude
      );
      if (distance < 10) {
        return;
      }
      gpsState.latitude = position.coords.latitude;
      gpsState.longitude = position.coords.longitude;
      gpsState.accuracy = position.coords.accuracy;
      gpsState.timestamp = position.timestamp;

      renderTileToWatch();

      console.log(
        "GPS update: " +
          gpsState.latitude +
          ", " +
          gpsState.longitude +
          " accuracy: " +
          gpsState.accuracy +
          " timestamp: " +
          gpsState.timestamp
      );
    },
    function (err) {
      console.log("Error getting position: " + JSON.stringify(err));
      renderErrorToWatch("Error getting\nGPS position", "⌖");
    }
  );
}

function prefetchGpxTiles() {
  if (!config.cacheGpxTrack || !config.gpxPoints || config.gpxPoints.length === 0) {
    return;
  }
  var provider = config.tileProvider || "osm";
  var tiles = geo.getTilesAlongRoute(config.gpxPoints, config.zoomLevel, 1);
  console.log(
    "Prefetching " + tiles.length + " tiles along GPX route at zoom " +
    config.zoomLevel + " (provider: " + provider + ")"
  );
  tileCache.prefetchRoute(
    provider,
    config.zoomLevel,
    tiles,
    function (done, total) {
      if (done === 1 || done % 10 === 0 || done === total) {
        console.log("Route tile prefetch: " + done + "/" + total);
      }
    },
    function (success, total) {
      console.log("Route tile prefetch complete: " + success + "/" + total + " tiles cached");
    }
  );
}

function renderErrorToWatch(message, icon = "⚡") {
  tileRenderer.renderError(
    {
      renderState: renderState,
      config: config,
      onFrameReady: function (frame) {
        startChunkTransfer(frame);
      },
    },
    message,
    icon
  );
}

function sendUpdateTimeOverlay(show) {
  var dict = {
    cmd: CMD_UPDATE_TIME_OVERLAY,
    showTimeOverlay: show ? 1 : 0,
  };
  Pebble.sendAppMessage(
    dict,
    function () {
      console.log("Notified watch of showTime overlay change: " + show);
    },
    function (err) {
      console.log(
        "Failed to notify watch of showTime overlay change: " +
          JSON.stringify(err)
      );
    }
  );
}

// GeoLocation
if (navigator.geolocation) {
  if (config.updateIntervalMs > 10000 && !config.onlyUpdateOnSelectPress) {
    geolocationUpdateInterval = setInterval(function () {
      getCurrentPosition();
    }, config.updateIntervalMs);
  }
} else {
  console.log("Geolocation is not supported by this browser.");
  renderErrorToWatch("Geolocation\nnot supported");
}

Pebble.addEventListener("appmessage", function (e) {
  console.log("AppMessage received: " + JSON.stringify(e));
  var payload = e.payload || {};
  if (payload.cmd === CMD_INIT) {
    renderState.width = payload.width;
    renderState.height = payload.height;
    renderState.bytesPerRow = payload.bytes_per_row;
    renderState.isColor = payload.is_color === 1;

    if (config.tileProvider === undefined) {
      config.tileProvider = renderState.isColor ? "osm" : "stamen_toner";
    }

    console.log(
      "Display settings of watch width:" +
        renderState.width +
        " height: " +
        renderState.height +
        " color:" +
        renderState.isColor
    );
  } else if (payload.cmd === CMD_BUTTON_CLICK) {
    var buttonId = payload.button_id;
    handleButtonClick(buttonId);
  } else if (payload.cmd === CMD_SAVE_SETTINGS) {
    saveSettings();
    console.log("Saved settings on watch exit request");
  }
  getCurrentPosition();
});

Pebble.addEventListener("ready", function () {
  console.log("PKJS ready, waiting for watch request");
  tileCache.cleanup(true);

  if (localStorage.settings) {
    console.log("Found saved settings in localStorage, loading");
    var options = JSON.parse(localStorage.settings);
    options.showCurrentLocationDot = options.showCurrentLocationDot === true;
    options.enforceMonochrome = options.enforceMonochrome === true;
    options.showGpxTrack = options.showGpxTrack === true;
    options.cacheGpxTrack = options.cacheGpxTrack === true;
    options.showTime = options.showTime === true;
    options.showZoomButtons = options.showZoomButtons === true;
    options.showZoomLevel = options.showZoomLevel === true;
    options.onlyUpdateOnSelectPress = options.onlyUpdateOnSelectPress === true;
    options.updateIntervalMs *= 1;
    options.zoomLevel *= 1;
    options.gpxPoints = options.gpxPoints || [];
    Object.assign(config, options);
    console.log("Loaded settings from localStorage: " + JSON.stringify(config));
  }

  prefetchGpxTiles();

  var dict = {
    cmd: 1,
    JSReady: 1,
    showTimeOverlay: config.showTime ? 1 : 0,
    isCanvasSupported: tileRenderer.isCanvasSupported() ? 1 : 0,
  };
  Pebble.sendAppMessage(
    dict,
    function () {
      console.log("Notified watch that JS is ready");
    },
    function (err) {
      console.log(
        "Failed to notify watch that JS is ready: " + JSON.stringify(err)
      );
    }
  );
});

Pebble.addEventListener("showConfiguration", function (e) {
  Pebble.openURL(clay.generateUrl());
});

Pebble.addEventListener("webviewclosed", function (e) {
  if (!e || !e.response) {
    return;
  }
  var newSettings = clay.getSettings(e.response, false);
  config.showCurrentLocationDot = newSettings.showCurrentLocationDot.value;
  config.tileProvider = newSettings.tileProvider.value;
  if (newSettings.onlyUpdateOnSelectPress) {
    config.onlyUpdateOnSelectPress = newSettings.onlyUpdateOnSelectPress.value;
    if (config.onlyUpdateOnSelectPress) {
      clearInterval(geolocationUpdateInterval);
      geolocationUpdateInterval = null;
    }
  }
  if (newSettings.updateIntervalSeconds) {
    config.updateIntervalMs = newSettings.updateIntervalSeconds.value * 1000;
    if (!config.onlyUpdateOnSelectPress) {
      clearInterval(geolocationUpdateInterval);
      geolocationUpdateInterval = setInterval(function () {
        getCurrentPosition();
      }, config.updateIntervalMs);
    }
  }
  config.zoomLevel = newSettings.zoomLevel.value * 1;
  if (newSettings.showTime && newSettings.showTime.value !== config.showTime) {
    config.showTime = newSettings.showTime.value;
    sendUpdateTimeOverlay(config.showTime);
  }
  if (newSettings.showZoomLevel) {
    config.showZoomLevel = newSettings.showZoomLevel.value;
  }
  if (newSettings.showZoomButtons) {
    config.showZoomButtons = newSettings.showZoomButtons.value;
  }
  // gpx stuff
  if (newSettings.gpxTrackColor) {
    config.gpxTrackColor = newSettings.gpxTrackColor.value.toString(16);
  } else {
    config.gpxTrackColor = 255;
  }
  if (newSettings.enforceMonochrome) {
    config.enforceMonochrome = newSettings.enforceMonochrome.value;
  } else {
    config.enforceMonochrome = false;
  }
  if (newSettings.gpxLineStyle) {
    config.gpxLineStyle = newSettings.gpxLineStyle.value;
  }
  if (newSettings.showGpxTrack) {
    config.showGpxTrack = newSettings.showGpxTrack.value;
  }
  if (newSettings.cacheGpxTrack !== undefined) {
    var wasEnabled = config.cacheGpxTrack;
    config.cacheGpxTrack = newSettings.cacheGpxTrack.value;
    if (wasEnabled && !config.cacheGpxTrack) {
      tileCache.clearRouteCache();
    }
  }
  if (
    newSettings.gpxUrl.value &&
    newSettings.gpxUrl.value.trim() !== "" &&
    newSettings.gpxUrl.value.trim() !== config.gpxUrl
  ) {
    console.log("GPX URL provided, fetching: " + newSettings.gpxUrl.value);
    var url = newSettings.gpxUrl.value.trim();
    config.gpxPoints = [];
    var request = new XMLHttpRequest();
    request.open("GET", url, true);
    request.onload = function () {
      if (request.status >= 200 && request.status < 400) {
        // Success!
        var gpxText = request.responseText;
        parseGpxTrackPointsAndSave(gpxText);
        prefetchGpxTiles();
        renderTileToWatch();
      } else {
        console.log("Failed to fetch GPX file, status: " + request.status);
      }
    };
    request.onerror = function () {
      console.log("Error fetching GPX file");
    };
    request.send();
    config.gpxUrl = url;
  } else if (
    newSettings.gpxText.value &&
    newSettings.gpxText.value.trim() !== "" &&
    newSettings.gpxText.value.trim() !== config.gpxText
  ) {
    console.log("GPX Text provided, parsing");
    config.gpxPoints = [];
    parseGpxTrackPointsAndSave(newSettings.gpxText.value);
    prefetchGpxTiles();
    renderTileToWatch();
    config.gpxText = newSettings.gpxText.value;
  }
  console.log("No GPX data provided or GPX data unchanged");
  renderTileToWatch();
  saveSettings();
  console.log("New settings: " + JSON.stringify(newSettings));
});
