"""Baut die Geodaten für public/data aus Daten des BKG (GeoBasis-DE), außerhalb Deutschlands aus dem
Copernicus-Höhenmodell und Natural Earth.

Rohdaten (nicht im Repo, Pfad über RAW, Standard ./raw; Dateien werden rekursiv gesucht):
  DE_VG250.gpkg                       VG250-EW, Stand 31.12.2024: Grenzen, Katasterflächen, Einwohner
  dlm250_ebenen/*.shp                 DLM250: Gewässer, Wald
  dgm200_utm32s.tif                   DGM200: Höhen im 200-m-Raster
  Copernicus_DSM_COG_30_*.tif         Copernicus DEM GLO-90, Kacheln N46-N55 / E005-E015 (Höhen und Küste außerhalb Deutschlands;
                                      das Meer hat dort den Wert 0, fehlende Kacheln sind offenes Meer)
  ne_10m_lakes.shp, ne_10m_lakes_europe.shp   Natural Earth (Seen der Nachbarländer)
tools/places.json: Wahrzeichen, höchste Punkte, Gipfel und Seen in UTM32 (EPSG:25832).

Ausgabe in public/data:
  hgt.bin     Höhenraster 600 m, zigzag-Delta, int16 zerlegt, gzip
  relief.jpg  Schummerung (R = Licht, auf Wasser Uferabstand)
  mask.png    R = Landesnummer * 9, G = Wald, B = Wasser
  geo.json    Raster, Länder, Linien, Beschriftungen
"""
import glob, gzip, json, math, os, sys, warnings
import numpy as np
import geopandas as gpd
import rasterio
from rasterio import features
from rasterio.enums import Resampling
from rasterio.transform import from_origin
from rasterio.warp import reproject
from PIL import Image
from scipy import ndimage
from shapely.geometry import box, shape, Point, LineString, MultiLineString
from shapely.ops import unary_union, linemerge
from skimage.morphology import skeletonize

warnings.filterwarnings('ignore')
RAW = os.environ.get('RAW', 'raw')
OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'data')
os.makedirs(OUT, exist_ok=True)
CRS = 'EPSG:25832'


def find(pattern):
    hits = sorted(glob.glob(os.path.join(RAW, '**', pattern), recursive=True))
    if not hits:
        sys.exit('fehlt in RAW: ' + pattern)
    return hits


VG = find('DE_VG250.gpkg')[0]
DLM = os.path.dirname(find('gew01_f.shp')[0])
DGM = find('dgm200_utm32s.tif')[0]
COP = find('Copernicus_DSM_COG_30_*_DEM.tif')
NE = find('ne_10m_lakes.shp') + find('ne_10m_lakes_europe.shp')

# Raster in UTM 32N, 10 km Rand um Deutschland
E0, E1, N0, N1, STEP = 270000, 930000, 5226000, 6108000, 600
NX, NY = (E1 - E0) // STEP + 1, (N1 - N0) // STEP + 1
TH = 4096
TW = round(TH * (E1 - E0) / (N1 - N0))
PX = (E1 - E0) / TW  # Texturpixel in Metern
T = from_origin(E0, N1, PX, PX)
BBOX = box(E0, N0, E1, N1)

CODES = ['SH', 'HH', 'NI', 'HB', 'NW', 'HE', 'RP', 'BW', 'BY', 'SL', 'BE', 'BB', 'MV', 'SN', 'ST', 'TH']  # Reihenfolge der Landesschlüssel 01-16
REGION = {'SH': 'norden', 'HH': 'norden', 'HB': 'norden', 'NI': 'norden', 'MV': 'nordosten', 'BE': 'nordosten', 'BB': 'nordosten',
          'ST': 'mitte', 'TH': 'mitte', 'SN': 'mitte', 'NW': 'westen', 'HE': 'rhein', 'RP': 'rhein', 'SL': 'rhein', 'BW': 'sueden', 'BY': 'sueden'}


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def shp(name, columns=None):
    d = gpd.read_file(os.path.join(DLM, name + '.shp'), columns=columns)
    d['geometry'] = d.geometry.force_2d()
    return d


