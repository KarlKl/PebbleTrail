/**
 * Parses a GPX string and extracts all track points (<trkpt>).
 * @param {string} gpxString - The GPX file content as a string.
 * @returns {Array<Object>} - Array of track points with lat, lon, ele, and time.
 */
function parseGpxTrackPoints(gpxString) {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(gpxString, 'text/xml');
  const trkpts = xmlDoc.getElementsByTagName('trkpt');

  return Array.from(trkpts).map(trkpt => {
    var eleElem = trkpt.getElementsByTagName('ele')[0];
    var timeElem = trkpt.getElementsByTagName('time')[0];
    return {
      lat: parseFloat(trkpt.getAttribute('lat')),
      lon: parseFloat(trkpt.getAttribute('lon')),
      ele: eleElem ? parseFloat(eleElem.textContent) : null,
      time: timeElem ? timeElem.textContent : null
    };
  });
}
