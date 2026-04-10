"""Тесты для checker.py."""

from unittest.mock import patch, MagicMock
from src.checker import check_dns, check_safety, _is_azure_ip, _same_subnet_16


class TestIsAzureIp:
    def test_azure_20(self):
        assert _is_azure_ip("20.201.192.52") is True

    def test_azure_40(self):
        assert _is_azure_ip("40.90.8.102") is True

    def test_azure_52(self):
        assert _is_azure_ip("52.1.2.3") is True

    def test_bypass_50(self):
        assert _is_azure_ip("50.7.85.221") is False

    def test_bypass_87(self):
        assert _is_azure_ip("87.228.47.196") is False

    def test_regular(self):
        assert _is_azure_ip("8.8.8.8") is False


class TestSameSubnet16:
    def test_same(self):
        assert _same_subnet_16(["142.250.74.110"], ["142.250.80.46"]) is True

    def test_different(self):
        assert _same_subnet_16(["142.250.74.110"], ["8.8.8.8"]) is False

    def test_empty(self):
        assert _same_subnet_16([], ["8.8.8.8"]) is False


class TestCheckDns:
    @patch("src.checker._resolve")
    def test_working(self, mock_resolve):
        # xsts резолвится в не-Azure IP, safety check ok
        mock_resolve.side_effect = lambda ns, domain: {
            "xsts.auth.xboxlive.com": ["87.228.47.196"],
            "google.com": ["142.250.74.110"],
        }[domain]
        # Нужен ещё один mock для Google DNS safety check
        with patch("src.checker._resolve") as mock_r:
            mock_r.side_effect = lambda ns, domain: {
                ("8.8.8.8", "google.com"): ["142.250.74.110"],
                ("1.2.3.4", "xsts.auth.xboxlive.com"): ["87.228.47.196"],
                ("1.2.3.4", "google.com"): ["142.250.80.46"],
            }.get((ns, domain), ["0.0.0.0"])
            result = check_dns("1.2.3.4")
        assert result["status"] == "working"
        assert result["resolved_ip"] == "87.228.47.196"
        assert result["checked_at"] is not None

    @patch("src.checker._resolve")
    def test_not_working(self, mock_resolve):
        mock_resolve.return_value = ["40.90.8.102"]
        result = check_dns("8.8.8.8")
        assert result["status"] == "not_working"

    @patch("src.checker._resolve")
    def test_timeout(self, mock_resolve):
        import dns.resolver
        mock_resolve.side_effect = dns.resolver.LifetimeTimeout()
        result = check_dns("1.1.1.1")
        assert result["status"] == "timeout"

    @patch("src.checker._resolve")
    def test_error(self, mock_resolve):
        mock_resolve.side_effect = Exception("connection failed")
        result = check_dns("1.1.1.1")
        assert result["status"] == "error"

    @patch("src.checker._resolve")
    def test_unsafe(self, mock_resolve):
        # bypass работает, но google.com подменён
        def side_effect(ns, domain):
            if domain == "xsts.auth.xboxlive.com":
                return ["87.228.47.196"]
            if ns == "8.8.8.8" and domain == "google.com":
                return ["142.250.74.110"]
            if domain == "google.com":
                return ["1.2.3.4"]  # совсем другой IP
            return []
        mock_resolve.side_effect = side_effect
        result = check_dns("6.6.6.6")
        assert result["status"] == "unsafe"
