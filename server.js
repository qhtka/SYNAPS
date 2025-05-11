// server.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

// Express 서버와 HTTP 서버 생성
const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// static 파일을 제공할 경로 설정 (HTML, CSS, JS)
app.use(express.static('public'));

// 사용자가 접속했을 때 처리
io.on('connection', (socket) => {
  console.log('A user connected');

  // 클라이언트에서 메시지가 들어오면 처리
  socket.on('chat message', (msg) => {
    console.log('Message received: ' + msg);
    io.emit('chat message', msg); // 모든 클라이언트에 메시지 전송
  });

  // 사용자가 접속을 종료했을 때 처리
  socket.on('disconnect', () => {
    console.log('A user disconnected');
  });
});

// 서버 포트 설정 (3000번 포트)
server.listen(3000, () => {
  console.log('Server running on port 3000');
});