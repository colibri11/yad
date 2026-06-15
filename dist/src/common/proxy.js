/**
 * Proxy-aware transport helpers for fail-closed environments.
 *
 * Some deployments run yad inside a container with NO direct internet egress —
 * the only way out is an HTTP CONNECT (or SOCKS) proxy exposed via the standard
 * HTTP_PROXY / HTTPS_PROXY / NO_PROXY env vars.
 *
 * None of the underlying libraries pick the proxy up automatically:
 * - Node 22+ global `fetch` (undici) ignores proxy env entirely.
 * - The native `node:https` streaming paths (large WebDAV / Disk REST uploads)
 *   connect directly.
 * - imapflow / nodemailer need the proxy passed explicitly.
 *
 * This module centralises proxy resolution and exposes:
 * - `resolveProxy(host)` — proxy URL for a target host (honours NO_PROXY), or undefined.
 * - `proxyFetch(url, init)` — drop-in `fetch` that injects an undici dispatcher.
 * - `getHttpsAgent(host)` — a `node:https.Agent` that tunnels through the proxy.
 * - `probeReachability` / `proxyReport` — diagnostics (credentials masked).
 *
 * When no proxy env is set everything degrades to the previous direct behaviour
 * (resolveProxy returns undefined → no dispatcher / no agent injected).
 *
 * Supports http://, https:// and socks(4/5):// proxy schemes.
 */
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import * as socks from "socks";
import { Agent, ProxyAgent } from "undici";
export const TRANSPORTS = [
    { name: "IMAP", host: "imap.yandex.ru", port: 993 },
    { name: "SMTP", host: "smtp.yandex.ru", port: 465 },
    { name: "WebDAV (Disk)", host: "webdav.yandex.ru", port: 443 },
    { name: "CalDAV", host: "caldav.yandex.ru", port: 443 },
    { name: "CardDAV", host: "carddav.yandex.ru", port: 443 },
    { name: "Disk REST", host: "cloud-api.yandex.ru", port: 443 },
];
// ---------------------------------------------------------------------------
// Env resolution
// ---------------------------------------------------------------------------
function pickEnv(...names) {
    for (const name of names) {
        const value = process.env[name];
        if (value?.trim())
            return value.trim();
    }
    return undefined;
}
/** Ensure a proxy string has an explicit scheme (default http://). */
function normalizeProxyUrl(raw) {
    return /:\/\//.test(raw) ? raw : `http://${raw}`;
}
/** Does the target host match a NO_PROXY entry (so it must bypass the proxy)? */
function isNoProxy(host) {
    const noProxy = pickEnv("NO_PROXY", "no_proxy");
    if (!noProxy)
        return false;
    const h = host.toLowerCase();
    for (const rawEntry of noProxy.split(",")) {
        let entry = rawEntry.trim().toLowerCase();
        if (!entry)
            continue;
        if (entry === "*")
            return true;
        if (entry.startsWith("*."))
            entry = entry.slice(1); // *.example.com -> .example.com
        if (entry.startsWith("."))
            entry = entry.slice(1);
        // Strip an optional :port. Handle bracketed IPv6 ([::1]:443 -> ::1) and
        // leave bare IPv6 literals (multiple colons) intact instead of mangling them.
        const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(entry);
        if (bracketed)
            entry = bracketed[1];
        else if ((entry.match(/:/g)?.length ?? 0) === 1)
            entry = entry.replace(/:\d+$/, "");
        if (!entry)
            continue;
        if (h === entry || h.endsWith(`.${entry}`))
            return true;
    }
    return false;
}
/**
 * Resolve the proxy URL to use for a given target host, or undefined for direct.
 *
 * Precedence (all yad endpoints are TLS, so HTTPS_PROXY wins):
 *   YAD_PROXY_URL → HTTPS_PROXY → ALL_PROXY → HTTP_PROXY
 * Returns undefined when the host is covered by NO_PROXY or no proxy is set.
 */
