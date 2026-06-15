import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { establishRawSocket } from "../proxy.js";

// Integration tests for the hand-rolled HTTP CONNECT tunnel (connectViaHttp)
// against a real in-process fake proxy + upstream — exercises the actual socket
// path (status parsing, Proxy-Authorization forwarding, error handling) that the
// unit tests cannot reach.

const servers: net.Server[] = [];

function track(server: net.Server): net.Server {
  servers.push(server);
  return server;
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (s) =>
        new Promise<void>((resolve) => {
          s.close(() => resolve());
        }),
    ),
  );
});

/** Upstream TCP server that greets every connection with "PONG". */
function startTarget(): Promise<number> {
  return new Promise((resolve) => {
    const server = track(net.createServer((sock) => sock.end("PONG")));
    server.listen(0, "127.0.0.1", () => resolve((server.address() as net.AddressInfo).port));
  });
}

interface ProxyState {
  port: number;
  lastAuth?: string;
  connects: number;
}

/** Fake HTTP CONNECT proxy. `status` other than 200 is returned without tunneling. */
function startConnectProxy(status = "200 Connection established"): Promise<ProxyState> {
  const state: ProxyState = { port: 0, connects: 0 };
  return new Promise((resolve) => {
    const server = track(
      net.createServer((client) => {
        let buf = "";
        const onData = (chunk: Buffer) => {
          buf += chunk.toString("utf8");
          const end = buf.indexOf("\r\n\r\n");
          if (end === -1) return;
          client.removeListener("data", onData);
          const lines = buf.slice(0, end).split("\r\n");
          const reqLine = /^CONNECT (\S+):(\d+)/.exec(lines[0]);
          const authLine = lines.find((l) => /^proxy-authorization:/i.test(l));
          if (authLine) state.lastAuth = authLine.slice(authLine.indexOf(":") + 1).trim();
          state.connects++;

          if (!status.startsWith("200")) {
            client.end(`HTTP/1.1 ${status}\r\n\r\n`);
            return;
          }
          const host = reqLine?.[1] ?? "127.0.0.1";
          const port = Number(reqLine?.[2] ?? 0);
          const upstream = net.connect({ host, port }, () => {
            client.write("HTTP/1.1 200 Connection established\r\n\r\n");
            upstream.pipe(client);
            client.pipe(upstream);
          });
          upstream.on("error", () => client.destroy());
        };
        client.on("data", onData);
      }),
    );
    server.listen(0, "127.0.0.1", () => {
      state.port = (server.address() as net.AddressInfo).port;
      resolve(state);
    });
  });
}

function readOnce(sock: net.Socket): Promise<string> {
  return new Promise((resolve, reject) => {
    sock.once("data", (d: Buffer) => resolve(d.toString("utf8")));
    sock.once("error", reject);
  });
}

describe("establishRawSocket — HTTP CONNECT tunnel", () => {
  it("tunnels to the upstream and relays data", async () => {
    const targetPort = await startTarget();
    const proxy = await startConnectProxy();

    const sock = await establishRawSocket(
      `http://127.0.0.1:${proxy.port}`,
      "127.0.0.1",
      targetPort,
    );
    const data = await readOnce(sock);
    sock.destroy();

    expect(data).toContain("PONG");
    expect(proxy.connects).toBe(1);
  });

  it("forwards Proxy-Authorization for an authenticated proxy", async () => {
    const targetPort = await startTarget();
    const proxy = await startConnectProxy();

    const sock = await establishRawSocket(
      `http://user:p@ss@127.0.0.1:${proxy.port}`,
      "127.0.0.1",
      targetPort,
    );
    await readOnce(sock);
    sock.destroy();

    const expected = `Basic ${Buffer.from("user:p@ss").toString("base64")}`;
    expect(proxy.lastAuth).toBe(expected);
  });

  it("rejects when the proxy refuses the CONNECT (non-2xx)", async () => {
    const proxy = await startConnectProxy("403 Forbidden");
    await expect(
      establishRawSocket(`http://127.0.0.1:${proxy.port}`, "example.com", 443),
    ).rejects.toThrow(/CONNECT .* failed: .*403/);
  });
});
