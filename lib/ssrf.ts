import net from "node:net";
import { lookup } from "node:dns/promises";

/**
 * SSRF guard for server-side URL fetching (e.g. /api/image-proxy).
 *
 * A user-supplied URL must not let the server reach internal/private network
 * destinations. We parse the URL, resolve its hostname to concrete IPs, and
 * reject if *any* resolved address falls in a loopback, link-local, RFC1918,
 * or otherwise reserved range. Callers should re-run `assertPublicUrl` on every
 * redirect target (or disable redirect following) so a public host can't bounce
 * the request to an internal one.
 *
 * Note: this validates DNS at check time; a determined attacker could in
 * principle rebind between this lookup and the fetch (TOCTOU). Pinning the
 * connection to the validated IP would defeat that but breaks TLS SNI, so we
 * accept the standard resolve-and-reject mitigation here.
 */
export class SsrfError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "SsrfError";
  }
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = (n << 8) | v;
  }
  return n >>> 0;
}

function isBlockedIpv4Int(n: number): boolean {
  const inRange = (base: string, bits: number) => {
    const b = ipv4ToInt(base)!;
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (n & mask) === (b & mask);
  };
  return (
    inRange("0.0.0.0", 8) || // "this" network
    inRange("10.0.0.0", 8) || // RFC1918
    inRange("100.64.0.0", 10) || // CGNAT
    inRange("127.0.0.0", 8) || // loopback
    inRange("169.254.0.0", 16) || // link-local
    inRange("172.16.0.0", 12) || // RFC1918
    inRange("192.0.0.0", 24) || // IETF protocol assignments
    inRange("192.0.2.0", 24) || // TEST-NET-1
    inRange("192.88.99.0", 24) || // 6to4 relay anycast
    inRange("192.168.0.0", 16) || // RFC1918
    inRange("198.18.0.0", 15) || // benchmarking
    inRange("198.51.100.0", 24) || // TEST-NET-2
    inRange("203.0.113.0", 24) || // TEST-NET-3
    inRange("224.0.0.0", 4) || // multicast
    inRange("240.0.0.0", 4) // reserved / broadcast
  );
}

/** Parse an IPv6 literal into its 16 octets, or null if unparseable. */
function ipv6ToBytes(input: string): number[] | null {
  let s = input.trim().toLowerCase();
  const zone = s.indexOf("%");
  if (zone >= 0) s = s.slice(0, zone);

  // Expand a trailing embedded IPv4 (e.g. ::ffff:127.0.0.1) into two hextets.
  const v4match = s.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (v4match && v4match.index !== undefined) {
    const v4 = ipv4ToInt(v4match[1]);
    if (v4 === null) return null;
    const h1 = ((v4 >>> 16) & 0xffff).toString(16);
    const h2 = (v4 & 0xffff).toString(16);
    s = s.slice(0, v4match.index) + h1 + ":" + h2;
  }

  const halves = s.split("::");
  if (halves.length > 2) return null;
  const expand = (seg: string) => (seg === "" ? [] : seg.split(":"));
  const head = expand(halves[0]);
  const tail = halves.length === 2 ? expand(halves[1]) : [];

  let groups: string[];
  if (halves.length === 2) {
    const missing = 8 - head.length - tail.length;
    if (missing < 0) return null;
    groups = [...head, ...Array(missing).fill("0"), ...tail];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;

  const bytes: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    const v = parseInt(g, 16);
    bytes.push((v >>> 8) & 0xff, v & 0xff);
  }
  return bytes;
}

function isBlockedIpv6Bytes(b: number[]): boolean {
  // IPv4-mapped (::ffff:0:0/96) — judge by the embedded IPv4 address.
  const mapped = b.slice(0, 10).every((x) => x === 0) && b[10] === 0xff && b[11] === 0xff;
  if (mapped) {
    const v4 = ((b[12] << 24) | (b[13] << 16) | (b[14] << 8) | b[15]) >>> 0;
    return isBlockedIpv4Int(v4);
  }
  // ::1 loopback / :: unspecified
  if (b.slice(0, 15).every((x) => x === 0)) return b[15] === 0 || b[15] === 1;
  // fc00::/7 unique-local
  if ((b[0] & 0xfe) === 0xfc) return true;
  // fe80::/10 link-local
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return true;
  // ff00::/8 multicast
  if (b[0] === 0xff) return true;
  return false;
}

/**
 * True if `ip` (a literal IPv4 or IPv6 address) is a loopback, private,
 * link-local, or otherwise reserved address that the proxy must not reach.
 * Anything that isn't a parseable IP is treated as blocked.
 */
export function isBlockedAddress(ip: string): boolean {
  const fam = net.isIP(ip);
  if (fam === 4) {
    const n = ipv4ToInt(ip);
    return n === null ? true : isBlockedIpv4Int(n);
  }
  if (fam === 6) {
    const b = ipv6ToBytes(ip);
    return b === null ? true : isBlockedIpv6Bytes(b);
  }
  return true;
}

/**
 * Validate that `rawUrl` is an http(s) URL whose host does not resolve to any
 * private/reserved address. Throws {@link SsrfError} otherwise. Call this for
 * the initial URL and again for every redirect target before following it.
 */
export async function assertPublicUrl(rawUrl: string): Promise<void> {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new SsrfError("invalid url");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new SsrfError("unsupported protocol");
  }

  const hostname = u.hostname;
  let addresses: string[];
  if (net.isIP(hostname)) {
    addresses = [hostname];
  } else {
    try {
      const resolved = await lookup(hostname, { all: true });
      addresses = resolved.map((r) => r.address);
    } catch {
      throw new SsrfError("dns resolution failed");
    }
  }

  if (addresses.length === 0) throw new SsrfError("no address");
  for (const addr of addresses) {
    if (isBlockedAddress(addr)) throw new SsrfError("private address");
  }
}
