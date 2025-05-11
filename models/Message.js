const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  receiver: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  chat: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Chat'
  },
  content: {
    type: String,
    required: true
  },
  isDeleted: {
    type: Boolean,
    default: false
  },
  isPrivate: {
    type: Boolean,
    default: false
  },
  readBy: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }]
}, {
  timestamps: true
});

// 채팅방 메시지와 1:1 메시지 중 하나만 있어야 함
messageSchema.pre('save', function(next) {
  if (this.isPrivate && this.chat) {
    next(new Error('1:1 메시지는 채팅방을 가질 수 없습니다.'));
  }
  if (!this.isPrivate && this.receiver) {
    next(new Error('채팅방 메시지는 수신자를 가질 수 없습니다.'));
  }
  next();
});

module.exports = mongoose.model('Message', messageSchema); 