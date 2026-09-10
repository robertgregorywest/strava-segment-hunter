export type LatLng = [number, number];

/**
 * Decodes a Google/Strava encoded polyline (precision 5) into an ordered
 * sequence of [lat, lng] points.
 */
export function decodePolyline(encoded: string, precision = 5): LatLng[] {
  const factor = 10 ** precision;
  let index = 0;
  let lat = 0;
  let lng = 0;
  const coordinates: LatLng[] = [];

  while (index < encoded.length) {
    const [deltaLat, nextIndexAfterLat] = decodeSignedValue(encoded, index);
    index = nextIndexAfterLat;
    const [deltaLng, nextIndexAfterLng] = decodeSignedValue(encoded, index);
    index = nextIndexAfterLng;

    lat += deltaLat;
    lng += deltaLng;
    coordinates.push([lat / factor, lng / factor]);
  }

  return coordinates;
}

/** Decodes one variable-length signed value starting at `start`; returns [value, nextIndex]. */
function decodeSignedValue(encoded: string, start: number): [number, number] {
  let shift = 0;
  let result = 0;
  let index = start;
  let byte: number;

  do {
    byte = encoded.charCodeAt(index) - 63;
    index += 1;
    result |= (byte & 0x1f) << shift;
    shift += 5;
  } while (byte >= 0x20);

  const value = result & 1 ? ~(result >> 1) : result >> 1;
  return [value, index];
}
