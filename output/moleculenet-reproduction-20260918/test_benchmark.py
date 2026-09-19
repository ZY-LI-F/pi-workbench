import numpy as np
import pytest

from benchmark import check_partition, overlap_report, regression_metrics


def test_partition_covers_every_row_once():
    check_partition(([0, 1, 2], [3], [4]), 5)


@pytest.mark.parametrize("parts", [([0, 1], [1], [2]), ([0], [1], [3]), ([0, 1], [], [2])])
def test_partition_rejects_leakage_missing_or_empty_rows(parts):
    with pytest.raises(ValueError):
        check_partition(parts, 3)


def test_metrics_are_on_original_scale():
    result = regression_metrics([1, 2, 3], [2, 2, 4])
    assert result["rmse"] == pytest.approx(np.sqrt(2 / 3))
    assert result["mae"] == pytest.approx(2 / 3)
    assert result["r2"] == pytest.approx(0)


@pytest.mark.parametrize("prediction", [[1, 2], [1, float("nan"), 3], [1, float("inf"), 3]])
def test_metrics_reject_incomplete_or_nonfinite_predictions(prediction):
    with pytest.raises(ValueError):
        regression_metrics([1, 2, 3], prediction)


def test_structure_overlap_is_measured_separately_from_row_overlap():
    assert overlap_report(["C", "CC", "C", "N"], ([0, 1], [2], [3])) == {
        "train_valid": 1, "train_test": 0, "valid_test": 0}
