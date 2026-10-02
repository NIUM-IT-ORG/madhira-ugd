import { EventEmitter } from 'node:events';

/**
 * Live updates: every change is broadcast to open browsers over Server-Sent Events, which pass through
 * ordinary HTTP proxies and load balancers. One server process keeps the subscribers in memory; to run
 * several processes, swap this for PostgreSQL LISTEN/NOTIFY.
 */
const bus = new EventEmitter();
bus.setMaxListeners(1000);

export function publish(event) {
  bus.emit('change', { ...event, at: new Date().toISOString() });
}

export function registerEvents(app) {
  app.get('/api/events', { preHandler: app.authenticate }, (req, reply) => {
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    reply.raw.write(`retry: 5000\n\n`);
    const send = (e) => reply.raw.write(`data: ${JSON.stringify(e)}\n\n`);
    const ping = setInterval(() => reply.raw.write(': ping\n\n'), 25000);
    bus.on('change', send);
    req.raw.on('close', () => {
      clearInterval(ping);
      bus.off('change', send);
    });
    reply.hijack();
  });
}