# ---------------------------------------------------------------- Höhen
def read_dem(transform, w, h, res_dgm, res_cop):
    """DGM200 in Deutschland, Copernicus GLO-90 außerhalb, über 2 km weich überblendet; offenes Meer 0 m."""
    cache = os.path.join(RAW, 'dem_%d_%d.npy' % (w, h))
    if os.path.exists(cache):
        return np.load(cache)
    dg = np.full((h, w), np.nan, np.float32)
    with rasterio.open(DGM) as s:
        reproject(rasterio.band(s, 1), dg, src_nodata=s.nodata, dst_transform=transform, dst_crs=CRS, dst_nodata=np.nan, resampling=res_dgm)
    cp = np.full((h, w), np.nan, np.float32)
    for f in COP:
        with rasterio.open(f) as s:
            reproject(rasterio.band(s, 1), cp, dst_transform=transform, dst_crs=CRS, dst_nodata=np.nan, init_dest_nodata=False, resampling=res_cop)
    cp = np.where(np.isnan(cp), 0, cp)  # fehlende Kacheln: offenes Meer
    ok = ~np.isnan(dg)
    px = abs(transform.a)
    alpha = np.clip(ndimage.distance_transform_edt(ok) * px / 2000, 0, 1).astype(np.float32)
    a = np.where(ok, alpha * np.nan_to_num(dg) + (1 - alpha) * cp, cp).astype(np.float32)
    np.save(cache, a)
    return a


# ---------------------------------------------------------------- Vektoren
log('Vektoren')
lan = gpd.read_file(VG, layer='vg250_lan')
lan['geometry'] = lan.geometry.force_2d()
land4 = lan[lan.GF == 4].copy()
land4['nr'] = land4.SN_L.astype(int)
lander = land4.dissolve(by='nr', aggfunc='first').reset_index()
sta = gpd.read_file(VG, layer='vg250_sta')
sta['geometry'] = sta.geometry.force_2d()
de_land = sta[(sta.GF == 4)].geometry.union_all()
de_terr = sta[sta.LKZ == 'DE'].geometry.union_all()  # mit Küstengewässern und deutschem Teil des Bodensees
bodensee = sta[sta.GEN.str.contains('Bodensee')].geometry.union_all()

gem = gpd.read_file(VG, layer='vg250_gem', ignore_geometry=True)
gem = gem[(gem.GF == 4) & (gem.BEZ != 'Gemeindefreies Gebiet')]
ngem = gem.groupby('SN_L').ARS.nunique().to_dict()
krs = gpd.read_file(VG, layer='vg250_krs', ignore_geometry=True)
nkrs = krs[krs.GF == 4].groupby('SN_L').ARS.nunique().to_dict()



def cop_sea():
    """Meer außerhalb Deutschlands aus Copernicus GLO-90: zusammenhängende Flächen mit Höhe 0 (oder ohne Kachel), ab 50 km²."""
    cp = np.full((TH, TW), np.nan, np.float32)
    for f in COP:
        with rasterio.open(f) as s:
            reproject(rasterio.band(s, 1), cp, dst_transform=T, dst_crs=CRS, dst_nodata=np.nan, init_dest_nodata=False, resampling=Resampling.nearest)
    sea = np.isnan(cp) | (cp == 0)
    lab, n = ndimage.label(sea, structure=np.ones((3, 3)))
    size = ndimage.sum(sea, lab, index=np.arange(1, n + 1)) * PX * PX
    keep = np.zeros(n + 1, bool)
    keep[1:] = size > 50e6
    sea = keep[lab]
    land = ndimage.binary_opening(~sea, iterations=1)
    polys = [shape(g) for g, v in features.shapes(land.astype(np.uint8), mask=land, transform=T) if v == 1]
    return unary_union(polys)


land_out = cop_sea()
land_all = unary_union([land_out.difference(de_terr.buffer(50)), de_land]).intersection(BBOX)

gw = shp('gew01_f', ['OBJART_TXT', 'NAM'])
lakes = gw[gw.OBJART_TXT.isin(['AX_StehendesGewaesser', 'AX_Hafenbecken'])]
rivers_f = gw[gw.OBJART_TXT == 'AX_Fliessgewaesser']
meer = gw[gw.OBJART_TXT == 'AX_Meer']
BBOX_4326 = tuple(gpd.GeoSeries([BBOX.buffer(20000)], crs=CRS).to_crs('EPSG:4326').total_bounds)
ne = unary_union([gpd.read_file(f, bbox=BBOX_4326).to_crs(CRS).geometry.make_valid().union_all() for f in NE]).intersection(BBOX)
ne = gpd.GeoDataFrame(geometry=[g for g in getattr(ne, 'geoms', [ne]) if g.geom_type == 'Polygon'], crs=CRS)
ne_out = ne.geometry.union_all().difference(de_terr)
forest = shp('veg02_f', ['OBJART_TXT'])


