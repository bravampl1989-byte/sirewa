# SIREWA

SIREWA adalah Sistem Reminder WhatsApp Pengadilan Agama Sampang berbasis Node.js, Express, Socket.IO, dan Fonnte.

## Persiapan Produksi

1. Install dependency:

```bash
npm install --omit=dev
```

2. Siapkan environment:

```bash
PORT=3000
DATA_DIR=/var/lib/sirewa/data
```

Jika tidak diisi, data tersimpan di folder `data` dalam direktori aplikasi.

3. Jalankan aplikasi:

```bash
npm start
```

4. Health check:

```bash
curl http://localhost:3000/health
```

## Data Penting

Folder `data` menyimpan:

- `settings.json`: user login, token Fonnte, group manual.
- `sessions.json`: sesi login aktif.
- `reminders.json`: jadwal reminder.
- `uploads/`: lampiran reminder.

Pastikan folder `data` dibackup rutin dan tidak dipublikasikan.

## Login Awal

Jika belum ada user, aplikasi akan menampilkan halaman pembuatan akun admin. Jika data sudah ada, gunakan user yang tersimpan.

## Deploy Dengan PM2

```bash
npm install -g pm2
pm2 start server.js --name sirewa
pm2 save
pm2 startup
```

## Reverse Proxy

Untuk domain publik, jalankan aplikasi di belakang Nginx/Apache/Caddy dengan HTTPS.
