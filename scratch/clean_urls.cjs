const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function cleanUrls() {
  const contacts = await prisma.contact.findMany({
    where: {
      profilePic: {
        contains: 'GoogleAccessId='
      }
    }
  });

  console.log(`Found ${contacts.length} contacts with signed URLs to clean.`);

  let updated = 0;
  for (const contact of contacts) {
    if (contact.profilePic && contact.profilePic.includes('?')) {
      const cleanUrl = contact.profilePic.split('?')[0];
      await prisma.contact.update({
        where: { deviceId_remoteJid: { deviceId: contact.deviceId, remoteJid: contact.remoteJid } },
        data: { profilePic: cleanUrl }
      });
      updated++;
    }
  }
  
  console.log(`Successfully updated ${updated} avatars.`);
}

cleanUrls().catch(console.error).finally(() => prisma.$disconnect());