def raster(geoms, value=1):
    geoms = [g for g in geoms if g is not None and not g.is_empty]
    if not geoms:
        return np.zeros((TH, TW), np.uint8)
    return features.rasterize(((g, value) for g in geoms), out_shape=(TH, TW), transform=T, all_touched=False, dtype=np.uint8)


# ---------------------------------------------------------------- Maske
log('Maske', TW, TH, round(PX, 2))
ids = np.zeros((TH, TW), np.uint8)
for _, k in lander.iterrows():
    ids = np.maximum(ids, raster([k.geometry], int(k.nr)))
landpx = raster([land_all])
water = np.maximum.reduce([1 - landpx, raster(lakes.geometry.values), raster(rivers_f.geometry.values), raster(meer.geometry.values),
                           raster([ne_out]), raster([bodensee])])
wood = raster(forest.geometry.values)
mask = np.dstack([ids * 9, wood * 255, water * 255]).astype(np.uint8)
Image.fromarray(mask, 'RGB').save(os.path.join(OUT, 'mask.png'), optimize=True)

# ---------------------------------------------------------------- Höhenraster
log('Höhenraster', NX, NY)
hT = from_origin(E0 - STEP / 2, N1 + STEP / 2, STEP, STEP)
H = read_dem(hT, NX, NY, Resampling.average, Resampling.average)  # Zeile 0 = Norden
sea_g = features.rasterize([(land_all, 1)], out_shape=(NY, NX), transform=hT, all_touched=True, dtype=np.uint8) == 0
H = np.where(sea_g, 0, H)
q = np.round(H * 2).astype(np.int64)
pred = np.zeros_like(q)
pred[0, 1:] = q[0, :-1]
pred[1:, 0] = q[:-1, 0]
pred[1:, 1:] = q[1:, :-1] + q[:-1, 1:] - q[:-1, :-1]
r = (q - pred).ravel()
zz = ((r << 1) ^ (r >> 63)).astype(np.uint64)
assert zz.max() < 65536
zz = zz.astype(np.uint16)
blob = np.concatenate([(zz & 255).astype(np.uint8), (zz >> 8).astype(np.uint8)]).tobytes()
open(os.path.join(OUT, 'hgt.bin'), 'wb').write(gzip.compress(blob, 9, mtime=0))
log('Höhen', float(H.min()), float(H.max()))

# ---------------------------------------------------------------- Schummerung
log('Schummerung')
Ht = read_dem(T, TW, TH, Resampling.bilinear, Resampling.average)
Ht = np.where(water > 0, np.minimum(Ht, ndimage.grey_erosion(Ht, size=3)), Ht)
gy, gx = np.gradient(Ht * 3.2, PX)  # gy: nach Süden (Zeilen), gx: nach Osten


def lambert(az, alt):
    az, alt = math.radians(az), math.radians(alt)
    lx, ly, lz = math.sin(az) * math.cos(alt), math.cos(az) * math.cos(alt), math.sin(alt)
    nx_, ny_, nz_ = -gx, gy, np.ones_like(gx)  # ny: Norden positiv
    n = np.sqrt(nx_ ** 2 + ny_ ** 2 + 1)
    return np.clip((nx_ * lx + ny_ * ly + nz_ * lz) / n, 0, 1)


L = 0.62 * lambert(315, 42) + 0.22 * lambert(270, 55) + 0.16 * lambert(350, 60)
flat = 0.62 * math.sin(math.radians(42)) + 0.22 * math.sin(math.radians(55)) + 0.16 * math.sin(math.radians(60))
rel = np.clip(0.69 * L / flat, 0, 1)
dist = ndimage.distance_transform_edt(water) * PX
depth = 175 * (1 - np.exp(-dist / 3000))
rel = np.where(water > 0, 1 - depth / 230, rel)
Image.fromarray(np.round(rel * 255).astype(np.uint8), 'L').save(os.path.join(OUT, 'relief.jpg'), quality=80, optimize=True)


# ---------------------------------------------------------------- Linien
log('Linien')


def enc(geom, tol, min_len=0):
    """Linien als flache Integer-Arrays relativ zu E0/N0."""
    g = geom.simplify(tol, preserve_topology=False)
    out = []
    for p in getattr(g, 'geoms', [g]):
        if p.is_empty:
            continue
        if p.geom_type == 'Polygon':
            rings = [p.exterior] + list(p.interiors)
        elif p.geom_type in ('LineString', 'LinearRing'):
            rings = [p]
        else:
            continue
        for ring in rings:
            if ring.length < min_len:
                continue
            cs = np.round(np.asarray(ring.coords)[:, :2] - [E0, N0]).astype(int)
            if len(cs) >= 2:
                out.append(cs.ravel().tolist())
    return out


