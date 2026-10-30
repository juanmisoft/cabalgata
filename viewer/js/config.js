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
      detail: "Calle de la Fundición",
      lon: -3.54545,
      lat: 40.35524
    }
  },

  timing: {
    /** Refresh de cabecera / calle / ETA (ms) */
    refreshMs: 12000,
    /** Se considera “en vivo” si el último fix tiene menos de N minutos */
    liveWindowMinutes: 8,
    /** Ventana de velocidad media para ETA (minutos) */
    speedWindowMinutes: 4,
    /** Velocidad mínima (km/h) para calcular ETA; si es menor → detenida */
    minSpeedKmh: 0.8,
    /** Velocidad por defecto si no hay histórico (km/h) */
    defaultSpeedKmh: 3.5,
    /** Buffer (m) para proyectar al ciudadano sobre la ruta */
    routeSnapMeters: 120,
    /** Minutos de estela GPS a mostrar */
    trailMinutes: 3
  },

  map: {
    basemap: "streets-navigation-vector",
    center: [-3.532, 40.352],
    zoom: 14
  }
};
