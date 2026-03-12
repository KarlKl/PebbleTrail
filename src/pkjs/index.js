try {
    const { parseGpxTrackPoints } = require('./gpxParser.js');
    
    require('./env.js');
    
    // Import the Clay package
    var Clay = require('@rebble/clay');
    // Load our Clay configuration file
    var clayConfig = require('./config');
    // Initialize Clay
    var clay = new Clay(clayConfig, null, { autoHandleEvents: false });
} catch (e) {
    console.log("Could not load gpxParser.js");
}

const INIT_LAT = 48.3067582;
const INIT_LON = 14.2861719;
const CHUNK_SIZE = 7 * 1024;
const LUMINANCE_THRESHOLD = 190; // higher = more likely to be black, lower = more likely to be white
const BTN_UP = 1;
const BTN_SELECT = 2;
const BTN_DOWN = 3;

const CMD_INIT = 1;
const CMD_IMAGE_CHUNK = 2;
const CMD_BUTTON_CLICK = 3;


var tileUrls = {
    osm: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    osm_cyclosm: 'https://c.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png',
    stamen_watercolor: `https://tiles.stadiamaps.com/tiles/stamen_watercolor/{z}/{x}/{y}.png?api_key={STADIAMAPS_API_KEY}`,
    stamen_toner: `https://tiles.stadiamaps.com/tiles/stamen_toner/{z}/{x}/{y}.png?api_key={STADIAMAPS_API_KEY}`,
    stamen_terrain: `https://tiles.stadiamaps.com/tiles/stamen_terrain/{z}/{x}/{y}.png?api_key={STADIAMAPS_API_KEY}`,
};

// Configuration
var config = {
    tileProvider: 'osm',
    updateIntervalMs: 15000,
    zoomLevel: 16,
    showCurrentLocationDot: true,
};

var renderState = {
    width: 0,
    height: 0,
    bytesPerRow: 0,
    isColor: false,
    sendData: null,
    sendIndex: 0,
    totalBytes: 0,
    renderToken: 0,
};

var gpsState = {
    latitude: INIT_LAT,
    longitude: INIT_LON,
    accuracy: 0,
    timestamp: 0,
};

var gpxState = {
    points: [],
};

var canvasContext = null;

if (!window.atob) {
	var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
	window.atob = function (input) {
		var str = String(input).replace(/=+$/, '');
		if (str.length % 4 == 1) {
			throw new Error("'atob' failed: The string to be decoded is not correctly encoded.");
		}
		for (
			var bc = 0, bs, buffer, idx = 0, output = '';
			buffer = str.charAt(idx++);
			~buffer && (bs = bc % 4 ? bs * 64 + buffer : buffer,
				bc++ % 4) ? output += String.fromCharCode(255 & bs >> (-2 * bc & 6)) : 0
		) {
			buffer = chars.indexOf(buffer);
		}
		return output;
	};
}

if (!window.Image) {
	window.Image = function() {
		var self = this;
		setTimeout(function() {
			self.onload && self.onload();
		}, 500);
	}
}

function long2tileFloat(lon, zoom) {
    return (lon + 180) / 360 * Math.pow(2, zoom);
}

