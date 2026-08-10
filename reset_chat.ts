import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function resetChat() {
  const remoteJid = '6281360403365@c.us';
  try {
    const deleted = await prisma.chatMessage.deleteMany({
      where: {
        remoteJid: remoteJid
      }
    });
    console.log(`Successfully deleted ${deleted.count} messages for ${remoteJid}`);
  } catch (error) {
    console.error('Error resetting chat:', error);
  } finally {
    await prisma.$disconnect();
  }
}

resetChat();
