const express = require('express');
const http = require('http');
const path = require('path');
const socketIo = require('socket.io');
const socketHandlers = require('./src/socket/socketHandlers');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: '*',
  },
});

const PORT = process.env.PORT || 3001;

app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

socketHandlers(io);

server.listen(PORT, () => {
  console.log(`Battle System 서버 실행 중: http://localhost:${PORT}`);
});
