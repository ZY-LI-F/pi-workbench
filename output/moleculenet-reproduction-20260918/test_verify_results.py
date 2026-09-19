import math
import pytest
from verify_results import calculate_metrics, close, source_rows


def test_independent_metrics_known_example():
    result = calculate_metrics([{"actual": 1, "predicted": 2}, {"actual": 3, "predicted": 3}])
    assert result == {"n":2,"rmse":math.sqrt(.5),"mae":.5,"r2":.5}


@pytest.mark.parametrize("rows", [[], [{"actual":1,"predicted":float("nan")}],
                                  [{"actual":1,"predicted":1},{"actual":1,"predicted":2}]])
def test_invalid_results_are_not_success(rows):
    with pytest.raises(ValueError):
        calculate_metrics(rows)


def test_metric_tampering_detected():
    with pytest.raises(AssertionError):
        close(.8, 1.2, "tampered metric")


def test_float_serialization_tolerated():
    close(.8, .8000000000000001, "float roundtrip")


def test_prestandardized_unit_cannot_masquerade_as_physical():
    with pytest.raises(AssertionError, match="physical target"):
        source_rows({"dataset":"freesolv", "unit":"z-score"})
