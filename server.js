// server.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const passport = require('passport');
const KakaoStrategy = require('passport-kakao').Strategy;
const session = require('express-session');
const mongoose = require('mongoose');
const User = require('./models/User');
const Chat = require('./models/Chat');

// MongoDB 연결
mongoose.connect('mongodb://localhost:27017/synaps', {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log('MongoDB connected');
}).catch(err => {
  console.error('MongoDB connection error:', err);
});

// Express 서버와 HTTP 서버 생성
const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// 미들웨어 설정
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (error) {
    done(error, null);
  }
});

// Kakao 전략 설정
passport.use(new KakaoStrategy({
    clientID: '184c354ac0856bbcd8097bc8da3e805b',
    clientSecret: '',
    callbackURL: 'http://localhost:3000/auth/kakao/callback'
  },
  async (accessToken, refreshToken, profile, done) => {
    try {
      let user = await User.findOne({ kakaoId: profile.id });
      
      if (!user) {
        user = await User.create({
          kakaoId: profile.id,
          nickname: profile.displayName
        });
      }
      
      return done(null, user);
    } catch (error) {
      return done(error, null);
    }
  }
));

// static 파일을 제공할 경로 설정
app.use(express.static(__dirname));
app.use('/public', express.static(path.join(__dirname, 'public')));

// API 라우트
// 친구 추가
app.post('/api/friends/add', async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: '로그인이 필요합니다.' });
  }

  try {
    const { friendId } = req.body;
    const user = await User.findById(req.user.id);
    const friend = await User.findById(friendId);

    if (!friend) {
      return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    }

    if (user.friends.includes(friendId)) {
      return res.status(400).json({ error: '이미 친구입니다.' });
    }

    user.friends.push(friendId);
    await user.save();

    res.json({ message: '친구가 추가되었습니다.' });
  } catch (error) {
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// 친구 목록 조회
app.get('/api/friends', async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: '로그인이 필요합니다.' });
  }

  try {
    const user = await User.findById(req.user.id).populate('friends');
    res.json({ friends: user.friends });
  } catch (error) {
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// 채팅 내역 조회
app.get('/api/chats/:friendId', async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: '로그인이 필요합니다.' });
  }

  try {
    const chat = await Chat.findOne({
      participants: { $all: [req.user.id, req.params.friendId] }
    }).populate('messages.sender', 'nickname');

    if (!chat) {
      return res.json({ messages: [] });
    }

    res.json({ messages: chat.messages });
  } catch (error) {
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

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

// 사용자 검색 API
app.get('/api/users/search', async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: '로그인이 필요합니다.' });
  }

  try {
    const { nickname } = req.query;
    const user = await User.findOne({ 
      nickname: nickname,
      _id: { $ne: req.user.id } // 자기 자신 제외
    });

    if (!user) {
      return res.json({ user: null });
    }

    res.json({ user: { id: user._id, nickname: user.nickname } });
  } catch (error) {
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// Socket.IO 연결 처리
const connectedUsers = new Map();

io.on('connection', async (socket) => {
  console.log('A user connected');

  // 사용자 인증
  socket.on('authenticate', async (userId) => {
    try {
      const user = await User.findById(userId);
      if (user) {
        connectedUsers.set(userId, socket.id);
        socket.userId = userId;
      }
    } catch (error) {
      console.error('Authentication error:', error);
    }
  });

  // 채팅 메시지 처리
  socket.on('chat message', async (data) => {
    if (!socket.userId) return;

    try {
      const { friendId, message } = data;
      const sender = await User.findById(socket.userId);
      
      // 채팅방 찾기 또는 생성
      let chat = await Chat.findOne({
        participants: { $all: [socket.userId, friendId] }
      });

      if (!chat) {
        chat = await Chat.create({
          participants: [socket.userId, friendId],
          messages: []
        });
      }

      // 메시지 저장
      chat.messages.push({
        sender: socket.userId,
        content: message,
        timestamp: new Date()
      });
      await chat.save();

      // 메시지 전송
      const friendSocketId = connectedUsers.get(friendId);
      if (friendSocketId) {
        io.to(friendSocketId).emit('chat message', {
          sender: sender.nickname,
          content: message,
          timestamp: new Date()
        });
      }

      // 발신자에게도 메시지 전송
      socket.emit('chat message', {
        sender: sender.nickname,
        content: message,
        timestamp: new Date()
      });
    } catch (error) {
      console.error('Chat message error:', error);
    }
  });

  // 연결 종료 처리
  socket.on('disconnect', () => {
    if (socket.userId) {
      connectedUsers.delete(socket.userId);
    }
    console.log('A user disconnected');
  });
});

// 서버 포트 설정
server.listen(3000, () => {
  console.log('Server running on port 3000');
});