import { prisma } from './prisma';

/**
 * Mengambil data Tenant utama/pertama.
 * Biasanya digunakan sebagai Fallback/Default apabila sebuah Request 
 * tidak secara eksplisit menyebutkan ID Tenant-nya.
 */
export async function findFirstTenant() {
  return prisma.tenant.findFirst();
}
