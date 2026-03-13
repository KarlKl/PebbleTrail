function parseGpxTrackPoints(gpxString) {
  var parser = new DOMParser();
  var xmlDoc = parser.parseFromString(gpxString, "text/xml");
  var trkpts = xmlDoc.getElementsByTagName("trkpt");
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

module.exports = {
  parseGpxTrackPoints: parseGpxTrackPoints,
};
