import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';

const SEPARATOR = '\r\n';

const sendResponse = (socket, { status, headers, body }) => {
  // Status line
  socket.write(`HTTP/1.1 ${status}`);
  socket.write(SEPARATOR);

  // Headers
  if (headers) {
    Object.entries(headers).forEach(([key, value]) => {
      socket.write(`${key}: ${value}`);
      socket.write(SEPARATOR);
    });
  }
  socket.write(SEPARATOR);

  // Body
  if (body) socket.write(body);

  socket.end();
};

const server = createServer((socket) => {
  socket.on('data', async (data) => {
    try {
      const [startLineAndHeaders, body] = data.toString().split(SEPARATOR + SEPARATOR);
      const [startLine, ...headers] = startLineAndHeaders.split(SEPARATOR);
      const [method, path, _version] = startLine.split(' ');

      if (path === '/') {
        sendResponse(socket, {
          status: '200 OK',
        });
      } else if (path.startsWith('/echo')) {
        const randomString = path.split('echo/')[1];
        sendResponse(socket, {
          status: '200 OK',
          headers: {
            'Content-Type': 'text/plain',
            'Content-Length': randomString.length,
          },
          body: randomString,
        });
      } else if (path.startsWith('/user-agent')) {
        const userAgentHeader = headers.find((header) => header.startsWith('User-Agent'));
        const [_, userAgent] = userAgentHeader.split(' ');
        sendResponse(socket, {
          status: '200 OK',
          headers: {
            'Content-Type': 'text/plain',
            'Content-Length': userAgent.length,
          },
          body: userAgent,
        });
      } else if (path.startsWith('/files')) {
        const directoryFlagIndex = process.argv.findIndex((arg) => arg === '--directory');
        const directory = process.argv[directoryFlagIndex + 1];
        const [_, fileName] = path.split('files/');

        const filePath = join(directory, fileName);

        if (method === 'GET') {
          try {
            const file = await readFile(filePath);
            sendResponse(socket, {
              status: '200 OK',
              headers: {
                'Content-Type': 'application/octet-stream',
                'Content-Length': file.length,
              },
              body: file,
            });
          } catch (error) {
            sendResponse(socket, {
              status: '404 Not Found',
            });
          }
        } else if (method === 'POST') {
          await writeFile(filePath, body);
          sendResponse(socket, {
            status: '201 Created',
          });
        }
      } else {
        sendResponse(socket, {
          status: '404 Not Found',
        });
      }
    } catch (error) {
      sendResponse(socket, {
        status: '500 Internal Server Error',
      });
    }
  });

  socket.on('close', () => {
    socket.end();
    server.close();
  });
});

server.listen(4221, 'localhost', () => {
  console.log('Server started at http://localhost:4221');
});
