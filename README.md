# blog

Source for [brensch.com](https://brensch.com) — a minimal, theme-less Jekyll blog.

## Develop

```sh
docker run --rm -it -v "$PWD:/srv/jekyll" -p 4000:4000 jekyll/jekyll:4 jekyll serve
```

## Build

```sh
docker run --rm -v "$PWD:/srv/jekyll" jekyll/jekyll:4 jekyll build
```

Output goes to `_site/`, which Caddy serves on the homelab box.

## Add a post

Drop a file in `_posts/` named `YYYY-MM-DD-title.md` with front matter:

```yaml
---
layout: post
title: "Your title"
---
```

Then rebuild.
