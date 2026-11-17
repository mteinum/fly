import numpy as np

from flypipe import terrain
from flypipe.grid import GridSpec


def test_grid_axes():
    g = GridSpec(west=1000, north=9000, cell=50, width=4, height=4)
    assert g.utm_to_grid(1000, 9000) == (0, 0)  # nordvest-hjørnet
    assert g.utm_to_grid(1050, 9000) == (1, 0)  # øst -> x øker
    assert g.utm_to_grid(1000, 8950) == (0, 1)  # sør -> y øker
    assert g.grid_to_utm(*g.utm_to_grid(1234.5, 8876.5)) == (1234.5, 8876.5)
    assert (g.east, g.south) == (1200, 8800)
    assert g.transform @ (0, 0) == (1000, 9000)


def test_grid_centered_snaps_to_cells():
    g = GridSpec.centered(94051.25, 6472303.86, 50, 512)
    assert g.west % 50 == 0 and g.north % 50 == 0
    x, y = g.utm_to_grid(94051.25, 6472303.86)
    assert abs(x - 256) < 0.5 and abs(y - 256) < 0.5


def test_block_mean():
    src = np.arange(16, dtype=np.float32).reshape(4, 4)
    out = terrain.block_mean(src, 2)
    assert out.tolist() == [[2.5, 4.5], [10.5, 12.5]]
    assert out.dtype == np.float32


def _ramp(direction: str) -> np.ndarray:
    """Plan med stigning 0.5 der flaten vender mot `direction` (faller den veien)."""
    rows, cols = np.mgrid[0:16, 0:16].astype(np.float64)
    z = {"S": -rows, "N": rows, "E": -cols, "W": cols}[direction]  # rad øker mot sør
    return (z - z.min()) * 25.0  # 25 m per 50 m-celle


def test_hillshade_sun_direction():
    kw = dict(cell=50.0, sun_elevation_deg=28.0, levels=1000)
    # Sol i sør: sørvendt li er lysere enn nordvendt
    assert terrain.hillshade(_ramp("S"), sun_azimuth_grid_deg=180, **kw)[8, 8] > terrain.hillshade(_ramp("N"), sun_azimuth_grid_deg=180, **kw)[8, 8]
    # Sol i vest: vestvendt li er lysere enn østvendt
    assert terrain.hillshade(_ramp("W"), sun_azimuth_grid_deg=270, **kw)[8, 8] > terrain.hillshade(_ramp("E"), sun_azimuth_grid_deg=270, **kw)[8, 8]
    # Sol i sørvest (225°): sør- og vestvendt like lyse
    sw = [terrain.hillshade(_ramp(d), sun_azimuth_grid_deg=225, **kw)[8, 8] for d in "SWNE"]
    assert abs(sw[0] - sw[1]) < 1e-9 and abs(sw[2] - sw[3]) < 1e-9 and sw[0] > sw[2]


def test_colormap_sea_and_determinism():
    hgt = np.array([[0.0, 0.05, 50.0], [-0.3, 200.0, 300.0]], dtype=np.float32)
    shade = np.ones_like(hgt, dtype=np.float64)
    rgb = terrain.colormap(hgt, 50.0, shade)
    assert rgb.dtype == np.uint8 and rgb.shape == (2, 3, 3)
    for r, c in ((0, 0), (0, 1), (1, 0)):
        assert tuple(rgb[r, c]) == terrain.SEA
    assert tuple(rgb[0, 2]) != terrain.SEA
    assert np.array_equal(rgb, terrain.colormap(hgt, 50.0, shade))
