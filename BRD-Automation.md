# Business Requirements Document (BRD)
## Modul CRM & Notifikasi Otomatis WhatsApp untuk Sistem Persewaan UMKM

---

## 1. Ringkasan Eksekutif & Tujuan Proyek

### 1.1 Latar Belakang
Sistem persewaan UMKM yang berjalan saat ini telah memfasilitasi transaksi langsung di toko (*point of sale*), pengelolaan master data pelanggan, inventaris produk, hingga pencatatan transaksi. Namun, komunikasi purna-jual dan pengingat operasional masih dilakukan secara manual oleh staf toko. Hal ini berpotensi menyebabkan tingginya angka keterlambatan pengembalian barang, risiko kerusakan/kehilangan, serta ketidakjelasan status barang bagi pelanggan.

### 1.2 Tujuan Proyek
Mengembangkan **Modul CRM & Automated Messaging** terintegrasi berbasis WhatsApp yang dapat mengirimkan notifikasi otomatis ke pelanggan berdasarkan perubahan status transaksi di toko dan jadwal waktu pengembalian barang.

### 1.3 Sasaran Kunci (Key Metrics)
* **Penghematan Waktu Staf Toko:** Menghilangkan 100% proses pengetikan pesan/pengingat manual oleh kasir.
* **Penurunan Keterlambatan:** Menurunkan tingkat keterlambatan pengembalian barang hingga 40% melalui *automated reminder*.
* **Peningkatan Kepuasan Pelanggan:** Memberikan transparansi status barang (*preparing*, *ready for pickup*, *returned*) secara *real-time*.

---

## 2. Ruang Lingkup Proyek (Scope of Work)

### 2.1 Termasuk dalam Ruang Lingkup (In-Scope)
1. **Aturan Trigger Pesan (Event-Driven):** Pengiriman pesan instan saat status pesanan diperbarui oleh staf toko (*Order Created, Preparing, Ready for Pickup, Returned*).
2. **Penjadwalan Pengingat (Time-Driven Scheduler):** Pengiriman pengingat pengembalian otomatis sebelum/sesudah waktu jatuh tempo (*due date/time*).
3. **Pengaturan Template & Variable Manager (UI Admin):** Halaman bagi pemilik UMKM untuk mengatur draf teks, insert variabel dinamis (`{nama_pelanggan}`, `{nama_barang}`, dll), format teks WA, dan melihat *Live Preview*.
4. **Log Pengiriman Pesan (Outbox Monitor):** Pemantauan status pengiriman pesan (*Pending, Sent, Failed*) beserta fungsi *Resend*.
5. **Integrasi WhatsApp Gateway:** Pengiriman pesan keluar (*outbound messaging*) satu arah via WhatsApp API.

### 2.2 Tidak Termasuk dalam Ruang Lingkup (Out-of-Scope)
1. Modul UI Chatting 2-arah (*Shared Inbox/Live Chat Panel*) di dalam dashboard web.
2. Fitur *chatbot* interaktif berbasis AI / balasan otomatis untuk pertanyaan umum.
3. Broadcast promosi massal (*marketing blast*) ke daftar kontak di luar transaksi aktif.

---

## 3. Personil & Peran Pengguna (User Personas)

| Peran Pengguna | Deskripsi Peran | Kebutuhan Utama pada Modul CRM |
| :--- | :--- | :--- |
| **Pemilik UMKM (Admin)** | Mengelola aturan bisnis, harga, dan template komunikasi toko. | Memiliki fleksibilitas mengatur kata-kata pesan, jam pengiriman pengingat, serta mengaktifkan/nonaktifkan notifikasi tertentu. |
| **Staf Toko / Kasir** | Melakukan operasional harian: input pesanan, menyiapkan barang, dan menerima pengembalian. | Menjalankan transaksi seperti biasa tanpa beban kerja tambahan untuk mengetik WA manual. |
| **Pelanggan (Customer)** | Penyewa barang yang berinteraksi langsung di toko. | Menerima notifikasi instan yang jelas mengenai status barang dan pengingat pengembalian tanpa harus mengunduh aplikasi tambahan. |

---

## 4. Persyaratan Fungsional (Functional Requirements)

### FR-01: Modul Aturan Pesan Otomatis (Event-Driven Triggers)
Sistem wajib memicu pengiriman pesan WhatsApp secara instan ketika ada aksi pembaruan status pada sistem persewaan utama:

[Input / Update Status] ──> [Sistem Utama] ──> [Trigger WA Outbound]

* **FR-01.1 (Order Created):** Sistem otomatis mengirimkan pesan konfirmasi/nota sewa saat transaksi baru berhasil dibuat.
* **FR-01.2 (Preparing):** Sistem otomatis mengirimkan pesan saat staf mengubah status barang menjadi "Sedang Disiapkan/Dicek".
* **FR-01.3 (Ready for Pickup):** Sistem otomatis mengirimkan pesan konfirmasi pengambilan saat staf mengubah status barang menjadi "Siap Diambil di Toko".
* **FR-01.4 (Returned / Completed):** Sistem otomatis mengirimkan pesan terima kasih & permintaan ulasan saat kasir mengonfirmasi barang telah dikembalikan dalam kondisi baik.

### FR-02: Modul Penjadwalan Pengingat (Time-Driven Scheduler)
Sistem wajib menyediakan mekanisme pengingat berbasis waktu berjalan di *background process*:

