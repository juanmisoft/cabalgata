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
    btnFollow: document.getElementById("btnFollow")
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
    iconSvgHtml: null
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
    const cab = await fetchCabecera();
    const speeds = await fetchRecentSpeeds();
    if (speeds.length) {
      state.speedKmh =
        speeds.reduce((a, b) => a + b, 0) / speeds.length ||
        CFG.timing.defaultSpeedKmh;
    }

    liveLayer.removeAll();
    // Redibujar el punto de usuario si sigue activo
    if (state.userPoint && state.userGraphic) {
      liveLayer.add(state.userGraphic);
    }

    if (!cab) {
      state.cabecera = null;
      state.cabeceraAlong = null;
      setStatus("offline", "Posición no disponible");
      els.street.textContent = "Sin señal de la cabecera";
      drawRouteSplit(0);
      await showCabeceraAtStart();
      updateEta();
      return;
    }

    const ageMin = (Date.now() - cab.fecha) / 60000;
    const liveLimit = CFG.timing.liveWindowMinutes;
    const pendingLimit = Math.max(liveLimit * 3, 6);

    // Sin captura reciente (p. ej. QuickCapture cerrado hace rato)
    if (ageMin > pendingLimit) {
      state.cabecera = null;
      state.cabeceraAlong = null;
      setStatus("pending", "Aún no ha salido");
      els.street.textContent = "Esperando salida en " + CFG.landmarks.start.detail;
      drawRouteSplit(0);
      await showCabeceraAtStart();
      updateEta();
      return;
    }

    state.cabecera = cab.point;
    const projected = Geo.projectOnRoute(
      [cab.point.longitude, cab.point.latitude],
      state.routeCoords
    );
    state.cabeceraAlong = projected.distanceAlong;

    // Meta = último vértice de la ruta (no al entrar en Fundición)
    const finishCoord = state.routeCoords[state.routeCoords.length - 1];
    const alongLeft = state.routeLength - state.cabeceraAlong;
    const nearEnd =
      state.routeLength > 0 &&
      alongLeft < CFG.timing.finishThresholdMeters;

    let followPoint = cab.point;
    if (nearEnd && ageMin <= liveLimit) {
      const finishPoint = new Point({
        longitude: finishCoord[0],
        latitude: finishCoord[1]
      });
      state.cabecera = finishPoint;
      state.cabeceraAlong = state.routeLength;
      drawRouteSplit(state.routeLength);
      await drawCabecera(finishPoint);
      setStatus("ended", "Ha finalizado");
      els.street.textContent = "Meta · " + CFG.landmarks.finish.detail;
      followPoint = finishPoint;
    } else {
      drawRouteSplit(state.cabeceraAlong);
      await drawCabecera(cab.point);
      await updateStreet(cab.point);

      if (ageMin <= liveLimit) {
        setStatus("live", "En curso");
      } else {
        // QuickCapture cerrado / GPS parado: ya no “En curso”
        setStatus("offline", "Captura detenida");
      }
    }

    if (state.followCabecera) {
      const scale = Math.min(view.scale || 6000, 6000);
      view.goTo({ center: followPoint, scale }).catch(() => {});
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
      speed: f.attributes.esrignss_speed,
      calle: null
    };
  }

  async function fetchRecentSpeeds() {
    const minutes = CFG.timing.speedWindowMinutes;
    // FECHA en epoch ms; filtro relativo aproximado con CURRENT_TIMESTAMP (días)
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
        .map((f) => f.attributes.esrignss_speed)
        .filter((s) => typeof s === "number" && s >= 0);
      if (speeds.length) return speeds;

      // Fallback: velocidad por distancia entre fixes
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
    return new URL("assets/cabalgata-icon.svg?v=4", window.location.href).href;
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
    liveLayer.add(
      new Graphic({
        geometry: point,
        symbol: {
          type: "simple-marker",
          style: "circle",
          color: [194, 0, 0, 0.15],
          size: 22,
          outline: { color: [194, 0, 0, 0.35], width: 1 }
        }
      })
    );

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

    const remaining = Geo.distanceBetweenAlong(
      state.cabeceraAlong,
      userProj.distanceAlong
    );

    if (remaining < -30) {
      els.etaValue.textContent = "La cabalgata ya ha pasado por tu zona";
      return;
    }
    if (Math.abs(remaining) <= 30) {
      els.etaValue.textContent = "¡Está llegando a tu zona!";
      return;
    }

    const speed = Math.max(state.speedKmh, 0);
    if (speed < CFG.timing.minSpeedKmh) {
      els.etaValue.textContent = "Detenida / calculando…";
      return;
    }

    const hours = remaining / 1000 / speed;
    const minutes = Math.max(1, Math.round(hours * 60));
    els.etaValue.textContent =
      minutes < 60
        ? `Llega a tu zona en ~${minutes} min`
        : `Llega a tu zona en ~${Math.floor(minutes / 60)} h ${minutes % 60} min`;
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
      if (!liveLayer.graphics.includes(state.userGraphic)) {
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
