import { FastifyInstance } from 'fastify';
import { findDeviceByIdentifier } from '../repositories/deviceRepository';
import { countContacts, findContacts, updateContactName, upsertContact } from '../repositories/contactRepository';
import { AdapterFactory } from '../services/AdapterFactory';

export default async function contactController(fastify: FastifyInstance) {
  fastify.get('/api/v1/contacts', {
    schema: {
      description: 'Get all contacts',
      tags: ['Contacts'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        required: ['device_id'],
        properties: {
          device_id: { type: 'string' },
          page: { type: 'integer' },
          limit: { type: 'integer' }
        }
      }
    }
  }, async (request, reply) => {
    const tenantId = (request as any).tenant.id;
    const { device_id } = request.query as any;
    const page = Number((request.query as any).page) || 1;
    const limit = Number((request.query as any).limit) || 50;

    try {
      // 1. Cari perangkat berdasarkan pengenal perangkat & Tenant (Keamanan Multi-Tenant)
      const device = await findDeviceByIdentifier(device_id, tenantId);
      if (!device) {
        reply.status(404);
        return { success: false, error: 'Device not found' };
      }

      // 2. Hitung Offset untuk Paginasi Halaman (Contoh: Halaman 2, Limit 50 = Mulai dari data ke 50)
      const offset = (page - 1) * limit;

      // 3. Muat Data Kontak dan Total Data secara paralel (Promise.all) agar lebih cepat
      const [contacts, total] = await Promise.all([
        findContacts(tenantId, device.id, offset, limit),
        countContacts(tenantId, device.id)
      ]);

      const adapter = AdapterFactory.getAdapter(device.channelType) as any;
      const socket = adapter?.getSocket ? adapter.getSocket(device.id) : null;

      // 4. Proses (Mappping) setiap kontak untuk menyesuaikan nama grup dan URL foto profil
      const processedContacts = await Promise.all(contacts.map(async (c: any) => {
        let name = c.pushName || c.verifiedName || null;
        
        // JIKA kontak ini adalah Grup (berakhiran @g.us) DAN namanya belum ada, 
        // perintahkan WAHA Socket untuk menarik nama (Subject) grup tersebut secara dinamis.
        if (!name && c.remoteJid.endsWith('@g.us') && socket) {
          try {
            const metadata = await socket.groupMetadata(c.remoteJid);
            if (metadata && metadata.subject) {
              name = metadata.subject;
              c.pushName = name;
              await upsertContact(device.id, c.remoteJid, device.tenantId, name);
            }
          } catch (err) {
            console.error(`Failed to fetch group metadata for ${c.remoteJid}`, err);
          }
        }
        
        // 5. Override (Timpa) URL profil dengan URL API Proxy milik kita sendiri
        // Hal ini dilakukan agar kita bisa menghasilkan URL khusus sementara (Signed URL) dari Google Cloud Storage secara langsung
        const originalProfilePic = c.profilePic;
        const baseUrl = `${request.protocol}://${request.headers.host}`;
        c.profilePic = `${baseUrl}/api/v1/contacts/${c.remoteJid}/avatar?tenant_id=${tenantId}&device_id=${device_id}`;
        if (originalProfilePic === 'none') {
          c.profilePic = null as any; // Secara eksplisit hapus avatar jika user tak pasang foto
        }
        return c;
      }));

      return {
        success: true,
        data: processedContacts,
        meta: {
          page,
          limit,
          total
        }
      };
    } catch (err: any) {
      reply.status(500);
      return { success: false, error: err.message };
    }
  });

  fastify.put('/api/v1/contacts/:remoteJid', {
    schema: {
      description: 'Update a contact name',
      tags: ['Contacts'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['remoteJid'],
        properties: {
          remoteJid: { type: 'string' }
        }
      },
      body: {
        type: 'object',
        required: ['device_id', 'name'],
        properties: {
          device_id: { type: 'string' },
          name: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    const tenantId = (request as any).tenant.id;
    const { remoteJid } = request.params as any;
    const { device_id, name } = request.body as any;

    try {
      // 1. Verifikasi Kepemilikan Perangkat
      const device = await findDeviceByIdentifier(device_id, tenantId);
      if (!device) {
        reply.status(404);
        return { success: false, error: 'Device not found' };
      }

      // 2. Perbarui Nama Kontak di Database melalui Repository
      const contact = await updateContactName(device.id, remoteJid, name);
      return { success: true, data: contact };
    } catch (err: any) {
      reply.status(500);
      return { success: false, error: err.message };
    }
  });
}
