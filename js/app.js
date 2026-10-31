require([
  "esri/Map",
  "esri/views/MapView",
  "esri/Graphic",
  "esri/layers/GraphicsLayer",
  "esri/geometry/Polyline",
  "esri/geometry/Point",
  "esri/geometry/support/webMercatorUtils",
  "esri/rest/locator",
  "esri/request"
], function (
  Map,
  MapView,
  Graphic,
  GraphicsLayer,
  Polyline,
  Point,
  webMercatorUtils,
  locator,
  esriRequest
) {
  const CFG = window.CABALGATA_CONFIG;
  const Geo = window.CabalgataGeometry;

  const els = {
    status: document.getElementById("statusChip"),
    street: document.getElementById("streetValue"),
    etaChip: document.getElementById("etaChip"),
    etaValue: document.getElementById("etaValue"),
    btnLocate: document.getElementById("btnLocate"),
    btnFollow: document.getElementById("btnFollow"),
    btnSim: document.getElementById("btnSim")
  };

  const state = {
    routeCoords: [],
    routeLength: 0,
    cabecera: null,
    cabeceraAlong: null,
    streetCache: { text: null, at: 0, lon: null, lat: null },
    userPoint: null,
    userGraphic: null,
    followCabecera: true,
    locateWatchId: null,
    speedKmh: CFG.timing.defaultSpeedKmh,
    cabeceraMarker: null,
    cabeceraWatchHandles: [],
    iconSvgHtml: null,
    simulating: false,
    simAlong: 0,
    simTimer: null,
    displayAlong: null,
    lastFixAlong: null,
    lastFixAt: 0,
    coastEnabled: false,
    smoothTimer: null,
    smoothLastTick: 0,
    lastFollowAt: 0,
    lastRoutePaintAlong: null,
    lastStreetTickAt: 0,
    cabeceraHalo: null
  };

  const routeLayer = new GraphicsLayer({ title: "Recorrido", listMode: "hide" });
  const markersLayer = new GraphicsLayer({ title: "Hitos", listMode: "hide" });
  const liveLayer = new GraphicsLayer({ title: "En vivo", listMode: "hide" });

  const map = new Map({
    basemap: CFG.map.basemap,
    layers: [routeLayer, markersLayer, liveLayer]
  });

  const view = new MapView({
    container: "viewDiv",
    map,
    center: CFG.map.center,
    zoom: CFG.map.zoom,
    constraints: { snapToZoom: false },
    ui: { components: ["zoom"] }
  });

  view.when(async () => {
    mountBrandIcon().catch((err) => console.warn("brand icon", err));
    try {
      await loadRoute();
      placeLandmarks();
    } catch (err) {
      console.error("loadRoute", err);
      setStatus("offline", "No se pudo cargar la ruta");
      els.street.textContent = "Error de carga de ruta";
      return;
    }
    try {
      await refreshLive();
    } catch (err) {
      console.error("refreshLive", err);
      setStatus("offline", "Posición no disponible");
      els.street.textContent = "Sin señal de la cabecera";
    }
    setInterval(() => {
      refreshLive().catch((err) => console.error("refreshLive", err));
    }, CFG.timing.refreshMs);
  });

  els.btnLocate.addEventListener("click", toggleLocate);
  els.btnFollow.addEventListener("click", () => {
    state.followCabecera = !state.followCabecera;
    els.btnFollow.classList.toggle("is-active", state.followCabecera);
    els.btnFollow.setAttribute("aria-pressed", String(state.followCabecera));
    if (state.followCabecera && state.cabecera) {
      view.goTo({ center: state.cabecera, scale: 5000 }).catch(() => {});
    }
  });
  if (els.btnSim) {
    els.btnSim.addEventListener("click", toggleSimulation);
  }

  /** esrignss_speed de Esri viene en m/s → km/h */
  function gnssSpeedToKmh(raw) {
    if (typeof raw !== "number" || raw < 0 || !Number.isFinite(raw)) return null;
    return raw * 3.6;
  }

  function etaSpeedKmh() {
    const measured = state.speedKmh;
    const def = CFG.timing.defaultSpeedKmh;
    const maxEta = CFG.timing.maxEtaSpeedKmh || 6;
    if (!measured || measured < CFG.timing.minSpeedKmh) return def;
    return Math.min(Math.max(measured, def * 0.6), maxEta);
  }

  function pointAlongRoute(alongMeters) {
    const coords = Geo.sliceAlong(state.routeCoords, alongMeters);
    const c = coords[coords.length - 1] || state.routeCoords[0];
    return new Point({ longitude: c[0], latitude: c[1] });
  }

  function toggleSimulation() {
    if (state.simulating) {
      stopSimulation();
      return;
    }
    if (!state.routeCoords.length) return;
    stopSmoothMotion();
    state.simulating = true;
    state.simAlong = 0;
    state.speedKmh = CFG.timing.simulationSpeedKmh || CFG.timing.defaultSpeedKmh;
    els.btnSim.classList.add("is-active");
    els.btnSim.textContent = "Parar simulacro";
    setStatus("live", "Simulacro");
    // Ciudadano de prueba a ~60% del recorrido si no hay GPS
    if (!state.userPoint) {
      const mid = state.routeLength * 0.6;
      state.userPoint = pointAlongRoute(mid);
      drawUser(state.userPoint, true);
      els.etaChip.classList.remove("is-hidden");
    }
    const stepMs = 500;
    const metersPerMs =
      ((CFG.timing.simulationSpeedKmh || 4) * 1000) / 3600000;
    state.simTimer = setInterval(() => {
      state.simAlong = Math.min(
        state.routeLength,
        state.simAlong + metersPerMs * stepMs
      );
      applyCabeceraAlong(state.simAlong, true);
      if (state.simAlong >= state.routeLength - 1) {
        setStatus("ended", "Ha finalizado");
        els.street.textContent = "Meta · " + CFG.landmarks.finish.detail;
        stopSimulation(false);
      }
    }, stepMs);
    applyCabeceraAlong(0, true);
  }

  function stopSimulation(resetLabel) {
    state.simulating = false;
    if (state.simTimer) {
      clearInterval(state.simTimer);
      state.simTimer = null;
    }
    if (els.btnSim && resetLabel !== false) {
      els.btnSim.classList.remove("is-active");
      els.btnSim.textContent = "Simulacro";
    } else if (els.btnSim) {
      els.btnSim.classList.remove("is-active");
      els.btnSim.textContent = "Simulacro";
    }
  }

  function stopSmoothMotion() {
    if (state.smoothTimer) {
      clearInterval(state.smoothTimer);
      state.smoothTimer = null;
    }
    state.smoothLastTick = 0;
    state.coastEnabled = false;
  }

  function clearCabeceraMotion() {
    state.cabecera = null;
    state.cabeceraAlong = null;
    state.displayAlong = null;
    state.lastFixAlong = null;
    state.lastRoutePaintAlong = null;
    if (state.cabeceraHalo) {
      liveLayer.remove(state.cabeceraHalo);
      state.cabeceraHalo = null;
    }
    hideCabeceraMarker();
  }

  function startSmoothMotion() {
    if (state.smoothTimer || state.simulating) return;
    state.smoothLastTick = Date.now();
    const stepMs = CFG.timing.smoothMs || 100;
    state.smoothTimer = setInterval(() => {
      tickSmoothMotion().catch((err) => console.warn("smooth", err));
    }, stepMs);
  }

  function softTargetAlong(now) {
    if (state.lastFixAlong == null) return null;
    const lead = CFG.timing.coastLeadMeters || 18;
    if (!state.coastEnabled) {
      return Math.min(state.routeLength, state.lastFixAlong);
    }
    const speedMps = (etaSpeedKmh() * 1000) / 3600;
    const ageSec = Math.max(0, (now - state.lastFixAt) / 1000);
    const predicted = state.lastFixAlong + speedMps * ageSec;
    return Math.min(
      state.routeLength,
      Math.max(state.lastFixAlong, Math.min(predicted, state.lastFixAlong + lead))
    );
  }

  async function tickSmoothMotion() {
    if (state.simulating || state.lastFixAlong == null || !state.routeCoords.length) {
      return;
    }
    const now = Date.now();
    const dtSec = Math.min(
      0.5,
      Math.max(0.02, (now - (state.smoothLastTick || now)) / 1000)
    );
    state.smoothLastTick = now;

    const target = softTargetAlong(now);
    if (target == null) return;

    let along =
      state.displayAlong == null ? state.lastFixAlong : state.displayAlong;
    const gap = target - along;
    if (gap > 0.15) {
      const catchUpSec = CFG.timing.catchUpSeconds || 2.5;
      const paradeMps = (etaSpeedKmh() * 1000) / 3600;
      const catchMps = Math.max(paradeMps, gap / catchUpSec);
      along = Math.min(target, along + catchMps * dtSec);
    } else if (gap < -25) {
      // Corrección GPS grande hacia atrás
      along = along + gap * Math.min(1, dtSec / 1.2);
    } else if (gap < -0.15) {
      along = target;
    } else {
      along = target;
    }

    await paintCabeceraAlong(along, {
      paintRoute: true,
      follow: true,
      updateStreet: now - state.lastStreetTickAt > 12000
    });
    updateEta();
  }

  async function paintCabeceraAlong(alongMeters, opts) {
    const options = opts || {};
    const point = pointAlongRoute(alongMeters);
    state.cabecera = point;
    state.cabeceraAlong = alongMeters;
    state.displayAlong = alongMeters;

    if (options.paintRoute) {
      const last = state.lastRoutePaintAlong;
      if (last == null || Math.abs(alongMeters - last) >= 1.5) {
        drawRouteSplit(alongMeters);
        state.lastRoutePaintAlong = alongMeters;
      }
    }

    await drawCabecera(point);

    if (options.follow && state.followCabecera) {
      const now = Date.now();
      if (now - state.lastFollowAt > 450) {
        state.lastFollowAt = now;
        const scale = Math.min(view.scale || 5000, 5000);
        view.goTo({ center: point, scale }).catch(() => {});
      }
    }

    if (options.updateStreet) {
      state.lastStreetTickAt = Date.now();
      await updateStreet(point);
    }
  }

  async function applyCabeceraAlong(alongMeters, isLive) {
    await paintCabeceraAlong(alongMeters, {
      paintRoute: true,
      follow: true,
      updateStreet: false
    });
    if (isLive) {
      const nearEnd =
        state.routeLength - alongMeters < CFG.timing.finishThresholdMeters;
      if (nearEnd) {
        setStatus("ended", "Ha finalizado");
        els.street.textContent = "Meta · " + CFG.landmarks.finish.detail;
      } else {
        setStatus("live", state.simulating ? "Simulacro" : "En curso");
        if (state.simulating) {
          els.street.textContent = "Simulación a lo largo del recorrido";
        }
      }
    }
    updateEta();
  }

  async function loadRoute() {
    // Feature: f430062cb49941268733a973a8caaab5 → recorrido_cabalgata
    const url =
      CFG.layers.route +
      "/query?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&f=json";
    const res = await esriRequest(url, { responseType: "json" });
    if (res.data?.error) {
      throw new Error(res.data.error.message || "Error consulta recorrido");
    }
    const features = res.data.features || [];
    const paths = [];
    features.forEach((f) => {
      (f.geometry?.paths || []).forEach((path) => paths.push(path));
    });
    if (!paths.length) {
      throw new Error("El servicio de recorrido no devolvió geometría");
    }

    const startHint = [CFG.landmarks.start.lon, CFG.landmarks.start.lat];
    const finishHint = [CFG.landmarks.finish.lon, CFG.landmarks.finish.lat];
    let coords = Geo.stitchPaths(paths, startHint, { maxGap: 120 });
    coords = Geo.orientRoute(coords, startHint);

    // Si tras unir, Alicia Alonso queda al final, invertir
    const dStart = Geo.haversine(coords[0], startHint);
    const dEnd = Geo.haversine(coords[coords.length - 1], startHint);
    if (dEnd < dStart) {
      coords = coords.slice().reverse();
    }

    // Confirmar Meta cerca de Fundición respecto a Inicio
    const alongStart = Geo.projectOnRoute(startHint, coords).distanceAlong;
    const alongFinish = Geo.projectOnRoute(finishHint, coords).distanceAlong;
    if (alongStart > alongFinish) {
      coords = coords.slice().reverse();
    }

    state.routeCoords = coords;
    state.routeLength = Geo.totalLength(coords);

    drawRouteSplit(0);
    if (coords.length > 1) {
      const polyline = new Polyline({
        paths: [coords],
        spatialReference: { wkid: 4326 }
      });
      const extent = polyline.extent;
      if (extent) {
        await view.goTo(extent.expand(1.25)).catch(() => {});
      } else {
        await view
          .goTo({
            center: coords[Math.floor(coords.length / 2)],
            zoom: 14
          })
          .catch(() => {});
      }
    }
  }

  function drawRouteSplit(alongMeters) {
    routeLayer.removeAll();
    if (!state.routeCoords.length) return;

    const done = Geo.sliceAlong(state.routeCoords, alongMeters);
    const left = Geo.remainingFrom(state.routeCoords, alongMeters);

    if (left.length > 1) {
      routeLayer.add(
        new Graphic({
          geometry: new Polyline({
            paths: [left],
            spatialReference: { wkid: 4326 }
          }),
          symbol: {
            type: "simple-line",
            color: [194, 0, 0, 0.9],
            width: 5,
            cap: "round",
            join: "round"
          }
        })
      );
    }

    if (done.length > 1) {
      routeLayer.add(
        new Graphic({
          geometry: new Polyline({
            paths: [done],
            spatialReference: { wkid: 4326 }
          }),
          symbol: {
            type: "simple-line",
            color: [90, 90, 90, 0.55],
            width: 5,
            cap: "round",
            join: "round"
          }
        })
      );
    }
  }

  function placeLandmarks() {
    markersLayer.removeAll();
    if (!state.routeCoords.length) return;

    const startCoord = state.routeCoords[0];
    const finishCoord = state.routeCoords[state.routeCoords.length - 1];

    addLandmarkIcon(
      startCoord,
      CFG.landmarks.start.name,
      CFG.landmarks.start.detail,
      new URL("assets/inicio-icon.svg", window.location.href).href
    );
    addLandmarkIcon(
      finishCoord,
      CFG.landmarks.finish.name,
      CFG.landmarks.finish.detail,
      new URL("assets/meta-icon.svg", window.location.href).href
    );
  }

  function addLandmarkIcon(coord, title, detail, iconHref) {
    const point = new Point({
      longitude: coord[0],
      latitude: coord[1]
    });
    markersLayer.add(
      new Graphic({
        geometry: point,
        symbol: {
          type: "picture-marker",
          url: iconHref + "?v=5",
          width: "48px",
          height: "60px",
          yoffset: 24
        },
        attributes: { title, detail },
        popupTemplate: {
          title: "{title}",
          content: "{detail}"
        }
      })
    );
    // Etiqueta siempre visible (por si el SVG no pinta en el mapa)
    markersLayer.add(
      new Graphic({
        geometry: point,
        symbol: {
          type: "text",
          color: title === "Meta" ? "#c20000" : "#1f7a4d",
          haloColor: "#fffaf5",
          haloSize: 2,
          text: title,
          font: { size: 12, weight: "bold", family: "sans-serif" },
          yoffset: 42
        }
      })
    );
  }

  async function refreshLive() {
    if (state.simulating) return;

    const cab = await fetchCabecera();
    const speeds = await fetchRecentSpeeds();
    if (speeds.length) {
      const avg =
        speeds.reduce((a, b) => a + b, 0) / speeds.length ||
        CFG.timing.defaultSpeedKmh;
      state.speedKmh = avg;
    }

    // Mantener el punto de usuario si sigue activo
    if (
      state.userPoint &&
      state.userGraphic &&
      liveLayer.graphics.indexOf(state.userGraphic) < 0
    ) {
      liveLayer.add(state.userGraphic);
    }

    // Sin ningún punto → aún no ha salido
    if (!cab) {
      stopSmoothMotion();
      clearCabeceraMotion();
      setStatus("pending", "Aún no ha salido");
      els.street.textContent = "Esperando salida en " + CFG.landmarks.start.detail;
      drawRouteSplit(0);
      await showCabeceraAtStart();
      updateEta();
      return;
    }

    const ageMin = (Date.now() - cab.fecha) / 60000;
    const liveLimit = CFG.timing.liveWindowMinutes;
    const eventMaxAgeMin = (CFG.timing.eventMaxAgeHours || 18) * 60;

    // Puntos de otro día / pruebas viejas → tratar como sin salida
    if (ageMin > eventMaxAgeMin) {
      stopSmoothMotion();
      clearCabeceraMotion();
      setStatus("pending", "Aún no ha salido");
      els.street.textContent = "Esperando salida en " + CFG.landmarks.start.detail;
      drawRouteSplit(0);
      await showCabeceraAtStart();
      updateEta();
      return;
    }

    const projected = Geo.projectOnRoute(
      [cab.point.longitude, cab.point.latitude],
      state.routeCoords
    );
    let fixAlong = projected.distanceAlong;
    const alongLeft = state.routeLength - fixAlong;
    const nearEnd =
      state.routeLength > 0 &&
      alongLeft < CFG.timing.finishThresholdMeters;
    const isLive = ageMin <= liveLimit;

    if (nearEnd && isLive) {
      fixAlong = state.routeLength;
      stopSmoothMotion();
      state.lastFixAlong = fixAlong;
      state.lastFixAt = cab.fecha;
      state.coastEnabled = false;
      await paintCabeceraAlong(fixAlong, {
        paintRoute: true,
        follow: true,
        updateStreet: false
      });
      setStatus("ended", "Ha finalizado");
      els.street.textContent = "Meta · " + CFG.landmarks.finish.detail;
      updateEta();
      return;
    }

    // Ya hubo salida: el icono se queda en el último punto (o se desliza si hay fix nuevo)
    state.lastFixAlong = fixAlong;
    state.lastFixAt = cab.fecha;
    state.coastEnabled = isLive;
    if (state.displayAlong == null) {
      state.displayAlong = fixAlong;
      await paintCabeceraAlong(fixAlong, {
        paintRoute: true,
        follow: true,
        updateStreet: true
      });
    }

    if (isLive) {
      // Grabando ahora (o reanudó tras una pausa)
      setStatus("live", "En curso");
      startSmoothMotion();
    } else {
      // Ya inició, pero lleva un rato sin puntos nuevos
      stopSmoothMotion();
      setStatus("stopped", "Detenida");
      await paintCabeceraAlong(fixAlong, {
        paintRoute: true,
        follow: true,
        updateStreet: true
      });
    }

    updateEta();
  }

  async function fetchCabecera() {
    const url =
      CFG.layers.cabecera +
      "/query?where=1%3D1&outFields=OBJECTID,FECHA,esrignss_speed,esrignss_latitude,esrignss_longitude&orderByFields=FECHA%20DESC&resultRecordCount=5&returnGeometry=true&outSR=4326&f=json";
    const res = await esriRequest(url, { responseType: "json" });
    if (res.data?.error) {
      throw new Error(res.data.error.message || "Error consulta cabecera");
    }
    const features = res.data.features || [];
    if (!features.length) return null;
    // Tomar el más reciente con geometría válida
    const f =
      features.find((feat) => {
        const x = feat.geometry?.x ?? feat.attributes.esrignss_longitude;
        const y = feat.geometry?.y ?? feat.attributes.esrignss_latitude;
        return x != null && y != null;
      }) || features[0];
    const lon = f.geometry?.x ?? f.attributes.esrignss_longitude;
    const lat = f.geometry?.y ?? f.attributes.esrignss_latitude;
    if (lon == null || lat == null) return null;
    return {
      point: new Point({ longitude: Number(lon), latitude: Number(lat) }),
      fecha: f.attributes.FECHA || Date.now(),
      speed: gnssSpeedToKmh(f.attributes.esrignss_speed),
      calle: null
    };
  }

  async function fetchRecentSpeeds() {
    const minutes = CFG.timing.speedWindowMinutes;
    const days = minutes / (24 * 60);
    const where = encodeURIComponent(
      `FECHA BETWEEN CURRENT_TIMESTAMP - ${days} AND CURRENT_TIMESTAMP`
    );
    const url =
      CFG.layers.cabecera +
      `/query?where=${where}&outFields=FECHA,esrignss_speed&orderByFields=FECHA%20ASC&returnGeometry=true&outSR=4326&f=json`;
    try {
      const res = await esriRequest(url, { responseType: "json" });
      const feats = res.data.features || [];
      const speeds = feats
        .map((f) => gnssSpeedToKmh(f.attributes.esrignss_speed))
        .filter((s) => typeof s === "number" && s >= 0);
      if (speeds.length) return speeds;

      // Fallback: velocidad por distancia entre fixes (ya en km/h)
      if (feats.length >= 2) {
        const computed = [];
        for (let i = 1; i < feats.length; i++) {
          const a = feats[i - 1];
          const b = feats[i];
          const dtH =
            (b.attributes.FECHA - a.attributes.FECHA) / 3600000;
          if (dtH <= 0) continue;
          const dKm =
            Geo.haversine(
              [a.geometry.x, a.geometry.y],
              [b.geometry.x, b.geometry.y]
            ) / 1000;
          computed.push(dKm / dtH);
        }
        return computed;
      }
    } catch (e) {
      console.warn("speed query", e);
    }
    return [];
  }

  function iconUrl() {
    return new URL("assets/cabalgata-icon.svg?v=7", window.location.href).href;
  }

  function startPoint() {
    if (!state.routeCoords.length) {
      return new Point({
        longitude: CFG.landmarks.start.lon,
        latitude: CFG.landmarks.start.lat
      });
    }
    const c = state.routeCoords[0];
    return new Point({ longitude: c[0], latitude: c[1] });
  }

  async function loadIconSvg() {
    if (state.iconSvgHtml) return state.iconSvgHtml;
    const res = await fetch(iconUrl(), { cache: "no-cache" });
    // Inline: las animaciones CSS del SVG solo corren si no va en <img>
    state.iconSvgHtml = await res.text();
    return state.iconSvgHtml;
  }

  async function mountBrandIcon() {
    const host = document.getElementById("brandIcon");
    if (!host) return;
    try {
      host.innerHTML = await loadIconSvg();
    } catch (e) {
      console.warn("brand icon", e);
    }
  }

  function ensureCabeceraMarker() {
    if (state.cabeceraMarker) return state.cabeceraMarker;
    const el = document.createElement("div");
    el.className = "cabecera-marker is-hidden";
    el.setAttribute("aria-hidden", "true");
    el.innerHTML = '<div class="cabecera-marker-inner"></div>';
    document.body.appendChild(el);
    state.cabeceraMarker = el;

    const sync = () => syncCabeceraMarker();
    state.cabeceraWatchHandles = [
      view.watch("extent", sync),
      view.watch("rotation", sync),
      view.watch("size", sync),
      view.watch("stationary", sync)
    ];
    window.addEventListener("resize", sync);
    return el;
  }

  function syncCabeceraMarker() {
    const el = state.cabeceraMarker;
    if (!el || !state.cabecera) return;
    const screen = view.toScreen(state.cabecera);
    if (!screen || !Number.isFinite(screen.x) || !Number.isFinite(screen.y)) {
      el.classList.add("is-hidden");
      return;
    }
    const rect = view.container.getBoundingClientRect();
    el.style.left = `${rect.left + screen.x}px`;
    el.style.top = `${rect.top + screen.y}px`;
    el.classList.remove("is-hidden");
  }

  function hideCabeceraMarker() {
    if (state.cabeceraMarker) {
      state.cabeceraMarker.classList.add("is-hidden");
    }
  }

  async function drawCabecera(point) {
    // Solo halo en el mapa; el icono animado va en overlay HTML (fondo transparente)
    if (
      state.cabeceraHalo &&
      liveLayer.graphics.indexOf(state.cabeceraHalo) >= 0
    ) {
      state.cabeceraHalo.geometry = point;
    } else {
      state.cabeceraHalo = new Graphic({
        geometry: point,
        symbol: {
          type: "simple-marker",
          style: "circle",
          color: [194, 0, 0, 0.15],
          size: 22,
          outline: { color: [194, 0, 0, 0.35], width: 1 }
        }
      });
      liveLayer.add(state.cabeceraHalo);
    }

    const el = ensureCabeceraMarker();
    const inner = el.querySelector(".cabecera-marker-inner");
    if (inner && !inner.dataset.ready) {
      try {
        inner.innerHTML = await loadIconSvg();
        inner.dataset.ready = "1";
      } catch (e) {
        console.warn("cabecera icon", e);
      }
    }
    syncCabeceraMarker();
  }

  async function showCabeceraAtStart() {
    const point = startPoint();
    state.cabecera = point;
    state.displayAlong = 0;
    state.lastRoutePaintAlong = 0;
    await drawCabecera(point);
  }

  async function updateStreet(point) {
    // Preferir atributo servidor si existiera
    const cab = state.cabecera;
    if (!cab) return;

    const cached = state.streetCache;
    const moved =
      cached.lon == null ||
      Geo.haversine(
        [cached.lon, cached.lat],
        [point.longitude, point.latitude]
      ) > 25;
    const stale = Date.now() - cached.at > 20000;

    if (cached.text && !moved && !stale) {
      els.street.textContent = cached.text;
      return;
    }

    try {
      const result = await locator.locationToAddress(
        CFG.geocoder.url,
        {
          location: point,
          locationType: "street"
        },
        { distance: CFG.geocoder.distanceMeters }
      );
      const addr = result?.attributes || {};
      const street =
        addr.ShortLabel ||
        addr.Address ||
        addr.Match_addr ||
        result?.address ||
        "Calle desconocida";
      const barrio = addr.Neighborhood ? `, ${addr.Neighborhood}` : "";
      const text = `${street}${barrio}`;
      state.streetCache = {
        text,
        at: Date.now(),
        lon: point.longitude,
        lat: point.latitude
      };
      els.street.textContent = text;
    } catch (e) {
      console.warn("reverse geocode", e);
      if (!cached.text) {
        els.street.textContent = "Localizando calle…";
      }
    }
  }

  function formatEtaMinutes(remainingMeters, speedKmh) {
    const minutesExact = (remainingMeters / 1000 / speedKmh) * 60;
    if (minutesExact < 1) return { text: "~1 min", exact: minutesExact };
    if (minutesExact < 60) {
      const minutes = Math.max(1, Math.round(minutesExact));
      return { text: `~${minutes} min`, exact: minutesExact };
    }
    const h = Math.floor(minutesExact / 60);
    const m = Math.round(minutesExact % 60);
    return {
      text: m > 0 ? `~${h} h ${m} min` : `~${h} h`,
      exact: minutesExact
    };
  }

  function updateEta() {
    if (!state.userPoint) {
      els.etaChip.classList.add("is-hidden");
      return;
    }
    els.etaChip.classList.remove("is-hidden");

    const userProj = state.routeCoords.length
      ? Geo.projectOnRoute(
          [state.userPoint.longitude, state.userPoint.latitude],
          state.routeCoords
        )
      : null;
    const onRoute =
      !!userProj && userProj.distanceToRoute <= CFG.timing.routeSnapMeters;
    drawUser(state.userPoint, onRoute);

    if (!state.cabecera || state.cabeceraAlong == null || !state.routeCoords.length) {
      els.etaValue.textContent = "Esperando posición de la cabalgata…";
      return;
    }

    if (!onRoute) {
      els.etaValue.textContent =
        "Acércate al recorrido para calcular la llegada";
      return;
    }

    // Metros restantes a lo largo de la polilínea (cabecera → tu tramo)
    const remaining = Geo.distanceBetweenAlong(
      state.cabeceraAlong,
      userProj.distanceAlong
    );
    const arrivingM = CFG.timing.etaArrivingMeters || 40;
    const soonM = CFG.timing.etaSoonMeters || 150;
    const passedM = CFG.timing.etaPassedMeters || 40;

    if (remaining < -passedM) {
      els.etaValue.textContent = "Ya ha pasado por tu zona";
      return;
    }

    const speed = etaSpeedKmh();
    const estimated =
      state.speedKmh < CFG.timing.minSpeedKmh ? " · ritmo estimado" : "";

    if (remaining <= arrivingM) {
      els.etaValue.textContent = "¡Está llegando!";
      return;
    }

    const eta = formatEtaMinutes(remaining, speed);
    if (remaining <= soonM) {
      els.etaValue.textContent = `${eta.text} · muy cerca${estimated}`;
      return;
    }

    els.etaValue.textContent = `${eta.text}${estimated}`;
  }

  function drawUser(point, onRoute) {
    const symbol = {
      type: "simple-marker",
      style: "circle",
      color: onRoute ? [30, 90, 180, 1] : [120, 120, 120, 1],
      size: 10,
      outline: { color: [255, 255, 255, 1], width: 2 }
    };
    if (state.userGraphic) {
      state.userGraphic.geometry = point;
      state.userGraphic.symbol = symbol;
      if (liveLayer.graphics.indexOf(state.userGraphic) < 0) {
        liveLayer.add(state.userGraphic);
      }
      return;
    }
    state.userGraphic = new Graphic({ geometry: point, symbol });
    liveLayer.add(state.userGraphic);
  }

  function toggleLocate() {
    if (state.locateWatchId != null) {
      navigator.geolocation.clearWatch(state.locateWatchId);
      state.locateWatchId = null;
      state.userPoint = null;
      if (state.userGraphic) {
        liveLayer.remove(state.userGraphic);
        state.userGraphic = null;
      }
      els.btnLocate.textContent = "Activar mi ubicación";
      els.etaChip.classList.add("is-hidden");
      refreshLive();
      return;
    }

    if (!navigator.geolocation) {
      els.etaValue.textContent = "Tu dispositivo no permite geolocalización";
      els.etaChip.classList.remove("is-hidden");
      return;
    }

    els.btnLocate.textContent = "Desactivar mi ubicación";
    let centeredOnce = false;
    state.locateWatchId = navigator.geolocation.watchPosition(
      (pos) => {
        state.userPoint = new Point({
          longitude: pos.coords.longitude,
          latitude: pos.coords.latitude
        });
        updateEta();
        if (!centeredOnce) {
          centeredOnce = true;
          state.followCabecera = false;
          els.btnFollow.classList.remove("is-active");
          els.btnFollow.setAttribute("aria-pressed", "false");
          view
            .goTo({ center: state.userPoint, scale: 4000 })
            .catch(() => {});
        }
      },
      (err) => {
        console.warn(err);
        els.etaChip.classList.remove("is-hidden");
        els.etaValue.textContent = "No se pudo obtener tu ubicación";
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );
  }

  function setStatus(stateName, text) {
    els.status.dataset.state = stateName;
    els.status.textContent = text;
  }
});
