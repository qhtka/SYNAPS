const mongoose = require('mongoose');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

// ID 키 생성 함수
function generateUserId() {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

const userSchema = new mongoose.Schema({
  kakaoId: { type: String, required: true, unique: true },
  nickname: { type: String, required: true },
  userId: { 
    type: String, 
    required: true, 
    unique: true
  },
  friendCode: {
    type: String,
    required: true,
    unique: true,
    default: () => uuidv4()
  },
  friends: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  kakaoProfile: {
    thumbnailImage: String,
    profileImage: String
  },
  createdAt: { type: Date, default: Date.now },
  lastLogin: { type: Date, default: Date.now }
});

// 새 사용자 생성 시 ID 키와 친구 코드 생성
userSchema.pre('save', async function(next) {
  try {
    if (this.isNew) {
      console.log('새 사용자 생성 중...');
      
      // ID 키 생성
      let userId;
      let isUnique = false;
      let attempts = 0;
      const maxAttempts = 5;
      
      while (!isUnique && attempts < maxAttempts) {
        userId = generateUserId();
        const existingUser = await this.constructor.findOne({ userId });
        if (!existingUser) {
          isUnique = true;
        }
        attempts++;
      }
      
      if (!isUnique) {
        throw new Error('고유한 ID 키를 생성할 수 없습니다.');
      }
      
      this.userId = userId;
      console.log('생성된 ID 키:', userId);
      
      // 친구 코드가 없는 경우 생성
      if (!this.friendCode) {
        this.friendCode = uuidv4();
        console.log('생성된 친구 코드:', this.friendCode);
      }
    }
    
    // 마지막 로그인 시간 업데이트
    if (this.isModified('kakaoId')) {
      this.lastLogin = new Date();
    }
    
    next();
  } catch (error) {
    console.error('사용자 저장 중 에러:', error);
    next(error);
  }
});

module.exports = mongoose.model('User', userSchema); 