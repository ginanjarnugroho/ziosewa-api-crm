import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function checkMessages() {
  try {
    const remoteJid = '6281360403365@c.us';
    const messages = await prisma.chatMessage.findMany({
      where: { remoteJid },
      orderBy: { timestamp: 'desc' },
      take: 10
    });
    console.log(`Found ${messages.length} messages.`);
    messages.forEach(m => {
      console.log(`ID: ${m.messageId} | Type: ${m.messageType} | MediaUrl: ${m.mediaUrl} | Text: ${m.text}`);
    });
  } catch (err) {
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
}

checkMessages();
