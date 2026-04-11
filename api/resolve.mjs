// Vercel Serverless Function: /api/resolve?dns=X.X.X.X
// Резолвит xsts.auth.xboxlive.com через указанный DNS и возвращает target IP.
// Используется фронтендом для DNS, у которых нет cached resolved_ip в data.json.
//
// Портабельность: стандартный (req, res) handler. Никаких Vercel-специфичных
// фич (Edge Config, KV, Middleware). В случае миграции на VPS — оборачивается
// в Express одной строкой: `app.get('/api/resolve', handler)`.
//
// Кэш: in-memory Map, TTL 24 часа. На cold start пустой — это ок, у нас
// ~16 уникальных DNS и на стороне браузера есть собственный localStorage-кэш.

import dns from 'node:dns/promises';

const XSTS_HOST = 'xsts.auth.xboxlive.com';
const DNS_TIMEOUT_MS = 5000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// IPv4-валидатор (IPv6 DNS не поддерживаем — GitHub Actions не умеют, см. v1.0.5)
const IPV4_REGEX = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
function isValidIPv4(ip) {
  if (typeof ip !== 'string') return false;
  const m = ip.match(IPV4_REGEX);
  if (!m) return false;
  return m.slice(1).every((n) => {
    const num = Number(n);
    return Number.isInteger(num) && num >= 0 && num <= 255;
  });
}

// In-memory кэш. Ключ = DNS IP, значение = { resolved_ip, cached_at }.
// ВАЖНО: на Vercel этот кэш живёт только пока жив warm-контейнер (обычно
// 5-15 минут между запросами). Cold start = пустой кэш. В `vercel dev`
// модуль перезагружается на каждый запрос — кэш не работает вообще.
// Основная защита от спама лежит на localStorage в браузере (Phase 5).
const cache = new Map();

async function resolveXstsVia(dnsIp) {
  const resolver = new dns.Resolver({ timeout: DNS_TIMEOUT_MS, tries: 1 });
  resolver.setServers([dnsIp]);
  const ips = await resolver.resolve4(XSTS_HOST);
  if (!Array.isArray(ips) || ips.length === 0) {
    throw new Error('empty_resolve_result');
  }
  return ips[0];
}

export default async function handler(req, res) {
  // CORS — эндпоинт публичный, никаких секретов не отдаём
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'method_not_allowed' }));
    return;
  }

  // Парсинг параметра dns. req.query есть у Vercel, но для портабельности
  // (и local dev в других рантаймах) парсим из req.url стандартным URL API.
  let dnsIp;
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    dnsIp = url.searchParams.get('dns');
  } catch {
    dnsIp = null;
  }

  if (!dnsIp) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'missing_dns_param' }));
    return;
  }

  if (!isValidIPv4(dnsIp)) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'invalid_ipv4', dns: dnsIp }));
    return;
  }

  // Проверка кэша
  const cached = cache.get(dnsIp);
  if (cached && Date.now() - cached.cached_at < CACHE_TTL_MS) {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.end(
      JSON.stringify({
        dns: dnsIp,
        resolved_ip: cached.resolved_ip,
        cached_at: new Date(cached.cached_at).toISOString(),
        from_cache: true,
      })
    );
    return;
  }

  // Fresh resolve
  try {
    const resolved_ip = await resolveXstsVia(dnsIp);
    const cached_at = Date.now();
    cache.set(dnsIp, { resolved_ip, cached_at });
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.end(
      JSON.stringify({
        dns: dnsIp,
        resolved_ip,
        cached_at: new Date(cached_at).toISOString(),
        from_cache: false,
      })
    );
  } catch (err) {
    const code = err && err.code ? err.code : 'unknown';
    // dnspython-style коды: ETIMEOUT (наш таймаут), ENOTFOUND, ECONNREFUSED, ESERVFAIL
    const isTimeout = code === 'ETIMEOUT' || code === 'ETIMEDOUT';
    res.statusCode = isTimeout ? 503 : 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        error: isTimeout ? 'dns_timeout' : 'resolve_failed',
        code,
        dns: dnsIp,
      })
    );
  }
}
