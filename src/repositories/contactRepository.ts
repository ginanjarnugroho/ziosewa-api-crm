import { prisma } from './prisma';

/**
 * Membuat kontak baru jika belum ada, atau memperbarui nama profil (pushName) 
 * jika kontak tersebut sudah tersimpan di database.
 * (Fitur ini sangat penting saat pengguna mengganti nama WhatsApp-nya)
 */
export async function upsertContact(deviceId: string, remoteJid: string, tenantId: string, pushName: string) {
  return prisma.contact.upsert({
    where: { deviceId_remoteJid: { deviceId, remoteJid } },
    create: { tenantId, deviceId, remoteJid, pushName },
    update: { pushName }
  });
}

/**
 * Menarik daftar kontak untuk sebuah perangkat (berbasis paginasi).
 * Diurutkan secara alfabetis berdasarkan nama profil.
 */
export async function findContacts(tenantId: string, deviceId: string, skip: number, take: number) {
  return prisma.contact.findMany({
    where: { tenantId, deviceId },
    orderBy: { pushName: 'asc' },
    skip,
    take
  });
}

/**
 * Menghitung total seluruh kontak yang dimiliki oleh sebuah perangkat.
 * Berguna untuk menghitung jumlah halaman (Pagination Meta).
 */
export async function countContacts(tenantId: string, deviceId: string) {
  return prisma.contact.count({
    where: { tenantId, deviceId }
  });
}

/**
 * Memperbarui nama kustom (alias) sebuah kontak.
 * Fungsi ini digunakan ketika admin CRM mengubah nama kontak secara manual melalui layar obrolan.
 */
export async function updateContactName(deviceId: string, remoteJid: string, pushName: string) {
  return prisma.contact.update({
    where: { deviceId_remoteJid: { deviceId, remoteJid } },
    data: { pushName }
  });
}

/**
 * Mengambil beberapa profil kontak sekaligus menggunakan Array daftar JID.
 * Fungsi ini digunakan untuk efisiensi database saat memuat profil dari banyak obrolan secara bersamaan.
 */
export async function findContactsByJids(tenantId: string, deviceId: string, remoteJids: string[]) {
  return prisma.contact.findMany({
    where: { 
      tenantId, 
      deviceId,
      remoteJid: { in: remoteJids }
    }
  });
}

/**
 * Mengambil profil kontak tunggal secara spesifik berdasarkan nomor JID-nya.
 */
export async function findContactByJid(deviceId: string, remoteJid: string) {
  return prisma.contact.findUnique({
    where: { deviceId_remoteJid: { deviceId, remoteJid } }
  });
}

/**
 * Mencari profil kontak berdasarkan JID saja (tanpa ID device).
 */
export async function findContactByRemoteJidOnly(remoteJid: string) {
  return prisma.contact.findFirst({
    where: { remoteJid }
  });
}

/**
 * Menyimpan atau memperbarui URL Foto Profil (Profile Picture) dari kontak.
 * Fungsi upsert menjamin bahwa baris di tabel database akan dibuat jika belum ada.
 */
export async function upsertContactProfilePic(tenantId: string, deviceId: string, remoteJid: string, profilePic: string | null) {
  return prisma.contact.upsert({
    where: { deviceId_remoteJid: { deviceId, remoteJid } },
    create: { tenantId, deviceId, remoteJid, profilePic },
    update: { profilePic }
  });
}
