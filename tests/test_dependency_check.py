import pandas as pd

from checks.types.dependency_check import DependencyCheck


def test_record_disagreeing_with_its_determinant_group_fails():
    df = pd.DataFrame({"MARC.DISPO": ["001", "001", "001", "002", ""],
                       "MARC.EKGRP": ["A10", "A10", "B20", "C30", "Z99"]})
    ev = DependencyCheck({"determinant": "MARC.DISPO", "field": "MARC.EKGRP"}).evaluate(df)
    assert ev.population.tolist() == [True, True, True, True, False]
    assert ev.failing.tolist() == [False, False, True, False, False]
