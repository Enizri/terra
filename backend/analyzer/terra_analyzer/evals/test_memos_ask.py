"""Golden Ask retrieve evals — keyword ranker, no live LLM."""

from .ask import assert_memos_ask


def test_memos_ask_retrieves_expected_components_and_files():
    assert_memos_ask()