def merged(geoms):
    g = unary_union(list(geoms))
    return linemerge(g) if g.geom_type == 'MultiLineString' else g


li = gpd.read_file(VG, layer='vg250_li')
li['geometry'] = li.geometry.force_2d()
nat = enc(merged(li[(li.AGZ == 1) & (li.GMK == 0)].geometry), 100)
land_lines = enc(merged(li[(li.AGZ == 2) & (li.GMK == 0)].geometry), 130)

# Küste: Deutschland aus VG250, Nachbarländer aus der Copernicus-Landmaske; dazu Ufer der großen Seen
coast_de = merged(li[li.AGZ == 9].geometry)
coast_out = land_out.boundary.intersection(BBOX.buffer(-2 * PX)).difference(de_terr.buffer(300))
big_lakes = list(lakes[lakes.geometry.area > 8e6].geometry) + [g for g in ne.geometry if g.area > 8e6 and not g.within(de_terr)] + [bodensee]
lake_shore = unary_union(big_lakes).boundary.intersection(BBOX)
shore = enc(unary_union([coast_de, coast_out, lake_shore]), 70, 3000)

RIVERS = ['Rhein', 'Donau', 'Elbe', 'Weser', 'Main', 'Mosel', 'Neckar', 'Ems', 'Oder', 'Lausitzer Neiße', 'Saale', 'Spree', 'Havel',
          'Isar', 'Inn', 'Lech', 'Iller', 'Fulda', 'Werra', 'Lahn', 'Ruhr', 'Lippe', 'Aller', 'Leine', 'Mulde', 'Vereinigte Mulde',
          'Weiße Elster', 'Naab', 'Regen', 'Altmühl', 'Saar', 'Nahe', 'Sieg', 'Unstrut', 'Peene', 'Warnow', 'Eider', 'Trave', 'Elde',
          'Hase', 'Hunte', 'Wertach', 'Salzach', 'Jagst', 'Kocher', 'Tauber', 'Fränkische Saale', 'Regnitz', 'Schwarze Elster', 'Bode',
          'Oker', 'Eder', 'Ilm', 'Ilmenau', 'Uecker', 'Wümme', 'Erft', 'Rur', 'Wupper', 'Diemel', 'Ammer', 'Loisach', 'Alz', 'Vils',
          'Mangfall', 'Wutach', 'Kinzig', 'Our', 'Sauer']
ax = shp('gew01_l', ['NAM'])
ax = ax[ax.NAM.isin(RIVERS)]
log('Flüsse als Achse', len(ax), 'fehlen', sorted(set(RIVERS) - set(ax.NAM)))


def centerline(polys, res=40):
    """Mittellinie breiter Flussabschnitte (DLM250 führt sie als Fläche ohne Achse) durch Skelettierung."""
    g = unary_union(list(polys))
    if g.is_empty:
        return []
    out = []
    for part in getattr(g, 'geoms', [g]):
        x0, y0, x1, y1 = part.bounds
        w, h = int((x1 - x0) / res) + 3, int((y1 - y0) / res) + 3
        tr = from_origin(x0 - res, y1 + res, res, res)
        m = features.rasterize([(part, 1)], out_shape=(h, w), transform=tr, dtype=np.uint8)
        sk = skeletonize(m > 0)
        jj, ii = np.nonzero(sk)
        if len(jj) < 3:
            continue
        on = set(zip(jj.tolist(), ii.tolist()))
        segs = []
        for (j, i) in on:
            for dj, di in ((0, 1), (1, 0), (1, 1), (1, -1)):
                if (j + dj, i + di) in on:
                    segs.append(LineString([tr * (i + .5, j + .5), tr * (i + di + .5, j + dj + .5)]))
        ml = linemerge(MultiLineString(segs))
        out += [l for l in getattr(ml, 'geoms', [ml]) if l.length > 400]
    return out


wide = rivers_f[rivers_f.NAM.isin(RIVERS)]
cl = centerline(wide.geometry.values)
log('Mittellinien', len(cl), 'aus', len(wide), 'Flächen', sorted(set(wide.NAM)))
water_geo = unary_union(big_lakes + list(meer.geometry) + [g for g in ne.geometry if g.area > 2e6])
riv_g = unary_union(list(ax.geometry) + cl).difference(water_geo.buffer(40)).intersection(BBOX)
rivers = enc(merged(getattr(riv_g, 'geoms', [riv_g])), 150, 1500)