export function resolveProxy(targetHost) {
    if (targetHost && isNoProxy(targetHost))
        return undefined;
    const raw = pickEnv("YAD_PROXY_URL", "HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy", "HTTP_PROXY", "http_proxy");
    if (!raw)
        return undefined;
    return normalizeProxyUrl(raw);
}
/** Mask credentials in a proxy URL for safe logging. */
export function maskProxy(proxyUrl) {
    try {
        const u = new URL(normalizeProxyUrl(proxyUrl));
        const cred = u.username ? "***@" : "";
        const port = u.port ? `:${u.port}` : "";
        return `${u.protocol}//${cred}${u.hostname}${port}`;
    }
    catch {
        return "(invalid proxy url)";
    }
}
function isSocks(u) {
    return u.protocol.startsWith("socks");
}
// ---------------------------------------------------------------------------
// Raw tunnelled socket (pre-TLS) via HTTP CONNECT or SOCKS
// ---------------------------------------------------------------------------
/**
 * Guard for proxy tunnel setup (CONNECT exchange / SOCKS handshake / TLS over the
 * tunnel). A half-open proxy that accepts the TCP connection but never replies
 * would otherwise hang the connection forever — fixed transfer timeouts on the
 * `node:https` request only start once a socket is assigned, which never happens.
 */
const PROXY_CONNECT_TIMEOUT_MS = 30_000;
/**
 * TLS-wrap an already-tunnelled raw socket. On any handshake failure (or timeout)
 * the underlying raw socket is destroyed so the tunnel is never leaked.
 */
function tlsWrap(raw, servername) {
    return new Promise((resolve, reject) => {
        const tlsSocket = tls.connect({ socket: raw, servername, ALPNProtocols: ["http/1.1"] });
        const fail = (err) => {
            raw.destroy();
            tlsSocket.destroy();
            reject(err);
        };
        tlsSocket.once("error", fail);
        tlsSocket.setTimeout(PROXY_CONNECT_TIMEOUT_MS, () => fail(new Error(`TLS handshake to ${servername} timed out after ${PROXY_CONNECT_TIMEOUT_MS}ms`)));
        tlsSocket.once("secureConnect", () => {
            tlsSocket.setTimeout(0);
            tlsSocket.removeListener("error", fail);
            resolve(tlsSocket);
        });
    });
}
/** Open a raw TCP socket to `host:port` tunnelled through an HTTP CONNECT proxy. */
function connectViaHttp(proxy, host, port) {
    return new Promise((resolve, reject) => {
        const proxyPort = proxy.port ? Number(proxy.port) : proxy.protocol === "https:" ? 443 : 80;
        const useTls = proxy.protocol === "https:";
        const socket = useTls
            ? tls.connect({ host: proxy.hostname, port: proxyPort, servername: proxy.hostname })
            : net.connect({ host: proxy.hostname, port: proxyPort });
        const onError = (err) => {
            socket.destroy();
            reject(err);
        };
        const onTimeout = () => socket.destroy(new Error(`Proxy CONNECT to ${host}:${port} timed out after ${PROXY_CONNECT_TIMEOUT_MS}ms`));
        socket.once("error", onError);
        socket.setTimeout(PROXY_CONNECT_TIMEOUT_MS, onTimeout);
        socket.once(useTls ? "secureConnect" : "connect", () => {
            let request = `CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\n`;
            if (proxy.username) {
                const user = decodeURIComponent(proxy.username);
                const pass = decodeURIComponent(proxy.password);
                const token = Buffer.from(`${user}:${pass}`).toString("base64");
                request += `Proxy-Authorization: Basic ${token}\r\n`;
            }
            request += "\r\n";
            socket.write(request);
            let buf = Buffer.alloc(0);
            const onData = (chunk) => {
                buf = Buffer.concat([buf, chunk]);
                const headerEnd = buf.indexOf("\r\n\r\n");
                if (headerEnd === -1)
                    return;
                socket.removeListener("data", onData);
                socket.removeListener("error", onError);
                socket.removeListener("timeout", onTimeout);
                socket.setTimeout(0);
                const statusLine = buf.subarray(0, buf.indexOf("\r\n")).toString("utf-8");
                const match = /^HTTP\/\d(?:\.\d)? (\d{3})/.exec(statusLine);
                if (!match || match[1][0] !== "2") {
                    socket.destroy();
                    reject(new Error(`Proxy CONNECT to ${host}:${port} failed: ${statusLine.trim()}`));
                    return;
                }
                // A compliant CONNECT proxy waits for the client before sending tunneled
                // bytes, but push back any payload that arrived in the same segment.
                const leftover = buf.subarray(headerEnd + 4);
                if (leftover.length)
                    socket.unshift(leftover);
                resolve(socket);
            };
            socket.on("data", onData);
        });
    });
}
/** Open a raw TCP socket to `host:port` tunnelled through a SOCKS proxy. */
async function connectViaSocks(proxy, host, port) {
    const scheme = proxy.protocol.replace(":", "");
    const type = scheme === "socks4" || scheme === "socks4a" ? 4 : 5;
    const info = await socks.SocksClient.createConnection({
        proxy: {
            host: proxy.hostname,
            port: proxy.port ? Number(proxy.port) : 1080,
            type,
            ...(proxy.username
                ? {
                    userId: decodeURIComponent(proxy.username),
                    password: decodeURIComponent(proxy.password),
                }
                : {}),
        },
        command: "connect",
        destination: { host, port },
        timeout: PROXY_CONNECT_TIMEOUT_MS,
    });
    return info.socket;
}
/**
 * Open a raw (pre-TLS) socket to `host:port` through the given proxy URL.
 * Exported for integration testing (fake proxy); not part of the public API.
 */
