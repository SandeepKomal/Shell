# Shell — Practical DevOps & DevSecOps Scripts

A collection of reusable **Bash scripts for Linux administration, DevOps, cloud, Docker, Kubernetes, AWS, CI/CD, and DevSecOps** tasks.

The goal is simple: provide small scripts that solve common day-to-day operational problems and are easy to understand, modify, and automate with cron or CI/CD.

## Repository structure

```text
Shell/
├── Backup Script/
├── Disk Usage/
├── HTTP Response Times/
├── Listening Ports Script/
├── Monitor System Processes & Memory Usage/
├── Network Connectivity Check/
├── Service Health Check/
├── System Uptime Check/
├── Automatic Package Updates/
├── scripts/
│   ├── check_disk_usage.sh
│   ├── check_http_endpoint.sh
│   ├── check_service.sh
│   ├── check_port.sh
│   ├── process_watch.sh
│   ├── rotate_app_logs.sh
│   ├── find_large_files.sh
│   ├── git_changed_files.sh
│   ├── scan_for_secrets.sh
│   ├── docker_health.sh
│   ├── k8s_pod_health.sh
│   └── aws_resource_count.sh
└── existing Docker/AWS/GCP utilities
```

## Quick start

```bash
git clone https://github.com/SandeepKomal/Shell.git
cd Shell
chmod +x scripts/check_disk_usage.sh
./scripts/check_disk_usage.sh 80
```

## Real-world automation (new)

Scripts for the jobs that come up every week in operations, each with `-h` / `--help`, safe defaults (dry runs before deletes), clear exit codes for cron and CI, and tests in `tests/` and `python/tests/`.

### Shell (`scripts/`)

| Script | What it is for |
| --- | --- |
| `retry.sh` | Retry a flaky command with exponential backoff and jitter: registry pushes, package mirrors, rate-limited APIs |
| `wait_for.sh` | Wait until a `host:port` or URL answers, with a timeout: start an app only when its database is up |
| `ssl_cert_expiry.sh` | Fail when any TLS certificate expires within N days; hosts from arguments or a file |
| `backup_rotate.sh` | Dated `.tar.gz` backup with a SHA-256 checksum, verified after writing, keeping the newest N |
| `release_deploy.sh` | Deploy into `releases/<timestamp>`, switch the `current` symlink atomically, roll back in one command |
| `incident_snapshot.sh` | Read-only snapshot of a host during an incident (load, memory, disks, sockets, kernel and systemd logs) in one archive |
| `deleted_open_files.sh` | "Disk full but du finds nothing": files deleted while a process still holds them open |
| `user_access_audit.sh` | Access review: login shells, extra UID 0 accounts, sudo members, NOPASSWD rules, empty passwords, last logins |
| `git_prune_branches.sh` | Delete branches already merged, locally and optionally on origin; dry run by default, main and release branches protected |
| `preflight_check.sh` | Before a deploy: required commands, environment variables (never printed), free disk, free ports |

```bash
./scripts/retry.sh -n 5 -- docker push registry.example.com/app:1.4.2
./scripts/wait_for.sh -t 60 db:5432 && ./start-app
./scripts/ssl_cert_expiry.sh -w 21 -f hosts.txt
./scripts/backup_rotate.sh -k 14 /srv/app/data /backups
./scripts/release_deploy.sh deploy /srv/app ./build 5
./scripts/release_deploy.sh rollback /srv/app
sudo ./scripts/incident_snapshot.sh /root
sudo ./scripts/deleted_open_files.sh 100
./scripts/git_prune_branches.sh -r          # look first, then add -y
./scripts/preflight_check.sh -c "docker kubectl" -e "IMAGE_TAG" -d /var:5 -p 8080
```

### Python (`python/`)

Standard library only: nothing to install beyond Python 3.9+.

| Script | What it is for |
| --- | --- |
| `log_analyzer.py` | nginx/Apache logs: requests, status mix, 5xx rate, p50/p95/p99 latency, top clients, failing and slowest paths; fails above a 5xx threshold |
| `http_monitor.py` | Check many URLs concurrently for status, body text and latency, with retries: post-deploy smoke tests and cron checks |
| `cert_checker.py` | TLS expiry and validity for many hosts at once, JSON output for dashboards |
| `port_check.py` | Is `host:port` reachable from here? Or, with `--expect closed`, is it properly firewalled? |
| `backup_retention.py` | Grandfather-father-son retention (daily, weekly, monthly) for dated backup files; reports before it deletes |
| `env_validator.py` | Compare `.env` with `.env.example`: missing, empty, placeholder and extra variables, without printing any value |
| `secret_scanner.py` | Committed secrets: cloud keys, tokens, private keys, passwords in URLs; masked output, allowlist, pre-commit friendly |
| `disk_report.py` | Biggest directories and files in one pass on one file system, with an alert threshold |
| `webhook_notify.py` | Send an alert to Slack, Teams, Discord or any JSON webhook; the URL comes from an environment variable |

