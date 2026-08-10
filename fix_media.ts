import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function fixMessageTypes() {
  try {
    const updated = await prisma.chatMessage.updateMany({
      where: {
        messageType: {
          in: ['image', 'video', 'audio', 'document', 'sticker']
        }
      },
      data: {
        messageType: 'media'
      }
    });
    console.log(`Successfully fixed ${updated.count} historical media messages!`);
  } catch (error) {
    console.error('Error fixing message types:', error);
  } finally {
    await prisma.$disconnect();
  }
}

fixMessageTypes();
