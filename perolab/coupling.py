"""Segregation result -> device performance.

Segregation creates low-gap, iodide-rich islands in the film.
Light absorption (current) barely changes, but recombination happens overwhelmingly
in the low-gap islands, so the saturation current J0 rises and Voc (open-circuit voltage) drops.
Here the post-segregation band-gap distribution goes into SubCell.eg_domains and J0 is summed per domain.
"""
from dataclasses import replace

from .device import SubCell, simulate
from .segregation import SegregationSim


def device_from_sim(sim: SegregationSim, cell: SubCell) -> SubCell:
    eg0 = sim.p.material.bandgap(sim.p.x_br)
    return replace(cell, eg=eg0, eg_domains=sim.bandgap_domains())


def segregation_impact(sim: SegregationSim, cell: SubCell, spectrum="AM1.5G", stack=None, index=0):
    """Compare performance before and after segregation.

    If a stack (list of tandem sub-cells) is given, sub-cell `index` is made segregated and the total efficiency compared.
    """
    eg0 = sim.p.material.bandgap(sim.p.x_br)
    fresh = replace(cell, eg=eg0, eg_domains=None)
    aged = device_from_sim(sim, cell)
    if stack is None:
        before = simulate([fresh], spectrum)["total"]
        after = simulate([aged], spectrum)["total"]
    else:
        s0 = list(stack); s0[index] = fresh
        s1 = list(stack); s1[index] = aged
        before = simulate(s0, spectrum)["total"]
        after = simulate(s1, spectrum)["total"]
    return {
        "eg_fresh": eg0,
        "voc_before": before.voc, "voc_after": after.voc,
        "dvoc_mV": (after.voc - before.voc) * 1000,
        "pce_before": before.pce, "pce_after": after.pce,
        "dpce_abs": after.pce - before.pce,
    }
