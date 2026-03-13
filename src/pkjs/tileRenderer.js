function createTileRenderer(options) {
  var geo = options.geo;
  var imagePacking = options.imagePacking;
  var tileCache = options.tileCache;

  var canvasContext = null;
  var renderToken = 0;

  function initCanvas(width, height) {
    try {
      var canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      if (document.getElementById("canvasDebug")) {
        document.getElementById("canvasDebug").appendChild(canvas);
      }
      return canvas.getContext("2d");
    } catch (ex) {
      return null;
    }
  }

  function ensureCanvas(width, height) {
    if (!canvasContext) {
      canvasContext = initCanvas(width, height);
      return canvasContext;
    }

    if (
      canvasContext.canvas &&
      (canvasContext.canvas.width !== width ||
        canvasContext.canvas.height !== height)
    ) {
      canvasContext.canvas.width = width;
      canvasContext.canvas.height = height;
    }

    return canvasContext;
  }

  function getOutputFormat(width, isColor, enforceMonochrome) {
    var outputIsColor = isColor && !enforceMonochrome;
    return {
      outputIsColor: outputIsColor,
      outputBytesPerRow: outputIsColor ? width : (width + 7) >> 3,
    };
  }

  function buildTileJobs(zoom, width, height, latitude, longitude) {
    var tileSize = 256;
    var tileCount = Math.pow(2, zoom);
    var centerTileX = geo.long2tileFloat(longitude, zoom);
    var centerTileY = geo.lat2tileFloat(latitude, zoom);
    var centerWorldX = centerTileX * tileSize;
    var centerWorldY = centerTileY * tileSize;
    var topLeftWorldX = centerWorldX - width / 2;
    var topLeftWorldY = centerWorldY - height / 2;

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
          drawX: tileX * tileSize - topLeftWorldX,
          drawY: tileY * tileSize - topLeftWorldY,
          srcX: geo.mod(tileX, tileCount),
          srcY: tileY,
        });
      }
    }

    return {
      jobs: jobs,
      centerWorldX: centerWorldX,
      centerWorldY: centerWorldY,
      topLeftWorldX: topLeftWorldX,
      topLeftWorldY: topLeftWorldY,
    };
  }

  function drawGpxTrack(ctx, gpxPoints, zoom, topLeftWorldX, topLeftWorldY) {
    if (!gpxPoints || gpxPoints.length === 0) {
      return;
    }

    var firstPoint = gpxPoints[0];
    var firstTileX = geo.long2tileFloat(firstPoint.lon, zoom);
    var firstTileY = geo.lat2tileFloat(firstPoint.lat, zoom);
    ctx.beginPath();
    ctx.moveTo(firstTileX * 256 - topLeftWorldX, firstTileY * 256 - topLeftWorldY);

    for (var i = 1; i < gpxPoints.length; i++) {
      var point = gpxPoints[i];
      var tileX = geo.long2tileFloat(point.lon, zoom);
      var tileY = geo.lat2tileFloat(point.lat, zoom);
      ctx.lineTo(tileX * 256 - topLeftWorldX, tileY * 256 - topLeftWorldY);
    }
  }

  function drawOverlays(ctx, params) {
    var config = params.config;
    var zoom = params.zoom;
    var topLeftWorldX = params.topLeftWorldX;
    var topLeftWorldY = params.topLeftWorldY;
    var centerWorldX = params.centerWorldX;
    var centerWorldY = params.centerWorldY;

    if (config.gpxPoints && config.gpxPoints.length > 0) {
      drawGpxTrack(ctx, config.gpxPoints, zoom, topLeftWorldX, topLeftWorldY);
      ctx.strokeStyle = config.gpxTrackColor || "rgba(0, 0, 255, 0.8)";
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    if (config.showCurrentLocationDot) {
      var gpsDotX = centerWorldX - topLeftWorldX;
      var gpsDotY = centerWorldY - topLeftWorldY;
      ctx.beginPath();
      ctx.arc(gpsDotX, gpsDotY, 4, 0, 2 * Math.PI);
      ctx.fillStyle = "rgba(255, 0, 0, 0.8)";
      ctx.fill();
    }
  }

  function packCanvas(ctx, width, height, outputFormat) {
    var imageData = ctx.getImageData(0, 0, width, height);
    if (outputFormat.outputIsColor) {
      return imagePacking.packColor(imageData, width, height);
    }

    return imagePacking.packMonochrome(
      imageData,
      width,
      height,
      outputFormat.outputBytesPerRow
    );
  }

  function render(params) {
    if (typeof document === "undefined" || !document.createElement) {
      console.log("Canvas API unavailable in PKJS environment");
      return;
    }

    tileCache.cleanup(false);

    var renderState = params.renderState;
    var config = params.config;
    var gpsState = params.gpsState;
    var width = renderState.width;
    var height = renderState.height;
    var zoom = config.zoomLevel;
    var outputFormat = getOutputFormat(
      width,
      renderState.isColor,
      config.enforceMonochrome
    );

    var ctx = ensureCanvas(width, height);
    if (!ctx) {
      console.log("Canvas context unavailable");
      return;
    }

    renderToken += 1;
    var thisRenderToken = renderToken;

    if (ctx.clearRect) {
      ctx.clearRect(0, 0, width, height);
    }

    var viewport = buildTileJobs(
      zoom,
      width,
      height,
      gpsState.latitude,
      gpsState.longitude
    );

    if (viewport.jobs.length === 0) {
      console.log("No tiles cover requested viewport");
      return;
    }

    var pending = viewport.jobs.length;
    var loaded = 0;

    function finalizeOneTile() {
      if (thisRenderToken !== renderToken) {
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

      drawOverlays(ctx, {
        config: config,
        zoom: zoom,
        topLeftWorldX: viewport.topLeftWorldX,
        topLeftWorldY: viewport.topLeftWorldY,
        centerWorldX: viewport.centerWorldX,
        centerWorldY: viewport.centerWorldY,
      });

      params.onFrameReady({
        packed: packCanvas(ctx, width, height, outputFormat),
        outputIsColor: outputFormat.outputIsColor,
        outputBytesPerRow: outputFormat.outputBytesPerRow,
      });
    }

    function loadAndDraw(job) {
      tileCache.load(
        config.tileProvider,
        zoom,
        job.srcX,
        job.srcY,
        function (img) {
          if (thisRenderToken !== renderToken) {
            return;
          }
          ctx.drawImage(img, job.drawX, job.drawY, 256, 256);
          loaded += 1;
          finalizeOneTile();
        },
        function () {
          console.log(
            "Failed to load tile provider=" +
              config.tileProvider +
              " z=" +
              zoom +
              " x=" +
              job.srcX +
              " y=" +
              job.srcY
          );
          finalizeOneTile();
        }
      );
    }

    for (var i = 0; i < viewport.jobs.length; i++) {
      loadAndDraw(viewport.jobs[i]);
    }
  }

  return {
    render: render,
  };
}

module.exports = {
  createTileRenderer: createTileRenderer,
};
