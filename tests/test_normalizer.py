"""Тесты для normalizer.py."""

from src.normalizer import (
    normalize_ip,
    extract_ipv4,
    extract_ipv6,
    extract_all_ips,
    generate_method_id,
    deduplicate_methods,
)


class TestNormalizeIp:
    def test_valid_ipv4(self):
        assert normalize_ip("178.22.122.100") == "178.22.122.100"

    def test_ipv4_with_spaces(self):
        assert normalize_ip("  178.22.122.100  ") == "178.22.122.100"

    def test_ipv4_leading_zeros(self):
        # ipaddress убирает ведущие нули
        assert normalize_ip("078.022.122.100") == "78.22.122.100"

    def test_ipv4_zero(self):
        assert normalize_ip("0.0.0.0") == "0.0.0.0"

    def test_valid_ipv6(self):
        assert normalize_ip("2a00:ab00:1233:26::50") == "2a00:ab00:1233:26::50"

    def test_ipv6_full(self):
        result = normalize_ip("2a00:ab00:1233:0026:0000:0000:0000:0050")
        assert result == "2a00:ab00:1233:26::50"

    def test_invalid_ip(self):
        assert normalize_ip("999.999.999.999") is None

    def test_empty_string(self):
        assert normalize_ip("") is None

    def test_not_ip(self):
        assert normalize_ip("hello") is None

    def test_partial_ip(self):
        assert normalize_ip("192.168.1") is None


class TestExtractIpv4:
    def test_single_ip(self):
        assert extract_ipv4("DNS: 178.22.122.100") == ["178.22.122.100"]

    def test_multiple_ips(self):
        text = "Основной: 178.22.122.100, Дополнительный: 78.157.42.100"
        result = extract_ipv4(text)
        assert result == ["178.22.122.100", "78.157.42.100"]

    def test_ip_pair_with_slash(self):
        text = "31.192.108.180 / 176.99.11.77"
        result = extract_ipv4(text)
        assert result == ["31.192.108.180", "176.99.11.77"]

    def test_no_ips(self):
        assert extract_ipv4("Нет адресов тут") == []

    def test_invalid_ips_filtered(self):
        # 999.999.999.999 не пройдёт валидацию через ipaddress
        text = "Valid: 8.8.8.8 Invalid: 999.1.2.3"
        result = extract_ipv4(text)
        assert "8.8.8.8" in result

    def test_zero_secondary(self):
        text = "45.90.33.120 / 0.0.0.0"
        result = extract_ipv4(text)
        assert result == ["45.90.33.120", "0.0.0.0"]


class TestExtractIpv6:
    def test_standard_ipv6(self):
        text = "IPv6: 2a00:ab00:1233:26::50"
        result = extract_ipv6(text)
        assert "2a00:ab00:1233:26::50" in result

    def test_no_ipv6(self):
        assert extract_ipv6("Only IPv4: 8.8.8.8") == []


class TestExtractAllIps:
    def test_mixed(self):
        text = "IPv4: 8.8.8.8, IPv6: 2a00:ab00:1233:26::50"
        result = extract_all_ips(text)
        assert "8.8.8.8" in result
        assert "2a00:ab00:1233:26::50" in result


class TestGenerateMethodId:
    def test_dns_pair_stable(self):
        id1 = generate_method_id("dns_pair", "178.22.122.100", "78.157.42.100")
        id2 = generate_method_id("dns_pair", "178.22.122.100", "78.157.42.100")
        assert id1 == id2

    def test_different_ips_different_ids(self):
        id1 = generate_method_id("dns_pair", "178.22.122.100", "78.157.42.100")
        id2 = generate_method_id("dns_pair", "8.8.8.8", "8.8.4.4")
        assert id1 != id2

    def test_xsts_ip(self):
        mid = generate_method_id("xsts_ip", "50.7.87.82")
        assert mid.startswith("xst-")

    def test_description_based(self):
        mid = generate_method_id("vpn", None, description="WireGuard на роутере")
        assert mid.startswith("vpn-")

    def test_no_secondary(self):
        id1 = generate_method_id("dns_pair", "8.8.8.8")
        id2 = generate_method_id("dns_pair", "8.8.8.8", None)
        assert id1 == id2


class TestDeduplicateMethods:
    def test_no_duplicates(self):
        methods = [
            {"id": "dns-aaa", "primary_dns": "8.8.8.8", "sources": ["src-1"], "source_urls": ["url1"], "last_seen": "2026-04-10"},
            {"id": "dns-bbb", "primary_dns": "1.1.1.1", "sources": ["src-2"], "source_urls": ["url2"], "last_seen": "2026-04-10"},
        ]
        result = deduplicate_methods(methods)
        assert len(result) == 2

    def test_merge_duplicates(self):
        methods = [
            {"id": "dns-aaa", "primary_dns": "8.8.8.8", "sources": ["src-1"], "source_urls": ["url1"], "last_seen": "2026-04-08"},
            {"id": "dns-aaa", "primary_dns": "8.8.8.8", "sources": ["src-2"], "source_urls": ["url2"], "last_seen": "2026-04-10"},
        ]
        result = deduplicate_methods(methods)
        assert len(result) == 1
        assert "src-1" in result[0]["sources"]
        assert "src-2" in result[0]["sources"]
        assert result[0]["last_seen"] == "2026-04-10"

    def test_no_duplicate_sources(self):
        methods = [
            {"id": "dns-aaa", "primary_dns": "8.8.8.8", "sources": ["src-1"], "source_urls": ["url1"], "last_seen": "2026-04-10"},
            {"id": "dns-aaa", "primary_dns": "8.8.8.8", "sources": ["src-1"], "source_urls": ["url1"], "last_seen": "2026-04-10"},
        ]
        result = deduplicate_methods(methods)
        assert len(result) == 1
        assert result[0]["sources"].count("src-1") == 1

    def test_garbage_ips_filtered(self):
        methods = [
            {"id": "dns-a", "primary_dns": "192.168.1.1", "sources": ["src-1"], "source_urls": [], "last_seen": "2026-04-10"},
            {"id": "dns-b", "primary_dns": "0.0.0.0", "sources": ["src-1"], "source_urls": [], "last_seen": "2026-04-10"},
            {"id": "dns-c", "primary_dns": "176.99.11.77", "sources": ["src-1"], "source_urls": [], "last_seen": "2026-04-10"},
        ]
        result = deduplicate_methods(methods)
        assert len(result) == 1
        assert result[0]["primary_dns"] == "176.99.11.77"

    def test_empty_list(self):
        assert deduplicate_methods([]) == []
