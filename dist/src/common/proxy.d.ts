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
import { type Dispatcher } from "undici";
/** A yad transport endpoint — used for startup logging and diagnostics. */
export interface TransportEndpoint {
  name: string;
  host: string;
  port: number;
}
export declare const TRANSPORTS: TransportEndpoint[];
/**
 * Resolve the proxy URL to use for a given target host, or undefined for direct.
 *
 * Precedence (all yad endpoints are TLS, so HTTPS_PROXY wins):
 *   YAD_PROXY_URL → HTTPS_PROXY → ALL_PROXY → HTTP_PROXY
 * Returns undefined when the host is covered by NO_PROXY or no proxy is set.
 */
export declare function resolveProxy(targetHost?: string): string | undefined;
/** Mask credentials in a proxy URL for safe logging. */
export declare function maskProxy(proxyUrl: string): string;
/**
 * Open a raw (pre-TLS) socket to `host:port` through the given proxy URL.
 * Exported for integration testing (fake proxy); not part of the public API.
 */
export declare function establishRawSocket(
  proxyUrl: string,
  host: string,
  port: number,
): Promise<net.Socket>;
/** Return the undici dispatcher for a target host, or undefined for direct. */
export declare function getDispatcher(targetHost?: string): Dispatcher | undefined;
/**
 * Drop-in replacement for global `fetch` that routes through the configured
 * proxy (per target host, honouring NO_PROXY). Falls back to a direct request
 * when no proxy is configured.
 */
export declare function proxyFetch(input: string | URL, init?: RequestInit): Promise<Response>;
/**
 * Return a `node:https.Agent` that tunnels its connections through the proxy,
 * or undefined for direct connections. The same agent is reused for every
 * target host that resolves to the same proxy — the tunnel destination is read
 * from the per-request connection options.
 */
export declare function getHttpsAgent(targetHost?: string): https.Agent | undefined;
export interface TransportProxyInfo {
  name: string;
  host: string;
  port: number;
  proxy: string | null;
}
/** Per-transport proxy assignment with credentials masked (for logging / yad_diagnose). */
export declare function proxyReport(): TransportProxyInfo[];
/** One-line startup summary of proxy usage (credentials masked). */
export declare function proxySummary(): string;
export interface ReachabilityResult {
  name: string;
  host: string;
  port: number;
  ok: boolean;
  via: "proxy" | "direct";
  proxy: string | null;
  error?: string;
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
export declare function probeReachability(
  endpoint: TransportEndpoint,
  timeoutMs?: number,
): Promise<ReachabilityResult>;