function lat2tileFloat(lat, zoom) {
    var latRad = deg2rad(lat);
    return (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * Math.pow(2, zoom);
}

function mod(n, m) {
    return ((n % m) + m) % m;
}


function quantize2(value) {
    var v = Math.floor((value + 42) / 85);
    if (v < 0) {
        return 0;
    }
    if (v > 3) {
        return 3;
    }
    return v;
}

function rgbaToPebbleColor(r, g, b) {
    var r2 = quantize2(r);
    var g2 = quantize2(g);
    var b2 = quantize2(b);
    return 0xC0 | (r2 << 4) | (g2 << 2) | b2;
}

function packMonochrome(imageData, width, height, bytesPerRow) {
    var packed = new Uint8Array(bytesPerRow * height);
    var data = imageData.data;

    for (var y = 0; y < height; y++) {
        for (var x = 0; x < width; x++) {
            var idx = (y * width + x) * 4;
            var r = data[idx];
            var g = data[idx + 1];
            var b = data[idx + 2];
            var luminance = (r * 0.2126) + (g * 0.7152) + (b * 0.0722);
            var bit = luminance > LUMINANCE_THRESHOLD ? 1 : 0;
            if (bit) {
                var byteIndex = y * bytesPerRow + (x >> 3);
                var bitIndex = 7 - (x & 7);
                packed[byteIndex] |= (1 << bitIndex);
            }
        }
    }

    return packed;
}

function packColor(imageData, width, height) {
    var packed = new Uint8Array(width * height);
    var data = imageData.data;
    var outIdx = 0;

    for (var i = 0; i < data.length; i += 4) {
        packed[outIdx++] = rgbaToPebbleColor(data[i], data[i + 1], data[i + 2]);
    }

    return packed;
}

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
        total_bytes: renderState.totalBytes,
        chunk_index: renderState.sendIndex,
        chunk_offset: offset,
        chunk_data: Array.from(chunk),
    };

    Pebble.sendAppMessage(dict, function() {
        renderState.sendIndex += 1;
        sendNextChunk();
    }, function(err) {
        console.log("Chunk send failed, retrying: " + JSON.stringify(err));
        setTimeout(sendNextChunk, 300);
    });
}


function getMockCanvasContext() {
	var noop = function() {};

	return {
		setTransform: noop,
        clearRect: noop,
		fillRect: noop,
		beginPath: noop,
		arc: noop,
		fill: noop,
		fillText: noop,
		drawImage: noop,
		getImageData: function(x, y, w, h) {
			// copy warning image to data buffer
			var data = new Uint8Array((w-x) * (h-y) * 4);

			for (var i = 0; i < data.length; i++) data[i] = 255;

			for (var i = 0; i < warnImg.length; i++) {
				for (var b = 0; b < 8; b++) {
					data[160 * 4 * 48 + (i * 8 + b) * 4 + 1] = (warnImg.charCodeAt(i) >> b) & 1 ? 255 : 0;
				}
			}

			return {
				data: data,
				width: (w-x),
				height: (h-y),
			};
		},
		putImageData: noop,
	};
}

var warnImg = atob('///9/+/+//3//v7f/3///1////////j/X////f/+/v//f///X///////+P9fs9V1Rrxm15xfc8Yq/v///3/w/7+t5am1XlpXay+ttXT/////f/L/v631re3ewloPby3sdv////8/5f+/rfWt3d76Wu9vrd92/////x/C/7+t9K21Xtpaay+ttXb/////H8D/v3P1bc685t2cX3POdv7///+PiP///////////////////////0cQ////////////////////////pyj//////94FfX38////v/////9TUP7/////3t05ff////+//////6Eo/I+t1lnc3Tm9f8baxbj/////UVX8by2llh7cVT2+vdS9tv////+oqPjfrbXW3t1V/b2Pto69////f1RQ8b+ttdbe3VX9vbe2trv///9/qqrybyWl1t7dVb29tba29v///z8AAOCfq9bZ3N1tYX6Odo+5////HwAAwP+/9////////////////////////7/3/////////////////w==');

function initCanvas(width, height) {
	try {
		canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		if (document.getElementById('canvasDebug')) {
			document.getElementById('canvasDebug').appendChild(canvas);
		}
		return canvas.getContext('2d');
	} catch(ex) {
		console.log('HTML5 canvas NOT SUPPORTED!');
		canvas = {};
		return getMockCanvasContext();
	}
	
}

