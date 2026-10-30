/**
 * Utilidades de ruta: unir tramos, proyectar puntos y calcular distancias a lo largo del recorrido.
 */
(function (global) {
  const EARTH_R = 6371000;

  function toRad(d) {
    return (d * Math.PI) / 180;
  }

  function haversine(a, b) {
    const dLat = toRad(b[1] - a[1]);
    const dLon = toRad(b[0] - a[0]);
    const lat1 = toRad(a[1]);
    const lat2 = toRad(b[1]);
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 2 * EARTH_R * Math.asin(Math.sqrt(h));
  }

  /** [[lon,lat], ...] */
  function pathLength(coords) {
    let len = 0;
    for (let i = 1; i < coords.length; i++) {
      len += haversine(coords[i - 1], coords[i]);
    }
    return len;
  }

  function reversePath(coords) {
    return coords.slice().reverse();
  }

  /**
   * Une paths sueltos en una polyline continua conectando extremos cercanos.
   * Empieza cerca de startHint y antepone tramos que enganchen al inicio
   * (p. ej. el stub de salida en Alicia Alonso).
   * @param {Array<Array<[number,number]>>} paths
   * @param {[number,number]} [startHint]
   * @param {{ maxGap?: number }} [opts]
   * @returns {Array<[number,number]>}
   */
  function stitchPaths(paths, startHint, opts) {
    if (!paths.length) return [];
    const maxGap = (opts && opts.maxGap) || 120;
    const remaining = paths
      .map((p) => p.filter((c) => c && c.length >= 2))
      .filter((p) => p.length >= 2)
      .map((p) => p.slice());

    // Empezar por el tramo cuyo extremo esté más cerca del landmark de inicio
    let startIdx = 0;
    if (startHint) {
      let best = Infinity;
      remaining.forEach((path, i) => {
        const d = Math.min(
          haversine(startHint, path[0]),
          haversine(startHint, path[path.length - 1])
        );
        if (d < best) {
          best = d;
          startIdx = i;
        }
      });
    }
    let current = remaining.splice(startIdx, 1)[0];
    if (
      startHint &&
      haversine(startHint, current[current.length - 1]) <
        haversine(startHint, current[0])
    ) {
      current = reversePath(current);
    }
    const joined = current.slice();

    function nearestEnd(tip) {
      let bestIdx = -1;
      let bestDist = Infinity;
      let reverse = false;
      remaining.forEach((path, i) => {
        const dStart = haversine(tip, path[0]);
        const dEnd = haversine(tip, path[path.length - 1]);
        if (dStart < bestDist) {
          bestDist = dStart;
          bestIdx = i;
          reverse = false;
        }
        if (dEnd < bestDist) {
          bestDist = dEnd;
          bestIdx = i;
          reverse = true;
        }
      });
      return { bestIdx, bestDist, reverse };
    }

    // Extender hacia delante
    while (remaining.length) {
      const { bestIdx, bestDist, reverse } = nearestEnd(
        joined[joined.length - 1]
      );
      if (bestIdx < 0 || bestDist > maxGap) break;
      let next = remaining.splice(bestIdx, 1)[0];
      if (reverse) next = reversePath(next);
      if (haversine(joined[joined.length - 1], next[0]) < 1) {
        joined.push(...next.slice(1));
      } else {
        joined.push(...next);
      }
    }

    // Anteponer tramos sueltos que enganchen al inicio (salida)
    while (remaining.length) {
      const tip = joined[0];
      let bestIdx = -1;
      let bestDist = Infinity;
      let reverse = false;
      remaining.forEach((path, i) => {
        const dStart = haversine(tip, path[0]);
        const dEnd = haversine(tip, path[path.length - 1]);
        // Queremos que el extremo del candidato toque el inicio actual
        if (dEnd < bestDist) {
          bestDist = dEnd;
          bestIdx = i;
          reverse = false; // path termina en tip → se antepone tal cual
        }
        if (dStart < bestDist) {
          bestDist = dStart;
          bestIdx = i;
          reverse = true; // path empieza en tip → invertir y anteponer
        }
      });
      if (bestIdx < 0 || bestDist > maxGap) break;
      let prev = remaining.splice(bestIdx, 1)[0];
      if (reverse) prev = reversePath(prev);
      if (haversine(prev[prev.length - 1], joined[0]) < 1) {
        joined.unshift(...prev.slice(0, -1));
      } else {
        joined.unshift(...prev);
      }
    }

    return joined;
  }

  /**
   * Ordena/orienta la ruta para que empiece cerca de startHint [lon,lat].
   */
  function orientRoute(coords, startHint) {
    if (!coords.length || !startHint) return coords;
    const dStart = haversine(coords[0], startHint);
    const dEnd = haversine(coords[coords.length - 1], startHint);
    return dEnd < dStart ? reversePath(coords) : coords;
  }

  /**
   * Proyecta un punto sobre la polyline.
   * @returns {{ index:number, coord:[number,number], distanceAlong:number, distanceToRoute:number, fraction:number }}
   */
  function projectOnRoute(point, coords) {
    let best = {
      index: 0,
      coord: coords[0],
      distanceAlong: 0,
      distanceToRoute: Infinity,
      fraction: 0
    };
    let along = 0;

    for (let i = 0; i < coords.length - 1; i++) {
      const a = coords[i];
      const b = coords[i + 1];
      const segLen = haversine(a, b) || 1e-9;
      const projected = projectOnSegment(point, a, b);
      const d = haversine(point, projected.coord);
      if (d < best.distanceToRoute) {
        best = {
          index: i,
          coord: projected.coord,
          distanceAlong: along + projected.t * segLen,
          distanceToRoute: d,
          fraction: projected.t
        };
      }
      along += segLen;
    }
    return best;
  }

  function projectOnSegment(p, a, b) {
    // Aprox. local en metros
    const ax = a[0];
    const ay = a[1];
    const midLat = toRad((a[1] + b[1]) / 2);
    const mx = Math.cos(midLat) * 111320;
    const my = 110540;
    const px = (p[0] - ax) * mx;
    const py = (p[1] - ay) * my;
    const bx = (b[0] - ax) * mx;
    const by = (b[1] - ay) * my;
    const denom = bx * bx + by * by || 1e-9;
    let t = (px * bx + py * by) / denom;
    t = Math.max(0, Math.min(1, t));
    return {
      t,
      coord: [ax + (b[0] - ax) * t, ay + (b[1] - ay) * t]
    };
  }

  function distanceBetweenAlong(fromAlong, toAlong) {
    return toAlong - fromAlong;
  }

  function totalLength(coords) {
    return pathLength(coords);
  }

  /** Sub-ruta desde distancia 0 hasta alongMeters */
  function sliceAlong(coords, alongMeters) {
    if (!coords.length) return [];
    if (alongMeters <= 0) return [coords[0]];
    const out = [coords[0]];
    let acc = 0;
    for (let i = 1; i < coords.length; i++) {
      const seg = haversine(coords[i - 1], coords[i]);
      if (acc + seg >= alongMeters) {
        const t = (alongMeters - acc) / (seg || 1e-9);
        out.push([
          coords[i - 1][0] + (coords[i][0] - coords[i - 1][0]) * t,
          coords[i - 1][1] + (coords[i][1] - coords[i - 1][1]) * t
        ]);
        return out;
      }
      out.push(coords[i]);
      acc += seg;
    }
    return out;
  }

  function remainingFrom(coords, alongMeters) {
    if (!coords.length) return [];
    const total = pathLength(coords);
    if (alongMeters >= total) return [coords[coords.length - 1]];
    const out = [];
    let acc = 0;
    let started = false;
    for (let i = 1; i < coords.length; i++) {
      const a = coords[i - 1];
      const b = coords[i];
      const seg = haversine(a, b);
      if (!started && acc + seg >= alongMeters) {
        const t = (alongMeters - acc) / (seg || 1e-9);
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
        out.push(b);
        started = true;
      } else if (started) {
        out.push(b);
      }
      acc += seg;
    }
    return out.length ? out : [coords[coords.length - 1]];
  }

  global.CabalgataGeometry = {
    haversine,
    stitchPaths,
    orientRoute,
    projectOnRoute,
    distanceBetweenAlong,
    totalLength,
    sliceAlong,
    remainingFrom
  };
})(window);
