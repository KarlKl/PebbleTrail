try {
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

const INIT_LAT = 48.3067582;
const INIT_LON = 14.2861719;
const CHUNK_SIZE = 7 * 1024;
const TILE_CACHE_TTL_MS = 5 * 60 * 1000;
const TILE_CACHE_CLEANUP_INTERVAL_MS = 60 * 1000;
const TILE_CACHE_MAX_ENTRIES = 64;
const BTN_UP = 1;
const BTN_SELECT = 2;
const BTN_DOWN = 3;

const CMD_INIT = 1;
const CMD_IMAGE_CHUNK = 2;
const CMD_BUTTON_CLICK = 3;

// initial configuration values, can be overridden by saved settings in localStorage or by the configuration page
var config = {
  tileProvider: undefined,
  updateIntervalMs: 15000,
  zoomLevel: 16,
  showCurrentLocationDot: true,
  gpxPoints: [],
  enforceMonochrome: false,
};

var renderState = {
  width: 0,
  height: 0,
  bytesPerRow: 0,
  isColor: false,
  outputBytesPerRow: 0,
  outputIsColor: false,
  sendData: null,
  sendIndex: 0,
  totalBytes: 0,
};

var gpsState = {
  latitude: INIT_LAT,
  longitude: INIT_LON,
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

function sendNextChunk() {
  if (!renderState.sendData) {
    return;
  }

  if (renderState.sendIndex * CHUNK_SIZE >= renderState.totalBytes) {
    console.log("Finished sending map bytes");
    renderState.sendData = null;
    return;
  }

  var offset = renderState.sendIndex * CHUNK_SIZE;
  var end = Math.min(offset + CHUNK_SIZE, renderState.totalBytes);
  var chunk = renderState.sendData.slice(offset, end);

  var dict = {
    cmd: 2,
    width: renderState.width,
    height: renderState.height,
    bytes_per_row: renderState.outputBytesPerRow,
    is_color: renderState.outputIsColor ? 1 : 0,
    total_bytes: renderState.totalBytes,
    chunk_index: renderState.sendIndex,
    chunk_offset: offset,
    chunk_data: Array.from(chunk),
  };

  Pebble.sendAppMessage(
    dict,
    function () {
      renderState.sendIndex += 1;
      sendNextChunk();
    },
    function (err) {
      console.log("Chunk send failed, retrying: " + JSON.stringify(err));
      setTimeout(sendNextChunk, 300);
    }
  );
}

function renderTileToWatch() {
  tileRenderer.render({
    renderState: renderState,
    config: config,
    gpsState: gpsState,
    onFrameReady: function (frame) {
      renderState.outputIsColor = frame.outputIsColor;
      renderState.outputBytesPerRow = frame.outputBytesPerRow;
      renderState.sendData = frame.packed;
      renderState.sendIndex = 0;
      renderState.totalBytes = frame.packed.length;
      sendNextChunk();
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
      "Rendering map for " +
        renderState.width +
        "x" +
        renderState.height +
        " color=" +
        renderState.isColor
    );
    renderTileToWatch();
  } else if (payload.cmd === CMD_BUTTON_CLICK) {
    var buttonId = payload.button_id;
    if (buttonId === BTN_UP) {
      config.zoomLevel = Math.min(config.zoomLevel + 1, 19);
      renderTileToWatch();
      console.log("Up button clicked, zoom level: " + config.zoomLevel);
    } else if (buttonId === BTN_SELECT) {
      console.log("Select button clicked");
      // Handle select button click
    } else if (buttonId === BTN_DOWN) {
      config.zoomLevel = Math.max(config.zoomLevel - 1, 0);
      renderTileToWatch();
      console.log("Down button clicked, zoom level: " + config.zoomLevel);
      // Handle down button click
    }
  }
});

Pebble.addEventListener("ready", function () {
  console.log("PKJS ready, waiting for watch request");
  tileCache.cleanup(true);

  if (localStorage.settings) {
    console.log("Found saved settings in localStorage, loading");
    var options = JSON.parse(localStorage.settings);
    options.showCurrentLocationDot = options.showCurrentLocationDot === true;
    options.enforceMonochrome = options.enforceMonochrome === true;
    options.updateIntervalMs *= 1;
    options.zoomLevel *= 1;
    options.gpxPoints = options.gpxPoints || [];
    Object.assign(config, options);
    console.log("Loaded settings from localStorage: " + JSON.stringify(config));
  }

  var dict = {
    cmd: 1,
    JSReady: 1,
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

// GeoLocation
if (navigator.geolocation) {
  setInterval(function () {
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
      }
    );
  }, config.updateIntervalMs);
} else {
  console.log("Geolocation is not supported by this browser.");
}

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
  if (newSettings.updateIntervalSeconds) {
    config.updateIntervalMs = newSettings.updateIntervalSeconds.value * 1000;
  }
  config.zoomLevel = newSettings.zoomLevel.value * 1;
  // gpx stuff
  if (newSettings.gpxTrackColor) {
    config.gpxTrackColor = newSettings.gpxTrackColor.value;
  } else {
    config.gpxTrackColor = 255;
  }
  if (newSettings.enforceMonochrome) {
    config.enforceMonochrome = newSettings.enforceMonochrome.value;
  } else {
    config.enforceMonochrome = false;
  }
  config.gpxPoints = [];
  if (newSettings.gpxUrl.value && newSettings.gpxUrl.value.trim() !== "") {
    console.log("GPX URL provided, fetching: " + newSettings.gpxUrl.value);
    var url = newSettings.gpxUrl.value.trim();
    var request = new XMLHttpRequest();
    request.open("GET", url, true);
    request.onload = function () {
      if (request.status >= 200 && request.status < 400) {
        // Success!
        var gpxText = request.responseText;
        parseGpxTrackPointsAndSave(gpxText);
        renderTileToWatch();
      } else {
        console.log("Failed to fetch GPX file, status: " + request.status);
      }
    };
    request.onerror = function () {
      console.log("Error fetching GPX file");
    };
    request.send();
  } else if (
    newSettings.gpxText.value &&
    newSettings.gpxText.value.trim() !== ""
  ) {
    console.log("GPX Text provided, parsing");
    parseGpxTrackPointsAndSave(newSettings.gpxText.value);
    renderTileToWatch();
  } else {
    console.log("No GPX data provided");
    renderTileToWatch();
    saveSettings();
  }
  console.log("New settings: " + JSON.stringify(newSettings));
});
