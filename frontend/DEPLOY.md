# Deploy frontend

Project nay la React + Vite, output la `dist`.

**Lưu ý bảo mật:** Không bao giờ commit các file `.env` chứa token thật lên GitHub.

Biến môi trường cần cấu hình trong bảng điều khiển (Dashboard) của nhà cung cấp hosting:
- `VITE_API_BASE_URL`: URL của backend API.

## Vercel

Nhanh nhat cho project nay.

1. Day code len GitHub.
2. Vao Vercel, chon `Add New Project`.
3. Import repo `deepface-frontend`.
4. Framework preset: `Vite`.
5. Build Command: `npm run build`.
6. Output Directory: `dist`.
7. **Environment Variables**: Thêm key/value vào phần cài đặt của Vercel thay vì file code.
   - `VITE_API_BASE_URL=https://graffiti-fit-error.ngrok-free.dev/api/v1`
8. Bam `Deploy`.

Neu can deploy bang CLI:

```bash
npm i -g vercel
vercel
vercel --prod
```

## Cloudflare Pages

1. Day code len GitHub.
2. Vao Cloudflare Pages, chon `Create a project`.
3. Connect GitHub repo.
4. Framework preset: `React (Vite)` hoac `Vite`.
5. Build command: `npm run build`.
6. Build output directory: `dist`.
7. Them environment variable:
   - `VITE_API_BASE_URL=https://graffiti-fit-error.ngrok-free.dev/api/v1`
8. Bam `Save and Deploy`.

File `public/_redirects` da duoc them de SPA route fallback ve `index.html`.

## Netlify

1. Day code len GitHub.
2. Vao Netlify, chon `Add new project`.
3. Import repo.
4. Build command: `npm run build`.
5. Publish directory: `dist`.
6. Them environment variable:
   - `VITE_API_BASE_URL=https://graffiti-fit-error.ngrok-free.dev/api/v1`
7. Bam `Deploy site`.

File `netlify.toml` da co san redirect cho SPA.

## Khuyen nghi

Dung Vercel neu ban muon deploy nhanh nhat.
Dung Cloudflare Pages neu ban muon giu he sinh thai Cloudflare.

Quick tunnel `trycloudflare.com` va `ngrok` chi hop cho test tam thoi, khong phai link on dinh lau dai.
