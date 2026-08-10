import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const msgs = await prisma.chatMessage.findMany({ orderBy: { timestamp: 'desc' }, take: 3 });
  console.log(JSON.stringify(msgs, null, 2));
}
main();
