# blog

Source for [brensch.com](https://brensch.com) — a minimal, theme-less Hugo blog.

## Develop

```sh
make serve        # http://localhost:1313, drafts included
```

## Deploy

```sh
make deploy       # builds git HEAD with Hugo in Docker, syncs to the VM
```

The site is served by Caddy on the schlift.com VM (Oracle Cloud) from
`/opt/blog/site`; `make setup-vm` sets that up once (`deploy/`).
