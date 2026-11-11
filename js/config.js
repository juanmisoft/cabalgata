/**
 * Configuración del Visor Cabalgata de Reyes — Rivas Vaciamadrid
 * Capas públicas AGO. No incluir tokens en este fichero.
 */
window.CABALGATA_CONFIG = {
  title: "Cabalgata de Reyes",
  subtitle: "Rivas Vaciamadrid",
  brandAccent: "#c20000",

  /** URLs de servicios públicos */
  layers: {
    route:
      "https://services5.arcgis.com/OvtDsNt9TdkMlaCZ/arcgis/rest/services/recorrido_cabalgata/FeatureServer/0",
    /**
     * Vista pública de lectura (Query).
     * No usar ubicacion_carrozas_cabalgata_vista_ESTRELLA: el 1-nov solo
     * exponía 3 puntos frente a ~620 de esta vista (~1 punto/s).
     */
    cabecera:
      "https://services5.arcgis.com/OvtDsNt9TdkMlaCZ/arcgis/rest/services/ubicacion_carrozas_cabalgata_vista/FeatureServer/0",
    /** Estela opcional (últimos minutos se filtran en cliente) */
    trail:
      "https://services5.arcgis.com/OvtDsNt9TdkMlaCZ/arcgis/rest/services/ubicacion_carrozas_cabalgata_vista/FeatureServer/0",
    /**
     * Ejes de calles (SIT Rivas) — item f831af56541f4edaa8a5538555ab8bb6
     * Se cruzan con el recorrido; no se usa geocode para el chip de calle.
     */
    streets:
      "https://sit.rivasciudad.es/server/rest/services/EJE_TRAZADO_ASFALTO/FeatureServer/0"
  },

  streets: {
    nameField: "NOMBRECOMP",
    /** Buffer (m) al consultar ejes que tocan el recorrido */
    queryDistanceMeters: 15,
    /** Distancia máx. punto-ruta → eje para asignar nombre */
    matchDistanceMeters: 25,
    /** Desvío máx. de rumbo (grados) para aceptar un eje (filtra perpendiculares) */
    maxBearingDiffDeg: 55,
    /** Paso de muestreo a lo largo del recorrido */
    sampleMeters: 30
  },

  geocoder: {
    url: "https://sit.rivasciudad.es/server/rest/services/Localizador_rivas_1_3_1/GeocodeServer",
    /** Solo fallback legado; el chip de calle usa capas de ejes */
    distanceMeters: 25,
    routeSampleMeters: 50,
    routeSampleDistanceMeters: 8,
    minStreetSegmentMeters: 120
  },

  /** Puntos de referencia del itinerario (WGS84). Se ajustan a extremos de la ruta al cargar. */
  landmarks: {
    start: {
      name: "Inicio",
      detail: "Paseo de Alicia Alonso",
      lon: -3.51562,
      lat: 40.34559
    },
    finish: {
      name: "Meta",
      detail: "Final del recorrido",
      lon: -3.54545,
      lat: 40.35524
    }
  },

  timing: {
    /** Refresh de cabecera / calle / ETA (ms) — más fluido en campo */
    refreshMs: 3000,
    /**
     * Sin puntos nuevos durante estos segundos → estado «Detenida»
     * (antes eran minutos; ahora responde enseguida a pausas).
     */
    stoppedAfterSeconds: 45,
    /**
     * Si el último punto es más antiguo que esto, se trata como otro día
     * (Aún no ha salido). Pausas del evento → Detenida, no este caso.
     */
    eventMaxAgeHours: 18,
    /** Ventana de velocidad media para ETA (minutos) */
    speedWindowMinutes: 4,
    /** Velocidad mínima (km/h) para considerar movimiento real */
    minSpeedKmh: 0.5,
    /** Velocidad por defecto de la cabalgata a pie (km/h) */
    defaultSpeedKmh: 3.5,
    /** Tope de velocidad para ETA ciudadano (evita coches de prueba → “1 min”) */
    maxEtaSpeedKmh: 6,
    /** Buffer (m) para proyectar al ciudadano sobre la ruta */
    routeSnapMeters: 250,
    /**
     * Longitud estimada de la comitiva (moto cabecera → Reyes al final).
     * La cola = cabecera − esta distancia a lo largo de la ruta.
     */
    paradeLengthMeters: 200,
    /** ETA: mensajes según metros restantes a lo largo de la ruta */
    etaArrivingMeters: 40,
    etaSoonMeters: 150,
    /** “Ya ha pasado” solo cuando la COLA supera al ciudadano */
    etaPassedMeters: 40,
    /** Minutos de estela GPS a mostrar */
    trailMinutes: 3,
    /** Solo el extremo final de la polyline (m restantes a lo largo de la ruta) */
    finishThresholdMeters: 25,
    /** Animación del icono sobre la ruta (ms entre frames) */
    smoothMs: 100,
    /** Segundos para alcanzar un punto GPS adelantado sin salto */
    catchUpSeconds: 2.5,
    /** Metros que puede adelantar por inercia entre fixes GPS */
    coastLeadMeters: 18
  },

  map: {
    basemap: "streets-navigation-vector",
    center: [-3.532, 40.352],
    zoom: 14
  },

  /** Directo YouTube (cambiar videoId cuando toque el stream del año) */
  youtube: {
    videoId: "C5b2TengduM",
    enabled: true
  },

  /**
   * Contador de usuarios activos.
   * Crea en AGOL una tabla/Feature Layer pública (Add+Update) con:
   *   session_id (texto 64), last_seen (fecha)
   * y pega aquí la URL .../FeatureServer/0
   * Si layer es null, el chip se oculta.
   */
  presence: {
    layer: null,
    heartbeatMs: 25000,
    activeMinutes: 2
  }
};
