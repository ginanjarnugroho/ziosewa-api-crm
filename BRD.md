# BUSINESS REQUIREMENTS & TECHNICAL DESIGN DOCUMENT (BRD/TDD)
## Project Name: **Antigravity Multi-Channel Omnichannel Messaging SaaS Engine**
* **Document Version:** 4.0.0-Enterprise
* **Core Architecture:** Headless Backend, Multi-Tenant, Unified Adapter Pattern, Event-Driven

---

## 1. System Architecture & Component Interactions

### 1.1 Detailed Request Flow (Outbound)
1. **API Client** mengirim request ke API Gateway dengan header `X-API-Key` dan `X-Tenant-ID`.
2. **Auth Middleware** memvalidasi API Key melalui Redis Cache (untuk mempercepat lookup) atau fallback ke PostgreSQL.
3. **Core Orchestrator** mengecek jenis kanal (`channel_type`) pada perangkat tujuan (`device_id`).
4. **Adapter Factory** memanggil driver yang sesuai (misal: `BaileysAdapter` untuk WhatsApp Unofficial).
5. **Anti-Ban Middleware (Jika kanal unofficial):** 
   * Mengecek *rate limiter* aktif di Redis.
   * Menambahkan *jitter delay* acak via antrean BullMQ.
   * Mensimulasikan status `composing` (mengetik) sebelum pesan dieksekusi ke socket WA.

---

## 2. Universal Database Schema Design (PostgreSQL)

### A. Tabel `tenants`
* `id` (UUID, Primary Key)
* `name` (VARCHAR)
* `status` (ENUM: `active`, `suspended`, `trial`)
* `created_at` (TIMESTAMP)

### B. Tabel `devices` (Channel Configurations)
* `id` (UUID, Primary Key)
* `tenant_id` (UUID, Foreign Key)
* `device_identifier` (VARCHAR) - *Contoh: store_medan_01*
* `channel_type` (ENUM: `wa_unofficial`, `wa_cloud`, `telegram`, `line`)
* `status` (ENUM: `connected`, `disconnected`, `banned`, `pairing`)
* `provider_config` (JSONB) - *Menyimpan token/sesi spesifik kanal*
* `updated_at` (TIMESTAMP)

### C. Tabel `message_logs` (Normalized Audit Trail)
* `id` (UUID, Primary Key)
* `tenant_id` (UUID)
* `device_id` (UUID)
* `channel_type` (VARCHAR)
* `direction` (ENUM: `inbound`, `outbound`)
* `recipient` (VARCHAR)
* `message_type` (ENUM: `text`, `media`, `interactive`)
* `payload` (JSONB)
* `status` (ENUM: `queued`, `sent`, `delivered`, `read`, `failed`)
* `created_at` (TIMESTAMP)

---

## 3. Deep-Dive Functional & Payload Specifications

### 3.1 Session Connection State Machine (Baileys / Unofficial)
Sistem wajib mengelola *state* perangkat secara ketat melalui Redis guna menghindari *race condition*:
* `INIT`: Device didaftarkan.
* `QR_GENERATED`: Menunggu pemindaian QR atau input pairing code.
* `CONNECTING`: Sesi socket sedang melakukan *handshake* ke server WhatsApp.
* `CONNECTED`: Sesi aktif, siap mengirim dan menerima pesan.
* `DISCONNECTED`: Terputus karena jaringan/kematian socket (memicu auto-reconnect).
* `BANNED`: Terdeteksi error `StreamErrors.loggedOut` atau blokir dari Meta.

### 3.2 Detailed REST API Payloads

#### A. Initialize Connection (`POST /api/v1/device/connect`)
* **Request Body:**
  ```json
  {
    "device_id": "cs_medan_01",
    "channel_type": "wa_unofficial",
    "connection_method": "qr",
    "phone_number": "628123456789"
  }

Response Success (200 OK):JSON{
  "status": "success",
  "message": "Connection sequence initialized",
  "data": {
    "device_id": "cs_medan_01",
    "state": "QR_READY",
    "qr_code": "data:image/png;base64,iVBORw0KGgoAAAANSU..." 
  }
}
B. Send Text Message (POST /api/v1/messages/send-text)Request Body:JSON{
  "device_id": "cs_medan_01",
  "to": "628987654321",
  "message": "Halo, pesanan Anda sedang diproses.",
  "idempotency_key": "unique-uuid-tx-001"
}
Response Success (202 Accepted - Queued):JSON{
  "status": "success",
  "message": "Message successfully enqueued",
  "data": {
    "queue_id": "bull:job:938475",
    "estimated_delay_ms": 3500
  }
}
C. Normalized Inbound Webhook Payload (Dispatched to Client)Setiap pesan masuk dari kanal apa pun akan dinormalisasi ke format ini sebelum dikirim ke URL webhook klien:JSON{
  "event": "message.incoming",
  "tenant_id": "t_uuid_12345",
  "device_id": "cs_medan_01",
  "channel_type": "wa_unofficial",
  "data": {
    "id": "MSG_WA_INTERNAL_ID_999",
    "from": "628987654321",
    "push_name": "Budi Santoso",
    "message_type": "text",
    "body": "Min, mau tanya stok apakah ready?",
    "timestamp": 1717001234
  }
}
4. Error Handling & Circuit Breaker MatrixError ScenarioSystem BehaviorRecovery ActionBaileys Session Expired / Logged OutMengubah status device ke DISCONNECTED di DB.Mengirim webhook darurat ke klien agar melakukan re-connect/re-scan.WhatsApp Rate Limit (Too Many Requests)BullMQ worker otomatis menahan antrean (pausing queue).Menerapkan Exponential Backoff bertahap (1m, 5m, 15m) sebelum membuka kembali rate limit.Webhook Client Timeout (Klien Down)Menyimpan status gagal kirim di retry queue.Mencoba ulang (retry) dengan interval eksponensial hingga batas maksimum 5 kali percobaan.5. Implementation Instructions for AI Code GeneratorSaat Anda memasukkan spesifikasi teknis mendalam ini ke dalam AI coding agent, pastikan instruksi tambahannya mencakup:Clean Architecture / Layered Design: Pisahkan Routes, Controllers, Services, Adapters, dan Queues secara ketat ke dalam direktori terpisah.Strict Concurrency Control: Gunakan Redis Distributed Locks (redlock) saat memperbarui sesi perangkat untuk mencegah bentrok akses multi-pod Kubernetes.No any Types: Seluruh fungsi adapter, payload, dan event handler wajib memiliki interface TypeScript yang eksplisit.