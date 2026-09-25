# Upload Prep

A local dashboard for getting files ready to upload to **YouTube, Shopify, Gumroad, Etsy, TikTok and Instagram**.

Add your videos, images and product files, plus an optional details sheet that fills everything in. Each platform has its own tab showing the files it will use and the text ready to paste. Or fill in the title, description, tags and price once, and override any of them per platform. The dashboard checks everything against each platform's limits and exports a folder per platform with the files plus a `DETAILS.txt` you can copy and paste from.

This app only prepares uploads. It does not log in to or post to any platform.

## Details sheet (auto-fill)

Drop a details sheet in with your files and every platform tab gets filled in. It can be a `.txt`, `.md`, `.docx` or `.pdf` file. Download the template from the dashboard or use `public/details-template.txt`:

```
Title: Haunted Places Vol. 1
Price: 9.99
Tags: haunted places, paranormal, ghost stories

Description:
As many lines as you want.

[Etsy]
Title: A title just for Etsy

[TikTok]
Caption: Would you stay here overnight?
Hashtags: #haunted #fyp
```

- The keys are `Title`, `Description` (or `Caption`), `Tags` (or `Hashtags`) and `Price`. They aren't case-sensitive.
- A `[Platform]` section changes values for just that platform.
- The sheet never switches platforms on or off. Use the "Prepare for …" switch on each platform's tab.
- A file only counts as a details sheet if it has at least two of these keys. A product PDF won't be mistaken for one.
- The sheet is used only to fill in details. It is never exported as a product file.

## Install (Windows)

Download `Upload-Prep-<version>.exe` and double-click it. It's a standalone app: no Node.js, no browser, nothing to install.

The first time, Windows may say "Windows protected your PC", because the app isn't code-signed. Click **More info → Run anyway**.

Your projects and exports are saved in `Documents\Upload Prep`.

## Build the .exe

```
npm install
npm run dist        # creates dist/Upload-Prep-<version>.exe
```

## Run from source

- As a desktop window: `npm install`, then `npm run app`.
- In a browser: `npm start`, or double-click `start.bat` on Windows, then open http://localhost:3000. Data is saved next to the code.

## Where things go

- `data/projects/`: your projects and their uploaded files
- `exports/<project>/<platform>/`: the ready-to-upload folders

(In the desktop app, both are inside `Documents\Upload Prep`.)

Files are written to disk as they upload, so large videos (multiple GB) work. The only limit is your free disk space. On the same drive, exports are hard links, so they don't take extra space or time.

## What gets checked

| Platform | Checks |
|---|---|
| YouTube | Title ≤ 100 chars, no `<` or `>`; description ≤ 5000 bytes; tags ≤ 500 chars total; exactly 1 video; thumbnail JPG/PNG ≤ 50 MB |
| Shopify | Images < 20 MB and ≤ 5000×5000 / 25 MP; videos ≤ 1 GB and ≤ 10 min; digital downloads ≤ 5 GB; tags ≤ 255 chars |
| Gumroad | Files ≤ 250 MB when free, ≤ 16 GB when priced above $0.99; cover < 50 MB |
| Etsy | Title ≤ 140 chars with allowed characters only, and `% : & +` once each; ≤ 13 tags of ≤ 20 chars; 1–20 photos; ≤ 5 digital files of ≤ 20 MB |
| TikTok | Caption ≤ 2200; video MP4/WebM/MOV, ≤ 4 GB, ≤ 10 min, 360–4096 px per side; photos JPEG/WebP ≤ 20 MB |
| Instagram | Caption ≤ 2200, ≤ 30 hashtags, ≤ 20 @ mentions; ≤ 10 items; video MP4/MOV ≤ 300 MB, 3 s–15 min; images JPEG ≤ 8 MB, aspect ratio 4:5 to 1.91:1 |

Each platform card links to the documentation its limits come from (see `src/platforms.js`). TikTok and Instagram limits come from their official posting APIs. The phone apps may allow slightly different limits.
