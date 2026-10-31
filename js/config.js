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
    cabecera:
      "https://services5.arcgis.com/OvtDsNt9TdkMlaCZ/arcgis/rest/services/ubicacion_carrozas_cabalgata_vista_ESTRELLA/FeatureServer/0",
    /** Estela opcional (últimos minutos se filtran en cliente) */
    trail:
      "https://services5.arcgis.com/OvtDsNt9TdkMlaCZ/arcgis/rest/services/ubicacion_carrozas_cabalgata_vista/FeatureServer/0"
  },

  geocoder: {
    url: "https://sit.rivasciudad.es/server/rest/services/Localizador_rivas_1_3_1/GeocodeServer",
    distanceMeters: 80
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
    /** “En curso” si el último punto tiene menos de N minutos */
    liveWindowMinutes: 3,
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
    /** ETA: mensajes según metros restantes a lo largo de la ruta */
    etaArrivingMeters: 40,
    etaSoonMeters: 150,
    etaPassedMeters: 40,
    /** Minutos de estela GPS a mostrar */
    trailMinutes: 3,
    /** Solo el extremo final de la polyline (m restantes a lo largo de la ruta) */
    finishThresholdMeters: 25,
    /** Simulacro: avance a lo largo de la ruta (km/h) */
    simulationSpeedKmh: 4,
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
