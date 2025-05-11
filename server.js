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
const Message = require('./models/Message');
const crypto = require('crypto');
const Friend = require('./models/Friend');
const { v4: uuidv4 } = require('uuid');

// MongoDB 연결
mongoose.connect('mongodb://localhost:27017/synaps', {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(async () => {
  console.log('MongoDB connected');
  
  // 기존 사용자의 ID 키 업데이트
  try {
    const users = await User.find({ userId: { $exists: false } });
    console.log(`ID 키가 없는 사용자 ${users.length}명 발견`);
    
    for (const user of users) {
      let userId;
      let isUnique = false;
      let attempts = 0;
      const maxAttempts = 5;
      
      while (!isUnique && attempts < maxAttempts) {
        userId = crypto.randomBytes(4).toString('hex').toUpperCase();
        const existingUser = await User.findOne({ userId });
        if (!existingUser) {
          isUnique = true;
        }
        attempts++;
      }
      
      if (isUnique) {
        user.userId = userId;
        if (!user.friendCode) {
          user.friendCode = uuidv4();
        }
        await user.save();
        console.log(`사용자 ${user.nickname}의 ID 키 업데이트: ${userId}`);
      } else {
        console.error(`사용자 ${user.nickname}의 ID 키 생성 실패`);
      }
    }
  } catch (error) {
    console.error('기존 사용자 ID 키 업데이트 중 에러:', error);
  }
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
  saveUninitialized: false,
  cookie: {
    secure: false, // 개발 환경에서는 false
    maxAge: 24 * 60 * 60 * 1000 // 24시간
  }
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
    clientSecret: '6MvUhQ3J60Qj4HASZxvGoiHEmrt40sFe',
    callbackURL: 'http://localhost:3000/auth/kakao/callback'
  },
  async (accessToken, refreshToken, profile, done) => {
    try {
      console.log('Kakao profile:', profile);
      
      let user = await User.findOne({ kakaoId: profile.id });
      
      if (!user) {
        // 카카오 프로필에서 필요한 정보 추출
        const nickname = profile.displayName || profile.username || `User${profile.id}`;
        
        // 새 사용자 생성
        user = new User({
          kakaoId: profile.id,
          nickname: nickname,
          kakaoProfile: {
            thumbnailImage: profile._json?.properties?.thumbnail_image,
            profileImage: profile._json?.properties?.profile_image
          }
        });
        
        // 사용자 저장 (pre-save 미들웨어에서 ID 키가 생성됨)
        await user.save();
        console.log('New user created:', user);
      } else {
        // 기존 사용자의 카카오 프로필 정보 업데이트
        user.nickname = profile.displayName || profile.username || user.nickname;
        user.kakaoProfile = {
          thumbnailImage: profile._json?.properties?.thumbnail_image || user.kakaoProfile?.thumbnailImage,
          profileImage: profile._json?.properties?.profile_image || user.kakaoProfile?.profileImage
        };
        await user.save();
      }
      
      return done(null, user);
    } catch (error) {
      console.error('Kakao strategy error:', error);
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
    const user = await User.findById(req.user.id)
      .populate('friends', 'nickname userId friendCode kakaoProfile');

    const friends = user.friends.map(friend => ({
      id: friend._id,
      nickname: friend.nickname,
      userId: friend.userId,
      friendCode: friend.friendCode,
      profileImage: friend.kakaoProfile?.profileImage || friend.kakaoProfile?.thumbnailImage
    }));

    res.json({ friends });
  } catch (error) {
    console.error('친구 목록 조회 에러:', error);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// 채팅 내역 조회 API 수정
app.get('/api/chats/:friendId', async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: '로그인이 필요합니다.' });
  }

  try {
    const chat = await Chat.findOne({
      participants: { $all: [req.user.id, req.params.friendId] }
    }).populate('messages.sender', 'nickname')
      .populate('lastMessage.sender', 'nickname');

    if (!chat) {
      return res.json({ 
        messages: [],
        lastMessage: null,
        unreadCount: 0
      });
    }

    // 읽음 상태 업데이트
    const userReadStatus = chat.readStatus.find(status => 
      status.user.toString() === req.user.id
    );

    if (userReadStatus) {
      userReadStatus.lastReadMessageId = chat.messages[chat.messages.length - 1]?._id;
      userReadStatus.lastReadTimestamp = new Date();
    } else {
      chat.readStatus.push({
        user: req.user.id,
        lastReadMessageId: chat.messages[chat.messages.length - 1]?._id,
        lastReadTimestamp: new Date()
      });
    }
    await chat.save();

    // 안읽은 메시지 수 계산
    const unreadCount = chat.messages.filter(msg => 
      !msg.isDeleted && 
      msg.sender.toString() !== req.user.id &&
      (!userReadStatus || msg.timestamp > userReadStatus.lastReadTimestamp)
    ).length;

    res.json({ 
      messages: chat.messages.filter(msg => !msg.isDeleted),
      lastMessage: chat.lastMessage,
      unreadCount
    });
  } catch (error) {
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// 채팅방 목록 조회 API 추가
app.get('/api/chats', async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: '로그인이 필요합니다.' });
  }

  try {
    const chats = await Chat.find({
      participants: req.user.id
    })
    .populate('participants', 'nickname')
    .populate('lastMessage.sender', 'nickname')
    .sort({ updatedAt: -1 });

    const chatList = await Promise.all(chats.map(async chat => {
      const otherParticipant = chat.participants.find(p => 
        p._id.toString() !== req.user.id
      );
      
      const userReadStatus = chat.readStatus.find(status => 
        status.user.toString() === req.user.id
      );

      const unreadCount = chat.messages.filter(msg => 
        !msg.isDeleted && 
        msg.sender.toString() !== req.user.id &&
        (!userReadStatus || msg.timestamp > userReadStatus.lastReadTimestamp)
      ).length;

      return {
        id: chat._id,
        participant: otherParticipant,
        lastMessage: chat.lastMessage,
        unreadCount,
        updatedAt: chat.updatedAt
      };
    }));

    res.json({ chats: chatList });
  } catch (error) {
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// 메시지 삭제 API 추가
app.delete('/api/chats/:chatId/messages/:messageId', async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: '로그인이 필요합니다.' });
  }

  try {
    const chat = await Chat.findById(req.params.chatId);
    if (!chat) {
      return res.status(404).json({ error: '채팅방을 찾을 수 없습니다.' });
    }

    const message = chat.messages.id(req.params.messageId);
    if (!message) {
      return res.status(404).json({ error: '메시지를 찾을 수 없습니다.' });
    }

    if (message.sender.toString() !== req.user.id) {
      return res.status(403).json({ error: '메시지를 삭제할 권한이 없습니다.' });
    }

    message.isDeleted = true;
    await chat.save();

    // 소켓을 통해 메시지 삭제 알림
    chat.participants.forEach(participantId => {
      const socketId = connectedUsers.get(participantId.toString());
      if (socketId) {
        io.to(socketId).emit('message deleted', {
          chatId: chat._id,
          messageId: message._id
        });
      }
    });

    res.json({ message: '메시지가 삭제되었습니다.' });
  } catch (error) {
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// 카카오 로그인 라우트 수정
app.get('/auth/kakao', (req, res, next) => {
  console.log('Kakao login requested'); // 디버깅을 위한 로그 추가
  passport.authenticate('kakao', {
    scope: ['profile_nickname', 'profile_image'] // 필요한 스코프 추가
  })(req, res, next);
});

// 카카오 로그인 콜백 라우트 수정
app.get('/auth/kakao/callback',
  (req, res, next) => {
    console.log('Kakao callback received'); // 디버깅을 위한 로그 추가
    passport.authenticate('kakao', { 
      failureRedirect: '/',
      failureMessage: true
    })(req, res, next);
  },
  (req, res) => {
    console.log('Kakao authentication successful'); // 디버깅을 위한 로그 추가
    res.redirect('/');
  }
);

// 로그인 상태 확인 API
app.get('/api/user', (req, res) => {
  console.log('=== /api/user API 호출 ===');
  console.log('Session ID:', req.sessionID);
  console.log('Session:', JSON.stringify(req.session, null, 2));
  console.log('User:', req.user ? JSON.stringify(req.user, null, 2) : 'undefined');
  
  if (req.isAuthenticated()) {
    const userData = {
      id: req.user._id,
      nickname: req.user.nickname,
      userId: req.user.userId,
      friendCode: req.user.friendCode,
      kakaoProfile: req.user.kakaoProfile
    };
    console.log('인증된 사용자 데이터:', JSON.stringify(userData, null, 2));
    res.json({ user: userData });
  } else {
    console.log('인증되지 않은 사용자');
    res.json({ user: null });
  }
});

// 로그아웃 API
app.get('/auth/logout', (req, res) => {
  req.logout(() => {
    res.redirect('/');
  });
});

// 사용자 검색 API 수정
app.get('/api/users/search', async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: '로그인이 필요합니다.' });
  }

  try {
    const { userId } = req.query;
    const user = await User.findOne({ 
      userId: userId.toUpperCase(),
      _id: { $ne: req.user.id } // 자기 자신 제외
    });

    if (!user) {
      return res.json({ user: null, message: '해당 ID를 가진 사용자를 찾을 수 없습니다.' });
    }

    res.json({ 
      user: { 
        id: user._id, 
        nickname: user.nickname,
        userId: user.userId
      },
      message: `${user.nickname}님을 찾았습니다.`
    });
  } catch (error) {
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// 1:1 메시지 전송 API
app.post('/api/messages/private', async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: '로그인이 필요합니다.' });
  }

  try {
    const { receiverId, content } = req.body;
    
    // 수신자가 친구인지 확인
    const sender = await User.findById(req.user.id);
    if (!sender.friends.includes(receiverId)) {
      return res.status(403).json({ error: '친구에게만 메시지를 보낼 수 있습니다.' });
    }

    const message = new Message({
      sender: req.user.id,
      receiver: receiverId,
      content,
      isPrivate: true
    });

    await message.save();
    res.json({ message: '메시지가 전송되었습니다.' });
  } catch (error) {
    console.error('메시지 전송 실패:', error);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// 1:1 메시지 조회 API
app.get('/api/messages/private/:friendId', async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: '로그인이 필요합니다.' });
  }

  try {
    const { friendId } = req.params;
    
    // 친구 관계 확인
    const user = await User.findById(req.user.id);
    if (!user.friends.includes(friendId)) {
      return res.status(403).json({ error: '친구와의 대화만 조회할 수 있습니다.' });
    }

    const messages = await Message.find({
      $or: [
        { sender: req.user.id, receiver: friendId },
        { sender: friendId, receiver: req.user.id }
      ],
      isPrivate: true
    })
    .sort({ createdAt: 1 })
    .populate('sender', 'nickname')
    .populate('receiver', 'nickname');

    res.json({ 
      messages: messages.map(msg => ({
        id: msg._id,
        content: msg.content,
        sender: msg.sender._id,
        receiver: msg.receiver._id,
        createdAt: msg.createdAt,
        isDeleted: msg.isDeleted
      }))
    });
  } catch (error) {
    console.error('메시지 조회 실패:', error);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// 사용자 정보 조회 API 수정
app.get('/api/users/me', async (req, res) => {
  console.log('=== /api/users/me API 호출 ===');
  console.log('Session ID:', req.sessionID);
  console.log('Session:', JSON.stringify(req.session, null, 2));
  console.log('User:', req.user ? JSON.stringify(req.user, null, 2) : 'undefined');
  
  if (!req.isAuthenticated()) {
    console.log('인증되지 않은 사용자');
    return res.status(401).json({ error: '로그인이 필요합니다.' });
  }

  try {
    console.log('사용자 ID로 DB 조회:', req.user.id);
    const user = await User.findById(req.user.id);
    console.log('DB에서 조회된 사용자:', user ? JSON.stringify(user, null, 2) : 'null');
    
    if (!user) {
      console.log('DB에서 사용자를 찾을 수 없음');
      return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    }

    const userData = {
      id: user._id,
      nickname: user.nickname,
      userId: user.userId,
      friendCode: user.friendCode,
      kakaoProfile: user.kakaoProfile
    };
    
    console.log('클라이언트에 전송할 데이터:', JSON.stringify(userData, null, 2));
    res.json({ user: userData });
  } catch (error) {
    console.error('사용자 정보 조회 중 에러:', error);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// ID 키 변경 API 추가
app.post('/api/users/change-id', async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: '로그인이 필요합니다.' });
  }

  try {
    const user = await User.findById(req.user.id);
    const newUserId = crypto.randomBytes(4).toString('hex').toUpperCase();
    
    // 새 ID가 이미 존재하는지 확인
    const existingUser = await User.findOne({ userId: newUserId });
    if (existingUser) {
      return res.status(400).json({ error: '새로운 ID 생성 중 오류가 발생했습니다. 다시 시도해주세요.' });
    }

    user.userId = newUserId;
    await user.save();

    res.json({ 
      message: 'ID가 성공적으로 변경되었습니다.',
      newUserId: user.userId
    });
  } catch (error) {
    console.error('ID 변경 실패:', error);
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

  // 채팅 메시지 처리 수정
  socket.on('chat message', async (data) => {
    if (!socket.userId) return;

    try {
      const { friendId, message } = data;
      const sender = await User.findById(socket.userId);
      
      let chat = await Chat.findOne({
        participants: { $all: [socket.userId, friendId] }
      });

      if (!chat) {
        chat = await Chat.create({
          participants: [socket.userId, friendId],
          messages: [],
          readStatus: [
            { user: socket.userId, lastReadTimestamp: new Date() }
          ]
        });
      }

      const newMessage = {
        sender: socket.userId,
        content: message,
        timestamp: new Date()
      };

      chat.messages.push(newMessage);
      await chat.save();

      // 상대방의 읽음 상태 업데이트
      const friendReadStatus = chat.readStatus.find(status => 
        status.user.toString() === friendId
      );
      if (friendReadStatus) {
        friendReadStatus.lastReadTimestamp = new Date();
      }

      // 메시지 전송
      const friendSocketId = connectedUsers.get(friendId);
      if (friendSocketId) {
        io.to(friendSocketId).emit('chat message', {
          chatId: chat._id,
          message: {
            ...newMessage,
            sender: sender.nickname
          },
          unreadCount: chat.messages.filter(msg => 
            !msg.isDeleted && 
            msg.sender.toString() !== friendId &&
            (!friendReadStatus || msg.timestamp > friendReadStatus.lastReadTimestamp)
          ).length
        });
      }

      // 발신자에게도 메시지 전송
      socket.emit('chat message', {
        chatId: chat._id,
        message: {
          ...newMessage,
          sender: sender.nickname
        }
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

// 친구 요청 보내기
app.post('/api/friends/request', async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: '로그인이 필요합니다.' });
  }

  const { friendCode } = req.body;
  if (!friendCode) {
    return res.status(400).json({ error: '친구 코드가 필요합니다.' });
  }

  try {
    // 친구 코드로 사용자 찾기
    const friend = await User.findOne({ friendCode });
    if (!friend) {
      return res.status(404).json({ error: '존재하지 않는 친구 코드입니다.' });
    }

    // 자기 자신에게 요청을 보내는 경우 방지
    if (friend._id.toString() === req.user.id) {
      return res.status(400).json({ error: '자기 자신에게 친구 요청을 보낼 수 없습니다.' });
    }

    // 이미 친구 관계가 있는지 확인
    const existingFriend = await Friend.findOne({
      $or: [
        { user: req.user.id, friend: friend._id },
        { user: friend._id, friend: req.user.id }
      ]
    });

    if (existingFriend) {
      return res.status(400).json({ error: '이미 친구 관계가 존재합니다.' });
    }

    // 친구 요청 생성
    const friendRequest = new Friend({
      user: req.user.id,
      friend: friend._id,
      status: 'pending'
    });

    await friendRequest.save();
    res.json({ message: '친구 요청이 전송되었습니다.' });
  } catch (error) {
    console.error('친구 요청 에러:', error);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// 친구 요청 수락/거절
app.put('/api/friends/:requestId', async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: '로그인이 필요합니다.' });
  }

  const { requestId } = req.params;
  const { status } = req.body;

  if (!['accepted', 'rejected'].includes(status)) {
    return res.status(400).json({ error: '잘못된 상태값입니다.' });
  }

  try {
    const friendRequest = await Friend.findOne({
      _id: requestId,
      friend: req.user.id,
      status: 'pending'
    });

    if (!friendRequest) {
      return res.status(404).json({ error: '친구 요청을 찾을 수 없습니다.' });
    }

    friendRequest.status = status;
    await friendRequest.save();

    // 요청이 수락된 경우 양방향 친구 관계 설정
    if (status === 'accepted') {
      const user = await User.findById(req.user.id);
      const friend = await User.findById(friendRequest.user);
      
      if (!user.friends.includes(friendRequest.user)) {
        user.friends.push(friendRequest.user);
        await user.save();
      }
      
      if (!friend.friends.includes(req.user.id)) {
        friend.friends.push(req.user.id);
        await friend.save();
      }
    }

    res.json({ message: status === 'accepted' ? '친구 요청을 수락했습니다.' : '친구 요청을 거절했습니다.' });
  } catch (error) {
    console.error('친구 요청 처리 에러:', error);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// 받은 친구 요청 목록 조회
app.get('/api/friends/requests', async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: '로그인이 필요합니다.' });
  }

  try {
    const requests = await Friend.find({
      friend: req.user.id,
      status: 'pending'
    }).populate('user', 'nickname userId friendCode kakaoProfile');

    const formattedRequests = requests.map(request => ({
      id: request._id,
      user: {
        id: request.user._id,
        nickname: request.user.nickname,
        userId: request.user.userId,
        friendCode: request.user.friendCode,
        profileImage: request.user.kakaoProfile?.profileImage || request.user.kakaoProfile?.thumbnailImage
      },
      createdAt: request.createdAt
    }));

    res.json({ requests: formattedRequests });
  } catch (error) {
    console.error('친구 요청 목록 조회 에러:', error);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// 서버 포트 설정
server.listen(3000, () => {
  console.log('Server running on port 3000');
});