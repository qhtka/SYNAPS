const mongoose = require('mongoose');

const chatSchema = new mongoose.Schema({
  participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  messages: [{
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    content: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
    isDeleted: { type: Boolean, default: false }
  }],
  lastMessage: {
    content: String,
    timestamp: Date,
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  },
  readStatus: [{
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    lastReadMessageId: { type: mongoose.Schema.Types.ObjectId },
    lastReadTimestamp: { type: Date, default: Date.now }
  }],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// 마지막 메시지가 업데이트될 때마다 updatedAt 필드 갱신
chatSchema.pre('save', function(next) {
  if (this.isModified('messages')) {
    this.updatedAt = new Date();
    if (this.messages.length > 0) {
      const lastMsg = this.messages[this.messages.length - 1];
      this.lastMessage = {
        content: lastMsg.content,
        timestamp: lastMsg.timestamp,
        sender: lastMsg.sender
      };
    }
  }
  next();
});

module.exports = mongoose.model('Chat', chatSchema); 