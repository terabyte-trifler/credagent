from model import score_address


def test_score_shape():
    result = score_address({"tx_volume_score": 40})
    assert "score" in result
