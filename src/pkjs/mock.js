const { mod } = require("./geo");
const imagePacking = require("./imagePacking");

// Test frame generation for emulator testing without Canvas API
function generateTestFrame(patternType, width, height, isColor) {
  // Create a canvas-like image data object
  const pixelCount = width * height;
  const imageData = {
    data: new Uint8ClampedArray(pixelCount * 4), // RGBA
  };

  // Fill with pattern
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      let r, g, b, a;

      switch (patternType) {
        case "white":
          r = g = b = 255;
          a = 255;
          break;
        case "black":
          r = g = b = 0;
          a = 255;
          break;
        case "vbars":
          // Vertical color bars
          const barWidth = width / 8;
          const barIdx = Math.floor(x / barWidth);
          const colors = [
            [255, 0, 0], // red
            [0, 255, 0], // green
            [0, 0, 255], // blue
            [255, 255, 0], // yellow
            [255, 0, 255], // magenta
            [0, 255, 255], // cyan
            [255, 128, 0], // orange
            [128, 0, 255], // purple
          ];
          [r, g, b] = colors[barIdx % colors.length];
          a = 255;
          break;
        case "hbars":
          // Horizontal stripes every 8 pixels
          const stripeIdx = Math.floor(y / 8);
          r = g = b = stripeIdx % 2 ? 255 : 0;
          a = 255;
          break;
        case "border":
          // White border around edge, black inside
          const borderWidth = 4;
          const isBorder =
            x < borderWidth ||
            x >= width - borderWidth ||
            y < borderWidth ||
            y >= height - borderWidth;
          r = g = b = isBorder ? 255 : 0;
          a = 255;
          break;
        case "checkerboard":
          // Checkerboard pattern
          const checker = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 0;
          r = g = b = checker ? 255 : 0;
          a = 255;
          break;
        case "crosshair":
          // Center crosshair
          const centerX = width / 2;
          const centerY = height / 2;
          const dx = Math.abs(x - centerX);
          const dy = Math.abs(y - centerY);
          const isCross = dx < 2 || dy < 2;
          r = g = b = isCross ? 255 : 0;
          a = 255;
          break;
        default:
          r = g = b = 128;
          a = 255;
      }

      imageData.data[idx] = r;
      imageData.data[idx + 1] = g;
      imageData.data[idx + 2] = b;
      imageData.data[idx + 3] = a;
    }
  }

  // Pack using the same logic as real rendering
  const outputFormat = {
    outputIsColor: isColor,
    outputBytesPerRow: isColor ? width : (width + 7) >> 3,
  };

  let packed;
  let compressionFormat = 0;
  if (isColor) {
    packed = imagePacking.packColorRle2Bit(imageData, width, height);
    compressionFormat = 1;
  } else {
    const monoRaw = imagePacking.packMonochrome(
      imageData,
      width,
      height,
      outputFormat.outputBytesPerRow
    );
    const monoRle = imagePacking.packMonochromeBitRle2(imageData, width, height);
    if (monoRle.length < monoRaw.length) {
      packed = monoRle;
      compressionFormat = 2;
    } else {
      packed = monoRaw;
      compressionFormat = 0;
    }
  }

  return {
    packed: packed,
    compressionFormat: compressionFormat,
    outputIsColor: outputFormat.outputIsColor,
    outputBytesPerRow: outputFormat.outputBytesPerRow,
  };
}

// Send a test frame with pattern name and optional dimensions
function sendTestFrame(
  chunkTransferFunction,
  patternType = "white",
  width = null,
  height = null,
  isColor = null
) {
  // Use current render state dimensions if not specified
  width = width || 144;
  height = height || 168;
  isColor = isColor !== null ? isColor : false;

  console.log(
    "Generating test frame: pattern=" +
      patternType +
      ", " +
      width +
      "x" +
      height +
      ", " +
      (isColor ? "color" : "mono")
  );

  console.log("test1");
  const frame = generateTestFrame(patternType, width, height, isColor);
  console.log("test2");
  chunkTransferFunction(frame);
}

module.exports = {
  sendTestFrame: sendTestFrame,
};