export function establishRawSocket(proxyUrl, host, port) {
    const proxy = new URL(proxyUrl);
    return isSocks(proxy) ? connectViaSocks(proxy, host, port) : connectViaHttp(proxy, host, port);
}
// ---------------------------------------------------------------------------
// undici dispatcher (for global fetch)
// ---------------------------------------------------------------------------
const dispatcherCache = new Map();
/** Build (and cache) an undici Dispatcher that routes through `proxyUrl`. */
function buildDispatcher(proxyUrl) {
    const cached = dispatcherCache.get(proxyUrl);
    if (cached)
        return cached;
    const proxy = new URL(proxyUrl);
    let dispatcher;
    if (isSocks(proxy)) {
        // undici has no native SOCKS support — supply a custom connector that opens
        // the SOCKS tunnel and performs TLS for https targets ourselves.
        dispatcher = new Agent({
            connect: (opts, callback) => {
                const host = (opts.hostname || opts.host || "");
                const isHttps = opts.protocol === "https:";
                const port = opts.port ? Number(opts.port) : isHttps ? 443 : 80;
                establishRawSocket(proxyUrl, host, port)
                    .then(async (raw) => {
                    if (!isHttps) {
                        callback(null, raw);
                        return;
                    }
                    const tlsSocket = await tlsWrap(raw, opts.servername || host);
                    callback(null, tlsSocket);
                })
                    .catch((err) => callback(err, null));
            },
        });
    }
    else {
        const token = proxy.username
            ? `Basic ${Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString("base64")}`
            : undefined;
        const origin = `${proxy.protocol}//${proxy.hostname}${proxy.port ? `:${proxy.port}` : ""}`;
        dispatcher = new ProxyAgent({ uri: origin, ...(token ? { token } : {}) });
    }
    dispatcherCache.set(proxyUrl, dispatcher);
    return dispatcher;
}
/** Return the undici dispatcher for a target host, or undefined for direct. */
export function getDispatcher(targetHost) {
    const proxyUrl = resolveProxy(targetHost);
    if (!proxyUrl)
        return undefined;
    return buildDispatcher(proxyUrl);
}
function hostOf(input) {
    try {
        return (typeof input === "string" ? new URL(input) : input).hostname;
    }
    catch {
        return undefined;
    }
}
/**
 * Drop-in replacement for global `fetch` that routes through the configured
 * proxy (per target host, honouring NO_PROXY). Falls back to a direct request
 * when no proxy is configured.
 */
export function proxyFetch(input, init) {
    const dispatcher = getDispatcher(hostOf(input));
    if (!dispatcher)
        return fetch(input, init);
    return fetch(input, { ...init, dispatcher });
}
// ---------------------------------------------------------------------------
// node:https agent (for native streaming PUT/GET that bypass undici)
// ---------------------------------------------------------------------------
const httpsAgentCache = new Map();
/**
 * Return a `node:https.Agent` that tunnels its connections through the proxy,
 * or undefined for direct connections. The same agent is reused for every
 * target host that resolves to the same proxy — the tunnel destination is read
 * from the per-request connection options.
 */
