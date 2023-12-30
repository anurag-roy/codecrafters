import { Resolver } from 'node:dns/promises';

export class DnsQuery {
  HEADER_LENGTH = 12;

  buffer;
  resolver;
  header = {};
  questionsBuffer;
  questions = [];

  /**
   * @constructor DnsQuery
   * @param {Buffer} buffer Buffer containing the DNS query.
   * @param {string} resolver Resolver to use for the DNS query.
   */
  constructor(buffer, resolver) {
    this.buffer = buffer;
    if (resolver) {
      this.resolver = new Resolver();
      this.resolver.setServers([resolver]);
    }
    this.constructHeader();
    this.constructQuestions();
  }

  /**
   * Parses the header of a DNS message.
   */
  constructHeader() {
    const headerBuffer = this.buffer.subarray(0, this.HEADER_LENGTH);

    this.header.id = headerBuffer.readUInt16BE(0); // ID
    const flags = headerBuffer.readUInt16BE(2); // Flags
    this.header.qr = flags >> 15; // QR
    this.header.opcode = (flags >> 11) & 0b1111; // OPCODE
    this.header.aa = (flags >> 10) & 0b1; // AA
    this.header.tc = (flags >> 9) & 0b1; // TC
    this.header.rd = (flags >> 8) & 0b1; // RD
    this.header.ra = (flags >> 7) & 0b1; // RA
    this.header.z = (flags >> 4) & 0b111; // Z
    this.header.rcode = flags & 0b1111; // RCODE

    this.header.qdcount = headerBuffer.readUInt16BE(4); // QDCOUNT
    this.header.ancount = headerBuffer.readUInt16BE(6); // ANCOUNT
    this.header.nscount = headerBuffer.readUInt16BE(8); // NSCOUNT
    this.header.arcount = headerBuffer.readUInt16BE(10); // ARCOUNT
  }

  /**
   * Parses the question section of a DNS message.
   */
  constructQuestions() {
    this.questionsBuffer = this.buffer.subarray(this.HEADER_LENGTH);

    let offset = this.HEADER_LENGTH;
    for (let i = 0; i < this.header.qdcount; i++) {
      const { labels, offset: newOffset } = this.getLabels(offset);
      offset = newOffset;

      this.questions.push({
        labels,
        domainLength: labels.reduce((acc, label) => acc + label.length, 0),
        type: this.buffer.readUInt16BE(offset + 1),
        class: this.buffer.readUInt16BE(offset + 3),
      });

      offset += 5;
    }
  }

  getLabels(offset) {
    const labels = [];
    while (this.buffer[offset] !== 0) {
      const length = this.buffer[offset];
      // Pointer handling
      if (length >= 192) {
        const pointer = this.buffer.readUInt16BE(offset) & 0b0011111111111111;
        labels.push(...this.getLabels(pointer).labels);
        offset += 1;
        break;
      }

      // Label handling
      labels.push(this.buffer.subarray(offset + 1, offset + length + 1).toString());
      offset += length + 1;
    }

    return { labels, offset };
  }

  async resolveHostname(question) {
    let ipAddress = '1.1.1.1';
    if (this.resolver) {
      try {
        const response = await this.resolver.resolve4(question.labels.join('.'));
        ipAddress = response[0];
      } catch (error) {
        console.error('Failed to resolve hostname, returning fallback address 1.1.1.1', error);
      }
    }

    return ipAddress;
  }

  get responseHeader() {
    const responseHeaders = {
      ...this.header,
      qr: 1,
      aa: 0,
      tc: 0,
      ra: 0,
      rcode: this.header.opcode === 0 ? 0 : 4,
      ancount: this.header.qdcount,
    };
    const responseHeader = Buffer.alloc(this.HEADER_LENGTH);

    // ID
    responseHeader.writeUInt16BE(responseHeaders.id, 0); // ID

    // Flags
    const flags =
      (responseHeaders.qr << 15) |
      (responseHeaders.opcode << 11) |
      (responseHeaders.aa << 10) |
      (responseHeaders.tc << 9) |
      (responseHeaders.rd << 8) |
      (responseHeaders.ra << 7) |
      (responseHeaders.z << 4) |
      responseHeaders.rcode;
    responseHeader.writeUint16BE(flags, 2);

    // Counts
    responseHeader.writeUInt16BE(responseHeaders.qdcount, 4); // QDCOUNT
    responseHeader.writeUInt16BE(responseHeaders.ancount, 6); // ANCOUNT
    responseHeader.writeUInt16BE(responseHeaders.nscount, 8); // NSCOUNT
    responseHeader.writeUInt16BE(responseHeaders.arcount, 10); // ARCOUNT

    return responseHeader;
  }

  get responseQuestion() {
    return this.questionsBuffer;
  }

  async getResponseAnswer() {
    const answers = [];

    for (const question of this.questions) {
      const answer = Buffer.alloc(question.domainLength + (question.labels.length - 1) + 16);
      const ipAddress = await this.resolveHostname(question);

      let offset = 0;
      for (const label of question.labels) {
        const len = label.length;
        answer[offset] = len;
        answer.write(label, offset + 1);
        offset += len + 1;
      }
      answer[offset] = 0;

      answer.writeUInt16BE(question.type, offset + 1); // QTYPE
      answer.writeUInt16BE(question.class, offset + 3); // QCLASS
      answer.writeUInt32BE(1, offset + 5); // TTL
      answer.writeUInt16BE(4, offset + 9); // RDLENGTH

      const data = ipAddress.split('.').map((x) => parseInt(x, 10));
      answer.set(data, offset + 11);

      answers.push(answer);
    }

    return Buffer.concat(answers);
  }

  async getResponse() {
    return Buffer.concat([
      this.responseHeader,
      this.responseQuestion,
      await this.getResponseAnswer(),
    ]);
  }
}
