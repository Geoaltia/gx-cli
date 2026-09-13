<div align="center">

# ◍ geoaltia

**Pásale un polígono y descubre qué datos satelitales existen sobre esa zona.**

`geoaltia` lee tu área de interés (GeoJSON, KML/KMZ, Shapefile, WKT o bbox),
calcula su superficie y CRS y consulta el catálogo STAC de
[Copernicus Data Space](https://dataspace.copernicus.eu) para decirte cuántas
escenas Sentinel-1 y Sentinel-2 hay, de qué fechas, con cuánta nubosidad, qué
parte del AOI cubren y qué bandas ofrecen. Todo en segundos, desde la terminal.

[![npm](https://img.shields.io/npm/v/%40geoaltia%2Fcli?color=cyan)](https://www.npmjs.com/package/@geoaltia/cli)
[![license](https://img.shields.io/npm/l/%40geoaltia%2Fcli?color=green)](./LICENSE)

</div>

---

## Índice

- [Qué hace (y qué no)](#qué-hace-y-qué-no)
- [Instalación](#instalación)
- [Inicio rápido](#inicio-rápido)
- [Modo guiado](#modo-guiado)
- [Formatos de área de interés](#formatos-de-área-de-interés)
- [Sistemas de referencia (CRS)](#sistemas-de-referencia-crs)
- [Referencia de comandos](#referencia-de-comandos)
- [Colecciones](#colecciones)
- [Cómo leer el informe](#cómo-leer-el-informe)
- [Exportación JSON y GeoJSON](#exportación-json-y-geojson)
- [Recetas](#recetas)
- [API programática](#api-programática)
- [Requisitos](#requisitos)
- [Desarrollo](#desarrollo)
- [Publicación](#publicación)
- [Licencia](#licencia)

---

## Qué hace (y qué no)

**Hace**

- Lee el AOI, detecta su CRS y lo reproyecta a EPSG:4326.
- Calcula superficie y perímetro geodésicos, bbox, centroide, número de
  vértices, zona UTM sugerida y problemas de geometría (auto-intersecciones,
  anillos degenerados).
- Consulta el catálogo STAC público de Copernicus (sin cuenta ni token) y
  resume, por colección: número de escenas, días con adquisición, primera y
  última fecha, nubosidad mín/media/máx, cobertura del AOI por escena,
  plataformas, tiles MGRS, órbitas relativas, polarizaciones, versión de
  procesado, CRS de los rásteres, volumen de los productos y bandas.
- Exporta el resultado a **JSON** (informe completo) o **GeoJSON** (AOI + huellas
  de las escenas, listo para QGIS).

**No hace**

- No descarga imágenes.
- No calcula índices, clasificaciones, series temporales ni ningún análisis
  científico. Eso es el servicio de Geoaltia; esta herramienta sirve para saber,
  antes de empezar, qué datos hay disponibles.

---

## Instalación

Sin instalar nada:

```bash
npx @geoaltia/cli parcela.geojson
```

Global:

```bash
npm install -g @geoaltia/cli
# o
pnpm add -g @geoaltia/cli
```

Instala dos comandos equivalentes: `geoaltia` y el alias corto `gx`.

---

## Inicio rápido

```bash
# Sentinel-2 L2A y Sentinel-1 GRD de los últimos 90 días
geoaltia parcela.geojson

# Último mes, escenas ópticas con ≤ 20 % de nubes, con listado de escenas
gx finca.kmz --days 30 --max-cloud 20 -s

# Un bbox rápido, solo radar
gx -b -3.8,40.35,-3.6,40.5 -c s1-grd

# Exportar AOI + huellas de escenas para abrir en QGIS
gx lotes.zip -o output/lotes.geojson
```

---

## Modo guiado

En una terminal interactiva y sin `-y`, `geoaltia` pregunta lo que no le hayas
pasado por flags: archivo del AOI, colecciones, periodo (30/90/180/365 días o
fechas concretas) y nubosidad máxima. Muestra el resumen del AOI y de la
búsqueda y pide confirmación antes de consultar el catálogo.

```bash
geoaltia                      # pregunta todo
geoaltia zona.geojson -c s1-grd  # solo pregunta el periodo
geoaltia zona.geojson -y      # sin preguntas: flags + valores por defecto
```

Con `-f json` / `-f geojson` sin `-o`, o cuando stdin/stdout no son una
terminal, nunca se pregunta nada.

---

## Formatos de área de interés

| Entrada | Cómo | CRS |
| --- | --- | --- |
| GeoJSON | `zona.geojson`, `zona.json` | EPSG:4326, o el miembro `crs` heredado (pre RFC 7946) |
| KML | `finca.kml` | Siempre WGS 84 |
| KMZ | `finca.kmz` (se lee `doc.kml` o el primer `.kml`) | Siempre WGS 84 |
| Shapefile | `lotes.shp` (+ `.dbf`, `.prj`, `.cpg` al lado) o `lotes.zip` | Leído del `.prj` |
| WKT / EWKT | `--wkt 'POLYGON((...))'`, `SRID=25830;POLYGON(...)` o archivo `.wkt` | EPSG:4326 o el `SRID` |
| BBox | `--bbox minx,miny,maxx,maxy` | EPSG:4326 o `--crs` |
| stdin | `cat zona.geojson \| geoaltia -` | Detecta GeoJSON, KML o WKT |

- Solo cuentan los **polígonos y multipolígonos**. Puntos y líneas se ignoran y
  se indica cuántos había.
- Varias features se combinan en un único multipolígono para la búsqueda.
- Si el AOI tiene más de 1000 vértices se busca por su envolvente (bbox), pero
  la cobertura de cada escena se sigue calculando con la geometría real.

---

## Sistemas de referencia (CRS)

Todo el cálculo se hace en **EPSG:4326**; superficie y perímetro son geodésicos
(sobre una esfera de radio medio terrestre, con una desviación típica inferior
al 0,5 % frente al elipsoide), así que no dependen de la proyección de entrada.
Son valores descriptivos para dimensionar el AOI, no una medición catastral.

El CRS de origen se toma, por orden de prioridad, de `--crs`, del `.prj` /
`SRID` / miembro `crs` del archivo, o se asume EPSG:4326. `--crs` acepta:

- Códigos EPSG en cualquier forma habitual: `EPSG:25830`, `25830`,
  `urn:ogc:def:crs:EPSG::25830`, `http://www.opengis.net/def/crs/EPSG/0/25830`.
- Reconocidos sin definición extra: 4326, 4258, 4269, 4674, 3857, WGS 84 / UTM
  (326xx, 327xx), ETRS89 / UTM (25828–25838), ED50 / UTM (23028–23038) y
  SIRGAS 2000 / UTM (31965–31985).
- Cualquier otro CRS como cadena proj4 (`+proj=lcc ...`) o WKT.

Si las coordenadas no parecen grados y no se indicó CRS, `geoaltia` se detiene y
sugiere `--crs` en lugar de buscar en el lugar equivocado del planeta.

El informe también sugiere la **zona UTM** (WGS 84) del centroide, útil como
CRS métrico de trabajo.

---

## Referencia de comandos

```text
geoaltia [scan] [aoi] [opciones]   AOI + búsqueda + informe (comando por defecto)
geoaltia aoi [aoi] [opciones]      Solo métricas del AOI, sin red
geoaltia collections [-f json]     Colecciones soportadas
```

### Área de interés

| Flag | Descripción |
| --- | --- |
| `[aoi]` | Archivo del AOI, o `-` para stdin |
| `-b, --bbox <minx,miny,maxx,maxy>` | Rectángulo |
| `-w, --wkt <wkt>` | Geometría WKT o EWKT |
| `--crs <crs>` | CRS de las coordenadas de entrada (prioridad sobre `.prj`) |

### Búsqueda

| Flag | Por defecto | Descripción |
| --- | --- | --- |
| `-c, --collections <lista>` | `s2-l2a,s1-grd` | Alias separados por comas |
| `--from <AAAA-MM-DD>` | hace 90 días | Inicio del periodo (incluido) |
| `--to <AAAA-MM-DD>` | hoy | Fin del periodo (incluido) |
| `--days <n>` | `90` | Últimos *n* días hasta `--to` |
| `--max-cloud <0-100>` | sin límite | Nubosidad máxima (solo ópticas) |
| `--max-items <n>` | `500` | Máximo de escenas por colección |
| `--timeout <s>` | `60` | Timeout por petición |

### Salida

| Flag | Descripción |
| --- | --- |
| `-f, --format <table\|json\|geojson>` | Formato. Sin `-o`, JSON/GeoJSON van a stdout sin nada más |
| `-o, --output <archivo>` | Guarda el resultado; formato deducido de `.json` / `.geojson` |
| `-s, --scenes` | Lista las escenas de cada colección |
| `--limit <n>` | Escenas listadas por colección (por defecto 20) |
| `-y, --yes` | Sin preguntas |
| `--no-color` | Sin colores (también respeta `NO_COLOR`) |
| `-v, --version` / `-h, --help` | Versión / ayuda |

### Códigos de salida

| Código | Significado |
| --- | --- |
| `0` | Todo bien (aunque no haya escenas) |
| `1` | Error de entrada, de red, alguna colección falló, o `aoi` con geometría inválida |
| `130` | Cancelado con Ctrl+C |

---

## Colecciones

| Alias | Colección STAC | Tipo | Resolución | Filtro de nubes |
| --- | --- | --- | --- | --- |
| `s2-l2a` | `sentinel-2-l2a` | Óptico, reflectancia de superficie (BOA) | 10 / 20 / 60 m | Sí |
| `s2-l1c` | `sentinel-2-l1c` | Óptico, reflectancia TOA | 10 / 20 / 60 m | Sí |
| `s1-grd` | `sentinel-1-grd` | Radar SAR banda C, GRD | 10 m (IW) | No aplica |

Catálogo: `https://stac.dataspace.copernicus.eu/v1`. La búsqueda es pública;
solo la descarga de productos requiere cuenta en Copernicus.

---

## Cómo leer el informe

1. **Área de interés**: superficie (km² y ha), perímetro, geometría, CRS de
   origen y de dónde se obtuvo, zona UTM sugerida, bbox, centroide y validez.
2. **Búsqueda**: catálogo, colecciones, periodo, filtros.
3. **Tabla de colecciones**: escenas (`500+` si se alcanzó `--max-items`), días
   distintos con adquisición, primera y última fecha, nubosidad y cobertura del
   AOI como mín / media / máx.
4. **Detalle por colección**: escenas que cubren ≥ 99 % del AOI, plataformas,
   tipo de producto, tiles MGRS (S2), órbitas relativas y dirección, modo y
   polarización (S1), CRS de los rásteres, versión de procesado, volumen total
   de los productos y bandas con sus resoluciones según el catálogo.
5. **Escenas** (`-s`): fecha UTC, plataforma, tile u órbita, nubes o
   polarización, cobertura e identificador completo.

Colores: nubes verde ≤ 10 %, amarillo ≤ 40 %, rojo por encima; cobertura verde
≥ 99 %, amarillo ≥ 50 %, rojo por debajo.

---

## Exportación JSON y GeoJSON

### JSON (`-o informe.json` o `-f json`)

El objeto `DiscoveryReport` completo:

```jsonc
{
  "generator": { "name": "@geoaltia/cli", "version": "0.1.0" },
  "generatedAt": "2026-09-13T10:00:00.000Z",
  "provider": { "id": "cdse", "name": "Copernicus Data Space Ecosystem", "url": "…" },
  "aoi": {
    "source": { "kind": "shapefile", "path": "/…/lotes.zip", "label": "lotes.zip" },
    "crs": { "code": "EPSG:25830", "name": "ETRS89 / UTM zone 30N", "origin": "prj", "reprojected": true },
    "metrics": { "areaM2": 7602800, "perimeterM": 10320, "bbox": [ … ], "utmZone": { "epsg": "EPSG:32630", … }, "valid": true, "issues": [] },
    "searchGeometry": "aoi",
    "geometry": { "type": "Polygon", "coordinates": [ … ] }
  },
  "search": { "collections": ["s2-l2a", "s1-grd"], "from": "2026-06-16", "to": "2026-09-13", "maxCloud": 20, … },
  "collections": [
    {
      "alias": "s2-l2a", "sceneCount": 35, "truncated": false,
      "firstDate": "2026-06-16", "lastDate": "2026-09-12", "acquisitionDates": [ … ],
      "cloudCover": { "min": 0, "mean": 1.2, "max": 9.1 },
      "aoiCoverage": { "min": 1, "mean": 1, "max": 1 },
      "platforms": [ … ], "tiles": ["30TVK"], "relativeOrbits": [94, 137], "bands": [ … ],
      "scenes": [ { "id": "S2C_MSIL2A_…", "datetime": "…", "cloudCover": 0, "aoiCoverage": 1, "bbox": [ … ], … } ]
    }
  ],
  "totals": { "scenes": 81, "collectionsWithData": 2, "durationMs": 1300 }
}
```

Las huellas de las escenas no se incluyen en JSON para mantenerlo ligero (cada
escena conserva su `bbox`).

### GeoJSON (`-o informe.geojson` o `-f geojson`)

Un `FeatureCollection` en EPSG:4326 con:

- **La primera feature**: el AOI, `role: "aoi"`, con `area_m2`, `area_ha`,
  `area_km2`, `perimeter_m`, `source_crs`, `utm_epsg`, `valid`…
- **Una feature por escena**: la huella, `role: "scene"`, con `id`,
  `collection`, `date`, `platform`, `cloud_cover`, `tile`, `relative_orbit`,
  `orbit_state`, `polarizations`, `aoi_coverage`, `product_bytes`…

Las propiedades son escalares (las listas van unidas por comas) para que QGIS,
ArcGIS u `ogr2ogr` las lean sin problemas. Los parámetros de la búsqueda van en
el miembro extra `metadata`.

---

## Recetas

```bash
# ¿Cuántas escenas despejadas hay este verano?
gx parcela.geojson --from 2026-06-01 --to 2026-08-31 --max-cloud 10 -c s2-l2a

# Solo la superficie y el CRS de un Shapefile
gx aoi recintos.zip

# Superficie en hectáreas desde un script
gx aoi parcela.kml -f json | jq '.metrics.areaM2 / 10000'

# Fechas con Sentinel-1 disponibles, una por línea
gx zona.geojson -c s1-grd -f json | jq -r '.collections[0].acquisitionDates[]'

# Coordenadas en ETRS89 / UTM 30N
gx -b 439000,4473000,441000,4475000 --crs EPSG:25830

# Huellas a GeoPackage
gx zona.geojson -f geojson | ogr2ogr output/escenas.gpkg /vsistdin/
```

---

## API programática

Todo lo que hace la CLI está disponible desde código:

```ts
import { writeFile } from "node:fs/promises";

import { discoverArea, toGeoJson } from "@geoaltia/cli";

const report = await discoverArea(
  { file: "parcela.geojson" }, // o { bbox: "…" }, { wkt: "…", crs: "EPSG:25830" }
  {
    collections: ["s2-l2a", "s1-grd"],
    from: "2026-06-01",
    to: "2026-08-31",
    maxCloud: 30,
    maxItems: 500,
    timeoutMs: 60_000,
  },
  {
    onCollectionDone: (summary) => console.log(summary.alias, summary.sceneCount),
  },
);

console.log(report.aoi.metrics.areaM2, report.totals.scenes);
await writeFile("informe.geojson", toGeoJson(report));
```

Otras exportaciones útiles: `loadAoi`, `computeAoiMetrics`, `resolveCrs`,
`searchStac`, `buildSearchBody`, `normalizeItem`, `summarizeCollection`,
`toJson`, `COLLECTIONS`, `COPERNICUS_CDSE` y todos los tipos (`DiscoveryReport`,
`CollectionSummary`, `SceneSummary`, `AoiMetrics`…). El paquete se publica en
ESM y CJS con tipos.

---

## Requisitos

- Node.js 20 o superior (usa `fetch` nativo).
- Conexión a internet para `scan` (`aoi` y `collections` funcionan sin red).

---

## Desarrollo

```bash
pnpm install        # instala el workspace
pnpm build          # empaqueta src/ en dist/ (ESM + CJS + tipos)
pnpm dev            # tsdown en modo watch
pnpm typecheck      # tsc --noEmit
pnpm lint           # eslint
pnpm test           # vitest (sin red: el catálogo se simula)
pnpm sample         # ejecuta samples/index.ts contra la librería
pnpm publish:check  # simulación del paquete publicado
```

Probar la CLI local sin publicar:

```bash
pnpm build
pnpm link --global
geoaltia --help
```

### Estructura

```text
src/
├─ cli.ts               # binario: comandos, flags y flujo de ejecución
├─ index.ts             # API pública
├─ prompts.ts           # modo guiado (@clack/prompts)
├─ types.ts             # tipos compartidos
├─ core/
│  ├─ aoi/
│  │  ├─ load.ts        # detección de formato, CRS y normalización del AOI
│  │  ├─ geojson.ts     # GeoJSON → polígonos
│  │  ├─ wkt.ts         # lector WKT/EWKT
│  │  ├─ bbox.ts        # bbox ↔ polígono
│  │  ├─ kml.ts         # KML y KMZ
│  │  ├─ shapefile.ts   # .shp suelto y .zip
│  │  ├─ crs.ts         # resolución de CRS, reproyección, zona UTM
│  │  └─ metrics.ts     # superficie, perímetro, validez…
│  ├─ stac/
│  │  ├─ providers/     # catálogos STAC (Copernicus CDSE)
│  │  ├─ collections.ts # alias y metadatos de colecciones
│  │  ├─ client.ts      # búsqueda con paginación, timeout y reintentos
│  │  ├─ normalize.ts   # item STAC → SceneSummary, bandas
│  │  └─ summarize.ts   # agregados por colección
│  ├─ discover.ts       # orquestación: AOI → búsqueda → informe
│  └─ export.ts         # JSON y GeoJSON
└─ ui/
   ├─ theme.ts          # colores e iconos
   ├─ format.ts         # números, áreas, fechas, anchos ANSI
   ├─ table.ts          # tablas y paneles
   ├─ progress.ts       # spinner (en stderr)
   ├─ banner.ts         # cabecera
   ├─ help.ts           # pantalla --help
   └─ report.ts         # paneles y tablas del informe
```

### Seguridad de la cadena de suministro

El workspace de pnpm fija `minimumReleaseAge: 10080` (7 días): una versión de
una dependencia tiene que llevar una semana publicada antes de poder instalarse.
Las versiones se guardan exactas (`save-exact`).

---

## Publicación

CI ejecuta lint, typecheck, tests y build en cada push y pull request.

Publicar es automático: un push a `main` lanza el workflow **Release**, que
verifica el paquete, lee la versión de `package.json` y lo publica en npm con
[provenance](https://docs.npmjs.com/generating-provenance-statements) mediante
OIDC. Si esa versión ya existe en npm, se omite, así que publicar es solo subir
la versión:

```bash
pnpm version patch   # o minor / major
git push
```

---

## Licencia

[MIT](./LICENSE) © Geoaltia
