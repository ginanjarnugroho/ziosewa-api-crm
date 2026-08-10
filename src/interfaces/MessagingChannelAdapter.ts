export interface SendMessagePayload {
  to: string;
  message: string;
  idempotency_key: string;
}

export interface MessagingChannelAdapter {
  connect(deviceId: string, deviceIdentifier: string): Promise<void>;
  disconnect(deviceId: string): Promise<void>;
  sendText(deviceId: string, payload: SendMessagePayload): Promise<any>;
  sendMedia?(deviceId: string, payload: { to: string, caption?: string, url?: string, mimetype?: string, filename?: string }, fileBuffer?: Buffer): Promise<any>;
  markAsRead?(deviceId: string, remoteJid: string, messageId: string): Promise<void>;
  getStatus(deviceId: string): Promise<string>;
}
