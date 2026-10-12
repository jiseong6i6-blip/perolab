"""perolab: a virtual lab for perovskite solar cells.

materials   : composition -> band gap
optics      : absorption model
device      : single- and multi-junction efficiency (detailed balance + losses)
segregation : phase-field simulator for halide segregation
coupling    : segregation -> voltage / efficiency loss
"""
from .materials import MA_I_BR, FACS_I_BR, PB_SN, BowingModel
from .device import SubCell, simulate, sq_limit, match_thickness, optimize_thickness
from .segregation import SegregationParams, SegregationSim
from .coupling import segregation_impact, device_from_sim

__all__ = [
    "MA_I_BR", "FACS_I_BR", "PB_SN", "BowingModel",
    "SubCell", "simulate", "sq_limit", "match_thickness", "optimize_thickness",
    "SegregationParams", "SegregationSim",
    "segregation_impact", "device_from_sim",
]
