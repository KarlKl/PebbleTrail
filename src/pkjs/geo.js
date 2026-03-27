function deg2rad(deg) {
  return deg * (Math.PI / 180);
}

function long2tileFloat(lon, zoom) {
  return ((lon + 180) / 360) * Math.pow(2, zoom);
}

function lat2tileFloat(lat, zoom) {
  var latRad = deg2rad(lat);
  return (
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) *
    Math.pow(2, zoom)
  );
}

function mod(n, m) {
  return ((n % m) + m) % m;
}

function getDistanceFromLatLonInMeters(lat1, lon1, lat2, lon2) {
  var radiusInMeters = 6371000;
  var dLat = deg2rad(lat2 - lat1);
  var dLon = deg2rad(lon2 - lon1);
  var a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(lat1)) *
      Math.cos(deg2rad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return radiusInMeters * c;
}

// Returns the unique set of tile coords (x, y) covering a GPX route at the
// given zoom level, expanded by bufferTiles in every direction.
function getTilesAlongRoute(points, zoom, bufferTiles) {
  var tileSet = {};
  var tileCount = Math.pow(2, zoom);
  for (var i = 0; i < points.length; i++) {
    var tx = Math.floor(long2tileFloat(points[i].lon, zoom));
    var ty = Math.floor(lat2tileFloat(points[i].lat, zoom));
    for (var dx = -bufferTiles; dx <= bufferTiles; dx++) {
      for (var dy = -bufferTiles; dy <= bufferTiles; dy++) {
        var nx = mod(tx + dx, tileCount);
        var ny = ty + dy;
        if (ny >= 0 && ny < tileCount) {
          var k = nx + ":" + ny;
          if (!tileSet[k]) {
            tileSet[k] = { x: nx, y: ny };
          }
        }
      }
    }
  }
  return Object.keys(tileSet).map(function (k) { return tileSet[k]; });
}

module.exports = {
  deg2rad: deg2rad,
  long2tileFloat: long2tileFloat,
  lat2tileFloat: lat2tileFloat,
  mod: mod,
  getDistanceFromLatLonInMeters: getDistanceFromLatLonInMeters,
  getTilesAlongRoute: getTilesAlongRoute,
};
