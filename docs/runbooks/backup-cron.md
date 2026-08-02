# Production Backup Cron (reference)

Installed on the Contabo host outside any container, alongside the
deployment in `docs/runbooks/deploy.md`. Referenced from
`docs/backup-restore.md`.

```cron
# Nightly Postgres dump (02:00) + off-box mirror (02:15)
0 2 * * *  cd /opt/health-house && COMPOSE_PROJECT=hh-prod ./scripts/backup-db.sh /var/backups/health-house/pg >> /var/log/health-house/backup-pg.log 2>&1
15 2 * * * rclone sync /var/backups/health-house/pg remote:health-house-backups/pg >> /var/log/health-house/backup-offbox.log 2>&1

# Nightly MinIO mirror (02:30)
30 2 * * * mc mirror --overwrite hh-prod-food-images remote:health-house-backups/minio/food-images >> /var/log/health-house/backup-minio.log 2>&1
31 2 * * * mc mirror --overwrite hh-prod-user-uploads remote:health-house-backups/minio/user-uploads >> /var/log/health-house/backup-minio.log 2>&1

# Weekly certbot renewal check (Sunday 03:00)
0 3 * * 0  cd /opt/health-house && docker compose -p hh-prod -f infrastructure/docker/compose.base.yml -f infrastructure/docker/compose.prod.yml run --rm certbot renew --webroot -w /var/www/certbot && docker compose -p hh-prod -f infrastructure/docker/compose.base.yml -f infrastructure/docker/compose.prod.yml exec nginx nginx -s reload >> /var/log/health-house/certbot.log 2>&1
```

`rclone`/`mc` remotes are configured once via `rclone config` / `mc alias
set` with credentials for the chosen off-box target (Contabo Object
Storage, Backblaze B2, etc.) — see `docs/backup-restore.md` for why off-box
replication is required, not optional.

Retention is enforced by `scripts/backup-db.sh` itself (newest N dumps kept
locally); the off-box remote should carry its own lifecycle policy (e.g. 90
days) configured on the storage provider side.
