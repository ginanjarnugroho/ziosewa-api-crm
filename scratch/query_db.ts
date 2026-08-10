import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const msgs = await prisma.chatMessage.findMany({
    where: { remoteJid: '6281360403365@c.us' },
    orderBy: { timestamp: 'desc' },
    take: 10
  });
  console.log(JSON.stringify(msgs, null, 2));
}
main().finally(() => prisma.$disconnect());
