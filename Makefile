.PHONY: build up down logs

# 生产模式
build:
	docker compose up --build -d

up:
	docker compose up -d

down:
	docker compose down

logs:
	docker compose logs -f
