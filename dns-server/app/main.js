import { createSocket } from 'node:dgram';
import { DnsQuery } from './dnsQuery.js';

const resolverArgIndex = process.argv.findIndex((arg) => arg === '--resolver');
const resolver = process.argv[resolverArgIndex + 1];

const server = createSocket('udp4');

server.on('error', (err) => {
  console.error(`Server error:\n${err.stack}`);
  server.close();
});

server.on('message', async (msg, rinfo) => {
  try {
    const dnsQuery = new DnsQuery(msg, resolver);
    const response = await dnsQuery.getResponse();

    server.send(response, rinfo.port, rinfo.address);
  } catch (e) {
    console.error('Error receiving data:', e);
  }
});

server.on('listening', () => {
  const address = server.address();
  console.log(`Server listening ${address.address}:${address.port}`);
});

server.bind(2053, '127.0.0.1');
