import { Type } from "@sinclair/typebox";
import { probeReachability, proxyReport, TRANSPORTS } from "./proxy.js";
import { jsonResult } from "./types.js";

export interface MetaInfo {
  version: string;
  enabledServices: string[];
}

export function createMetaTools(info: MetaInfo) {
  return [
    {
      name: "yad_version",
      description:
        "Return runtime info about this yad instance: plugin version, " +
        "enabled Yandex services, process start time, uptime, and pid. " +
        "Use this to verify which build is actually running — especially " +
        "during development or after an upgrade, when cached or stale " +
        "binaries would otherwise be indistinguishable from a fresh install.",
      parameters: Type.Object({}, { additionalProperties: false }),
      async execute(_id: string, _params: Record<string, unknown>) {
        const uptimeSeconds = Math.round(process.uptime());
        const startedAt = new Date(Date.now() - process.uptime() * 1000).toISOString();
        return jsonResult({
          version: info.version,
          enabledServices: info.enabledServices,
          startedAt,
          uptimeSeconds,
          pid: process.pid,
        });
      },
    },
    {
      name: "yad_diagnose",
      description:
        "Diagnose yad network transport, especially in fail-closed (proxy-only) " +
        "environments. Reports which proxy each Yandex transport (IMAP, SMTP, " +
        "WebDAV, CalDAV, CardDAV, Disk REST) resolves to from the environment " +
        "(HTTP_PROXY/HTTPS_PROXY/ALL_PROXY/NO_PROXY/YAD_PROXY_URL), with " +
        "credentials masked, and performs a live TCP reachability probe to each " +
        "endpoint (through the proxy when configured). No credentials are sent — " +
        "the probe only opens and immediately closes the connection.\n\n" +
        "Use this to validate a deployment with one call: every transport should " +
        "report ok=true. If a transport shows ok=false with a proxy set, the proxy " +
        "likely does not allow CONNECT on that port (IMAP 993 / SMTP 465 / 443).\n\n" +
        "The probe replicates exactly how each client addresses CONNECT (see the " +
        "connectVia field): IMAP uses a DNS-resolved IP (imapflow pre-resolves), " +
        "while SMTP/WebDAV/CalDAV/CardDAV/Disk-REST use the hostname. This matters " +
        "for proxy ACLs: a rule that allows CONNECT by hostname/domain (e.g. squid " +
        "dstdomain .yandex.ru) will pass the hostname transports but DENY IMAP, " +
        "because IMAP arrives as CONNECT <IP>:993. Allow CONNECT to 993 by " +
        "destination IP (e.g. squid `acl ... dst imap.yandex.ru` or Yandex IP " +
        "ranges) for mail to work.\n\n" +
        "NOTE: large Disk uploads/downloads (>10 MB, REST API) stream to a dynamic " +
        "CDN host 'uploader*.disk.yandex.net' / 'downloader*.disk.yandex.net' that " +
        "cannot be probed ahead of time (the exact subdomain is assigned per request). " +
        "The 'Disk REST' row only probes the metadata host cloud-api.yandex.ru. A proxy " +
        "must also allow CONNECT to *.disk.yandex.net:443 for large-file transfers, and " +
        "any NO_PROXY entry should cover both cloud-api.yandex.ru and *.disk.yandex.net " +
        "together to avoid splitting one operation across proxy and direct paths.\n\n" +
        "Set probe=false to only report proxy resolution without opening sockets.",
      parameters: Type.Object(
        {
          probe: Type.Optional(
            Type.Boolean({
              description: "Run live reachability probes (default true)",
              default: true,
            }),
          ),
        },
        { additionalProperties: false },
      ),
      async execute(_id: string, params: { probe?: boolean }) {
        const report = proxyReport();
        const anyProxy = report.some((r) => r.proxy);
        const result: Record<string, unknown> = {
          version: info.version,
          enabledServices: info.enabledServices,
          proxyConfigured: anyProxy,
          transports: report,
        };
        if (params.probe !== false) {
          result.reachability = await Promise.all(
            TRANSPORTS.map((endpoint) => probeReachability(endpoint)),
          );
        }
        return jsonResult(result);
      },
    },
  ];
}