export function getHttpsAgent(targetHost) {
    const proxyUrl = resolveProxy(targetHost);
    if (!proxyUrl)
        return undefined;
    const cached = httpsAgentCache.get(proxyUrl);
    if (cached)
        return cached;
    const agent = new https.Agent({ keepAlive: false });
    agent.createConnection = (options, callback) => {
        const host = options.host || options.hostname || "";
        const port = options.port ? Number(options.port) : 443;
        establishRawSocket(proxyUrl, host, port)
            .then((raw) => tlsWrap(raw, options.servername || host))
            .then((tlsSocket) => callback(null, tlsSocket))
            .catch((err) => callback(err));
        return undefined;
    };
    httpsAgentCache.set(proxyUrl, agent);
    return agent;
}
/** Per-transport proxy assignment with credentials masked (for logging / yad_diagnose). */
export function proxyReport() {
    return TRANSPORTS.map((t) => {
        const proxy = resolveProxy(t.host);
        return { name: t.name, host: t.host, port: t.port, proxy: proxy ? maskProxy(proxy) : null };
    });
}
/** One-line startup summary of proxy usage (credentials masked). */
export function proxySummary() {
    const report = proxyReport();
    const used = report.filter((r) => r.proxy);
    if (used.length === 0)
        return "Proxy: none (direct connections)";
    const byProxy = new Map();
    for (const r of used) {
        const list = byProxy.get(r.proxy) ?? [];
        list.push(r.name);
        byProxy.set(r.proxy, list);
    }
    const parts = [...byProxy.entries()].map(([p, names]) => `${p} → ${names.join(", ")}`);
    const direct = report.filter((r) => !r.proxy).map((r) => r.name);
    const directNote = direct.length ? `; direct: ${direct.join(", ")}` : "";
    return `Proxy: ${parts.join(" | ")}${directNote}`;
}
function directConnect(host, port) {
    return new Promise((resolve, reject) => {
        const socket = net.connect({ host, port });
        socket.once("connect", () => resolve(socket));
        socket.once("error", reject);
    });
}
function withTimeout(p, ms) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
            settled = true;
            // Destroy the socket if the connection completes after we gave up, so a
            // slow-but-eventually-successful proxy does not leak an open socket.
            p.then((s) => s.destroy()).catch(() => { });
            reject(new Error(`timed out after ${ms}ms`));
        }, ms);
        p.then((v) => {
            if (settled) {
                v.destroy();
                return;
            }
            clearTimeout(timer);
            resolve(v);
        }, (e) => {
            if (settled)
                return;
            clearTimeout(timer);
            reject(e);
        });
    });
}
/**
 * Test reachability of one endpoint (through the proxy if configured).
 *
 * Establishes the tunnel (CONNECT / SOCKS) and then performs a real TLS
 * handshake to the endpoint — all yad endpoints are implicit-TLS (993/465/443),
 * so a successful handshake confirms end-to-end reachability, not merely that
 * the proxy accepted CONNECT. No credentials are sent.
 *
 * The default timeout is slightly above PROXY_CONNECT_TIMEOUT_MS so the inner
 * tunnel-setup guard fires first with a specific error instead of a generic
 * "timed out" from this outer guard.
 */
export async function probeReachability(endpoint, timeoutMs = PROXY_CONNECT_TIMEOUT_MS + 5_000) {
    const proxyUrl = resolveProxy(endpoint.host);
    const via = proxyUrl ? "proxy" : "direct";
    const proxy = proxyUrl ? maskProxy(proxyUrl) : null;
    try {
        const socket = await withTimeout((async () => {
            const raw = proxyUrl
                ? await establishRawSocket(proxyUrl, endpoint.host, endpoint.port)
                : await directConnect(endpoint.host, endpoint.port);
            return await tlsWrap(raw, endpoint.host);
        })(), timeoutMs);
        socket.destroy();
        return { name: endpoint.name, host: endpoint.host, port: endpoint.port, ok: true, via, proxy };
    }
    catch (err) {
        return {
            name: endpoint.name,
            host: endpoint.host,
            port: endpoint.port,
            ok: false,
            via,
            proxy,
            error: err instanceof Error ? err.message : String(err),
        };
    }
}
//# sourceMappingURL=proxy.js.map