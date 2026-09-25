// Platform rules. Every limit links to the page it came from.
// File "kind" is one of: video, image, other (digital product files).

const MB = 1024 * 1024;
const GB = 1024 * MB;

const countUtf16 = (s) => s.length;
const byteLen = (s) => Buffer.byteLength(s, 'utf8');
const ext = (name) => name.toLowerCase().split('.').pop();

const PLATFORMS = {
  youtube: {
    name: 'YouTube',
    accepts: ['video', 'image'],
    fields: ['title', 'description', 'tags'],
    sources: [
      'https://developers.google.com/youtube/v3/docs/videos',
      'https://developers.google.com/youtube/v3/docs/thumbnails/set',
    ],
    validate({ title, description, tags }, files) {
      const out = [];
      if (!title) out.push(err('Title is required'));
      if (title.length > 100) out.push(err(`Title is ${title.length}/100 characters`));
      if (/[<>]/.test(title)) out.push(err('Title cannot contain < or >'));
      if (byteLen(description) > 5000) out.push(err(`Description is ${byteLen(description)}/5000 bytes`));
      if (/[<>]/.test(description)) out.push(err('Description cannot contain < or >'));
      // Commas count; tags with spaces are counted as if wrapped in quotes.
      const tagLen = tags.reduce((n, t) => n + t.length + (t.includes(' ') ? 2 : 0), 0) + Math.max(tags.length - 1, 0);
      if (tagLen > 500) out.push(err(`Tags total ${tagLen}/500 characters (commas and quotes count)`));
      const videos = files.filter((f) => f.kind === 'video');
      if (videos.length !== 1) out.push(err(`Needs exactly 1 video (has ${videos.length})`));
      const thumbs = files.filter((f) => f.kind === 'image');
      if (thumbs.length > 1) out.push(err('Only 1 thumbnail image allowed'));
      for (const t of thumbs) {
        if (!['jpg', 'jpeg', 'png'].includes(ext(t.name))) out.push(err(`Thumbnail ${t.name} must be JPG or PNG`));
        if (t.size > 50 * MB) out.push(err(`Thumbnail ${t.name} is over 50 MB`));
      }
      return out;
    },
    format({ title, description, tags }) {
      return { Title: title, Description: description, Tags: tags.join(', ') };
    },
  },

  shopify: {
    name: 'Shopify',
    accepts: ['video', 'image', 'other'],
    fields: ['title', 'description', 'tags', 'price'],
    sources: [
      'https://help.shopify.com/en/manual/products/product-media/product-media-types',
      'https://help.shopify.com/en/manual/products/digital-service-product/digital-downloads',
      'https://help.shopify.com/en/manual/products/details/tags',
    ],
    validate({ title, tags, price }, files) {
      const out = [];
      if (!title) out.push(err('Title is required'));
      if (title.length > 70) out.push(warn('Titles over 70 characters may be cut off in search results'));
      for (const t of tags) if (t.length > 255) out.push(err(`Tag "${t.slice(0, 20)}…" is over 255 characters`));
      if (price === '' || !(Number(price) >= 0)) out.push(err('Price is required'));
      for (const f of files) {
        if (f.kind === 'image') {
          if (f.size >= 20 * MB) out.push(err(`Image ${f.name} must be under 20 MB`));
          if (f.width && (f.width > 5000 || f.height > 5000 || f.width * f.height > 25e6))
            out.push(err(`Image ${f.name} is ${f.width}x${f.height}; max 5000x5000 / 25 megapixels`));
        } else if (f.kind === 'video') {
          if (f.size > 1 * GB) out.push(err(`Video ${f.name} is over 1 GB`));
          if (f.duration > 600) out.push(err(`Video ${f.name} is over 10 minutes`));
        } else if (f.size > 5 * GB) {
          out.push(err(`Digital download ${f.name} is over 5 GB`));
        }
      }
      if (!files.some((f) => f.kind === 'image')) out.push(warn('No product image'));
      return out;
    },
    format({ title, description, tags, price }) {
      return { Title: title, Description: description, Tags: tags.join(', '), Price: price };
    },
  },

  gumroad: {
    name: 'Gumroad',
    accepts: ['video', 'image', 'other'],
    fields: ['title', 'description', 'price'],
    sources: [
      'https://gumroad.com/help/article/289-file-size-limits-on-gumroad.html',
      'https://gumroad.com/help/article/60-adding-a-cover-image',
    ],
    validate({ title, price }, files) {
      const out = [];
      if (!title) out.push(err('Name is required'));
      if (price === '' || !(Number(price) >= 0)) out.push(err('Price is required (0 for free)'));
      const paid = Number(price) > 0.99;
      const product = files.filter((f) => f.kind !== 'image');
      if (!product.length) out.push(warn('No product file (only images attached)'));
      for (const f of product) {
        if (paid && f.size > 16 * GB) out.push(err(`${f.name} is over 16 GB`));
        if (!paid && f.size > 250 * MB) out.push(err(`${f.name} is over 250 MB (free product limit; price above $0.99 raises it to 16 GB)`));
      }
      for (const f of files.filter((f) => f.kind === 'image'))
        if (f.size >= 50 * MB) out.push(err(`Cover ${f.name} must be under 50 MB`));
      return out;
    },
    format({ title, description, price }) {
      return { Name: title, Description: description, Price: price };
    },
  },

  etsy: {
    name: 'Etsy',
    accepts: ['image', 'other'],
    fields: ['title', 'description', 'tags', 'price'],
    sources: [
      'https://help.etsy.com/hc/en-us/articles/115015628707-How-to-Create-a-Listing',
      'https://developers.etsy.com/documentation/reference#operation/createDraftListing',
    ],
    validate({ title, description, tags, price }, files) {
      const out = [];
      if (!title) out.push(err('Title is required'));
      if (title.length > 140) out.push(err(`Title is ${title.length}/140 characters`));
      if (/[^\p{L}\p{Nd}\p{P}\p{Sm}\p{Zs}™©®]/u.test(title)) out.push(err('Title has characters Etsy does not allow (letters, numbers, punctuation, math symbols, ™ © ® only)'));
      for (const c of ['%', ':', '&', '+'])
        if (title.split(c).length > 2) out.push(err(`Title can use "${c}" only once`));
      if (!description) out.push(err('Description is required'));
      if (tags.length > 13) out.push(err(`${tags.length}/13 tags`));
      for (const t of tags) {
        if (t.length > 20) out.push(err(`Tag "${t}" is over 20 characters`));
        if (/[^\p{L}\p{Nd}\p{Zs}\-'™©®]/u.test(t)) out.push(err(`Tag "${t}" has characters Etsy does not allow`));
      }
      if (!(Number(price) > 0)) out.push(err('Price must be above 0'));
      const photos = files.filter((f) => f.kind === 'image');
      if (!photos.length) out.push(err('At least 1 photo is required'));
      if (photos.length > 20) out.push(err(`${photos.length}/20 photos`));
      const digital = files.filter((f) => f.kind === 'other');
      if (digital.length > 5) out.push(err(`${digital.length}/5 digital files`));
      for (const f of digital) if (f.size > 20 * MB) out.push(err(`Digital file ${f.name} is over 20 MB`));
      return out;
    },
    format({ title, description, tags, price }) {
      return { Title: title, Description: description, Tags: tags.join(', '), Price: price };
    },
  },

  tiktok: {
    name: 'TikTok',
    accepts: ['video', 'image'],
    fields: ['description', 'tags'],
    sources: [
      'https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide',
      'https://developers.tiktok.com/doc/content-posting-api-reference-direct-post',
    ],
    validate(meta, files) {
      const out = [];
      const caption = captionWithTags(meta);
      if (countUtf16(caption) > 2200) out.push(err(`Caption + hashtags is ${countUtf16(caption)}/2200 characters`));
      const videos = files.filter((f) => f.kind === 'video');
      const photos = files.filter((f) => f.kind === 'image');
      if (!videos.length && !photos.length) out.push(err('Needs a video or photos'));
      if (videos.length > 1) out.push(err('Only 1 video per post'));
      if (videos.length && photos.length) out.push(err('Post a video or photos, not both'));
      for (const f of videos) {
        if (!['mp4', 'webm', 'mov'].includes(ext(f.name))) out.push(err(`${f.name} must be MP4, WebM or MOV`));
        if (f.size > 4 * GB) out.push(err(`${f.name} is over 4 GB`));
        if (f.duration > 600) out.push(err(`${f.name} is over 10 minutes`));
        if (f.width && (Math.min(f.width, f.height) < 360 || Math.max(f.width, f.height) > 4096))
          out.push(err(`${f.name} is ${f.width}x${f.height}; each side must be 360–4096 px`));
      }
      for (const f of photos) {
        if (!['jpg', 'jpeg', 'webp'].includes(ext(f.name))) out.push(err(`${f.name} must be JPEG or WebP`));
        if (f.size > 20 * MB) out.push(err(`${f.name} is over 20 MB`));
      }
      return out;
    },
    format(meta) {
      return { Caption: captionWithTags(meta) };
    },
  },

  instagram: {
    name: 'Instagram',
    accepts: ['video', 'image'],
    fields: ['description', 'tags'],
    sources: ['https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media'],
    validate(meta, files) {
      const out = [];
      const caption = captionWithTags(meta);
      if (caption.length > 2200) out.push(err(`Caption + hashtags is ${caption.length}/2200 characters`));
      const hashtags = (caption.match(/#[\p{L}\p{N}_]+/gu) || []).length;
      if (hashtags > 30) out.push(err(`${hashtags}/30 hashtags`));
      const mentions = (caption.match(/@[\w.]+/g) || []).length;
      if (mentions > 20) out.push(err(`${mentions}/20 @ tags`));
      const media = files.filter((f) => f.kind !== 'other');
      if (!media.length) out.push(err('Needs a video or image'));
      if (media.length > 10) out.push(err(`${media.length}/10 items (carousel limit)`));
      for (const f of media) {
        if (f.kind === 'video') {
          if (!['mp4', 'mov'].includes(ext(f.name))) out.push(err(`${f.name} must be MP4 or MOV`));
          if (f.size > 300 * MB) out.push(err(`${f.name} is over 300 MB`));
          if (f.duration && (f.duration < 3 || f.duration > 900)) out.push(err(`${f.name} must be 3 seconds to 15 minutes`));
        } else {
          if (!['jpg', 'jpeg'].includes(ext(f.name))) out.push(err(`${f.name} must be JPEG`));
          if (f.size > 8 * MB) out.push(err(`${f.name} is over 8 MB`));
          const r = f.width / f.height;
          if (f.width && (r < 0.8 - 0.005 || r > 1.91 + 0.005))
            out.push(err(`${f.name} aspect ratio ${r.toFixed(2)} must be between 4:5 (0.80) and 1.91:1`));
        }
      }
      return out;
    },
    format(meta) {
      return { Caption: captionWithTags(meta) };
    },
  },
};

function captionWithTags({ description, tags }) {
  const hashtags = tags.map((t) => '#' + t.replace(/\s+/g, '')).join(' ');
  return [description, hashtags].filter(Boolean).join('\n\n');
}

function err(msg) {
  return { level: 'error', msg };
}
function warn(msg) {
  return { level: 'warn', msg };
}

function kindOf(name, mime = '') {
  if (mime.startsWith('video/') || ['mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v'].includes(ext(name))) return 'video';
  if (mime.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext(name))) return 'image';
  return 'other';
}

// Merge project-wide fields with a platform's overrides (blank override = use main value).
function effectiveMeta(project, key) {
  const o = project.platforms[key] || {};
  const pick = (f) => (o[f] !== undefined && o[f] !== '' ? o[f] : project.main[f] ?? '');
  const tags = pick('tags');
  return {
    title: String(pick('title')).trim(),
    description: String(pick('description')),
    tags: (Array.isArray(tags) ? tags : String(tags).split(',')).map((t) => t.trim()).filter(Boolean),
    price: String(pick('price')).trim(),
  };
}

function platformFiles(project, key) {
  const excluded = new Set((project.platforms[key] || {}).excluded || []);
  return project.files.filter((f) => PLATFORMS[key].accepts.includes(f.kind) && !excluded.has(f.name));
}

function check(project, key) {
  const p = PLATFORMS[key];
  const issues = p.validate(effectiveMeta(project, key), platformFiles(project, key));
  const status = issues.some((i) => i.level === 'error') ? 'error' : issues.length ? 'warn' : 'ready';
  return { status, issues };
}

module.exports = { PLATFORMS, kindOf, effectiveMeta, platformFiles, check };
