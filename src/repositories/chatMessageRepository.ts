import { prisma } from './prisma';

/**
 * Mencari pesan berdasarkan ID WAHA yang tepat (Exact Match).
 * Digunakan untuk mengecek apakah sebuah pesan Webhook sudah pernah dimasukkan ke Database (Deduplikasi).
 */
export async function findMessageByWahaId(deviceId: string, remoteJid: string, messageId: string) {
  return prisma.chatMessage.findUnique({
    where: { deviceId_remoteJid_messageId: { deviceId, remoteJid, messageId } }
  });
}

/**
 * Mencari pesan keluar (outbound) yang baru saja dikirimkan dalam 60 detik terakhir.
 * Berguna pada fitur Optimistic UI di mana Frontend membuat "Temporary ID" (msg_1234),
 * dan kita harus menemukan pesan tersebut untuk di-update dengan ID WAHA yang asli.
 */
export async function findRecentOutboundMessage(deviceId: string, remoteJid: string, text: string) {
  return prisma.chatMessage.findFirst({
    where: {
      deviceId,
      remoteJid,
      isFromMe: true,
      text, // Validasi teks harus sama persis
      messageId: { startsWith: 'msg_' }, // ID sementara bawaan Frontend
      timestamp: { gte: new Date(Date.now() - 60000) } // Rentang waktu mundur 1 menit
    },
    orderBy: { timestamp: 'asc' }
  });
}

/**
 * Mencari pesan berdasarkan Short ID (Versi pendek dari Serialized ID WAHA).
 * Diperlukan karena Event Acknowledgment (ACK) terkadang tidak menyertakan awalan `true_628xxx_`.
 */
export async function findMessageByShortId(shortId: string) {
  return prisma.chatMessage.findFirst({
    where: {
      OR: [
        { messageId: { equals: shortId, mode: 'insensitive' } },
        { messageId: { endsWith: shortId, mode: 'insensitive' } },
        { messageId: { contains: shortId, mode: 'insensitive' } }
      ]
    }
  });
}

/**
 * Menyimpan pesan masuk/keluar baru, atau abaikan pembaruan status jika pesan sudah ada 
 * guna menghindari "Race Condition" yang menurunkan centang biru menjadi centang abu-abu.
 */
export async function upsertMessage(data: {
  tenantId: string;
  deviceId: string;
  remoteJid: string;
  messageId: string;
  isFromMe: boolean;
  text: string;
  messageType: any;
  mediaUrl: string | null;
  mediaPath: string | null;
  replyToMessageId: string | null;
  timestamp: Date;
  status: any;
}) {
  return prisma.chatMessage.upsert({
    where: { deviceId_remoteJid_messageId: { deviceId: data.deviceId, remoteJid: data.remoteJid, messageId: data.messageId } },
    create: data,
    update: {
      status: undefined // Status sengaja DIBEKUKAN saat upsert update, agar ACK webhook tidak tertimpa.
    }
  });
}

/**
 * Pembaruan parsial (sebagian) pada data Pesan.
 * Biasa digunakan untuk meng-update Reaction (Emoji) atau Status Centang Pesan (Delivered/Read).
 */
export async function updateMessageData(id: string, data: any) {
  return prisma.chatMessage.update({
    where: { id },
    data
  });
}

/**
 * Mengambil beberapa pesan terakhir. Endpoint ini khusus diciptakan 
 * untuk keperluan penelusuran masalah (Debugging).
 */
export async function getRecentDebugMessages(take: number) {
  return prisma.chatMessage.findMany({
    orderBy: { createdAt: 'desc' },
    take
  });
}

/**
 * MENGAMBIL DAFTAR OBROLAN TERBARU (HANYA PESAN TERAKHIR PER KONTAK)
 * Menggunakan perintah Raw SQL tingkat lanjut dengan fungsi partisi (ROW_NUMBER() OVER PARTITION BY)
 * demi efisiensi tinggi pada tabel yang mungkin berisi jutaan baris pesan.
 */
export async function getLatestChatsWithPagination(tenantId: string, deviceId: string, limit: number, offset: number) {
  return prisma.$queryRaw<any[]>`
    SELECT * FROM (
      SELECT *, ROW_NUMBER() OVER(PARTITION BY "remote_jid" ORDER BY "timestamp" DESC) as rn
      FROM "chat_messages"
      WHERE "tenant_id" = ${tenantId}::uuid AND "device_id" = ${deviceId}::uuid
    ) sub
    WHERE rn = 1
    ORDER BY "timestamp" DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
}

/**
 * MENGHITUNG TOTAL OBROLAN UNIK
 * Sangat diperlukan pada sisi antarmuka Frontend untuk fungsionalitas Paginasi (Pagination Metadata).
 */
export async function countDistinctChats(tenantId: string, deviceId: string): Promise<number> {
  const result: any[] = await prisma.$queryRaw`
    SELECT COUNT(DISTINCT "remote_jid")::int as total
    FROM "chat_messages"
    WHERE "tenant_id" = ${tenantId}::uuid AND "device_id" = ${deviceId}::uuid
  `;
  return result[0]?.total || 0;
}

/**
 * MENGAMBIL RIWAYAT PESAN (HISTORI CHAT) DENGAN SISTEM KURSOR
 * Cocok untuk infinite scrolling (gulir tanpa henti) pada jendela obrolan di layar pengguna (Frontend).
 */
export async function findMessagesByChat(tenantId: string, deviceId: string, remoteJid: string, limit: number, cursor?: string) {
  return prisma.chatMessage.findMany({
    where: { tenantId, deviceId, remoteJid },
    take: limit,
    skip: cursor ? 1 : 0,
    cursor: cursor ? { id: cursor } : undefined,
    orderBy: [{ timestamp: 'desc' }, { id: 'desc' }]
  });
}

/**
 * MEMPERBARUI STATUS KESELURUHAN PESAN BELUM DIBACA MENJADI "DIBACA"
 * Ini dieksekusi secara instan ketika staf (agen customer service) meng-klik kontak tertentu di antarmuka.
 */
export async function markMessagesAsRead(deviceId: string, remoteJid: string) {
  return prisma.chatMessage.updateMany({
    where: { deviceId, remoteJid, isFromMe: false, status: { not: 'read' } },
    data: { status: 'read' }
  });
}

/**
 * MENCARI PESAN TERAKHIR YANG DIKIRIMKAN OLEH PELANGGAN (UNTUK TRIGGER BACA / READ RECEIPT KE WAHA)
 * Diperlukan agar kita dapat mengirimkan "Read Receipt" (Centang Biru) kembali ke server WhatsApp API (WAHA).
 */
export async function findLatestUnreadMessage(deviceId: string, remoteJid: string) {
  return prisma.chatMessage.findFirst({
    where: { deviceId, remoteJid, isFromMe: false },
    orderBy: { timestamp: 'desc' }
  });
}

/**
 * MENGAMBIL SEMUA PESAN YANG BERISI KONTEN MEDIA (GAMBAR, VIDEO, DOKUMEN)
 * Fitur ini memberikan kemampuan seperti tab "Media, Tautan, dan Dokumen" layaknya di aplikasi WhatsApp asli.
 */
export async function getMediaGalleryByChat(remoteJid: string, limit: number) {
  return prisma.chatMessage.findMany({
    where: {
      remoteJid,
      messageType: 'media'
    },
    orderBy: { timestamp: 'desc' },
    take: limit
  });
}
