/**
 * DNS Server for Focus Shield.
 * Intercepts DNS queries and blocks configured domains.
 */

import dns2 from 'dns2';
import { isDomainBlocked } from './store';

const { Packet } = dns2;

interface DnsServer {
  close: () => void;
}

let server: DnsServer | null = null;
const UPSTREAM_DNS = '8.8.8.8';
const DNS_PORT = 53;
const BLOCK_IP = '127.0.0.1'; // Redirect to localhost

const upstreamClient = new dns2({ dns: UPSTREAM_DNS });

interface DnsQuestion {
  name: string;
  type: number;
  class: number;
}

interface DnsAnswer {
  name: string;
  type: number;
  class: number;
  ttl: number;
  address?: string;
}

interface DnsPacket {
  header: { id: number; qr: number; rd: number; ra: number };
  questions: DnsQuestion[];
  answers: DnsAnswer[];
}

async function handleQuery(
  request: DnsPacket,
  send: (response: DnsPacket) => void,
): Promise<void> {
  const response: DnsPacket = {
    header: {
      id: request.header.id,
      qr: 1,
      rd: 1,
      ra: 1,
    },
    questions: request.questions,
    answers: [],
  };

  for (const question of request.questions) {
    const domain = question.name;

    if (question.type === Packet.TYPE.A) {
      if (isDomainBlocked(domain)) {
        console.log(`🚫 Blocked: ${domain}`);
        response.answers.push({
          name: domain,
          type: Packet.TYPE.A,
          class: Packet.CLASS.IN,
          ttl: 1,
          address: BLOCK_IP,
        });
      } else {
        try {
          const result = await upstreamClient.resolveA(domain);
          if (result.answers) {
            for (const answer of result.answers) {
              response.answers.push({
                name: domain,
                type: Packet.TYPE.A,
                class: Packet.CLASS.IN,
                ttl: answer.ttl || 300,
                address: answer.address,
              });
            }
          }
        } catch (err) {
          console.error(`DNS lookup failed for ${domain}:`, err);
        }
      }
    }
  }

  send(response);
}

/**
 * Start the DNS server.
 */
export async function startDnsServer(): Promise<void> {
  if (server) return;

  return new Promise((resolve, reject) => {
    const dnsServer = dns2.createServer({
      udp: true,
      handle: handleQuery as Parameters<typeof dns2.createServer>[0]['handle'],
    });

    dnsServer.on('error', (err: Error) => {
      console.error('DNS Server error:', err);
      reject(err);
    });

    dnsServer.on('listening', () => {
      console.log(`🛡️ DNS server running on port ${DNS_PORT}`);
      server = dnsServer;
      resolve();
    });

    dnsServer.listen({
      udp: {
        port: DNS_PORT,
        address: '127.0.0.1',
      },
    });
  });
}

/**
 * Stop the DNS server.
 */
export async function stopDnsServer(): Promise<void> {
  if (server) {
    server.close();
    server = null;
    console.log('DNS server stopped');
  }
}

/**
 * Check if DNS server is running.
 */
export function isDnsRunning(): boolean {
  return server !== null;
}
