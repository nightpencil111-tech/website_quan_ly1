// Lỗi nghiệp vụ: message là câu tiếng Việt hiển thị trực tiếp cho người dùng.
class AppError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AppError';
  }
}

module.exports = { AppError };
