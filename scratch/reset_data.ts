import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env.production') });

const prisma = new PrismaClient();

async function resetData() {
  console.log('Resetting ChatMessage table...');
  const chatMessagesResult = await prisma.chatMessage.deleteMany({});
  console.log(`Deleted ${chatMessagesResult.count} chat messages.`);

  console.log('Resetting Contact table...');
  const contactsResult = await prisma.contact.deleteMany({});
  console.log(`Deleted ${contactsResult.count} contacts.`);
  
  console.log('Data reset complete!');
}

resetData()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