function renderTileToWatch() {
    if (typeof document === "undefined" || !document.createElement) {
        console.log("Canvas API unavailable in PKJS environment");
        return;
    }
    var width = renderState.width;
    var height = renderState.height;
    var bytesPerRow = renderState.bytesPerRow;
    var isColor = renderState.isColor;
    var zoom = config.zoomLevel;
    var tileSize = 256;
    var tileCount = Math.pow(2, zoom);

    renderState.renderToken += 1;
    var thisRenderToken = renderState.renderToken;

    if (!canvasContext) {
        canvasContext = initCanvas(width, height);
    } else if (canvasContext.canvas && (canvasContext.canvas.width !== width || canvasContext.canvas.height !== height)) {
        canvasContext.canvas.width = width;
        canvasContext.canvas.height = height;
    }

    if (canvasContext.clearRect) {
        // Clear previous frame before drawing newly fetched tiles.
        canvasContext.clearRect(0, 0, width, height);
    }

    var centerTileX = long2tileFloat(gpsState.longitude, zoom);
    var centerTileY = lat2tileFloat(gpsState.latitude, zoom);
    var centerWorldX = centerTileX * tileSize;
    var centerWorldY = centerTileY * tileSize;
    var topLeftWorldX = centerWorldX - (width / 2);
    var topLeftWorldY = centerWorldY - (height / 2);

    var minTileX = Math.floor(topLeftWorldX / tileSize);
    var minTileY = Math.floor(topLeftWorldY / tileSize);
    var maxTileX = Math.floor((topLeftWorldX + width - 1) / tileSize);
    var maxTileY = Math.floor((topLeftWorldY + height - 1) / tileSize);

    var jobs = [];
    for (var tileY = minTileY; tileY <= maxTileY; tileY++) {
        if (tileY < 0 || tileY >= tileCount) {
            continue;
        }
        for (var tileX = minTileX; tileX <= maxTileX; tileX++) {
            jobs.push({
                drawX: (tileX * tileSize) - topLeftWorldX,
                drawY: (tileY * tileSize) - topLeftWorldY,
                srcX: mod(tileX, tileCount),
                srcY: tileY,
            });
        }
    }

    if (jobs.length === 0) {
        console.log("No tiles cover requested viewport");
        return;
    }

    var pending = jobs.length;
    var loaded = 0;

    function finalizeJob() {
        if (thisRenderToken !== renderState.renderToken) {
            return;
        }

        pending -= 1;
        if (pending > 0) {
            return;
        }

        if (loaded === 0) {
            console.log("Failed to load all map tiles");
            return;
        }

        // draw gpx track points, if any
        if (gpxState.points.length > 0) {
            canvasContext.beginPath();
            canvasContext.strokeStyle = config.gpxTrackColor || 'rgba(0, 0, 255, 0.8)';
            canvasContext.lineWidth = 3;
            gpxState.points.forEach(pt => {
                var tileX = long2tileFloat(pt.lon, zoom);
                var tileY = lat2tileFloat(pt.lat, zoom);
                var worldX = tileX * tileSize;
                var worldY = tileY * tileSize;
                var x = worldX - topLeftWorldX;
                var y = worldY - topLeftWorldY;

                canvasContext.lineTo(x, y);
            });
            canvasContext.stroke();
        }

        // draw gps dot
        if (config.showCurrentLocationDot) {
            var gpsDotX = (centerTileX * tileSize) - topLeftWorldX;
            var gpsDotY = (centerTileY * tileSize) - topLeftWorldY;
            canvasContext.beginPath();
            canvasContext.arc(gpsDotX, gpsDotY, 4, 0, 2 * Math.PI);
            canvasContext.fillStyle = 'rgba(255, 0, 0, 0.8)';
            canvasContext.fill();
        }

        var imageData = canvasContext.getImageData(0, 0, width, height);
        var packed = isColor ? packColor(imageData, width, height)
                             : packMonochrome(imageData, width, height, bytesPerRow);

        renderState.sendData = packed;
        renderState.sendIndex = 0;
        renderState.totalBytes = packed.length;
        sendNextChunk();
    }

    function loadAndDrawTile(job) {
        var img = new Image();
        img.crossOrigin = "Anonymous";
        img.onload = function() {
            if (thisRenderToken !== renderState.renderToken) {
                return;
            }
            canvasContext.drawImage(img, job.drawX, job.drawY, tileSize, tileSize);
            loaded += 1;
            finalizeJob();
        };

        img.onerror = function() {
            console.log("Failed to load tile z=" + zoom + " x=" + job.srcX + " y=" + job.srcY);
            finalizeJob();
        };

        img.src = getTileUrl(config.tileProvider, zoom, job.srcX, job.srcY);
    }

    for (var i = 0; i < jobs.length; i++) {
        loadAndDrawTile(jobs[i]);
    }
}

