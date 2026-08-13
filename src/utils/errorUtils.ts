/**
 * Converts technical Axios/WAHA errors into clear, friendly, human-readable Indonesian error messages.
 */
export function formatHumanError(err: any): string {
  if (err?.response) {
    const status = err.response.status;
    const responseData = err.response.data;

    // Standardize WAHA / HTTP API Error Status Codes
    if (status === 422) {
      return "Nomor WhatsApp tujuan tidak valid atau tidak terdaftar di WhatsApp (Status 422).";
    }
    if (status === 404) {
      return "Sesi Perangkat WhatsApp tidak ditemukan di Gateway. Harap hubungkan ulang perangkat (Status 404).";
    }
    if (status === 400) {
      const detail = typeof responseData === 'object' ? (responseData.message || responseData.error) : null;
      return `Format pesan tidak valid: ${detail || 'Data parameter tidak lengkap'} (Status 400).`;
    }
    if (status === 401 || status === 403) {
      return "Otentikasi Perangkat WhatsApp ditolak atau masa berlaku sesi habis (Status 401/403).";
    }
    if (status === 500 || status === 502 || status === 503) {
      return "Server WhatsApp Gateway sedang gangguan atau tidak dapat dijangkau (Status 500/503).";
    }

    if (typeof responseData === 'object' && responseData.message) {
      return responseData.message;
    }
    if (typeof responseData === 'string' && responseData.trim().length > 0 && !responseData.includes('<html')) {
      return responseData;
    }
  }

  if (err?.code === 'ECONNREFUSED' || err?.message?.includes('ECONNREFUSED')) {
    return "Tidak dapat terhubung ke Server WhatsApp Gateway (Koneksi Ditolak). Pastikan WAHA aktif.";
  }

  if (err?.code === 'ETIMEDOUT' || err?.message?.includes('timeout')) {
    return "Koneksi ke Server WhatsApp Gateway mengalami batas waktu (Timeout).";
  }

  return err?.message || "Terjadi kesalahan tidak dikenal saat mengirim pesan.";
}
