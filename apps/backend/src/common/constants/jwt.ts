/** JWT 密钥统一出口:HTTP 策略与 WebSocket 网关握手共用,避免双份漂移 */
export const JWT_SECRET =
  process.env.JWT_SECRET || 'zxh-jwt-secret-change-me-in-production';
