# Memoar

Simpan postingan sosial ke library lokal, lalu temukan lagi lewat pencarian, filter, dan koleksi. Muse Spark otomatis membantu mengorganisasi konten setelah disimpan.

## Tech stack

- Next.js 16, React 19, dan TypeScript.
- Astryx dan StyleX untuk UI.
- Chrome Extension Manifest V3 untuk capture postingan.
- IndexedDB untuk library di extension dan cache di website.
- Meta Muse Spark 1.3 melalui API server untuk analisis konten.

## How to install

Siapkan Node.js 22+, npm, Chrome 112+, dan API key Meta untuk Muse Spark.

```sh
npm ci
cp .env.example .env.local
```

Isi `.env.local`:

```dotenv
MODEL_API_KEY=your_meta_api_key
MEMOAR_ENRICHMENT_TOKEN=your_random_secret_at_least_24_characters
```

Keduanya hanya untuk server. `MEMOAR_ENRICHMENT_TOKEN` adalah secret untuk koneksi lokal, bukan API key Meta. `NEXT_PUBLIC_MEMOAR_EXTENSION_ID` opsional karena extension dapat mengirim ID-nya saat membuka website.

Build extension dan jalankan website:

```sh
npm run extension:build
npm run dev
```

Buka [http://localhost:3000](http://localhost:3000). Gunakan alamat ini dan profil Chrome yang sama dengan extension. Restart server setelah mengubah `.env.local`.

## Import extension ke Chrome

1. Buka `chrome://extensions` dan aktifkan **Developer mode**.
2. Klik **Load unpacked**, lalu pilih folder `extension/dist` dari proyek ini.
3. Pin Memoar di toolbar Chrome.
4. Klik ikon Memoar pada halaman web, lalu pilih **Your library** untuk menghubungkan extension dan mengimpor library ke website.

Jika perlu, masukkan ID extension dari `chrome://extensions` di [halaman setup](http://localhost:3000/setup). Setelah mengubah source extension, build ulang, klik **Reload** pada extension, lalu refresh tab sosial.

## How to use

1. Buka postingan Instagram, Threads, atau Facebook yang didukung sampai kontennya terlihat.
2. Klik ikon Memoar, lalu **Add to Memoar**. Biarkan postingan terbuka selama capture; carousel bisa berpindah slide.
3. Tunggu **Saved to Memoar**, lalu klik **Open in Memoar**. Analisis AI berjalan di background.
4. Cari kembali postingan lewat Explore, filter, atau koleksi. Detail postingan menampilkan konten tersimpan dan hasil AI.

Website mengambil pembaruan saat dashboard aktif, sekitar setiap 20 detik. Gunakan **Resync** untuk menyinkronkan secara manual.

## Supported platforms

| Platform | Konten / link yang didukung |
| --- | --- |
| Instagram | Post, carousel, dan Reel (`/p/`, `/reel/`, `/reels/`). |
| Threads | Post teks dan media (`/@handle/post/id`, `/t/id`), termasuk domain `threads.net`. |
| Facebook | Post, Reel, video, dan watch. Capture dapat parsial; video/watch hanya memiliki fallback link untuk preview. |

Gunakan link langsung ke postingan. Profil, Stories, link share/pendek, `permalink.php`, dan `story.php` belum didukung. Konten yang tidak berhasil ditangkap tetap ditandai tidak tersedia; dukungan link tidak menjamin semua media bisa diambil.

## Alur Muse Spark

1. Extension menangkap konten postingan dari halaman yang dibuka setelah kamu menekan tombol simpan.
2. Konten disimpan lebih dulu ke IndexedDB extension. Setelah itu, job analisis masuk antrean otomatis tanpa toggle AI.
3. Website memasangkan extension ke API lokal. Worker extension mengirim teks dan media yang lolos validasi ke `/api/enrich`; server meneruskannya ke Muse Spark 1.3 menggunakan API key server.
4. Muse Spark menghasilkan kategori, topik, ringkasan per slide, teks dalam gambar/video, objek, brand, dan kata kunci sesuai input yang tersedia. Jika media tidak tersedia, analisis dibatasi ke teks.
5. Hasil kembali disimpan di extension dan disinkronkan ke website untuk pencarian serta related posts. Pencarian tidak memanggil AI lagi.

Server lokal harus berjalan agar analisis bisa diproses. Job yang bisa dicoba ulang memiliki maksimal tiga percobaan; jika gagal, postingan tetap tersimpan dan bisa di-retry dari detailnya. Snapshot preview dan metadata oEmbed hanya untuk tampilan, bukan input AI.

## Penyimpanan dan batasan

- Library utama ada di profil Chrome tempat extension dipasang. Website menyimpan salinan cache; belum ada cloud sync atau database server.
- Analisis mengirim konten yang tersedia ke Meta dan dapat memakai kuota API. Simpan hanya konten yang kamu berhak proses; hasil AI tetap perlu diperiksa.
- Video penuh tidak diarsipkan permanen. Export metadata tidak menyertakan file media asli dan bukan backup lengkap.
- Menghapus extension atau storage browser dapat menghapus library. MVP ini berjalan lokal; belum ada deployment atau hosting enrichment produksi.