* **FR-02.1 (Pengingat Pengembalian):** Sistem dapat mengkalkulasi waktu pengembalian (`due_datetime`) dan mengirimkan pesan pengingat $X$ jam/hari sebelum batas waktu pengembalian.
* **FR-02.2 (Pengingat Keterlambatan/Overdue):** Sistem dapat mengirimkan pesan teguran $X$ jam setelah melewati batas waktu jika status transaksi belum berubah menjadi *Returned*.
* **FR-02.3 (Batas Jam Pengiriman / Quiet Hours):** Sistem wajib menyediakan batasan jam pengiriman (contoh: 08:00 - 20:00). Jika jadwal pengingat jatuh pada malam hari, pengiriman otomatis digeser ke batas awal jam kerja berikutnya.

### FR-03: UI Pengaturan Template & Live Preview
Sistem wajib menyediakan halaman khusus bagi Pemilik UMKM untuk mengelola template pesan:

+-------------------------------------------------------+-----------------------+
| FORM EDITOR TEMPLATE (Teks + Dynamic Chips)           | LIVE PREVIEW (HP)     |
+-------------------------------------------------------+-----------------------+


* **FR-03.1 (Dynamic Variable Chips):** Menyediakan tombol tag dinamis yang dapat diklik untuk memasukkan data transaksi secara otomatis:
  * `{nama_pelanggan}`
  * `{nama_barang}`
  * `{tgl_sewa}` & `{jam_kembali}`
  * `{total_bayar}` & `{sisa_tagihan}`
  * `{alamat_toko}`
* **FR-03.2 (WYSIWYG / Formatting Support):** Mendukung format bawaan WhatsApp seperti Bold (`*teks*`), Italic (`_teks_`), Strikethrough (`~teks~`), dan pemilih Emoji.
* **FR-03.3 (Real-time Live Preview):** Menampilkan simulasi tampilan layar HP WhatsApp di sebelah kanan editor yang langsung mengupdate contoh teks berdasarkan input pengguna.
* **FR-03.4 (Toggle ON/OFF):** Setiap jenis notifikasi memiliki sakelar (*toggle*) untuk mengaktifkan atau mematikan jenis pesan tertentu tanpa menghapus draf.

### FR-04: Log & Pemantauan Pengiriman (Outbox Monitor)
* **FR-04.1 (Status Dashboard):** Menampilkan daftar riwayat pesan keluar beserta status pengiriman (*Pending*, *Sent*, *Delivered*, *Failed*).
* **FR-04.2 (Manual Resend Action):** Jika pengiriman gagal (misal: nomor WA tidak valid atau provider *down*), sistem menyediakan tombol **`[Kirim Ulang]`**.

---

## 5. Persyaratan Non-Fungsional (Non-Functional Requirements)

| Kategori | Kriteria Persyaratan |
| :--- | :--- |
| **Usability (Kebiasaan Penggunaan)** | Staf toko tidak boleh dipaksa melakukan alur kerja baru. Pembaruan status pesan berjalan otomatis bersamaan dengan tombol simpan status transaksi yang sudah ada. |
| **Performance (Performa)** | Pengiriman notifikasi berbasis *event* harus masuk ke antrean (*queue*) dalam waktu < 2 detik setelah aksi dilakukan kasir, tanpa membuat UI kasir menjadi lambat/hang. |
| **Reliability & Queue** | Jika koneksi ke WhatsApp API terputus, sistem harus menyimpan pesan dalam antrean pengiriman (*retry mechanism*) hingga 3 kali percobaan sebelum menandainya sebagai *Failed*. |
| **Scalability** | Arsitektur pengirim pesan harus mampu menangani pengiriman terjadwal (*scheduler*) secara simultan untuk ratusan toko UMKM tanpa bentrokan waktu. |

---

## 6. Alur Pengalaman Pengguna (User Flow Summary)

1. **Konfigurasi Aturan & Template Pesan (Admin Dashboard):**
   * Pemilik toko membuka menu **Aturan Pesan WA**.
   * Mengaktifkan toggle aturan (misal: *Ready for Pickup* & *Pengingat H-2 Jam*).
   * Mengatur draf kalimat menggunakan chip variabel dinamis dan mengecek tampilan di *Live Preview*.
   * Klik **Simpan Aturan**.

2. **Eksekusi Transaksi & Pembaruan Status (Staf Toko / Kasir):**
   * Kasir menginput transaksi sewa baru atau menguji barang di gudang.
   * Kasir menekan tombol pembaruan status (contoh: **`[Siap Diambil]`**).
   * Sistem utama memperbarui status di database dan melempar notifikasi secara otomatis di latar belakang.

3. **Penerimaan Pesan & Tindak Lanjut (Pelanggan):**
   * Pelanggan menerima notifikasi WA resmi dari nomor toko.
   * Pelanggan membaca detail/instruksi (lokasi ambil / batas jam kembali).
   * Jika pelanggan membalas chat, pesan masuk secara alami ke aplikasi WhatsApp Business di smartphone toko.

---

## 7. Kriteria Penerimaan (Acceptance Criteria)

1. **AC-01:** Pesan *Order Created* berhasil diterima nomor WhatsApp pelanggan kurang dari 5 detik setelah kasir menekan tombol simpan transaksi.
2. **AC-02:** Variabel dinamis seperti `{nama_pelanggan}` dan `{nama_barang}` terisi sesuai dengan data transaksi aktual saat pesan diterima di WhatsApp.
3. **AC-03:** Pesan pengingat pengembalian secara otomatis terkirim tepat waktu sesuai opsi durasi yang diatur pada scheduler (misal: tepat 2 jam sebelum `due_time`).
4. **AC-04:** Mengubah teks template pada admin dashboard tidak merusak variabel dinamis dan perubahan langsung terlihat pada *Live Preview*.
5. **AC-05:** Pengiriman pesan yang gagal dapat dicoba ulang secara manual melalui halaman *Outbox Log*.