"""Dekkhøyden langs en bru: prøver som ikke traff veibanen skal ikke gi humper og hull."""

import numpy as np

from flypipe.structures import smooth_deck

# Den ene av de to Varoddbruene slik den ble lest ut av DOM 1 m (2026-11-22): tre steder faller eller spretter
# høyden flere meter, der prøvene traff noe annet enn veibanen.
VARODD = [12.0, 13.9, 15.3, 17.2, 17.1, 17.2, 17.4, 17.5, 17.8, 17.4, 15.4, 17.3, 16.5, 15.2, 20.2, 20.6, 17.8, 19.2, 19.8, 21.7, 22.0, 22.2, 22.5, 22.8, 23.1,
          23.4, 23.6, 23.9, 24.3, 24.5, 24.9, 25.1, 25.3, 25.6, 25.9, 26.3, 26.5, 26.9, 27.1, 27.4, 27.6, 27.8, 28.1, 28.8, 28.7, 29.0, 29.4, 30.0, 30.4, 30.2,
          30.4, 30.8, 30.9, 31.5, 33.0, 32.4, 34.0, 31.0, 26.0, 27.9, 32.7, 34.2, 33.2, 33.4, 33.4, 33.6, 34.1, 34.0, 34.1, 34.4, 34.5, 34.6, 35.1, 35.1, 35.3,
          35.4, 35.6, 35.6, 35.9, 36.1, 36.2, 36.5, 36.6, 36.7, 36.8, 36.8, 36.9, 37.0, 37.0, 37.0, 37.2, 37.3, 37.3, 37.3, 37.4, 37.4, 37.4, 37.5, 37.5, 37.5,
          37.5, 37.5, 37.5, 37.6, 37.6, 37.6, 37.6, 37.6, 37.6, 37.3, 33.6, 30.0, 37.5, 29.8, 25.4, 25.3, 25.2, 27.9, 27.6, 37.3, 37.3, 37.2, 37.2, 37.2, 37.0,
          36.9, 36.8, 36.7, 36.6, 36.7, 36.5, 36.4, 36.3, 36.2, 36.1, 36.2]


def test_varoddbrua_faar_en_jevn_veibane():
    assert np.abs(np.diff(VARODD)).max() > 7  # slik den var: hopp på over sju meter mellom to prøver fem meter fra hverandre
    deck = np.array(smooth_deck(VARODD))
    assert deck.size == len(VARODD)
    assert np.abs(np.diff(deck[20:])).max() < 0.8  # 5 m mellom prøvene: under 16 % stigning (de første hundre meterne er urolige i DOM)
    assert deck[110:120].min() > 36.5  # hullet på 12 m ved østre ende er borte
    assert deck[57:60].min() > 31.5  # og det på 8 m midt på
    assert 36.5 < deck.max() < 38  # toppen er der den var


def test_en_jevn_bru_beholder_hoyden_sin():
    arch = [10 + 20 * np.sin(np.pi * i / 80) for i in range(81)]  # en buet bru, 400 m lang og 20 m høy på midten
    deck = np.array(smooth_deck(arch))
    assert np.abs(deck - np.array(arch)).max() < 0.3
    assert smooth_deck([5.0, 5.2, 9.0]) == [5.0, 5.2, 9.0]  # for kort til å rense
    # en bru der halve lengden er søppel skal ikke få høyder utenfor det prøvene spenner over
    junk = [80.0 - i for i in range(20)] + [5.0, 90.0, 4.0, 88.0, 6.0, 91.0, 3.0, 80.0]
    out = np.array(smooth_deck(junk))
    assert out.min() >= min(junk) and out.max() <= max(junk)
    ramp = [3.0 + 0.3 * i for i in range(40)]  # en rett rampe: uendret, også i endene
    assert np.abs(np.array(smooth_deck(ramp)) - np.array(ramp)).max() < 0.01
