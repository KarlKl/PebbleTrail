function parseGpxTrackPoints(gpxString) {
  var parser = new DOMParser();
  var xmlDoc = parser.parseFromString(gpxString, "text/xml");
  var trkpts = xmlDoc.getElementsByTagName("trkpt");
  if (trkpts.length === 0) {
    // many route planners export <rte>/<rtept> instead of tracks
    trkpts = xmlDoc.getElementsByTagName("rtept");
  }
  var points = [];

  for (var i = 0; i < trkpts.length; i++) {
    var trkpt = trkpts[i];
    var lat = parseFloat(trkpt.getAttribute("lat"));
    var lon = parseFloat(trkpt.getAttribute("lon"));
    if (isNaN(lat) || isNaN(lon)) {
      continue;
    }

    var eleElem = trkpt.getElementsByTagName("ele")[0];
    var timeElem = trkpt.getElementsByTagName("time")[0];
    var ele = null;
    if (eleElem) {
      var parsedEle = parseFloat(eleElem.textContent);
      ele = isNaN(parsedEle) ? null : parsedEle;
    }

    points.push({
      lat: lat,
      lon: lon,
      ele: ele,
      time: timeElem ? timeElem.textContent : null,
    });
  }

  return points;
}

// Decodes a Google encoded polyline (precision 5) into [{lat, lon}, ...]
function decodePolyline(str) {
  var points = [];
  var index = 0;
  var lat = 0;
  var lon = 0;

  while (index < str.length) {
    var result = 0;
    var shift = 0;
    var b;
    do {
      b = str.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20 && index < str.length);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    result = 0;
    shift = 0;
    do {
      b = str.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20 && index < str.length);
    lon += result & 1 ? ~(result >> 1) : result >> 1;

    points.push({ lat: lat / 1e5, lon: lon / 1e5, ele: null, time: null });
  }

  return points;
}

// Parses the compact payload produced by the config page upload
// ({"n": name, "c": count, "p": encodedPolyline}).
function parseCompactTrack(payload) {
  var data = JSON.parse(payload);
  if (!data || typeof data.p !== "string") {
    throw new Error("Invalid compact GPX payload");
  }
  return {
    name: data.n || "",
    points: decodePolyline(data.p),
  };
}

module.exports = {
  parseGpxTrackPoints: parseGpxTrackPoints,
  decodePolyline: decodePolyline,
  parseCompactTrack: parseCompactTrack,
};
