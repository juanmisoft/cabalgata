#!/usr/bin/env python3
"""
Simulacro: escribe puntos reales en la capa de carrozas (como QuickCapture).

Uso:
  1) Guarda el token AGOL en token.txt (raíz del proyecto) o variable AGOL_TOKEN
  2) python scripts/simulate_cabecera.py

Opciones:
  python scripts/simulate_cabecera.py --speed 4 --interval 3 --duration 15
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# Capa de ESCRITURA (no la vista pública ESTRELLA)
LAYER_WRITE = (
    "https://services5.arcgis.com/OvtDsNt9TdkMlaCZ/arcgis/rest/services/"
    "ubicacion_carrozas_cabalgata/FeatureServer/0"
)
ROUTE_LAYER = (
    "https://services5.arcgis.com/OvtDsNt9TdkMlaCZ/arcgis/rest/services/"
    "recorrido_cabalgata/FeatureServer/0"
)


def load_token() -> str:
    env = os.environ.get("AGOL_TOKEN", "").strip()
    if env:
        return env
    for name in ("token.txt", ".env"):
        path = ROOT / name
        if not path.exists():
            continue
        text = path.read_text(encoding="utf-8").strip()
        if name == ".env":
            for line in text.splitlines():
                line = line.strip()
                if line.startswith("AGOL_TOKEN="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
        elif text:
            # primera línea no vacía / no comentario
            for line in text.splitlines():
                line = line.strip()
                if line and not line.startswith("#"):
                    return line
    print(
        "No hay token. Crea token.txt en la raíz con el token AGOL, "
        "o define AGOL_TOKEN.",
        file=sys.stderr,
    )
    sys.exit(1)


def http_json(url: str, data: dict | None = None) -> dict:
    if data is None:
        req = urllib.request.Request(url, headers={"User-Agent": "cabalgata-sim/1.0"})
    else:
        body = urllib.parse.urlencode(data).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=body,
            headers={
                "User-Agent": "cabalgata-sim/1.0",
                "Content-Type": "application/x-www-form-urlencoded",
            },
        )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode("utf-8"))


def haversine(a, b):
    r = 6371000.0
    p1, p2 = math.radians(a[1]), math.radians(b[1])
    dphi = math.radians(b[1] - a[1])
    dl = math.radians(b[0] - a[0])
    h = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def stitch_route(paths, start_hint):
    remaining = [p[:] for p in paths if len(p) >= 2]
    if not remaining:
        return []

    def d_end(tip, path):
        return min(haversine(tip, path[0]), haversine(tip, path[-1]))

    best_i, best_d = 0, float("inf")
    for i, p in enumerate(remaining):
        d = min(haversine(start_hint, p[0]), haversine(start_hint, p[-1]))
        if d < best_d:
            best_d, best_i = d, i
    cur = remaining.pop(best_i)
    if haversine(start_hint, cur[-1]) < haversine(start_hint, cur[0]):
        cur = cur[::-1]
    joined = cur[:]
    max_gap = 120.0
    while remaining:
        tip = joined[-1]
        cand = sorted(
            (
                (
                    min(haversine(tip, p[0]), haversine(tip, p[-1])),
                    i,
                    haversine(tip, p[-1]) < haversine(tip, p[0]),
                )
                for i, p in enumerate(remaining)
            )
        )
        d, i, rev = cand[0]
        if d > max_gap:
            break
        nxt = remaining.pop(i)
        if rev:
            nxt = nxt[::-1]
        joined += nxt[1:] if haversine(joined[-1], nxt[0]) < 1 else nxt
    # prepend leftovers that attach to start
    while remaining:
        tip = joined[0]
        best = None
        for i, p in enumerate(remaining):
            d0, d1 = haversine(tip, p[0]), haversine(tip, p[-1])
            entry = (d1, i, False) if d1 <= d0 else (d0, i, True)
            if best is None or entry[0] < best[0]:
                best = entry
        if best[0] > max_gap:
            break
        d, i, rev = best
        prev = remaining.pop(i)
        if rev:
            prev = prev[::-1]
        joined = (prev[:-1] if haversine(prev[-1], joined[0]) < 1 else prev) + joined
    return joined


def load_route(token: str):
    q = urllib.parse.urlencode(
        {
            "where": "1=1",
            "outFields": "*",
            "returnGeometry": "true",
            "outSR": "4326",
            "f": "json",
            "token": token,
        }
    )
    data = http_json(f"{ROUTE_LAYER}/query?{q}")
    if data.get("error"):
        raise RuntimeError(data["error"])
    paths = []
    for f in data.get("features", []):
        for path in f.get("geometry", {}).get("paths", []):
            paths.append(path)
    start = (-3.51562, 40.34559)
    coords = stitch_route(paths, start)
    if len(coords) < 2:
        raise RuntimeError("No se pudo unir el recorrido")
    return coords


def densify(coords, step_m=8.0):
    out = [coords[0]]
    for i in range(1, len(coords)):
        a, b = coords[i - 1], coords[i]
        seg = haversine(a, b)
        if seg <= step_m:
            out.append(b)
            continue
        n = max(1, int(seg // step_m))
        for k in range(1, n + 1):
            t = k / n
            out.append([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
    return out


def add_point(token: str, lon: float, lat: float, speed_ms: float):
    now = int(time.time() * 1000)
    feature = {
        "geometry": {"x": lon, "y": lat, "spatialReference": {"wkid": 4326}},
        "attributes": {
            "FECHA": now,
            "esrignss_speed": speed_ms,
            "esrignss_longitude": lon,
            "esrignss_latitude": lat,
        },
    }
    payload = {
        "f": "json",
        "token": token,
        "features": json.dumps([feature]),
    }
    # addFeatures
    res = http_json(f"{LAYER_WRITE}/addFeatures", payload)
    if res.get("error"):
        raise RuntimeError(res["error"])
    results = res.get("addResults") or []
    if not results or not results[0].get("success"):
        raise RuntimeError(res)
    return results[0].get("objectId")


def main():
    ap = argparse.ArgumentParser(description="Simulacro de cabecera en AGOL")
    ap.add_argument("--speed", type=float, default=4.0, help="km/h de avance")
    ap.add_argument("--interval", type=float, default=3.0, help="segundos entre puntos")
    ap.add_argument(
        "--duration",
        type=float,
        default=0.0,
        help="minutos máximos (0 = hasta el final de la ruta)",
    )
    ap.add_argument(
        "--start-frac",
        type=float,
        default=0.0,
        help="fracción inicial 0..1 a lo largo de la ruta",
    )
    args = ap.parse_args()

    token = load_token()
    print("Cargando recorrido…")
    coords = densify(load_route(token), step_m=10.0)
    total_m = sum(haversine(coords[i], coords[i + 1]) for i in range(len(coords) - 1))
    print(f"Ruta ~{total_m:.0f} m, {len(coords)} puntos densificados")

    # índice inicial
    target = total_m * max(0.0, min(1.0, args.start_frac))
    acc = 0.0
    idx = 0
    for i in range(len(coords) - 1):
        if acc >= target:
            idx = i
            break
        acc += haversine(coords[i], coords[i + 1])
        idx = i

    speed_ms = args.speed / 3.6
    step_m = speed_ms * args.interval
    deadline = time.time() + args.duration * 60 if args.duration > 0 else None

    print(
        f"Escribiendo en {LAYER_WRITE}\n"
        f"Velocidad {args.speed} km/h · cada {args.interval}s · paso ~{step_m:.1f} m"
    )
    print("Abre el visor y pulsa Seguir. Ctrl+C para parar.\n")

    along = target
    n = 0
    try:
        while idx < len(coords) - 1:
            if deadline and time.time() >= deadline:
                print("Duración alcanzada.")
                break
            lon, lat = coords[idx]
            oid = add_point(token, lon, lat, speed_ms)
            n += 1
            print(f"[{n}] OBJECTID={oid}  lon={lon:.6f} lat={lat:.6f}  along~{along:.0f}m")

            # avanzar step_m
            remain = step_m
            while remain > 0 and idx < len(coords) - 1:
                seg = haversine(coords[idx], coords[idx + 1])
                if seg <= remain:
                    remain -= seg
                    along += seg
                    idx += 1
                else:
                    # interpolar dentro del segmento
                    t = remain / seg
                    a, b = coords[idx], coords[idx + 1]
                    coords[idx] = [
                        a[0] + (b[0] - a[0]) * t,
                        a[1] + (b[1] - a[1]) * t,
                    ]
                    along += remain
                    remain = 0
            time.sleep(args.interval)
    except KeyboardInterrupt:
        print("\nParado por usuario.")

    print(f"Listo. Puntos insertados: {n}")


if __name__ == "__main__":
    main()
