"""Boundary checks for real upstream outline output, not a simulated workflow."""
import pytest
from test_paper2any_live import validate_outline


def page():
    return dict(title='研究范围', layout_description='标题与正文',
                key_points=['三个真实数据集'], asset_ref=None)


def test_valid_structured_outline():
    validate_outline([page()], 1)


@pytest.mark.parametrize('pages', [[], {}, ['not an object']])
def test_reject_wrong_page_count_or_shape(pages):
    with pytest.raises(ValueError):
        validate_outline(pages, 1)


@pytest.mark.parametrize('field,value', [
    ('title', ' '), ('layout_description', ''), ('key_points', []),
    ('key_points', [' ']), ('asset_ref', 'invented-figure.png'),
])
def test_reject_missing_content_or_invented_image(field, value):
    item = page()
    item[field] = value
    with pytest.raises(ValueError):
        validate_outline([item], 1)
