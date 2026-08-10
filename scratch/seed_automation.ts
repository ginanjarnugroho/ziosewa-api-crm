import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function seed() {
  console.log('Seeding default automation templates and rules...');

  const tenant = await prisma.tenant.findFirst();
  if (!tenant) {
    console.error('No tenant found in database.');
    return;
  }

  const defaultTemplates = [
    {
      name: 'Nota Sewa Baru (Order Created)',
      templateText: 'Halo *{nama_pelanggan}*, terima kasih telah menyewa di *{alamat_toko}*.\n\nBerikut nota pesanan Anda:\n📦 Barang: *{nama_barang}*\n📅 Batas Pengembalian: *{jam_kembali}*\n💰 Total Sewa: *{total_bayar}*\n💳 Sisa Tagihan: *{sisa_tagihan}*\n\nHarap menjaga barang sewa dengan baik. Terima kasih!',
      rule: {
        name: 'Zap: Send Receipt on Order Created',
        triggerType: 'EVENT_STATUS_CHANGED',
        targetStatus: 'ORDER_CREATED',
        offsetValue: 0,
        offsetUnit: 'MINUTES',
        offsetDirection: 'IMMEDIATE'
      }
    },
    {
      name: 'Sedang Disiapkan (Preparing)',
      templateText: 'Halo *{nama_pelanggan}*, tim kami sedang menyiapkan & menguji kelengkapan *{nama_barang}* Anda.\n\nKami akan mengabari Anda begitu barang siap diambil!',
      rule: {
        name: 'Zap: Notify when Item is Preparing',
        triggerType: 'EVENT_STATUS_CHANGED',
        targetStatus: 'PREPARING',
        offsetValue: 0,
        offsetUnit: 'MINUTES',
        offsetDirection: 'IMMEDIATE'
      }
    },
    {
      name: 'Siap Diambil (Ready for Pickup)',
      templateText: 'Halo *{nama_pelanggan}*, barang sewaan Anda *{nama_barang}* sudah *SIAP DIAMBIL* di *{alamat_toko}*.\n\nSilakan tunjukkan pesan ini ke staf toko kami. Terima kasih!',
      rule: {
        name: 'Zap: Notify when Ready for Pickup',
        triggerType: 'EVENT_STATUS_CHANGED',
        targetStatus: 'READY_FOR_PICKUP',
        offsetValue: 0,
        offsetUnit: 'MINUTES',
        offsetDirection: 'IMMEDIATE'
      }
    },
    {
      name: 'Pengingat H-2 Jam (Due Reminder)',
      templateText: '⏰ *PENGINGAT PENGEMBALIAN BARANG*\n\nHalo *{nama_pelanggan}*, mengingatkan bahwa batas waktu pengembalian *{nama_barang}* adalah hari ini jam *{jam_kembali}* di *{alamat_toko}*.\n\nMohon mengembalikan tepat waktu untuk menghindari denda keterlambatan.',
      rule: {
        name: 'Zap: Remind 2 Hours Before Due Time',
        triggerType: 'TIME_DUE_COUNTDOWN',
        targetStatus: 'ANY',
        offsetValue: 2,
        offsetUnit: 'HOURS',
        offsetDirection: 'BEFORE'
      }
    },
    {
      name: 'Teguran Keterlambatan (Overdue Alert)',
      templateText: '⚠️ *PERINGATAN KETERLAMBATAN PENGEMBALIAN*\n\nHalo *{nama_pelanggan}*, batas waktu pengembalian *{nama_barang}* (*{jam_kembali}*) telah terlewati.\n\nMohon segera mengembalikan barang ke *{alamat_toko}* atau menghubungi kasir toko kami. Terima kasih!',
      rule: {
        name: 'Zap: Alert 1 Hour After Overdue',
        triggerType: 'TIME_OVERDUE',
        targetStatus: 'ANY',
        offsetValue: 1,
        offsetUnit: 'HOURS',
        offsetDirection: 'AFTER'
      }
    },
    {
      name: 'Terima Kasih & Ulasan (Returned)',
      templateText: 'Halo *{nama_pelanggan}*, terima kasih telah mengembalikan *{nama_barang}* dalam kondisi baik di *{alamat_toko}*.\n\nSenang berbisnis dengan Anda! Sampai jumpa di persewaan berikutnya. 🙏',
      rule: {
        name: 'Zap: Thank You Note on Item Returned',
        triggerType: 'EVENT_STATUS_CHANGED',
        targetStatus: 'RETURNED',
        offsetValue: 0,
        offsetUnit: 'MINUTES',
        offsetDirection: 'IMMEDIATE'
      }
    }
  ];

  for (const item of defaultTemplates) {
    const t = await prisma.messageTemplate.create({
      data: {
        tenantId: tenant.id,
        name: item.name,
        templateText: item.templateText
      }
    });

    await prisma.automationRule.create({
      data: {
        tenantId: tenant.id,
        name: item.rule.name,
        triggerType: item.rule.triggerType as any,
        targetStatus: item.rule.targetStatus,
        offsetValue: item.rule.offsetValue,
        offsetUnit: item.rule.offsetUnit as any,
        offsetDirection: item.rule.offsetDirection as any,
        templateId: t.id,
        isEnabled: true
      }
    });
  }

  console.log('Successfully seeded 6 default templates and Zaps!');
}

seed().finally(() => prisma.$disconnect());
