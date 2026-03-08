var TILE_URL = "https://tiles.stadiamaps.com/tiles/stamen_terrain/{z}/{x}/{y}.jpg";
var TILE_Z = 6;
var TILE_X = 17;
var TILE_Y = 25;
var CHUNK_SIZE = 200;

var renderState = {
    width: 0,
    height: 0,
    bytesPerRow: 0,
    isColor: false,
    sendData: null,
    sendIndex: 0,
    totalBytes: 0,
};

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
            var bit = luminance > 128 ? 1 : 0;
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
        chunk_data: chunk,
    };

    Pebble.sendAppMessage(dict, function() {
        renderState.sendIndex += 1;
        sendNextChunk();
    }, function(err) {
        console.log("Chunk send failed, retrying: " + JSON.stringify(err));
        setTimeout(sendNextChunk, 300);
    });
}

function renderTileToWatch(width, height, bytesPerRow, isColor) {
    if (typeof document === "undefined" || !document.createElement) {
        console.log("Canvas API unavailable in PKJS environment");
        return;
    }

    var canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    var ctx = canvas.getContext("2d");

    var img = new Image();
    img.crossOrigin = "Anonymous";
    img.onload = function() {
        ctx.drawImage(img, 0, 0, width, height);
        var imageData = ctx.getImageData(0, 0, width, height);
        var packed = isColor ? packColor(imageData, width, height)
                                                 : packMonochrome(imageData, width, height, bytesPerRow);

        renderState.sendData = packed;
        renderState.sendIndex = 0;
        renderState.totalBytes = packed.length;
        sendNextChunk();
    };

    img.onerror = function() {
        console.log("Failed to load tile image");
    };

    var url = TILE_URL.replace("{z}", TILE_Z)
                                        .replace("{x}", TILE_X)
                                        .replace("{y}", TILE_Y);
    img.src = url;
}

Pebble.addEventListener("appmessage", function(e) {
    var payload = e.payload || {};
    if (payload.cmd === 1) {
        renderState.width = payload.width;
        renderState.height = payload.height;
        renderState.bytesPerRow = payload.bytes_per_row;
        renderState.isColor = payload.is_color === 1;

        console.log("Rendering map for " + renderState.width + "x" + renderState.height +
                                " color=" + renderState.isColor);
        renderTileToWatch(renderState.width, renderState.height,
                                            renderState.bytesPerRow, renderState.isColor);
    }
});

Pebble.addEventListener("ready", function() {
    console.log("PKJS ready, waiting for watch request");
});
