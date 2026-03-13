const LUMINANCE_THRESHOLD = 190; // higher = more likely to be black, lower = more likely to be white

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
  return 0xc0 | (r2 << 4) | (g2 << 2) | b2;
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
      var luminance = r * 0.2126 + g * 0.7152 + b * 0.0722;
      var bit = luminance > LUMINANCE_THRESHOLD ? 1 : 0;
      if (bit) {
        var byteIndex = y * bytesPerRow + (x >> 3);
        var bitIndex = 7 - (x & 7);
        packed[byteIndex] |= 1 << bitIndex;
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

module.exports = {
  packMonochrome: packMonochrome,
  packColor: packColor,
};
