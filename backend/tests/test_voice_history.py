from app.api.voice import MAX_HISTORY_CHARS, MAX_HISTORY_MESSAGES, _normalize_history


def test_normalize_history_keeps_valid_recent_messages():
    history = [
        {"role": "system", "content": "ignore"},
        {"role": "user", "content": "  你好  "},
        {"role": "assistant", "content": "你好，我还记得上次的话题。"},
        {"role": "tool", "content": "ignore"},
        {"role": "assistant", "content": ""},
        {"role": "user", "content": 123},
    ]

    assert _normalize_history(history) == [
        {"role": "user", "content": "你好"},
        {"role": "assistant", "content": "你好，我还记得上次的话题。"},
    ]


def test_normalize_history_limits_recent_messages_and_characters():
    history = [
        {"role": "user" if index % 2 == 0 else "assistant", "content": f"message-{index}"}
        for index in range(MAX_HISTORY_MESSAGES + 3)
    ]

    normalized = _normalize_history(history)

    assert len(normalized) == MAX_HISTORY_MESSAGES
    assert normalized[0]["content"] == "message-3"
    assert normalized[-1]["content"] == f"message-{MAX_HISTORY_MESSAGES + 2}"

    long_history = [
        {"role": "user", "content": "a" * (MAX_HISTORY_CHARS + 500)},
        {"role": "assistant", "content": "b" * 2000},
        {"role": "user", "content": "c" * 2000},
        {"role": "assistant", "content": "d" * 2000},
    ]

    total_chars = sum(len(item["content"]) for item in _normalize_history(long_history))

    assert total_chars == MAX_HISTORY_CHARS


def test_normalize_history_rejects_non_list_payloads():
    assert _normalize_history(None) == []
    assert _normalize_history({"role": "user", "content": "hello"}) == []
