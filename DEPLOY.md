# Gomoku Production Deploy

## Requirements

- Node.js 18+
- npm

## Upload And Start

```bash
tar -xzf gomoku-production.tar.gz
cd gomoku-production
npm ci --omit=dev
PORT=3001 npm start
```

Open:

```text
http://YOUR_SERVER_IP:3001
```

## Process Manager Example

```bash
npm install -g pm2
PORT=3001 pm2 start server/index.js --name gomoku
pm2 save
```

Run this app as a single PM2 process. Room state is in memory, so do not use `pm2 start -i max` or cluster mode unless you add sticky sessions plus a shared Socket.IO adapter such as Redis.

## Reverse Proxy Notes

If you put this behind Nginx, make sure WebSocket upgrade headers are enabled for Socket.IO.

```nginx
location / {
  proxy_pass http://127.0.0.1:3001;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header Host $host;
}
```