# je Land: Umriss für die Auswahl (ohne Inseln unter 4 km²)
rings = {}
for _, k in lander.iterrows():
    parts = [p for p in getattr(k.geometry, 'geoms', [k.geometry]) if p.area > 4e6]
    rings[CODES[int(k.nr) - 1]] = enc(unary_union(parts).boundary, 160)

# ---------------------------------------------------------------- Orte
pp = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'places.json')
src = json.load(open(pp)) if os.path.exists(pp) else {}
lidx = lander.set_index('nr')


def land_at(e, n):
    pt = Point(e, n)
    for nr, k in lidx.iterrows():
        if k.geometry.contains(pt):
            return CODES[int(nr) - 1]
    return None


highest = src.get('highest', {})

# ---------------------------------------------------------------- Länder
log('Länder')
laender = []
for _, k in lander.iterrows():
    nr = int(k.nr)
    code = CODES[nr - 1]
    geom = k.geometry
    big_part = max(getattr(geom, 'geoms', [geom]), key=lambda g: g.area)
    dm = raster([big_part])
    dt = ndimage.distance_transform_edt(dm)
    j, i = np.unravel_index(np.argmax(dt), dt.shape)
    hi = highest.get(code, {})
    laender.append({
        'id': nr, 'code': code, 'name': k.GEN, 'bez': k.BEZ,
        'km2': round(float(k.KFL), 2), 'pop': int(k.EWZ), 'gem': int(ngem.get(k.SN_L, 0)), 'krs': int(nkrs.get(k.SN_L, 0)),
        'hmax': hi.get('h'), 'hname': hi.get('name'), 'top': [hi['E'], hi['N']] if 'E' in hi else None,
        'at': [round(E0 + (i + .5) * PX), round(N1 - (j + .5) * PX)],
        'bb': [round(b) for b in unary_union([p for p in getattr(geom, 'geoms', [geom]) if p.area > 0.1 * big_part.area]).bounds],
    })
laender.sort(key=lambda c: c['id'])
for c in laender:
    log(c['code'], c['name'], c['km2'], c['pop'], c['gem'], c['krs'], c['hname'], c['hmax'])
de = {'km2': round(sum(c['km2'] for c in laender), 1), 'pop': sum(c['pop'] for c in laender), 'gem': sum(c['gem'] for c in laender),
      'krs': sum(c['krs'] for c in laender), 'hmax': max((c['hmax'] or 0) for c in laender)}
log('DE', de)

places = {}
if src:
    places['marks'] = {code: [{'name': m['name'], 'E': m['E'], 'N': m['N']} for m in ms] for code, ms in src.get('landmarks', {}).items()}
    for code, ms in src.get('landmarks', {}).items():
        for m in ms:
            if land_at(m['E'], m['N']) != code:
                log('WARNUNG Wahrzeichen außerhalb', code, m['name'], land_at(m['E'], m['N']))
    places['peaks'] = []
    for p in src.get('peaks', []):
        code = land_at(p['E'], p['N']) or p.get('land')
        places['peaks'].append({'name': p['name'], 'E': p['E'], 'N': p['N'], 'h': p['h'],
                                'regions': sorted(set(([REGION[code]] if code else []) + p.get('regions', []))), 'big': bool(p.get('big'))})
    places['lakes'] = []
    for p in src.get('lakes', []):
        code = land_at(p['E'], p['N']) or p.get('land')
        places['lakes'].append({'name': p['name'], 'E': p['E'], 'N': p['N'], 'sea': bool(p.get('sea')),
                                'regions': sorted(set(([REGION[code]] if code else []) + p.get('regions', []))), 'big': bool(p.get('big'))})
    log('Orte', {k: len(v) for k, v in places.items()})

geo = {
    'grid': {'E0': E0, 'E1': E1, 'N0': N0, 'N1': N1, 'nx': NX, 'ny': NY, 'step': STEP},
    'tex': [TW, TH], 'de': de, 'laender': laender,
    'lines': {'nation': nat, 'land': land_lines, 'shore': shore, 'rivers': rivers},
    'rings': rings,
    'places': places,
}
json.dump(geo, open(os.path.join(OUT, 'geo.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
for f in sorted(os.listdir(OUT)):
    p = os.path.join(OUT, f)
    if os.path.isfile(p):
        log(f, os.path.getsize(p))
log('Linien', {k: (len(v), sum(len(x) for x in v) // 2) for k, v in geo['lines'].items()})
