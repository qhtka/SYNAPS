// server.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const passport = require('passport');
const KakaoStrategy = require('passport-kakao').Strategy;
const session = require('express-session');

// Express 서버와 HTTP 서버 생성
const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// 세션 설정
app.use(session({
  secret: 'your-secret-key',
  resave: false,
  saveUninitialized: false
}));

// Passport 초기화
app.use(passport.initialize());
app.use(passport.session());

// Passport 직렬화/역직렬화 설정
passport.serializeUser((user, done) => {
  done(null, user);
});

passport.deserializeUser((user, done) => {
  done(null, user);
});

// Kakao 전략 설정
passport.use(new KakaoStrategy({
    clientID: 'YOUR_KAKAO_CLIENT_ID', // 카카오 개발자 센터에서 발급받은 클라이언트 ID
    clientSecret: 'YOUR_KAKAO_CLIENT_SECRET', // 카카오 개발자 센터에서 발급받은 클라이언트 시크릿
    callbackURL: 'http://localhost:3000/auth/kakao/callback'
  },
  (accessToken, refreshToken, profile, done) => {
    // 여기서 사용자 정보를 DB에 저장하거나 처리할 수 있습니다
    return done(null, {
      id: profile.id,
      nickname: profile.displayName,
      provider: 'kakao'
    });
  }
));

// static 파일을 제공할 경로 설정 (HTML, CSS, JS)
app.use(express.static(__dirname));  // 루트 디렉토리의 파일들 제공
app.use('/public', express.static(path.join(__dirname, 'public')));  // public 디렉토리 파일들 제공

// 카카오 로그인 라우트
app.get('/auth/kakao', passport.authenticate('kakao'));

// 카카오 로그인 콜백 라우트
app.get('/auth/kakao/callback',
  passport.authenticate('kakao', { failureRedirect: '/' }),
  (req, res) => {
    res.redirect('/');
  }
);

// 로그인 상태 확인 API
app.get('/api/user', (req, res) => {
  if (req.isAuthenticated()) {
    res.json({ user: req.user });
  } else {
    res.json({ user: null });
  }
});

// 로그아웃 API
app.get('/auth/logout', (req, res) => {
  req.logout(() => {
    res.redirect('/');
  });
});

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