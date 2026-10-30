# Visor ciudadano — Cabalgata de Reyes (Rivas Vaciamadrid)

Aplicación web pública (ArcGIS Maps SDK for JavaScript) para seguir el recorrido en directo, ver la calle actual de la cabecera y estimar el tiempo de llegada a la posición del ciudadano.

## Visor en vivo

**[Abrir el visor](https://juanmisoft.github.io/cabalgata/)** ← esta es la app (mapa).  
La página de GitHub (`github.com/...`) solo muestra este README; no es el visor.

## Abrir en local

Sirve la carpeta `viewer/` con cualquier servidor estático (IIS, nginx, o):

```bash
npx --yes serve "viewer"
```

Luego abre la URL que indique (p. ej. `http://localhost:3000`).

> La geolocalización del navegador exige **HTTPS** (o `localhost`).

## Qué usa

| Recurso | URL / origen |
|---|---|
| Ruta | AGO `recorrido_cabalgata` (público) |
| Cabecera en vivo | AGO vista `…_ESTRELLA` / CABECERA (público) |
| Calle actual | Reverse geocode `Localizador_rivas_1_3_1` (SIT, público) |
| Inicio / Meta | Extremos de la ruta unida + textos en `viewer/js/config.js` |

**No se embebe ningún token** en el cliente. Las capas ciudadanas deben permanecer públicas (solo Query).

## Captura operativa (geoposicionar la cabalgata)

Confirmado en la org AGO (contenido compartido/org):

| Rol | Ítem |
|---|---|
| Capa de escritura | `ubicacion_carrozas_cabalgata` (shared, `gpsMetadataEnabled`) |
| Proyecto captura AGO | **QuickCapture** `Ubicación Carrozas` |
| Vista ciudadana cabecera | `ubicacion_carrozas_cabalgata_vista_CABECERA` (pública) |
| Vista ciudadana estela | `ubicacion_carrozas_cabalgata_vista` (pública) |
| Alternativa SIT | QuickCapture `localizacion_cabalgata` + FS Enterprise |

1. Una persona en la **cabecera** abre **QuickCapture → Ubicación Carrozas** (o AppStudio legado) en Android.
2. La app escribe puntos GPS **automáticamente** (~1–5 s) en la capa hosted (no a mano).
3. El visor lee el último punto de la **vista pública** y refresca cada ~12 s.
4. Día del evento: powerbank, móvil de respaldo, ensayo la tarde anterior.

Configuración de tiempos, umbrales de ETA y textos de hitos: [`viewer/js/config.js`](viewer/js/config.js).

## Funciones del visor

1. **Mapa** con recorrido (tramo hecho en gris / pendiente en rojo), Inicio y Meta.
2. **“Ahora está en: …”** para todos (reverse geocode municipal, con caché).
3. **ETA** solo si el ciudadano activa su ubicación: proyecta sobre la ruta y estima minutos con la velocidad media reciente de la cabecera.
4. Estados: *Aún no ha salido* / *En curso* / *Ha finalizado* / *Posición no disponible*.

## Publicación

Copiar `viewer/` a IIS / CDN municipal / item de aplicación en el portal. Actualizar `config.js` si cambian las URLs de capa del año.

## Seguridad

Si se ha compartido un token de Portal en chat o correo, **revócalo o deja que caduque** y genera otro solo para trabajo interno. Nunca lo pongas en el visor público.
