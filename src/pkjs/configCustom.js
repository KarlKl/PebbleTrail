/*
 * Clay custom function - runs INSIDE the configuration webview, not in pkjs.
 * Clay stringifies this function, so it must be fully self-contained:
 * no require(), no references to outer variables, ES5 only.
 *
 * Adds a "Upload GPX file" button. The selected file is parsed in the
 * webview, reduced (lat/lon only, Douglas-Peucker simplified, polyline
 * encoded) and stored in the hidden "gpxFile" input so the payload that
 * travels back via the close URL stays small.
 * Pasted GPX text is converted the same way.
 */
module.exports = function (minified) {
  var clayConfig = this;

  var MAX_POINTS = 1500;
  var MAX_FILE_BYTES = 20 * 1024 * 1024;
  var CLEAR = "__clear__";

  function parsePoints(text) {
    var doc = new DOMParser().parseFromString(text, "text/xml");
    if (doc.getElementsByTagName("parsererror").length > 0) {
      return [];
    }
    var nodes = doc.getElementsByTagName("trkpt");
    if (nodes.length === 0) {
      nodes = doc.getElementsByTagName("rtept");
    }
    var pts = [];
    for (var i = 0; i < nodes.length; i++) {
      var lat = parseFloat(nodes[i].getAttribute("lat"));
      var lon = parseFloat(nodes[i].getAttribute("lon"));
      if (!isNaN(lat) && !isNaN(lon)) {
        pts.push([lat, lon]);
      }
    }
    return pts;
  }

  // squared distance from p to segment a-b (planar coordinates)
  function segDist2(p, a, b) {
    var dx = b[0] - a[0];
    var dy = b[1] - a[1];
    var t = 0;
    if (dx !== 0 || dy !== 0) {
      t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy);
      t = Math.max(0, Math.min(1, t));
    }
    var x = a[0] + t * dx - p[0];
    var y = a[1] + t * dy - p[1];
    return x * x + y * y;
  }

  // iterative Douglas-Peucker, tolerance in meters
  function simplify(pts, tolMeters) {
    var n = pts.length;
    if (n < 3) {
      return pts.slice();
    }
    var kx = 111320 * Math.cos((pts[0][0] * Math.PI) / 180);
    var ky = 110540;
    var xy = [];
    var keep = [];
    for (var i = 0; i < n; i++) {
      xy.push([pts[i][1] * kx, pts[i][0] * ky]);
      keep.push(false);
    }
    keep[0] = true;
    keep[n - 1] = true;
    var tol2 = tolMeters * tolMeters;
    var stack = [[0, n - 1]];
    while (stack.length > 0) {
      var seg = stack.pop();
      var a = seg[0];
      var b = seg[1];
      var maxD = 0;
      var idx = -1;
      for (var j = a + 1; j < b; j++) {
        var d = segDist2(xy[j], xy[a], xy[b]);
        if (d > maxD) {
          maxD = d;
          idx = j;
        }
      }
      if (idx !== -1 && maxD > tol2) {
        keep[idx] = true;
        stack.push([a, idx]);
        stack.push([idx, b]);
      }
    }
    var out = [];
    for (var k = 0; k < n; k++) {
      if (keep[k]) {
        out.push(pts[k]);
      }
    }
    return out;
  }

  function reduce(pts) {
    var tol = 2;
    var out = simplify(pts, tol);
    while (out.length > MAX_POINTS) {
      tol *= 2;
      out = simplify(pts, tol);
    }
    return out;
  }

  function encodeValue(v) {
    v = v < 0 ? ~(v << 1) : v << 1;
    var s = "";
    while (v >= 0x20) {
      s += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>= 5;
    }
    return s + String.fromCharCode(v + 63);
  }

  function encodePolyline(pts) {
    var s = "";
    var prevLat = 0;
    var prevLon = 0;
    for (var i = 0; i < pts.length; i++) {
      var lat = Math.round(pts[i][0] * 1e5);
      var lon = Math.round(pts[i][1] * 1e5);
      s += encodeValue(lat - prevLat) + encodeValue(lon - prevLon);
      prevLat = lat;
      prevLon = lon;
    }
    return s;
  }

  function buildPayload(name, text) {
    var pts = parsePoints(text);
    if (pts.length === 0) {
      return null;
    }
    var reduced = reduce(pts);
    return {
      payload: JSON.stringify({ n: name, c: reduced.length, p: encodePolyline(reduced) }),
      original: pts.length,
      reduced: reduced.length,
    };
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  clayConfig.on(clayConfig.EVENTS.AFTER_BUILD, function () {
    var fileItem = clayConfig.getItemByMessageKey("gpxFile");
    var urlItem = clayConfig.getItemByMessageKey("gpxUrl");
    var textItem = clayConfig.getItemByMessageKey("gpxText");
    if (!fileItem) {
      return;
    }
    fileItem.hide();
    fileItem.set("");

    var anchor = fileItem.$element[0];

    var wrap = document.createElement("div");
    wrap.className = "component component-button";
    wrap.innerHTML =
      '<button type="button" class="pt-gpx-upload">Upload GPX File</button>' +
      '<div class="description pt-gpx-status">Choose a .gpx file from your phone. ' +
      "It replaces the URL and text above.</div>";

    var removeWrap = document.createElement("div");
    removeWrap.className = "component component-button";
    removeWrap.innerHTML = '<button type="button" class="pt-gpx-remove">Remove GPX Track</button>';

    var fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = ".gpx,application/gpx+xml,application/xml,text/xml";
    fileInput.style.display = "none";

    anchor.parentNode.insertBefore(wrap, anchor);
    anchor.parentNode.insertBefore(removeWrap, anchor);
    anchor.parentNode.insertBefore(fileInput, anchor);

    var status = wrap.querySelector(".pt-gpx-status");
    function setStatus(html) {
      status.innerHTML = html;
    }

    function applyPayload(result, sourceLabel) {
      fileItem.set(result.payload);
      if (urlItem) {
        urlItem.set("");
      }
      if (textItem) {
        textItem.set("");
      }
      var info = result.reduced + " points";
      if (result.reduced < result.original) {
        info += " (simplified from " + result.original + ")";
      }
      setStatus("&#10003; " + sourceLabel + ": " + info + ". Press <b>Save Settings</b> to apply.");
    }

    wrap.querySelector(".pt-gpx-upload").addEventListener("click", function () {
      fileInput.value = "";
      fileInput.click();
    });

    removeWrap.querySelector(".pt-gpx-remove").addEventListener("click", function () {
      fileItem.set(CLEAR);
      if (urlItem) {
        urlItem.set("");
      }
      if (textItem) {
        textItem.set("");
      }
      setStatus("Track will be removed when you press <b>Save Settings</b>.");
    });

    fileInput.addEventListener("change", function () {
      var file = fileInput.files && fileInput.files[0];
      if (!file) {
        return;
      }
      if (file.size > MAX_FILE_BYTES) {
        setStatus("&#9888; File is too large (max 20 MB).");
        return;
      }
      setStatus("Reading " + escapeHtml(file.name) + "&hellip;");
      var reader = new FileReader();
      reader.onload = function () {
        var result = null;
        try {
          result = buildPayload(file.name, reader.result);
        } catch (e) {
          result = null;
        }
        if (!result) {
          setStatus("&#9888; No track points found in " + escapeHtml(file.name) + ".");
          return;
        }
        applyPayload(result, escapeHtml(file.name));
      };
      reader.onerror = function () {
        setStatus("&#9888; Could not read " + escapeHtml(file.name) + ".");
      };
      reader.readAsText(file);
    });

    // Convert pasted GPX text the same way, so it doesn't bloat the settings.
    if (textItem) {
      textItem.on("change", function () {
        var value = (textItem.get() || "").trim();
        if (value === "" || value.charAt(0) !== "<") {
          return;
        }
        var result = null;
        try {
          result = buildPayload("pasted.gpx", value);
        } catch (e) {
          result = null;
        }
        if (!result) {
          setStatus("&#9888; No track points found in pasted text.");
          return;
        }
        applyPayload(result, "Pasted GPX");
      });
    }
  });
};
