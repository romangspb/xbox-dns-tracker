"""Тесты для merger.py."""

from src.merger import merge, _days_between


class TestDaysBetween:
    def test_same_day(self):
        assert _days_between("2026-04-10", "2026-04-10") == 0

    def test_one_day(self):
        assert _days_between("2026-04-09", "2026-04-10") == 1

    def test_two_months(self):
        assert _days_between("2026-02-01", "2026-04-10") == 68

    def test_invalid_format(self):
        assert _days_between("bad", "2026-04-10") == 0


class TestMerge:
    def _method(self, mid="dns-aaa", primary="8.8.8.8", sources=None, last_seen="2026-04-10", active=True, recheck=False):
        return {
            "id": mid,
            "type": "dns_pair",
            "difficulty": "easy",
            "primary_dns": primary,
            "secondary_dns": None,
            "sources": sources or ["src-1"],
            "source_urls": ["url1"],
            "first_seen": "2026-03-01",
            "last_seen": last_seen,
            "active": active,
            "recheck": recheck,
        }

    def test_new_method_added(self):
        existing = [self._method(mid="dns-aaa")]
        new = [self._method(mid="dns-bbb", primary="1.1.1.1")]
        result = merge(existing, new, "2026-04-10")
        assert len(result) == 2
        ids = {m["id"] for m in result}
        assert "dns-aaa" in ids
        assert "dns-bbb" in ids

    def test_existing_updated(self):
        existing = [self._method(last_seen="2026-04-08")]
        new = [self._method(sources=["src-2"])]
        result = merge(existing, new, "2026-04-10")
        assert len(result) == 1
        assert result[0]["last_seen"] == "2026-04-10"
        assert "src-1" in result[0]["sources"]
        assert "src-2" in result[0]["sources"]

    def test_deactivation_after_60_days(self):
        existing = [self._method(last_seen="2026-01-01")]
        new = []  # метод не найден
        result = merge(existing, new, "2026-04-10")
        assert len(result) == 1
        assert result[0]["active"] is False

    def test_no_deactivation_within_60_days(self):
        existing = [self._method(last_seen="2026-03-15")]
        new = []
        result = merge(existing, new, "2026-04-10")
        assert len(result) == 1
        assert result[0]["active"] is True

    def test_recheck_when_inactive_reappears(self):
        existing = [self._method(active=False, last_seen="2026-01-01")]
        new = [self._method()]
        result = merge(existing, new, "2026-04-10")
        assert len(result) == 1
        assert result[0]["active"] is True
        assert result[0]["recheck"] is True

    def test_no_recheck_for_active(self):
        existing = [self._method(active=True)]
        new = [self._method()]
        result = merge(existing, new, "2026-04-10")
        assert result[0]["recheck"] is False

    def test_empty_existing(self):
        result = merge([], [self._method()], "2026-04-10")
        assert len(result) == 1

    def test_empty_new(self):
        result = merge([self._method()], [], "2026-04-10")
        assert len(result) == 1

    def test_both_empty(self):
        assert merge([], [], "2026-04-10") == []

    def test_first_seen_preserved(self):
        existing = [self._method(last_seen="2026-03-01")]
        new = [self._method()]
        result = merge(existing, new, "2026-04-10")
        assert result[0]["first_seen"] == "2026-03-01"
