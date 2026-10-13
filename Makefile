# Build brensch.com with Hugo (in Docker) and publish it on the schlift.com VM.
#   make build     build the committed site (git HEAD) into deploy/out/
#   make deploy    build, then sync it to the VM (Caddy serves /opt/blog/site)
#   make setup-vm  one-time VM setup (directory + Caddy site)
#   make serve     local preview with drafts on :1313
VM ?= opc@146.235.203.8
HUGO ?= hugomods/hugo:git-0.163.3

.PHONY: build deploy setup-vm serve
build:
	rm -rf deploy/out deploy/src && mkdir -p deploy/src
	git archive --format=tar HEAD | tar -x -C deploy/src
	docker run --rm -u $$(id -u):$$(id -g) -v "$(CURDIR)/deploy:/work" -w /work/src $(HUGO) \
		hugo --minify --destination /work/out
	rm -rf deploy/src

deploy: build
	rsync -rlt --delete --chmod=D755,F644 deploy/out/ $(VM):/opt/blog/site/

setup-vm:
	scp deploy/blog.caddyfile $(VM):/tmp/
	ssh $(VM) 'sudo sh -s' < deploy/setup-vm.sh

serve:
	docker run --rm -it -u $$(id -u):$$(id -g) -v "$(CURDIR):/src" -w /src -p 1313:1313 $(HUGO) \
		hugo server --bind 0.0.0.0 -D
