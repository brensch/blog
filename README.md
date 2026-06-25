# blog

Source for [brensch.com](https://brensch.com) — a minimal, theme-less Hugo blog.

## Develop

```sh
docker run --rm -it -v "$PWD:/src" -p 1313:1313 hugomods/hugo:latest \
  hugo server --bind 0.0.0.0 -D
```

## Build

```sh
docker run --rm -v "$PWD:/src" hugomods/hugo:latest hugo --minify
```

Output goes to `public/`, which Caddy serves on the homelab box.

## Add a post

```sh
# create content/posts/my-post.md with front matter:
---
title: "Your title"
date: 2026-06-25
---
```

Then rebuild and the box will pick it up on the next pull + build.