```bash
zcat /var/log/nginx/access.log.*.gz | python3 python/log_analyzer.py - --top 20
python3 python/http_monitor.py --file endpoints.txt --slow 0.8
python3 python/cert_checker.py example.com api.example.com:8443 --json
python3 python/port_check.py db.internal:5432 cache.internal:6379
python3 python/backup_retention.py /backups --pattern '*.tar.gz'      # then --delete
python3 python/env_validator.py .env
git diff --cached --name-only | python3 python/secret_scanner.py --stdin-files
python3 python/disk_report.py /var --alert-percent 85
./scripts/backup_rotate.sh /srv/data /backups || WEBHOOK_URL=... python3 python/webhook_notify.py "backup failed on $(hostname)" --level error
```

### Tests

```bash
tests/test_scripts.sh                                  # runs the shell scripts in throwaway directories
python3 -m unittest discover -s python/tests -v       # the Python scripts
```

## Day-to-day DevOps utilities

### Linux
```bash
./scripts/check_disk_usage.sh 80
./scripts/check_service.sh nginx
./scripts/check_port.sh 8080
./scripts/process_watch.sh
./scripts/find_large_files.sh /var 500M
./scripts/rotate_app_logs.sh /var/log/myapp.log 5
```

### Application monitoring
```bash
./scripts/check_http_endpoint.sh https://example.com
```

### Docker
```bash
./scripts/docker_health.sh my-container
```

### Kubernetes
```bash
./scripts/k8s_pod_health.sh default
```

### AWS
```bash
./scripts/aws_resource_count.sh us-east-1
```

The AWS script uses the credentials and permissions configured for the AWS CLI and does not create or modify resources.

### DevSecOps
```bash
./scripts/scan_for_secrets.sh
```

This is a lightweight pattern check, not a replacement for dedicated scanners such as Gitleaks or TruffleHog.

## Existing scripts

The repository also contains examples for:

- Backups
- Disk usage
- HTTP response times
- Listening ports
- Network connectivity
- Service health
- System uptime
- Automatic package updates
- Docker cleanup
- AWS resources
- GCP resources
- Git pre-commit checks

## Automation with cron

```bash
crontab -e
```

Example:

```cron
*/15 * * * * /path/to/check_disk_usage.sh 80 >> /var/log/disk-check.log 2>&1
```

Review scheduled jobs:

```bash
crontab -l
```

Prefer absolute paths in cron jobs and ensure the executing user has the required permissions.

## Script design principles

New scripts aim to use:

- `#!/usr/bin/env bash`
- `set -euo pipefail`
- Explicit argument validation
- Non-zero exit codes on failures
- No hard-coded credentials
- Safe variable quoting
- Clear operational output

## Security

Never commit AWS access keys, cloud credentials, API tokens, passwords, private keys, Kubernetes kubeconfigs, or production secrets.

The secret scanning script is only a lightweight first check. Use dedicated security tooling in production CI/CD.

See [SECURITY.md](./SECURITY.md).

## Contributing

Contributions are welcome, especially new practical DevOps scripts, DevSecOps automation, Kubernetes utilities, AWS automation, Linux troubleshooting scripts, bug fixes, and better error handling.

Before submitting a pull request:

1. Test the script in a safe environment.
2. Run ShellCheck where available.
3. Avoid destructive defaults.
4. Never include credentials or secrets.
5. Document required tools and permissions.
6. Explain how the script was tested.

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## Validation

```bash
shellcheck scripts/*.sh
bash -n scripts/check_disk_usage.sh
tests/test_scripts.sh
python3 -m unittest discover -s python/tests
```

CI runs ShellCheck, both test suites and the secret scanner on every pull request.

## Roadmap

- Kubernetes rollout and deployment checks
- EKS health checks
- AWS cost/resource reporting
- ECR image cleanup
- Terraform validation helpers
- Jenkins/GitHub Actions helpers
- Trivy integration
- Gitleaks integration
- Log anomaly detection

## Support the project

If these scripts save you time or help with your DevOps/DevSecOps work, consider giving the repository a star. It helps other engineers discover the toolkit.

## Author

**Sandeep Komal**

Cloud / DevOps Engineer focused on AWS, Kubernetes, Terraform, CI/CD, automation, and DevSecOps.