function getTileUrl(provider, zoom, x, y) {
    var template = tileUrls[provider];
    return template.replace("{z}", zoom)
                   .replace("{x}", x)
                   .replace("{y}", y)
                   .replace("{STADIAMAPS_API_KEY}", STADIAMAPS_API_KEY);
}

function getDistanceFromLatLonInMeters(lat1, lon1, lat2, lon2) {
    var R = 6371000; // Radius of the earth in meters
    var dLat = deg2rad(lat2 - lat1);
    var dLon = deg2rad(lon2 - lon1);
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    var distance = R * c; // Distance in meters
    return distance;
}

function deg2rad(deg) {
    return deg * (Math.PI / 180);
}

Pebble.addEventListener("appmessage", function(e) {
    console.log("AppMessage received: " + JSON.stringify(e));
    var payload = e.payload || {};
    if (payload.cmd === CMD_INIT) {
        renderState.width = payload.width;
        renderState.height = payload.height;
        renderState.bytesPerRow = payload.bytes_per_row;
        renderState.isColor = payload.is_color === 1;

        console.log("Rendering map for " + renderState.width + "x" + renderState.height +
                                " color=" + renderState.isColor);
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

Pebble.addEventListener("ready", function() {
    console.log("PKJS ready, waiting for watch request");
    // Update s_js_ready on watch

    var dict = {
        cmd: 1,
        JSReady: 1,
    };
    Pebble.sendAppMessage(dict, function() {
        console.log("Notified watch that JS is ready");
    }, function(err) {
        console.log("Failed to notify watch that JS is ready: " + JSON.stringify(err));
    });
});

// GeoLocation
if (navigator.geolocation) {
    setInterval(function() {
        navigator.geolocation.getCurrentPosition(function(position) {
            // update watch if changed significantly (more than 10m)
            var distance = getDistanceFromLatLonInMeters(gpsState.latitude, gpsState.longitude, position.coords.latitude, position.coords.longitude);
            if (distance < 10) {
                return;
            }
            gpsState.latitude = position.coords.latitude;
            gpsState.longitude = position.coords.longitude;
            gpsState.accuracy = position.coords.accuracy;
            gpsState.timestamp = position.timestamp;

            renderTileToWatch();

            console.log("GPS update: " + gpsState.latitude + ", " + gpsState.longitude +
                        " accuracy: " + gpsState.accuracy + " timestamp: " + gpsState.timestamp);
        }, function(err) {
            console.log("Error getting position: " + JSON.stringify(err));
        });
    }, config.updateIntervalMs);
} else {
    console.log("Geolocation is not supported by this browser.");
}

Pebble.addEventListener('showConfiguration', function(e) {
	Pebble.openURL(clay.generateUrl());
});

Pebble.addEventListener('webviewclosed', function (e) {
	console.log('webview closed');
	if (e && e.response) {
		var newSettings = clay.getSettings(e.response, false);
		config.showCurrentLocationDot = newSettings.showCurentLocationDot.value;
		config.tileProvider = newSettings.tileProvider.value;
		config.updateIntervalMs = newSettings.updateIntervalMs.value * 1;
		config.zoomLevel = newSettings.zoomLevel.value * 1;
        // gpx stuff
        config.gpxTrackColor = newSettings.gpxTrackColor.value;
		gpxState.points = [];
        if (newSettings.GPX_URL.value) {
            fetch(newSettings.GPX_URL.value)
                .then(response => response.text())
                .then(gpxText => {
                    gpxState.points = parseGpxTrackPoints(gpxText);
                })
                .catch(err => {
                    console.log("Failed to fetch GPX file: " + JSON.stringify(err));
                });
        } else if (newSettings.GPX_TEXT.value) {
            gpxState.points = parseGpxTrackPoints(newSettings.GPX_TEXT.value);
        }
		localStorage.settings = JSON.stringify(config);

        renderTileToWatch();
		resetTimers();
	}
});
