import { processIncomingWebhook } from '../src/services/zapierEngine';
import prisma from '../src/repositories/prisma';

async function testAutomationEngine() {
  console.log('--- TESTING ZAPIER AUTOMATION ENGINE ---');

  const tenant = await prisma.tenant.findFirst();
  const device = await prisma.device.findFirst({ where: { status: 'connected' } });

  console.log('Tenant:', tenant?.id, 'Device:', device?.id);

  // Test Webhook Payload from POS / Sales module
  const testPayload = {
    tenant_id: tenant?.id,
    event_type: 'ORDER_STATUS_CHANGED',
    status: 'READY_FOR_PICKUP',
    order_id: 'ORD-TEST-001',
    customer_phone: '6281360403365',
    due_datetime: new Date(Date.now() + 2 * 3600 * 1000).toISOString(), // 2 hours from now
    data: {
      nama_pelanggan: 'Ginanjar Nugroho',
      nama_barang: 'Kamera Sony Alpha A7 III',
      tgl_sewa: '10 Aug 2026',
      jam_kembali: '10 Aug 2026 16:30',
      total_bayar: 'Rp 350.000',
      sisa_tagihan: 'Rp 0',
      alamat_toko: 'SewaPro Store Lt. 1, Medan'
    }
  };

  const result = await processIncomingWebhook(testPayload);
  console.log('Engine Processing Result:', JSON.stringify(result, null, 2));
}

testAutomationEngine().finally(() => prisma.$disconnect());
